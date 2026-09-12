import type { EventPayload } from "@gpuix/native"
import type {
  Container,
  Instance,
  NativeRenderer,
} from "../types/host.js"
import {
  createGpuixSyntheticEvent,
  type GpuixEventDispatchResult,
  type GpuixSyntheticEvent,
} from "./synthetic-event.js"
// A cycle on paper — `reconciler.js` imports this module for `attachRoot` —
// and harmless in practice: neither module touches the other's bindings while
// they evaluate, only later, from inside a dispatch.
import { flushSync } from "./reconciler.js"
import { TEXT_EDITING_TYPES } from "./text-editing.js"
import { dispatchResizeObservation } from "../resize-observer.js"

const EVENT_REGISTRY_KEY = "__gpuixEventRegistry"

type EventRegistrySlot = {
  containersByRenderer: WeakMap<NativeRenderer, Container>
  /** Attached containers, oldest first, held weakly so an un-unmounted root is
   *  not pinned in memory by this registry alone. */
  attachOrder: WeakRef<Container>[]
}

function eventRegistrySlot(): EventRegistrySlot {
  // Bun --hot re-evaluates this module, producing duplicate module instances per reload pass.
  // This slot deliberately makes that duplication HARMLESS (all instances share one registry
  // and ID allocator) rather than preventing it. Do not 'fix' the duplication by
  // de-duplicating module evaluation — the cross-reload event routing depends on this
  // slot surviving re-evaluation.
  const existing = Reflect.get(globalThis, EVENT_REGISTRY_KEY) as EventRegistrySlot | undefined
  if (existing) {
    // A slot created by a module copy that predates `attachOrder` (an older
    // reload pass, or this field's own introduction crossing a --hot reload)
    // must not make `attachRoot` throw on a missing array.
    existing.attachOrder ??= []
    return existing
  }

  const created: EventRegistrySlot = { containersByRenderer: new WeakMap(), attachOrder: [] }
  Reflect.set(globalThis, EVENT_REGISTRY_KEY, created)
  return created
}

const TARGET_ONLY_EVENTS = new Set([
  "mouseDownOutside",
  "toggleFile",
  "showMore",
  "lineClick",
  "linkClick",
  "visibleRange",
])

const NON_BUBBLING_EVENTS = new Set(["focus", "blur", "scroll", "fileDrop", "load", "error"])
// React delegates resource events: ancestors observe `onLoad` and `onError`
// even though the DOM event's `bubbles` property remains false.
const REACT_DELEGATED_NON_BUBBLING_EVENTS = new Set(["load", "error"])

/**
 * The editor a change event came from, when there is one whose state React
 * might have to restore.
 *
 * Resolved before the dispatch, because it decides how the dispatch runs.
 */
function textEditorTarget(
  payload: EventPayload,
  renderer: NativeRenderer
): Instance | undefined {
  if (payload.eventType !== "change") return undefined
  const container = eventRegistrySlot().containersByRenderer.get(renderer)
  const target = container?.eventTargets.get(payload.elementId)
  return target !== undefined && TEXT_EDITING_TYPES.has(target.type) ? target : undefined
}

/**
 * React DOM's `restoreControlledState`, ported to the native editor.
 *
 * A controlled `<input>` shows `props.value` and nothing else: when a handler
 * declines the edit — an `onChange` that sets no state, or one that filters the
 * text it stores — the browser puts the field back. Nothing else does it. React
 * cannot re-send an unchanged prop (the reconciler diffs props before the FFI,
 * and a handler that changes no state does not even re-render), so without this
 * the editor keeps text the application rejected.
 *
 * The comparison is the emitted value against the prop, not against a fresh
 * read of the editor: they agree exactly when React accepted the edit, and that
 * is the common case, so an accepted keystroke costs no native call at all.
 *
 * **This may only run once React's answer has committed**, which is what the
 * `flushSync` around the dispatch is for. Deciding earlier would read the props
 * React is in the middle of replacing and rewind an edit it *accepted* — and
 * that rewind would stick, because the value React commits a moment later looks
 * to the editor like an echo of the edit it just reported, and is dropped.
 */
