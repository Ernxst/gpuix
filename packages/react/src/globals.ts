/**
 * Opt-in `globalThis` shims for code written against the browser DOM.
 *
 * `import "@gpuix/react/globals"` installs exactly four names —
 * `requestAnimationFrame`, `cancelAnimationFrame`, `window`, `scrollTo` — and
 * nothing else. Nobody is required to import this: the root `@gpuix/react`
 * entry installs no global, so a consumer who never touches the DOM never
 * gets one either.
 *
 * Each name is installed only if absent, so a real browser's globals (or an
 * earlier import of this module) always win. `requestAnimationFrame` and
 * `cancelAnimationFrame` are installed as the frame clock's *native* path —
 * see `requestNativeAnimationFrame` in `./frame-clock.js` for why the
 * exported, browser-detecting wrappers cannot be used here.
 */
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
