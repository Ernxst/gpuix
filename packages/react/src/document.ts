/**
 * The single-window `document` facade behind `PublicInstance.ownerDocument`,
 * which `@gpuix/react/globals` also installs as `globalThis.document` when the
 * host has none.
 *
 * It answers four questions from the retained tree and nothing else:
 * `getElementById()`, `activeElement`, `body`, and `defaultView`. It is not a
 * DOM `Document`: it has no `createElement`, `querySelector`, event listeners,
 * or style computation, and nothing here pretends otherwise.
 *
 * GPU-IX mounts one root per renderer and one renderer per native window, so
 * the facade reads the root `announce()` targets: the most recently attached
 * one that has rendered. Separate documents for several simultaneous windows
 * are not supported.
 */
import { latestAttachedContainer } from "./reconciler/event-registry.js"
import { elementById } from "./reconciler/form-controls.js"
import type { Container, GpuixDocument, PublicInstance } from "./types/host.js"

const GPUIX_DOCUMENT_KEY = "__gpuixDocument"

function body(container: Container | undefined): PublicInstance | null {
  if (container?.rootElementId == null) return null
  return container.eventTargets.get(container.rootElementId) ?? null
}

function createGpuixDocument(): GpuixDocument {
  return {
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
