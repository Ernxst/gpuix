/// Fixture for `testing-per-file-isolation.test.tsx`. Renders a window and
/// installs a custom menu action — nothing else. Proves window disposal alone
/// (not `configureTestWindow` / `configureScreenshots`) clears it before
/// `02-configure.fixture.tsx` runs next in the same worker, under
/// `--no-isolate`.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import React from "react"
import { describe, expect, it } from "vitest"
import { render } from "@gpuix/react/testing"

describe("fixture 01: menu", () => {
  it("renders and installs a custom menu action", () => {
    const screen = render(<div>fixture 01</div>)
    // A fresh window already has the platform's default application menu —
    // `hasMainMenu()` is `true` before this call too — so the next fixture
    // proves isolation by checking this action id specifically, not
    // `hasMainMenu()`.
    screen.renderer.setMenus([
      { name: "Test", items: [{ kind: "action", id: "mark", label: "Mark" }] },
    ])
    expect(() => screen.renderer.simulateMenuAction("mark")).not.toThrow()
  })
})
