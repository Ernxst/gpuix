/// `@gpuix/react/testing`, plus vitest's automatic cleanup and matcher pack.
///
/// This is the only entry point that imports vitest. `@gpuix/react/testing`
/// itself stays framework-free — it is used from plain scripts, other runners,
/// and the automation harness — so the `afterEach` registration and the
/// `expect.extend` call both live here rather than behind a guard there.
///
/// vitest-browser-react splits the same way, with the polarity reversed: its
/// default entry registers the cleanup and `vitest-browser-react/pure` opts
/// out. Nothing there has to run outside vitest, so it can afford that default.
///
/// A single import wires everything up, either per file or as a `setupFiles`
/// entry:
///
/// ```ts
/// import "@gpuix/react/testing/vitest"
/// ```
///
/// `expect.extend` re-registers the same functions if this module ends up
/// imported more than once — from a `setupFiles` entry and again from a test
/// file, say — which is harmless.

import { afterEach, beforeAll, expect } from "vitest"

import { cleanup, configuredTestWindow, configureTestWindow, disposeSharedWindow } from "./testing.js"
import { gpuixMatchers, type GpuixMatchers } from "./testing-expect.js"
import { configuredScreenshots, configureScreenshots } from "./testing-screenshot.js"

export * from "./testing.js"

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

expect.extend(gpuixMatchers)

afterEach(() => {
  cleanup()
})

// Under `isolate: false`, vitest re-executes this module for every collected
// file, so the `afterEach` above attaches per file — but the modules it
// imports (`testing.ts`, `testing-screenshot.ts`) are evaluated once per
// worker, not once per file. Their module-level defaults —
// `configureTestWindow`, `configureScreenshots`, and the shared window itself
// — would otherwise leak from one file into the next.
//
// The restore is a function `beforeAll` returns, not a separate `afterAll`:
// vitest calls a `beforeAll`'s returned cleanup after every `afterAll` in the
// file, regardless of `sequence.hooks` — both `"list"` and `"parallel"` let a
// plain `afterAll` registered here run concurrently with, or before, the
// file's own `afterAll`, which would restore the defaults before the file's
// teardown had finished dirtying them. A returned cleanup has no such race:
// it is this `beforeAll`'s own teardown, not another hook competing for a
// slot in the file's `afterAll` list.
beforeAll(() => {
  const testWindowSnapshot = configuredTestWindow()
  const screenshotSnapshot = configuredScreenshots()

  return () => {
    configureTestWindow(testWindowSnapshot)
    configureScreenshots(screenshotSnapshot)
    // Also the reset for menus, the debug frame overlay, and every other
    // window-level knob `cleanup()` deliberately leaves alone.
    disposeSharedWindow()
  }
})
