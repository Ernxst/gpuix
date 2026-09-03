import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot } from "../testing.js"

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: bounds![0], y: bounds![1], width: bounds![2], height: bounds![3] }
}

// Issue #300: `max-content` / `min-content` / `fit-content` and `vw` / `vh`
// were rejected by the style validator, so none of them ever reached layout.
// Each case below states the number a browser computes for the same tree.
// One root per test: every extra offscreen window costs real GPU setup, and
// the suite's clock-driven tests feel that as lost frames.
describe("intrinsic and viewport lengths (issue #300)", () => {
  it("resolves vw and vh against the window size", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div data-testid="half-viewport" style={{ width: "50vw", height: "10vh" }} />
          <div data-testid="full-viewport" style={{ width: "100vw", height: "100vh" }} />
          {/* The issue's exact report: minWidth: "100vw" as a floor. */}
          <div data-testid="viewport-floor" style={{ minWidth: "100vw", height: 20 }}>
            <div style={{ width: 50, height: 20 }} />
          </div>
        </div>,
      )

      const half = boundsFor(root.renderer, "half-viewport")
      expect(half.width).toBeCloseTo(200, 4)
      expect(half.height).toBeCloseTo(30, 4)

      const full = boundsFor(root.renderer, "full-viewport")
      expect(full.width).toBeCloseTo(400, 4)
      expect(full.height).toBeCloseTo(300, 4)

      expect(boundsFor(root.renderer, "viewport-floor").width).toBeCloseTo(400, 4)
    } finally {
      root.unmount()
    }
  })

  it("measures min-content and max-content the way a browser does", () => {
    const root = createTestRoot({ width: 400, height: 600 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          {/* A flex column stretches children to 300px by default; a browser
              gives the max-content child its content width of 200px instead,
              and lets it overflow a narrower 150px parent. */}
          <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
            <div data-testid="max-content" style={{ display: "flex", width: "max-content" }}>
              <div style={{ width: 120, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
            <div data-testid="stretch-control" style={{ display: "flex", height: 20 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 150 }}>
            <div data-testid="overflowing" style={{ display: "flex", width: "max-content" }}>
              <div style={{ width: 120, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
          </div>

          {/* min-content of a wrapping row is its widest single item: 80px,
              wrapped into two 20px rows. */}
          <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
            <div
              data-testid="min-content"
              style={{ display: "flex", flexWrap: "wrap", width: "min-content" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 60, height: 20 }} />
            </div>
          </div>

          {/* The #294 probe: without a floor the 150px scrollport squeezes the
              shrinkable child; a browser keeps it at its 200px content width
              and scrolls. */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              width: 150,
              height: 60,
              overflowX: "scroll",
            }}
          >
            <div
              data-testid="content-floor"
              style={{ display: "flex", flexShrink: 1, minWidth: "max-content", height: 20 }}
            >
              <div style={{ width: 120, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
          </div>

          {/* On the block axis the keyword resolves to the content height,
              overriding the row's default cross-axis stretch to 120px. */}
          <div style={{ display: "flex", flexDirection: "row", width: 300, height: 120 }}>
            <div data-testid="content-height" style={{ width: 60, height: "max-content" }}>
              <div style={{ width: 60, height: 40 }} />
            </div>
            <div data-testid="stretch-height-control" style={{ width: 60 }} />
          </div>
        </div>,
      )

      expect(boundsFor(root.renderer, "max-content").width).toBeCloseTo(200, 4)
      expect(boundsFor(root.renderer, "stretch-control").width).toBeCloseTo(300, 4)
      expect(boundsFor(root.renderer, "overflowing").width).toBeCloseTo(200, 4)

      const minContent = boundsFor(root.renderer, "min-content")
      expect(minContent.width).toBeCloseTo(80, 4)
      expect(minContent.height).toBeCloseTo(40, 4)

      expect(boundsFor(root.renderer, "content-floor").width).toBeCloseTo(200, 4)

      expect(boundsFor(root.renderer, "content-height").height).toBeCloseTo(40, 4)
      expect(boundsFor(root.renderer, "stretch-height-control").height).toBeCloseTo(120, 4)
    } finally {
      root.unmount()
    }
  })

  it("clamps fit-content between min-content, the available space, and max-content, and composes vw inside calc()", () => {
    // fit-content resolves to its CSS definition, clamp(min-content, stretch,
    // max-content), which rides GPUI's calc engine. The default test window
    // is scale 2, so this doubles as the regression test for the gpui fix
    // that scales calc()'s absolute atoms into Taffy's device-pixel space:
    // before it, every calc()/clamp() mixing px with % — the plain
    // `calc(50% - 20px)` control below included — was off by the scale
    // factor on any hidpi window.
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          {/* 300px available, content 80..160 -> fit-content is 160. */}
          <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
            <div
              data-testid="fit-content-roomy"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
          </div>
          {/* 120px available, content 80..160 -> fit-content is 120. */}
          <div style={{ display: "flex", flexDirection: "column", width: 120 }}>
            <div
              data-testid="fit-content-tight"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
          </div>
          <div data-testid="viewport-calc" style={{ width: "calc(50vw - 20px)", height: 10 }} />
          <div data-testid="percent-calc" style={{ width: "calc(50% - 20px)", height: 10 }} />
        </div>,
      )

      expect(boundsFor(root.renderer, "fit-content-roomy").width).toBeCloseTo(160, 4)
      expect(boundsFor(root.renderer, "fit-content-tight").width).toBeCloseTo(120, 4)
      expect(boundsFor(root.renderer, "viewport-calc").width).toBeCloseTo(180, 4)
      expect(boundsFor(root.renderer, "percent-calc").width).toBeCloseTo(180, 4)
    } finally {
      root.unmount()
    }
  })
})