function restoreControlledEditor(
  target: Instance,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  // The editor may have unmounted, or its id been reused, during the dispatch.
  const container = eventRegistrySlot().containersByRenderer.get(renderer)
  if (container?.eventTargets.get(payload.elementId) !== target) return
  const declared = (target.props as { value?: unknown }).value
  // `value == null` is React's own test for an uncontrolled field: no prop owns
  // the text, so there is nothing to restore it to. This is what keeps typing
  // and imperative `ref.value` writes on an uncontrolled input.
  if (declared === null || declared === undefined) return
  const value = String(declared)
  if (value === payload.value) return
  renderer.setInputValue?.(payload.elementId, value)
}

export function attachRoot(renderer: NativeRenderer, container: Container): void {
  const slot = eventRegistrySlot()
  const owner = slot.containersByRenderer.get(renderer)
  if (owner && owner !== container) {
    throw new Error(
      "This renderer already drives a mounted GPUIX root. One renderer owns one window, one native root id, and one event map, so a second root would silently take both over. Unmount the first root first."
    )
  }
  slot.containersByRenderer.set(renderer, container)
  // Drop dead refs and any earlier ref to this same container (re-attaching
  // after a detach) before recording it as the newest.
  slot.attachOrder = slot.attachOrder.filter((ref) => {
    const target = ref.deref()
    return target !== undefined && target !== container
  })
  slot.attachOrder.push(new WeakRef(container))
}

/** Only the owner may detach. Otherwise unmounting a rejected or stale root
 *  would delete the live root's event mapping and every handler would go dead. */
export function detachRoot(renderer: NativeRenderer, container: Container): void {
  const slot = eventRegistrySlot()
  if (slot.containersByRenderer.get(renderer) === container) {
    slot.containersByRenderer.delete(renderer)
  }
  slot.attachOrder = slot.attachOrder.filter((ref) => {
    const target = ref.deref()
    return target !== undefined && target !== container
  })
}

export function containerForRenderer(renderer: NativeRenderer): Container | undefined {
  return eventRegistrySlot().containersByRenderer.get(renderer)
}

/**
 * The window `announce()` targets: the newest attached container that has
 * actually rendered a root element, scanning from the most recently attached.
 * A root that attached after this one but has not rendered yet (or has since
 * unmounted, per `rootElementId` going back to `null`) is skipped rather than
 * making `announce()` warn while a usable, slightly older root is available.
 */
export function latestAttachedContainer(): Container | undefined {
  const slot = eventRegistrySlot()
  for (let index = slot.attachOrder.length - 1; index >= 0; index -= 1) {
    const container = slot.attachOrder[index]!.deref()
    if (container === undefined) {
      slot.attachOrder.splice(index, 1)
      continue
    }
    if (container.rootElementId != null) return container
  }
  return undefined
}

function eventPath(container: Container, target: Instance): Instance[] {
  const path = [target]
  const visited = new Set([target.id])
  let parentId = target.parentId

  while (parentId != null && !visited.has(parentId)) {
    const parent = container.eventTargets.get(parentId)
    if (!parent) break
    path.push(parent)
    visited.add(parentId)
    parentId = parent.parentId
  }

  return path
}

function rememberDragOverPrevention(
  container: Container,
  payload: EventPayload,
  defaultPrevented: boolean
): void {
  if (payload.eventType !== "dragOver") return
  const target = container.eventTargets.get(payload.elementId)
  if (!target) return
  for (const instance of eventPath(container, target)) {
    container.preventedDragOvers.set(instance.id, defaultPrevented)
  }
}

function clearDragOverPrevention(container: Container, payload: EventPayload): void {
  if (payload.eventType !== "dragLeave" && payload.eventType !== "fileDrop") return
  container.preventedDragOvers.clear()
}

