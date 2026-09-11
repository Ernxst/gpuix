/// Fixture for `testing-per-file-isolation.test.tsx`. First asserts that
/// `01-menu.fixture.tsx`'s custom menu action is gone from this file's fresh
/// window — proving window disposal happened on its own, before any
/// `configureTestWindow` / `configureScreenshots` call in this file could be
/// blamed for it. Then, in `afterAll`, dirties both module-level defaults for
/// `03-verify.fixture.tsx` to find restored.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import React from "react"
import { afterAll, describe, expect, it } from "vitest"
import { configureTestWindow, render } from "@gpuix/react/testing"
import { configureScreenshots } from "@gpuix/react/testing/matchers"

describe("fixture 02: configure", () => {
  it("starts fresh: 01's menu action is gone", () => {
    const screen = render(<div>fixture 02</div>)
    expect(() => screen.renderer.simulateMenuAction("mark")).toThrow(/Unknown menu action id/)
  })
})

afterAll(() => {
  configureTestWindow({ width: 641, height: 481, scaleFactor: 1 })
  configureScreenshots({ animations: "allow" })
})
