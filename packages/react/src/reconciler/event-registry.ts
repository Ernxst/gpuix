import type { EventPayload } from "@gpuix/native"
import type {
  Container,
  Instance,
  NativeRenderer,
  Props,
} from "../types/host.js"
import {
  createGpuixSyntheticEvent,
  type GpuixEventDispatchResult,
  type GpuixSyntheticEvent,
} from "./synthetic-event.js"
import { editorPropText, isTextEditingInstance } from "./text-editing.js"
import {
  beginChoiceActivation,
  buttonType,
  formOwner,
  isChoiceInput,
  isLabelable,
  isRangeInput,
  isUnreachable,
  labeledControl,
  radioGroup,
  readChecked,
  requestSubmit,
  rangeStepTarget,
  resetForm,
  restoreControlledChoices,
  restoreControlledRange,
  stepRange,
} from "./form-controls.js"
import { dispatchResizeObservation } from "../resize-observer.js"
import { finishEventDispatch, type GpuixDispatchableEvent } from "../pointer-event.js"
import {
  dispatchDocumentPointerEvent,
  dropDocumentListeners,
  isDocumentPointerEvent,
} from "../document-listeners.js"

/**
 * React's `flushSync`, installed by `reconciler.ts` once the reconciler exists.
 *
 * Importing it from there would close a cycle that breaks on load order:
 * `host-config.ts` imports this module for `click()`, and `reconciler.ts`
 * builds the reconciler from `hostConfig` as it evaluates, so a graph entered
 * through `host-config.ts` would reach `reconciler.ts` before `hostConfig`
 * exists.
 */
let flushSync: <R>(fn: () => R) => R = (fn) => fn()

export function installFlushSync(implementation: <R>(fn: () => R) => R): void {
  flushSync = implementation
}

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

const NON_BUBBLING_EVENTS = new Set(["scroll", "fileDrop", "load", "error"])
// React delegates resource events: ancestors observe `onLoad` and `onError`
// even though the DOM event's `bubbles` property remains false.
const REACT_DELEGATED_NON_BUBBLING_EVENTS = new Set(["load", "error"])
const HOVER_TRANSITION_EVENTS = new Set(["pointerEnter", "pointerLeave"])

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
  return target !== undefined && isTextEditingInstance(target) ? target : undefined
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
  // `value == null` is React's own test for an uncontrolled field: no prop owns
  // the text, so there is nothing to restore it to. This is what keeps typing
  // and imperative `ref.value` writes on an uncontrolled input.
  const value = editorPropText((target.props as { value?: unknown }).value)
  if (value === undefined || value === payload.value) return
  renderer.setInputValue?.(payload.elementId, value)
}

function isActionDisabled(instance: Instance): boolean {
  const props = instance.props as Props & Record<string, unknown>
  const ariaDisabled = props.ariaDisabled ?? props["aria-disabled"]
  return (
    isNativelyDisabled(instance) ||
    ariaDisabled === true ||
    (typeof ariaDisabled === "string" && ariaDisabled.toLowerCase() === "true")
  )
}

function isNativelyDisabled(instance: Instance): boolean {
  const { disabled } = instance.props
  return disabled === true || typeof disabled === "string"
}

/**
 * A click on a checkbox or radio: HTML's legacy-pre-activation flips the state
 * before the click is dispatched, and a prevented click puts it back.
 *
 * `onChange` follows `onClick` whenever the state changed, prevented or not,
 * as it does in ReactDOM, whose change plugin reads the flipped state before
 * the browser reverts it. The change event's `nativeEvent.defaultPrevented`
 * reports the prevention, which is what Base UI checks before accepting it.
 *
 * The dispatch runs under `flushSync` for the same reason a text edit's does:
 * restoring a controlled input has to tell a change React accepted from one it
 * refused, and it can only do that once React's answer has committed.
 */
function runChoiceClick(
  container: Container,
  target: Instance,
  payload: EventPayload,
  renderer: NativeRenderer,
  dispatched?: GpuixDispatchableEvent
): GpuixEventDispatchResult {
  const activation = beginChoiceActivation(container, target)
  if (activation === undefined) return dispatchGpuixEvent(payload, renderer, dispatched)

  let result: GpuixEventDispatchResult = { defaultPrevented: false, propagationStopped: false }
  flushSync(() => {
    result = dispatchGpuixEvent(payload, renderer, dispatched)
    if (activation.changed) {
      dispatchGpuixEvent(
        {
          elementId: target.id,
          eventType: "change",
          checked: readChecked(target),
          defaultPrevented: result.defaultPrevented,
        } as EventPayload,
        renderer
      )
    }
    if (result.defaultPrevented) activation.cancel()
  })
  restoreControlledChoices(container, target)
  return result
}