function acceptsDrop(container: Container, payload: EventPayload): boolean {
  if (payload.eventType !== "fileDrop") return false
  const target = container.eventTargets.get(payload.elementId)
  if (!target) return false
  return eventPath(container, target).some(
    (instance) => container.preventedDragOvers.get(instance.id) === true
  )
}

/**
 * Native hover hit testing reports one painted element. DOM mouseenter and
 * mouseleave instead describe the change between the old and new ancestry:
 * leave the old branch from inside out, then enter the new branch from outside
 * in. This keeps a painted descendant from hiding its listeners' ancestors.
 */
function dispatchHoverTransition(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer
): GpuixEventDispatchResult {
  const nextTarget = payload.hovered ? container.eventTargets.get(payload.elementId) : undefined
  const previousPath = container.hoverPath
  const nextPath = nextTarget ? eventPath(container, nextTarget) : []

  let shared = 0
  while (
    shared < previousPath.length &&
    shared < nextPath.length &&
    previousPath[previousPath.length - 1 - shared]?.id === nextPath[nextPath.length - 1 - shared]?.id
  ) {
    shared += 1
  }

  const leaving = previousPath.slice(0, previousPath.length - shared)
  const entering = nextPath.slice(0, nextPath.length - shared).reverse()
  // `MouseEvent.relatedTarget` names the other side of the transition: what a
  // leave moved to, and where an enter came from. Each is the deepest hovered
  // element on its side, and null when the pointer came from or went to
  // nothing this tree painted.
  const previousTarget = previousPath[0] ?? null
  container.hoverPath = nextPath

  for (const target of leaving) {
    dispatchHoverEvent(container, payload, target, "mouseLeave", renderer, nextTarget ?? null)
  }
  for (const target of entering) {
    dispatchHoverEvent(container, payload, target, "mouseEnter", renderer, previousTarget)
  }

  return { defaultPrevented: false, propagationStopped: false }
}

function dispatchHoverEvent(
  container: Container,
  payload: EventPayload,
  target: Instance,
  eventType: "mouseEnter" | "mouseLeave",
  renderer: NativeRenderer,
  relatedTarget: Instance | null
): void {
  const handler = container.eventHandlers.get(target.id)?.get(eventType)
  if (!handler) return

  const controller = createGpuixSyntheticEvent(
    { ...payload, elementId: target.id, eventType, hovered: eventType === "mouseEnter" },
    target,
    renderer,
    relatedTarget
  )
  controller.setCurrentTarget(target, 2)
  handler(controller.event)
}

function activationKey(payload: EventPayload): string | null {
  if (payload.eventType !== "keyDown" && payload.eventType !== "keyUp") return null
  if (payload.modifiers?.alt || payload.modifiers?.ctrl || payload.modifiers?.cmd) {
    return null
  }

  const key = payload.key?.toLowerCase()
  if (key === "tab") return "tab"
  if (payload.modifiers?.shift) return null
  if (key === "enter") return "enter"
  return key === "space" || key === "spacebar" || key === " " ? "space" : null
}

function rememberKeyboardPrevention(
  container: Container,
  payload: EventPayload,
  defaultPrevented: boolean
): void {
  if (payload.eventType !== "keyDown" && payload.eventType !== "keyUp") return

  const key = activationKey(payload)
  if (!key) {
    container.preventedKeyboardActivations.delete(payload.elementId)
    return
  }
  if (key === "tab" && payload.eventType === "keyUp") {
    container.preventedKeyboardActivations.delete(payload.elementId)
    return
  }

  if (defaultPrevented) {
    container.preventedKeyboardActivations.set(payload.elementId, key)
  } else if (
    payload.eventType === "keyDown" ||
    container.preventedKeyboardActivations.get(payload.elementId) !== key
  ) {
    container.preventedKeyboardActivations.delete(payload.elementId)
  }
}

