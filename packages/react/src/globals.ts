/**
 * Opt-in `globalThis` shims for code written against the browser DOM.
 *
 * `import "@gpuix/react/globals"` installs exactly five names —
 * `requestAnimationFrame`, `cancelAnimationFrame`, `window`, `scrollTo`, and
 * `navigator.clipboard` — and nothing else. Nobody is required to import
 * this: the root `@gpuix/react` entry installs no global, so a consumer who
 * never touches the DOM never gets one either.
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
defineGlobalIfAbsent("scrollTo", () => undefined)

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