/**
 * A click and the activation behaviour that follows it when it is not
 * prevented. `dispatched` is the event object behind a `dispatchEvent()` call.
 */
function runClick(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer,
  dispatched?: GpuixDispatchableEvent
): GpuixEventDispatchResult {
  // A prevented Space or Enter keydown means no click, so a checkbox or radio
  // must not flip, or report a change, before the dispatch would drop it.
  if (shouldSuppressKeyboardClick(container, payload)) {
    return { defaultPrevented: true, propagationStopped: false }
  }
  const target = container.eventTargets.get(payload.elementId)
  const result =
    target !== undefined && isChoiceInput(target)
      ? runChoiceClick(container, target, payload, renderer, dispatched)
      : dispatchGpuixEvent(payload, renderer, dispatched)
  if (!result.defaultPrevented) runClickDefault(container, payload, renderer)
  return result
}

function isInteractiveContent(instance: Instance): boolean {
  if (isLabelable(instance)) return true
  return instance.type === "a" && typeof (instance.props as { href?: unknown }).href === "string"
}

/**
 * The activation behaviour of the nearest activatable element on the click's
 * path. Interactive content inside a `<label>` keeps the click for itself, so
 * clicking a control inside its own label activates it once, not twice.
 */
function runClickDefault(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  const target = container.eventTargets.get(payload.elementId)
  if (!target) return
  for (const instance of eventPath(container, target)) {
    if (instance.type === "button") {
      runButtonDefault(container, instance)
      return
    }
    if (isInteractiveContent(instance)) return
    if (instance.type === "label") {
      runLabelDefault(container, instance, payload, renderer)
      return
    }
  }
}

function runLabelDefault(
  container: Container,
  label: Instance,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  const control = labeledControl(container, label)
  if (!control || isActionDisabled(control)) return
  if (control.type === "input" || control.type === "textarea") {
    renderer.focusElement?.(control.id)
  }
  runClick(container, { ...payload, elementId: control.id, clickCount: 1 }, renderer)
}

/** A submit or reset button's activation behaviour on its form owner. */
function runButtonDefault(container: Container, button: Instance): void {
  if (isNativelyDisabled(button)) return
  const type = buttonType(button)
  if (type === "button") return
  const form = formOwner(container, button)
  if (form === null) return
  if (type === "reset") resetForm(container, form)
  else requestSubmit(container, form, button)
}

const RADIO_ARROW_STEPS: Readonly<Record<string, number>> = {
  down: 1,
  right: 1,
  up: -1,
  left: -1,
}

/**
 * Arrow keys on a radio check the next or previous enabled member of its
 * group, wrapping at either end, and move focus with the selection. The newly
 * checked radio receives the click, and the `change`, that a browser fires.
 */
function runRadioKeyDefault(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  if (payload.modifiers?.alt || payload.modifiers?.ctrl || payload.modifiers?.cmd) return
  if (payload.modifiers?.shift) return
  const step = RADIO_ARROW_STEPS[payload.key?.toLowerCase() ?? ""]
  if (step === undefined) return
  const target = container.eventTargets.get(payload.elementId)
  if (!target || !isChoiceInput(target) || isNativelyDisabled(target)) return
  const group = radioGroup(container, target).filter(
    (member) =>
      member === target || (!isNativelyDisabled(member) && !isUnreachable(container, member))
  )
  if (group.length < 2) return
  const index = group.indexOf(target)
  const next = group[(index + step + group.length) % group.length]!
  renderer.focusElement?.(next.id)
  runClick(container, { elementId: next.id, eventType: "click", clickCount: 0 } as EventPayload, renderer)
}

const RANGE_KEY_ACTIONS: Readonly<
  Record<string, "increment" | "decrement" | "home" | "end" | "pageUp" | "pageDown">
> = {
  up: "increment",
  right: "increment",
  down: "decrement",
  left: "decrement",
  pageup: "pageUp",
  pagedown: "pageDown",
  home: "home",
  end: "end",
}

/**
 * A range's value change from its keyboard or assistive-technology default:
 * the value moves and `change` follows, which is the event React's `onChange`
 * listens for on a range. Like a choice click, it runs under `flushSync` so a
 * controlled range can be put back once React's answer has committed.
 */
function runRangeChange(
  container: Container,
  target: Instance,
  value: number,
  renderer: NativeRenderer
): void {
  flushSync(() => {
    if (!stepRange(container, target, value)) return
    dispatchGpuixEvent(
      { elementId: target.id, eventType: "change", value: String(value) } as EventPayload,
      renderer
    )
  })
  restoreControlledRange(container, target)
}

