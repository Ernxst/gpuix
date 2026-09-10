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

import { afterEach, expect } from "vitest"

import { cleanup } from "./testing.js"
import { gpuixMatchers, type GpuixMatchers } from "./testing-expect.js"

export * from "./testing.js"

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

expect.extend(gpuixMatchers)

afterEach(() => {
  cleanup()
})
