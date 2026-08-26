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
  const existing = Reflect.get(globalThis, EVENT_REGISTRY_KEY) as EventRegistrySlot | undefined
  if (existing) return existing

  const created: EventRegistrySlot = { containersByRenderer: new WeakMap() }
  Reflect.set(globalThis, EVENT_REGISTRY_KEY, created)
  return created
}

const NON_BUBBLING_EVENTS = new Set([
  "mouseEnter",
  "mouseLeave",
  "mouseDownOutside",
  "toggleFile",
  "showMore",
  "lineClick",
  "linkClick",
  "visibleRange",
])

export function attachRoot(renderer: NativeRenderer, container: Container): void {
  eventRegistrySlot().containersByRenderer.set(renderer, container)
}

export function detachRoot(renderer: NativeRenderer): void {
  eventRegistrySlot().containersByRenderer.delete(renderer)
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

function activationKey(payload: EventPayload): string | null {
  if (payload.eventType !== "keyDown" && payload.eventType !== "keyUp") return null
  if (
    payload.modifiers?.alt ||
    payload.modifiers?.ctrl ||
    payload.modifiers?.cmd ||
    payload.modifiers?.shift
  ) {
    return null
  }

  const key = payload.key?.toLowerCase()
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
  if (!container) return { defaultPrevented: false, propagationStopped: false }

  if (shouldSuppressKeyboardClick(container, payload)) {
    return { defaultPrevented: true, propagationStopped: false }
  }

  const target = container.eventTargets.get(payload.elementId)
  if (!target) return { defaultPrevented: false, propagationStopped: false }

  const path = NON_BUBBLING_EVENTS.has(payload.eventType)
    ? [target]
    : eventPath(container, target)
  const controller = createGpuixSyntheticEvent(payload, target, renderer)
  const { event } = controller

  const invoke = (instance: Instance, handlerKey: string, phase: 1 | 2 | 3): void => {
    const handler = container.eventHandlers.get(instance.id)?.get(handlerKey)
    if (!handler) return
    controller.setCurrentTarget(instance, phase)
    handler(event)
  }

  // Capture travels from the root toward, but not including, the target.
  for (let index = path.length - 1; index >= 1; index -= 1) {
    invoke(path[index]!, `${payload.eventType}Capture`, 1)
    if (event.isPropagationStopped()) {
      rememberKeyboardPrevention(container, payload, event.defaultPrevented)
      return {
        defaultPrevented: event.defaultPrevented,
        propagationStopped: true,
      }
    }
  }

  // Both listeners on the target run at AT_TARGET. stopPropagation does not
  // suppress another listener on that same target.
  invoke(target, `${payload.eventType}Capture`, 2)
  invoke(target, payload.eventType, 2)

  if (!event.isPropagationStopped()) {
    for (let index = 1; index < path.length; index += 1) {
      invoke(path[index]!, payload.eventType, 3)
      if (event.isPropagationStopped()) break
    }
  }

  rememberKeyboardPrevention(container, payload, event.defaultPrevented)
  return {
    defaultPrevented: event.defaultPrevented,
    propagationStopped: event.isPropagationStopped(),
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