/**
 * Arrow keys step a range, Page Up and Page Down move it a tenth of the way,
 * and Home and End jump to its ends. Up and Right increase it whatever its
 * orientation or direction.
 */
function runRangeKeyDefault(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  if (payload.modifiers?.alt || payload.modifiers?.ctrl || payload.modifiers?.cmd) return
  const action = RANGE_KEY_ACTIONS[payload.key?.toLowerCase() ?? ""]
  if (action === undefined) return
  const target = container.eventTargets.get(payload.elementId)
  if (!target || !isRangeInput(target) || isNativelyDisabled(target)) return
  runRangeChange(container, target, rangeStepTarget(target, action), renderer)
}

/** Assistive technology's increment and decrement actions step a range, as a key press would. */
function runRangeAccessibilityAction(
  container: Container,
  payload: EventPayload,
  renderer: NativeRenderer
): void {
  const action = payload.accessibilityAction
  if (action !== "increment" && action !== "decrement") return
  const target = container.eventTargets.get(payload.elementId)
  if (!target || !isRangeInput(target) || isNativelyDisabled(target)) return
  runRangeChange(container, target, rangeStepTarget(target, action), renderer)
}

/**
 * `HTMLElement.click()`: a click through the usual capture and bubble path,
 * followed by its activation behaviour. A disabled form control ignores it.
 */
export function clickElement(container: Container, instance: Instance): void {
  const formControl =
    instance.type === "input" || instance.type === "textarea" || instance.type === "button"
  if (formControl && isNativelyDisabled(instance)) return
  runClick(
    container,
    { elementId: instance.id, eventType: "click", clickCount: 0 } as EventPayload,
    container.native
  )
}

/** DOM pointer event types and the GPUIX event each one dispatches as. */
const DISPATCHABLE_EVENT_TYPES: Readonly<Record<string, string>> = {
  click: "click",
  pointerdown: "pointerDown",
  pointerup: "pointerUp",
  pointermove: "pointerMove",
  pointercancel: "pointerCancel",
  pointerenter: "pointerEnter",
  pointerleave: "pointerLeave",
}

/** Events inside a `dispatchEvent()` call, which the DOM refuses to re-dispatch. */
const dispatchingEvents = new WeakSet<object>()

/**
 * `EventTarget.dispatchEvent()` for a JS-created pointer event: the matching
 * handlers run through the usual capture, target, and bubble path, and a click
 * then runs its activation behaviour unless a handler prevented it, as an
 * untrusted click does in a browser. The return value is the DOM's: `false`
 * when the event was canceled, `true` otherwise. As with `click()`, a disabled
 * form control takes no click at all. An event whose propagation was stopped
 * before the call reaches no handler.
 *
 * Only the types in {@link DISPATCHABLE_EVENT_TYPES} reach handlers. Any
 * other type has no GPUIX listener to run, as a browser element has none for
 * a type nothing listens to.
 */
export function dispatchElementEvent(
  container: Container,
  instance: Instance,
  event: GpuixDispatchableEvent
): boolean {
  if (typeof event !== "object" || event === null || typeof event.type !== "string") {
    throw new TypeError(
      "Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'."
    )
  }
  if (dispatchingEvents.has(event)) {
    throw new DOMException(
      "Failed to execute 'dispatchEvent': The event is already being dispatched.",
      "InvalidStateError"
    )
  }
  const eventType = DISPATCHABLE_EVENT_TYPES[event.type]
  const formControl =
    instance.type === "input" || instance.type === "textarea" || instance.type === "button"
  if (
    eventType === undefined ||
    container.eventTargets.get(instance.id) !== instance ||
    (eventType === "click" && formControl && isNativelyDisabled(instance))
  ) {
    return !event.defaultPrevented
  }

  const payload = {
    elementId: instance.id,
    eventType,
    clickCount: event.detail ?? 0,
    x: event.clientX ?? 0,
    y: event.clientY ?? 0,
    button: event.button ?? 0,
    buttons: event.buttons ?? 0,
    pointerId: event.pointerId ?? 0,
    pointerType: event.pointerType ?? "",
    isPrimary: event.isPrimary ?? false,
    modifiers: {
      alt: event.altKey === true,
      ctrl: event.ctrlKey === true,
      shift: event.shiftKey === true,
      cmd: event.metaKey === true,
    },
  } as EventPayload
  dispatchingEvents.add(event)
  try {
    const result =
      eventType === "click"
        ? runClick(container, payload, container.native, event)
        : dispatchGpuixEvent(payload, container.native, event)
    return !result.defaultPrevented
  } finally {
    dispatchingEvents.delete(event)
    finishEventDispatch(event)
  }
}

