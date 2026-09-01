import type { EventPayload } from "@gpuix/native"
import type {
  Container,
  EventHandlerMap,
  Instance,
  NativeRenderer,
} from "../types/host.js"
import {
  createGpuixSyntheticEvent,
  type GpuixEventDispatchResult,
  type GpuixSyntheticEvent,
} from "./synthetic-event.js"

const EVENT_REGISTRY_KEY = "__gpuixEventRegistry"

type EventRegistrySlot = {
  containersByRenderer: WeakMap<NativeRenderer, Container>
}

function eventRegistrySlot(): EventRegistrySlot {
  // Bun --hot re-evaluates this module, producing duplicate module instances per reload pass.
  // This slot deliberately makes that duplication HARMLESS (all instances share one registry
  // and ID allocator) rather than preventing it. Do not 'fix' the duplication by
  // de-duplicating module evaluation — the cross-reload event routing depends on this
  // slot surviving re-evaluation.
  const existing = Reflect.get(globalThis, EVENT_REGISTRY_KEY) as EventRegistrySlot | undefined
  if (existing) return existing

  const created: EventRegistrySlot = { containersByRenderer: new WeakMap() }
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

const NON_BUBBLING_EVENTS = new Set(["focus", "blur"])

export function attachRoot(renderer: NativeRenderer, container: Container): void {
  const containersByRenderer = eventRegistrySlot().containersByRenderer
  const owner = containersByRenderer.get(renderer)
  if (owner && owner !== container) {
    throw new Error(
      "This renderer already drives a mounted GPUIX root. One renderer owns one window, one native root id, and one event map, so a second root would silently take both over. Unmount the first root first."
    )
  }
  containersByRenderer.set(renderer, container)
}

/** Only the owner may detach. Otherwise unmounting a rejected or stale root
 *  would delete the live root's event mapping and every handler would go dead. */
export function detachRoot(renderer: NativeRenderer, container: Container): void {
  const containersByRenderer = eventRegistrySlot().containersByRenderer
  if (containersByRenderer.get(renderer) === container) {
    containersByRenderer.delete(renderer)
  }
}

export function containerForRenderer(renderer: NativeRenderer): Container | undefined {
  return eventRegistrySlot().containersByRenderer.get(renderer)
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
  container.hoverPath = nextPath

  for (const target of leaving) {
    dispatchHoverEvent(container, payload, target, "mouseLeave", renderer)
  }
  for (const target of entering) {
    dispatchHoverEvent(container, payload, target, "mouseEnter", renderer)
  }

  return { defaultPrevented: false, propagationStopped: false }
}

function dispatchHoverEvent(
  container: Container,
  payload: EventPayload,
  target: Instance,
  eventType: "mouseEnter" | "mouseLeave",
  renderer: NativeRenderer
): void {
  const handler = container.eventHandlers.get(target.id)?.get(eventType)
  if (!handler) return

  const controller = createGpuixSyntheticEvent(
    { ...payload, elementId: target.id, eventType, hovered: eventType === "mouseEnter" },
    target,
    renderer
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
  if (payload.eventType === "keyDown" && activationKey(payload) === "tab") {
    const defaultPrevented = container.preventedKeyboardActivations.delete(payload.elementId)
    container.native.resolveTabKeyDown?.(defaultPrevented)
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
  if (!container) {
    if (payload.eventType === "keyDown" && activationKey(payload) === "tab") {
      renderer.resolveTabKeyDown?.(false)
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
    handler(event)
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
    // suppress another listener on that same target.
    invoke(target, `${payload.eventType}Capture`, 2)
    invoke(target, payload.eventType, 2)

    if (!event.isPropagationStopped() && !NON_BUBBLING_EVENTS.has(payload.eventType)) {
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
      payload.eventType === "keyDown" &&
      activationKey(payload) === "tab"
    ) {
      finishDispatch({
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.isPropagationStopped(),
      })
    }
  }
}

export function registerEventHandler(
  eventHandlers: EventHandlerMap,
  elementId: number,
  eventType: string,
  handler: (event: GpuixSyntheticEvent) => void
): void {
  let elementHandlers = eventHandlers.get(elementId)
  if (!elementHandlers) {
    elementHandlers = new Map()
    eventHandlers.set(elementId, elementHandlers)
  }
  elementHandlers.set(eventType, handler)
}

export function unregisterEventHandler(
  eventHandlers: EventHandlerMap,
  elementId: number,
  eventType: string
): void {
  const handlers = eventHandlers.get(elementId)
  if (!handlers) return
  handlers.delete(eventType)
  if (handlers.size === 0) eventHandlers.delete(elementId)
}

export function unregisterEventHandlers(
  eventHandlers: EventHandlerMap,
  elementId: number
): void {
  eventHandlers.delete(elementId)
}
