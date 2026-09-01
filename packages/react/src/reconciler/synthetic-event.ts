import type { EventPayload } from "@gpuix/native"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

export type GpuixEventPhase = 1 | 2 | 3

/**
 * The React-facing event delivered for a native GPUIX payload.
 *
 * Native payload fields remain available at the top level for compatibility.
 * `nativeEvent` preserves the unmodified payload for code that needs to
 * distinguish host data from the DOM-compatible surface.
 */
export type GpuixSyntheticEvent = EventPayload & {
  readonly nativeEvent: EventPayload
  readonly target: PublicInstance
  readonly currentTarget: PublicInstance
  readonly type: string
  readonly eventPhase: GpuixEventPhase
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly defaultPrevented: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly button: number

  preventDefault(): void
  stopPropagation(): void
  isDefaultPrevented(): boolean
  isPropagationStopped(): boolean
  /** Route this pressed-pointer sequence to the original event target. */
  setPointerCapture(): void
  /** Stop routing this pressed-pointer sequence to the original event target. */
  releasePointerCapture(): void
  /** GPUIX events are never pooled, so persist is intentionally a no-op. */
  persist(): void
}

export interface GpuixEventDispatchResult {
  defaultPrevented: boolean
  propagationStopped: boolean
}

interface SyntheticEventController {
  event: GpuixSyntheticEvent
  setCurrentTarget(target: PublicInstance, phase: GpuixEventPhase): void
}

export function createGpuixSyntheticEvent(
  nativeEvent: EventPayload,
  target: PublicInstance,
  renderer: NativeRenderer
): SyntheticEventController {
  let currentTarget = target
  let eventPhase: GpuixEventPhase = 2
  let defaultPrevented = false
  let propagationStopped = false

  const modifiers = nativeEvent.modifiers
  const isPlainFocusEvent = nativeEvent.eventType === "focus" || nativeEvent.eventType === "blur"
  const event = {
    ...nativeEvent,
    nativeEvent,
    target,
    type: nativeEvent.eventType,
    bubbles: !isPlainFocusEvent,
    cancelable: !isPlainFocusEvent,
    altKey: modifiers?.alt ?? false,
    ctrlKey: modifiers?.ctrl ?? false,
    metaKey: modifiers?.cmd ?? false,
    shiftKey: modifiers?.shift ?? false,
    button: nativeEvent.button ?? 0,
    preventDefault(): void {
      if (!isPlainFocusEvent) defaultPrevented = true
    },
    stopPropagation(): void {
      propagationStopped = true
    },
    isDefaultPrevented(): boolean {
      return defaultPrevented
    },
    isPropagationStopped(): boolean {
      return propagationStopped
    },
    setPointerCapture(): void {
      renderer.setPointerCapture?.(nativeEvent.elementId)
    },
    releasePointerCapture(): void {
      renderer.releasePointerCapture?.(nativeEvent.elementId)
    },
    persist(): void {},
  } as GpuixSyntheticEvent

  Object.defineProperties(event, {
    currentTarget: { enumerable: true, get: () => currentTarget },
    eventPhase: { enumerable: true, get: () => eventPhase },
    defaultPrevented: { enumerable: true, get: () => defaultPrevented },
  })

  return {
    event,
    setCurrentTarget(target, phase): void {
      currentTarget = target
      eventPhase = phase
    },
  }
}