/**
 * Dispatch an event this renderer synthesizes in JS, such as `submit` and
 * `reset`, through the normal capture and bubble path. `extra` lands on the
 * event object, as every payload field does.
 */
export function dispatchSyntheticEvent(
  container: Container,
  target: Instance,
  eventType: string,
  extra: Record<string, unknown>
): GpuixEventDispatchResult {
  return dispatchGpuixEvent(
    { elementId: target.id, eventType, ...extra } as EventPayload,
    container.native
  )
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
  dropDocumentListeners(container)
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
    dispatchHoverEvent(container, payload, target, "pointerLeave", renderer, nextTarget ?? null)
    dispatchHoverEvent(container, payload, target, "mouseLeave", renderer, nextTarget ?? null)
  }
  for (const target of entering) {
    dispatchHoverEvent(container, payload, target, "pointerEnter", renderer, previousTarget)
    dispatchHoverEvent(container, payload, target, "mouseEnter", renderer, previousTarget)
  }

  return { defaultPrevented: false, propagationStopped: false }
}

function dispatchHoverEvent(
  container: Container,
  payload: EventPayload,
  target: Instance,
  eventType: "mouseEnter" | "mouseLeave" | "pointerEnter" | "pointerLeave",
  renderer: NativeRenderer,
  relatedTarget: Instance | null
): void {
  const handler = container.eventHandlers.get(target.id)?.get(eventType)
  if (!handler) return

  const controller = createGpuixSyntheticEvent(
    {
      ...payload,
      elementId: target.id,
      eventType,
      hovered: eventType === "mouseEnter" || eventType === "pointerEnter",
    },
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
  const container = eventRegistrySlot().containersByRenderer.get(renderer)
  // A window pointer event has no element target; it exists only for the
  // listeners on the document facade.
  if (isDocumentPointerEvent(payload.eventType)) {
    if (container) dispatchDocumentPointerEvent(container, payload)
    return { defaultPrevented: false, propagationStopped: false }
  }
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
  if (container && payload.eventType === "dragOver") {
    // A new move replaces the one acceptance path, even if native retargeting
    // did not deliver an intermediate dragLeave.
    container.preventedDragOvers.clear()
  }
  const dropAccepted = container ? acceptsDrop(container, payload) : false
  try {
    const result = editor
      ? flushSync(() => dispatchGpuixEvent(payload, renderer))
      : container && payload.eventType === "click"
        ? runClick(container, payload, renderer)
        : dispatchGpuixEvent(payload, renderer)

    if (container && payload.eventType === "keyDown" && !result.defaultPrevented) {
      runRadioKeyDefault(container, payload, renderer)
      runRangeKeyDefault(container, payload, renderer)
    }
    if (container && payload.eventType === "accessibilityAction" && !result.defaultPrevented) {
      runRangeAccessibilityAction(container, payload, renderer)
    }

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
  renderer: NativeRenderer,
  dispatched?: GpuixDispatchableEvent
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

  if (payload.eventType === "selectionChange") {
    if (payload.elementId === container.windowSelectionEventId) {
      container.onSelectionChange?.({ ...payload, elementId: 0 }, renderer)
    }
    return { defaultPrevented: false, propagationStopped: false }
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

  const currentImageRequestGeneration =
    payload.eventType === "load" || payload.eventType === "error"
      ? renderer.getImageRequestGeneration?.(payload.elementId)
      : undefined
  if (
    payload.imageRequestGeneration !== undefined &&
    currentImageRequestGeneration != null &&
    payload.imageRequestGeneration !== currentImageRequestGeneration
  ) {
    return { defaultPrevented: false, propagationStopped: false }
  }

  const path = TARGET_ONLY_EVENTS.has(payload.eventType) ? [target] : eventPath(container, target)
  const controller = createGpuixSyntheticEvent(payload, target, renderer, null, dispatched)
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
    // A dispatched event whose propagation was stopped before dispatch
    // reaches no listener.
    if (event.isPropagationStopped()) {
      return finishDispatch({ defaultPrevented: event.defaultPrevented, propagationStopped: true })
    }

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

    const bubbles = dispatched
      ? // Enter and leave run on their target alone, as React's own do.
        dispatched.bubbles && !HOVER_TRANSITION_EVENTS.has(payload.eventType)
      : !NON_BUBBLING_EVENTS.has(payload.eventType) ||
        REACT_DELEGATED_NON_BUBBLING_EVENTS.has(payload.eventType)
    if (!event.isPropagationStopped() && bubbles) {
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
