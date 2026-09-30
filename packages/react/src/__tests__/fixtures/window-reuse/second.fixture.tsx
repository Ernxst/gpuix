/// Fixture for `testing-window-reuse.test.tsx`; see `window-state.tsx`. The
/// two fixtures are identical so that either can run first.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import { describe, it } from "vitest"
import { dirtyWindow, expectFreshWindow } from "./window-state.js"

describe("fixture: window reuse (second)", () => {
  it("starts from a fresh window's state", () => {
    expectFreshWindow()
  })

  it("leaves window-level state dirty", () => {
    dirtyWindow()
  })
})