function shouldSuppressKeyboardClick(container: Container, payload: EventPayload): boolean {
  if (payload.eventType !== "click" || payload.inputSource !== "keyboard") return false
  return container.preventedKeyboardActivations.delete(payload.elementId)
}

function finishKeyboardDispatch(
  container: Container,
  payload: EventPayload,
  result: GpuixEventDispatchResult
): GpuixEventDispatchResult {
  rememberKeyboardPrevention(container, payload, result.defaultPrevented)
  if (payload.eventType === "keyDown") {
    container.native.resolveScrollKeyDown?.(result.defaultPrevented)
  }
  if (payload.eventType === "keyDown" && activationKey(payload) === "tab") {
    const defaultPrevented = container.preventedKeyboardActivations.delete(payload.elementId)
    container.native.resolveTabKeyDown?.(defaultPrevented)
  }
  if (payload.eventType === "keyDown" && activationKey(payload) !== "tab") {
    container.native.resolveEditorKeyDown?.(payload.elementId, result.defaultPrevented)
  }
  return result
}

/**
 * Dispatch a native payload synchronously through the retained host ancestry.
 *
 * The return value is the cancellation contract for host defaults: callers
 * that synthesize a follow-up action must not perform it when
 * `defaultPrevented` is true. GPUIX uses the same result to discard the
 * keyboard-generated click that follows a prevented Enter or Space event.
 */
export function handleGpuixEvent(
  payload: EventPayload,
  renderer: NativeRenderer
): GpuixEventDispatchResult {
  // A change on a text editor is a **discrete** event, as `input` and `change`
  // are in the DOM, and the only kind GPUIX treats that way. The host config
  // reports `DefaultEventPriority` for everything, so a handler's `setState`
  // normally only schedules work — the commit lands a macrotask later. That is
  // fine for a click, and fatal here: the restore below has to tell an edit
  // React accepted from one it refused, and it can only do that once React's
  // answer has committed. `flushSync` makes this one dispatch behave as a
  // discrete event does, committing before it returns. Every other event keeps
  // the priority it had.
  const editor = textEditorTarget(payload, renderer)
  const container = eventRegistrySlot().containersByRenderer.get(renderer)
  if (container && payload.eventType === "dragOver") {
    // A new move replaces the one acceptance path, even if native retargeting
    // did not deliver an intermediate dragLeave.
    container.preventedDragOvers.clear()
  }
  const dropAccepted = container ? acceptsDrop(container, payload) : false
  try {
    const result = editor
      ? flushSync(() => dispatchGpuixEvent(payload, renderer))
      : dispatchGpuixEvent(payload, renderer)

    if (container && payload.eventType === "dragOver") {
      rememberDragOverPrevention(container, payload, result.defaultPrevented)
    }
    if (payload.eventType === "fileDrop") {
      if (dropAccepted) {
        dispatchGpuixEvent({ ...payload, eventType: "drop" }, renderer)
      }
      return result
    }

    if (
      payload.eventType === "click" &&
      payload.clickCount === 2 &&
      (payload.button ?? 0) === 0 &&
      payload.isRightClick !== true &&
      // Two keyboard activations are two clicks, never a double click.
      payload.inputSource !== "keyboard"
    ) {
      dispatchGpuixEvent({ ...payload, eventType: "doubleClick" }, renderer)
    } else if (payload.eventType === "mouseDown" && payload.button === 2) {
      // macOS opens a context menu on the press, so contextmenu follows
      // mousedown and precedes mouseup and auxclick, as it does in the DOM.
      dispatchGpuixEvent(
        { ...payload, eventType: "contextMenu", isRightClick: true },
        renderer
      )
    }

    // After the handlers and after their commit, never before.
    if (editor) restoreControlledEditor(editor, payload, renderer)

    return result
  } finally {
    // Terminal drag events retire the complete path even when their target was
    // destroyed or a handler throws before normal cleanup runs.
    if (container && (payload.eventType === "dragLeave" || payload.eventType === "fileDrop")) {
      clearDragOverPrevention(container, payload)
    }
  }
}

