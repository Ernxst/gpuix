/**
 * The `pointerup` and `pointercancel` listeners registered on the `document`
 * facade, and their delivery from the native window.
 *
 * This is not an `EventTarget`. It holds just enough for code that registers a
 * listener on `ownerDocument(element)` when a press starts and removes it when
 * the press ends, as Base UI's `Tabs.Tab` does. Native emits
 * `windowPointerUp` for every mouse up in the window and `windowPointerCancel`
 * when a press is cancelled, whichever element the pointer is over, and the
 * event registry hands both to {@link dispatchDocumentPointerEvent}.
 *
 * Each listener belongs to the root that was current when it was added, and
 * is dropped when that root detaches.
 */
import type { EventPayload } from "@gpuix/native"

import { PointerEvent } from "./pointer-event.js"
import type { Container } from "./types/host.js"

const DOCUMENT_LISTENERS_KEY = "__gpuixDocumentListeners"

export type DocumentPointerEventType = "pointerup" | "pointercancel"

/** The DOM event type each native window pointer event delivers as. */
const DOCUMENT_POINTER_EVENTS: ReadonlyMap<string, DocumentPointerEventType> = new Map([
  ["windowPointerUp", "pointerup"],
  ["windowPointerCancel", "pointercancel"],
])

type DocumentListener = {
  container: Container
  type: DocumentPointerEventType
  callback: (event: PointerEvent) => void
  capture: boolean
  removed: boolean
}

/** On `globalThis` for the reason the facade itself is; see `gpuixDocument()`. */
function documentListeners(): DocumentListener[] {
  const existing = Reflect.get(globalThis, DOCUMENT_LISTENERS_KEY) as
    | DocumentListener[]
    | undefined
  if (existing) return existing
  const created: DocumentListener[] = []
  Reflect.set(globalThis, DOCUMENT_LISTENERS_KEY, created)
  return created
}

function findListener(type: string, callback: unknown, capture: boolean): number {
  return documentListeners().findIndex(
    (entry) => entry.type === type && entry.callback === callback && entry.capture === capture
  )
}

/** Adds a listener unless the same type, callback, and capture flag is present. */
export function addDocumentListener(
  container: Container,
  type: DocumentPointerEventType,
  callback: (event: PointerEvent) => void,
  capture: boolean
): void {
  if (findListener(type, callback, capture) !== -1) return
  documentListeners().push({ container, type, callback, capture, removed: false })
}

export function removeDocumentListener(type: string, callback: unknown, capture: boolean): void {
  const index = findListener(type, callback, capture)
  if (index === -1) return
  const [entry] = documentListeners().splice(index, 1)
  entry!.removed = true
}

/** Drops every listener a detaching root owns. */
export function dropDocumentListeners(container: Container): void {
  const listeners = documentListeners()
  for (let index = listeners.length - 1; index >= 0; index -= 1) {
    if (listeners[index]!.container !== container) continue
    listeners[index]!.removed = true
    listeners.splice(index, 1)
  }
}

/** Whether `eventType` is a native window pointer event for the facade. */
export function isDocumentPointerEvent(eventType: string): boolean {
  return DOCUMENT_POINTER_EVENTS.has(eventType)
}

/**
 * Runs the `container`'s listeners for a native `windowPointerUp` or
 * `windowPointerCancel`, capture listeners first, in the order they were
 * added. As in the DOM, a listener added during the dispatch does not run
 * and one removed before its turn does not either. A throwing listener does
 * not stop the rest; the first error is rethrown once they have all run.
 */
export function dispatchDocumentPointerEvent(
  container: Container,
  payload: EventPayload
): void {
  const type = DOCUMENT_POINTER_EVENTS.get(payload.eventType)
  if (type === undefined) return
  const matching = documentListeners().filter(
    (entry) => entry.type === type && entry.container === container
  )
  if (matching.length === 0) return
  const ordered = [
    ...matching.filter((entry) => entry.capture),
    ...matching.filter((entry) => !entry.capture),
  ]
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: type === "pointerup",
    clientX: payload.x ?? 0,
    clientY: payload.y ?? 0,
    button: type === "pointercancel" ? -1 : (payload.button ?? 0),
    buttons: payload.buttons ?? 0,
    pointerId: payload.pointerId ?? 1,
    pointerType: payload.pointerType ?? "mouse",
    isPrimary: payload.isPrimary ?? true,
    altKey: payload.modifiers?.alt === true,
    ctrlKey: payload.modifiers?.ctrl === true,
    shiftKey: payload.modifiers?.shift === true,
    metaKey: payload.modifiers?.cmd === true,
  })
  let failure: { error: unknown } | undefined
  for (const entry of ordered) {
    if (entry.removed) continue
    try {
      entry.callback(event)
    } catch (error) {
      failure ??= { error }
    }
  }
  if (failure) throw failure.error
}
