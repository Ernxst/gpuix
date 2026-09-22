/**
 * The single-window `document` facade that `@gpuix/react/globals` installs as
 * `globalThis.document`, and that `PublicInstance.ownerDocument` returns, when
 * the host has no document of its own.
 *
 * It answers four questions from the retained tree: `getElementById()`,
 * `activeElement`, `body`, and `defaultView`. It also takes `pointerup` and
 * `pointercancel` function listeners, which run when a press in the window
 * ends or is cancelled; see `./document-listeners.js`. It is not a DOM
 * `Document` or `EventTarget`: it has no `createElement`, `querySelector`,
 * other event types, or style computation, and nothing here pretends
 * otherwise.
 *
 * GPU-IX mounts one container per renderer and one renderer per native window,
 * so the facade reads the most recently attached container. Separate documents
 * for several simultaneous windows are not supported.
 */
import {
  addDocumentListener,
  removeDocumentListener,
  type DocumentPointerEventType,
} from "./document-listeners.js"
import { latestAttachedContainer } from "./reconciler/event-registry.js"
import { elementById } from "./reconciler/form-controls.js"
import type {
  Container,
  GpuixDocument,
  GpuixDocumentListenerOptions,
  PublicInstance,
} from "./types/host.js"

const GPUIX_DOCUMENT_KEY = "__gpuixDocument"

function body(container: Container | undefined): PublicInstance | null {
  if (container?.rootElementId == null) return null
  return container.bodyElement ?? container.eventTargets.get(container.rootElementId) ?? null
}

const LISTENER_TYPES: ReadonlySet<string> = new Set<DocumentPointerEventType>([
  "pointerup",
  "pointercancel",
])

const warned = new Set<string>()

function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

function captureFlag(options: GpuixDocumentListenerOptions | undefined): boolean {
  return typeof options === "boolean" ? options : options?.capture === true
}

function createGpuixDocument(): GpuixDocument {
  return {
    addEventListener(type, listener, options): void {
      // The DOM ignores a null listener without complaint.
      if (listener == null) return
      const eventType = String(type)
      if (!LISTENER_TYPES.has(eventType)) {
        warnOnce(
          `GPUIX document.addEventListener("${eventType}") was ignored: the document facade delivers only "pointerup" and "pointercancel".`
        )
        return
      }
      if (typeof listener !== "function") {
        warnOnce(
          "GPUIX document.addEventListener() was ignored: the document facade accepts only function listeners, not handleEvent objects."
        )
        return
      }
      if (
        typeof options === "object" &&
        options !== null &&
        ("once" in options || "signal" in options)
      ) {
        warnOnce(
          "GPUIX document.addEventListener() was ignored: the document facade does not support the once or signal options."
        )
        return
      }
      const container = latestAttachedContainer()
      if (!container) {
        warnOnce(
          `GPUIX document.addEventListener("${eventType}") was ignored: no GPUIX root is mounted.`
        )
        return
      }
      addDocumentListener(
        container,
        eventType as DocumentPointerEventType,
        listener,
        captureFlag(options)
      )
    },
    removeEventListener(type, listener, options): void {
      if (listener == null) return
      removeDocumentListener(String(type), listener, captureFlag(options))
    },
    get defaultView(): typeof globalThis | null {
      return (Reflect.get(globalThis, "window") as typeof globalThis | undefined) ?? null
    },
    get body(): PublicInstance | null {
      return body(latestAttachedContainer())
    },
    get activeElement(): PublicInstance | null {
      const container = latestAttachedContainer()
      if (!container) return null
      const focused = container.native.getActiveElement?.() ?? null
      // As in the DOM, the body stands in for "nothing is focused".
      const instance = focused == null ? undefined : container.eventTargets.get(focused)
      return instance ?? body(container)
    },
    getElementById(elementId: string): PublicInstance | null {
      const container = latestAttachedContainer()
      if (!container) return null
      return elementById(container, String(elementId), () => true) ?? null
    },
  }
}

/**
 * The shared facade. Like the host-node and event registries, it lives on
 * `globalThis` so a module re-evaluated by `bun --hot` hands out the same
 * object that an earlier evaluation installed as `globalThis.document`.
 */
export function gpuixDocument(): GpuixDocument {
  const existing = Reflect.get(globalThis, GPUIX_DOCUMENT_KEY) as GpuixDocument | undefined
  if (existing) return existing
  const created = createGpuixDocument()
  Reflect.set(globalThis, GPUIX_DOCUMENT_KEY, created)
  return created
}

/**
 * Whether the host has a real browser document. The facade does not count: it
 * is installed on the desktop, where browser-only paths such as the in-page
 * automation hook must stay off.
 */
export function hasBrowserDocument(): boolean {
  if (typeof document === "undefined") return false
  return (document as unknown) !== Reflect.get(globalThis, GPUIX_DOCUMENT_KEY)
}

/**
 * `PublicInstance.ownerDocument`: the host's own document when there is one,
 * so browser code keeps reaching the document it registers listeners on, and
 * the facade otherwise.
 */
export function ownerDocument(): GpuixDocument | Document {
  return hasBrowserDocument() ? document : gpuixDocument()
}