function dispatchGpuixEvent(
  payload: EventPayload,
  renderer: NativeRenderer
): GpuixEventDispatchResult {
  if (payload.eventType === "resizeObservation") {
    return dispatchResizeObservation(payload, renderer)
  }
  const container = eventRegistrySlot().containersByRenderer.get(renderer)
  if (!container) {
    if (payload.eventType === "keyDown") {
      renderer.resolveScrollKeyDown?.(false)
    }
    if (payload.eventType === "keyDown" && activationKey(payload) === "tab") {
      renderer.resolveTabKeyDown?.(false)
    }
    if (payload.eventType === "keyDown" && activationKey(payload) !== "tab") {
      renderer.resolveEditorKeyDown?.(payload.elementId, false)
    }
    return { defaultPrevented: false, propagationStopped: false }
  }

  if (payload.eventType === "hoverTarget") {
    return dispatchHoverTransition(container, payload, renderer)
  }

  if (shouldSuppressKeyboardClick(container, payload)) {
    return { defaultPrevented: true, propagationStopped: false }
  }

  const target = container.eventTargets.get(payload.elementId)
  if (!target) {
    return finishKeyboardDispatch(container, payload, {
      defaultPrevented: false,
      propagationStopped: false,
    })
  }

  if (
    (payload.eventType === "load" || payload.eventType === "error") &&
    payload.imageRequestGeneration !== undefined &&
    payload.imageRequestGeneration !== target.imageRequestGeneration
  ) {
    return { defaultPrevented: false, propagationStopped: false }
  }

  const path = TARGET_ONLY_EVENTS.has(payload.eventType) ? [target] : eventPath(container, target)
  const controller = createGpuixSyntheticEvent(payload, target, renderer)
  const { event } = controller
  let keyboardDispatchFinished = false

  const finishDispatch = (result: GpuixEventDispatchResult): GpuixEventDispatchResult => {
    keyboardDispatchFinished = true
    return finishKeyboardDispatch(container, payload, result)
  }

  const invoke = (instance: Instance, handlerKey: string, phase: 1 | 2 | 3): void => {
    const handler = container.eventHandlers.get(instance.id)?.get(handlerKey)
    if (!handler) return
    controller.setCurrentTarget(instance, phase)
    if (payload.eventType === "fileDrop" && handlerKey === "fileDrop") {
      handler(payload as unknown as GpuixSyntheticEvent)
    } else {
      handler(event)
    }
  }

  try {
    // Capture travels from the root toward, but not including, the target.
    for (let index = path.length - 1; index >= 1; index -= 1) {
      invoke(path[index]!, `${payload.eventType}Capture`, 1)
      if (event.isPropagationStopped()) {
        return finishDispatch({
          defaultPrevented: event.defaultPrevented,
          propagationStopped: true,
        })
      }
    }

    // Both listeners on the target run at AT_TARGET. stopPropagation does not
    // suppress another listener on that same target; stopImmediatePropagation
    // is the one that does.
    invoke(target, `${payload.eventType}Capture`, 2)
    if (!controller.isImmediatePropagationStopped()) {
      invoke(target, payload.eventType, 2)
    }

    if (
      !event.isPropagationStopped() &&
      (!NON_BUBBLING_EVENTS.has(payload.eventType) ||
        REACT_DELEGATED_NON_BUBBLING_EVENTS.has(payload.eventType))
    ) {
      for (let index = 1; index < path.length; index += 1) {
        invoke(path[index]!, payload.eventType, 3)
        if (event.isPropagationStopped()) break
      }
    }

    return finishDispatch({
      defaultPrevented: event.defaultPrevented,
      propagationStopped: event.isPropagationStopped(),
    })
  } finally {
    if (
      !keyboardDispatchFinished &&
      payload.eventType === "keyDown"
    ) {
      finishDispatch({
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.isPropagationStopped(),
      })
    }
  }
}
