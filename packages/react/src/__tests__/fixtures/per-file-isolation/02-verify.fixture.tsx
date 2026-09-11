/// Fixture for `testing-per-file-isolation.test.tsx`. Asserts that the
/// module-level state `01-configure.fixture.tsx` dirtied — the
/// `configureTestWindow` / `configureScreenshots` defaults and the shared
/// window — was restored by `@gpuix/react/testing/vitest`'s `afterAll` before
/// this file's tests ran, in the same worker under `--no-isolate`.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import React from "react"
import { describe, expect, it } from "vitest"
import { configuredScreenshots } from "../../../testing-screenshot.js"
import { configuredTestWindow, render } from "../../../testing.js"

describe("fixture 02: verify", () => {
  it("starts fresh: default window geometry, no configured screenshot options, no leftover menu action", () => {
    expect(configuredTestWindow()).toEqual({})
    expect(configuredScreenshots()).toEqual({})

    const screen = render(<div>fixture 02</div>)
    expect(screen.renderer.getWindowSize()).toMatchObject({ width: 1280, height: 800 })
    // A fresh window still has the platform's default application menu, so
    // `hasMainMenu()` alone cannot tell the default apart from 01's leftover
    // "Test" menu. The "mark" action id it registered is the specific thing
    // that must be gone.
    expect(() => screen.renderer.simulateMenuAction("mark")).toThrow(/Unknown menu action id/)
  })
})
