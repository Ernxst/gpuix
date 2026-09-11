/// Fixture for `testing-per-file-isolation.test.tsx`. Renders a window with a
/// main menu, then dirties the module-level `configureTestWindow` and
/// `configureScreenshots` defaults in `afterAll` — the state
/// `02-verify.fixture.tsx` asserts is gone by the time it runs in the same
/// worker, under `--no-isolate`.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import React from "react"
import { afterAll, describe, expect, it } from "vitest"
import { configureScreenshots } from "../../../testing-screenshot.js"
import { configureTestWindow, render } from "../../../testing.js"

describe("fixture 01: configure", () => {
  it("renders and installs a custom menu action", () => {
    const screen = render(<div>fixture 01</div>)
    // A fresh window already has the platform's default application menu —
    // `hasMainMenu()` is `true` before this call too — so `02-verify` proves
    // isolation by checking this action id specifically, not `hasMainMenu()`.
    screen.renderer.setMenus([
      { name: "Test", items: [{ kind: "action", id: "mark", label: "Mark" }] },
    ])
    expect(() => screen.renderer.simulateMenuAction("mark")).not.toThrow()
  })
})

afterAll(() => {
  configureTestWindow({ width: 641, height: 481, scaleFactor: 1 })
  configureScreenshots({ animations: "allow" })
})
