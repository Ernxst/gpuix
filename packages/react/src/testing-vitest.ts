/// `@gpuix/react/testing`, plus vitest's automatic cleanup.
///
/// This is the only entry point that imports vitest. `@gpuix/react/testing`
/// itself stays framework-free — it is used from plain scripts, other runners,
/// and the automation harness — so the `afterEach` registration lives here
/// rather than behind a guard there.
///
/// vitest-browser-react splits the same way, with the polarity reversed: its
/// default entry registers the cleanup and `vitest-browser-react/pure` opts
/// out. Nothing there has to run outside vitest, so it can afford that default.
///
/// ```ts
/// import { render } from "@gpuix/react/testing/vitest"
/// ```

import { afterEach } from "vitest"

import { cleanup } from "./testing.js"

export * from "./testing.js"

afterEach(() => {
  cleanup()
})
