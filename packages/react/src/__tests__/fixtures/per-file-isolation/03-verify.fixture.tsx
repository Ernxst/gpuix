/// Fixture for `testing-per-file-isolation.test.tsx`. Asserts that the
/// `configureTestWindow` / `configureScreenshots` defaults
/// `02-configure.fixture.tsx` dirtied in its `afterAll` were restored by
/// `@gpuix/react/testing/vitest`'s `beforeAll`-returned cleanup before this
/// file's tests ran, in the same worker under `--no-isolate`.
///
/// Named `*.fixture.tsx` so the default vitest `include` glob skips it; the
/// regression test passes it to a child vitest run explicitly.

import React from "react"
import { describe, expect, it } from "vitest"
import { configuredTestWindow, render } from "@gpuix/react/testing"
import { configuredScreenshots } from "@gpuix/react/testing/matchers"

describe("fixture 03: verify", () => {
  it("starts fresh: default window geometry, no configured screenshot options", () => {
    expect(configuredTestWindow()).toEqual({})
    expect(configuredScreenshots()).toEqual({})

    const screen = render(<div>fixture 03</div>)
    expect(screen.renderer.getWindowSize()).toMatchObject({ width: 1280, height: 800 })
  })
})
