/**
 * Opt-in `globalThis` shims for code written against the browser DOM.
 *
 * `import "@gpuix/react/globals"` installs `requestAnimationFrame`,
 * `cancelAnimationFrame`, `window`, `self`, `scrollTo`, `ResizeObserver`, `Image`,
 * `navigator.clipboard`, `navigator.gpu`, `PointerEvent`, and the element
 * constructors `Node`, `Element`, `HTMLElement`, `HTMLDivElement`,
 * `HTMLButtonElement`, `HTMLInputElement`, and `HTMLTextAreaElement`, and
 * `document` as the single-window facade in `./document.js`, and the
 * incremental native WebGPU API — and nothing else. Nobody is required to
 * import this: the root `@gpuix/react` entry installs no global, so a consumer
 * who never touches the DOM never gets one either.
 *
 * Each name is installed only if absent, so a real browser's globals (or an
 * earlier import of this module) always win. `requestAnimationFrame` and
 * `cancelAnimationFrame` are installed as the frame clock's *native* path —
 * see `requestNativeAnimationFrame` in `./frame-clock.js` for why the
 * exported, browser-detecting wrappers cannot be used here.
 */
import { clipboard } from "./clipboard.js"
import {
  cancelNativeAnimationFrame,
  requestNativeAnimationFrame,
} from "./frame-clock.js"
import { ResizeObserver as GpuixResizeObserver } from "./resize-observer.js"
import type { ResizeObserverOptions as GpuixResizeObserverOptions } from "./resize-observer.js"
import {
  Element as GpuixElement,
  HTMLButtonElement,
  HTMLDivElement,
  HTMLElement,
  HTMLInputElement,
  HTMLTextAreaElement,
  Node,
} from "./element-constructors.js"
import { Image } from "./canvas/image.js"
import { PointerEvent } from "./pointer-event.js"
import { gpuixDocument } from "./document.js"
import {
  installWebGpuGlobal,
  type GPUAdapter as GpuixGPUAdapter,
  type GPUError as GpuixGPUError,
  type GPUInternalError as GpuixGPUInternalError,
  type GPUOutOfMemoryError as GpuixGPUOutOfMemoryError,
  type GPUValidationError as GpuixGPUValidationError,
} from "./canvas/webgpu.js"
import type { PublicInstance } from "./types/host.js"

declare global {
  interface Navigator {
    readonly gpu: GPU
  }

  interface GPU {
    requestAdapter(): Promise<GpuixGPUAdapter>
  }

  interface GPUError {
    readonly message: GpuixGPUError["message"]
  }

  interface GPUValidationError extends GPUError {
    readonly name: GpuixGPUValidationError["name"]
  }
  interface GPUOutOfMemoryError extends GPUError {
    readonly name: GpuixGPUOutOfMemoryError["name"]
  }
  interface GPUInternalError extends GPUError {
    readonly name: GpuixGPUInternalError["name"]
  }
  interface GPUUncapturedErrorEvent extends Event {
    readonly error: GPUError
  }
  interface GPUUncapturedErrorEventInit {
    error: GPUError
  }

  interface GPUBufferUsage {
    readonly MAP_READ: number
    readonly MAP_WRITE: number
    readonly COPY_SRC: number
    readonly COPY_DST: number
    readonly INDEX: number
    readonly VERTEX: number
    readonly UNIFORM: number
    readonly STORAGE: number
    readonly INDIRECT: number
    readonly QUERY_RESOLVE: number
  }

  var GPUBufferUsage: GPUBufferUsage
  var GPUValidationError: {
    prototype: GPUValidationError
    new(message: string): GPUValidationError
  }
  var GPUOutOfMemoryError: {
    prototype: GPUOutOfMemoryError
    new(message: string): GPUOutOfMemoryError
  }
  var GPUInternalError: {
    prototype: GPUInternalError
    new(message: string): GPUInternalError
  }
  var GPUUncapturedErrorEvent: {
    prototype: GPUUncapturedErrorEvent
    new(type: string, init: GPUUncapturedErrorEventInit): GPUUncapturedErrorEvent
  }

  interface ResizeObserver {
    observe(target: Element | PublicInstance, options?: GpuixResizeObserverOptions): void
  }
}

function defineGlobalIfAbsent(name: string, value: unknown): void {
  if (Reflect.has(globalThis, name)) return
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  })
}

defineGlobalIfAbsent("requestAnimationFrame", requestNativeAnimationFrame)
defineGlobalIfAbsent("cancelAnimationFrame", cancelNativeAnimationFrame)
defineGlobalIfAbsent("window", globalThis)
defineGlobalIfAbsent("self", globalThis)
defineGlobalIfAbsent("scrollTo", () => undefined)
defineGlobalIfAbsent("ResizeObserver", GpuixResizeObserver)
defineGlobalIfAbsent("Image", Image)
defineGlobalIfAbsent("Node", Node)
defineGlobalIfAbsent("Element", GpuixElement)
defineGlobalIfAbsent("HTMLElement", HTMLElement)
defineGlobalIfAbsent("HTMLDivElement", HTMLDivElement)
defineGlobalIfAbsent("HTMLButtonElement", HTMLButtonElement)
defineGlobalIfAbsent("HTMLInputElement", HTMLInputElement)
defineGlobalIfAbsent("HTMLTextAreaElement", HTMLTextAreaElement)
defineGlobalIfAbsent("PointerEvent", PointerEvent)
defineGlobalIfAbsent("document", gpuixDocument())

// `navigator.clipboard` needs its own path rather than `defineGlobalIfAbsent`:
// Node has had a global `navigator` since v21, so the common case is not "no
// navigator" but "a navigator with no clipboard". Only a `navigator` that is
// entirely absent gets the shortcut of being defined outright as `{ clipboard }`.
if (Reflect.has(globalThis, "navigator")) {
  // Presence must be judged by presence, not by reading a value: a host
  // `navigator` getter can throw (that must not abort this whole import),
  // and testing `.clipboard` for truthiness would overwrite an existing own
  // `clipboard: undefined` or misfire an accessor. So the read is wrapped,
  // and existence is checked with `Reflect.has` rather than a value read.
  let navigator: unknown
  try {
    navigator = (globalThis as { navigator?: unknown }).navigator
  } catch {
    navigator = undefined
  }
  if (typeof navigator === "object" && navigator !== null && !Reflect.has(navigator, "clipboard")) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: clipboard,
    })
  }
} else {
  defineGlobalIfAbsent("navigator", { clipboard })
}

// A browser's navigator.gpu always wins. Desktop installs the experimental
// native WebGPU subset; it does not manufacture a document.
installWebGpuGlobal()
