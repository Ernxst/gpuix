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

  it("sizes a text-bearing div's min-content width to its longest word", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div data-testid="min-content-text" style={{ width: "min-content" }}>
            <text style={{ fontSize: 20 }}>grid layout</text>
          </div>
          <text data-testid="min-content-reference" style={{ fontSize: 20 }}>
            layout
          </text>
        </div>,
      )

      const text = boundsFor(root.renderer, "min-content-text")
      const reference = boundsFor(root.renderer, "min-content-reference")
      expect(text.width).toBeCloseTo(reference.width, 3)
    } finally {
      root.unmount()
    }
  })

  it("sizes a two-line text-bearing div's min-content width to the widest word on its second hard line", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div data-testid="min-content-multiline-text" style={{ width: "min-content" }}>
            <text style={{ fontSize: 20 }}>{"grid\nwide layout"}</text>
          </div>
          {/* "layout" is the last word of its hard-wrapped line, so its
              wrap-candidate span ends at the line's own width rather than
              extending into a following space. That makes the reference a
              bare word instead of a word-plus-space span. */}
          <text data-testid="min-content-multiline-reference" style={{ fontSize: 20 }}>
            layout
          </text>
        </div>,
      )

      const text = boundsFor(root.renderer, "min-content-multiline-text")
      const reference = boundsFor(root.renderer, "min-content-multiline-reference")
      expect(text.width).toBeCloseTo(reference.width, 3)
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

  it("clamps fit-content() limits using the CSS min/max-content formula", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
            <div
              data-testid="fit-content-limit-120"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content(120px)" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
            <div
              data-testid="fit-content-limit-200"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content(200px)" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
            <div
              data-testid="fit-content-limit-40"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content(40px)" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
            <div
              data-testid="fit-content-limit-10vw"
              style={{ display: "flex", flexWrap: "wrap", width: "fit-content(10vw)" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 80, height: 20 }} />
            </div>
          </div>
        </div>,
      )

      const minContent = 80
      const maxContent = 160
      const fitContent = (limit: number) => Math.min(maxContent, Math.max(minContent, limit))

      expect(boundsFor(root.renderer, "fit-content-limit-120").width).toBeCloseTo(
        fitContent(120),
        4,
      )
      expect(boundsFor(root.renderer, "fit-content-limit-200").width).toBeCloseTo(
        fitContent(200),
        4,
      )
      expect(boundsFor(root.renderer, "fit-content-limit-40").width).toBeCloseTo(
        fitContent(40),
        4,
      )
      expect(boundsFor(root.renderer, "fit-content-limit-10vw").width).toBeCloseTo(
        fitContent(40),
        4,
      )
    } finally {
      root.unmount()
    }
  })
})

describe("intrinsic keywords in state refinements (issue #313)", () => {
  it("measures a hovered refinement at its effective padding", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div
            data-testid="hover-target"
            style={{
              display: "flex",
              width: "max-content",
              paddingLeft: 4,
              hover: { width: "max-content", padding: 20 },
            }}
          >
            <div style={{ width: 100, height: 20 }} />
          </div>
        </div>,
      )

      const target = root.renderer.findByTestId("hover-target")!
      expect(boundsFor(root.renderer, "hover-target").width).toBeCloseTo(104, 4)

      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(boundsFor(root.renderer, "hover-target").width).toBeCloseTo(140, 4)

      root.renderer.nativeSimulateMouseMove(-1, -1)
      expect(boundsFor(root.renderer, "hover-target").width).toBeCloseTo(104, 4)
    } finally {
      root.unmount()
    }
  })

  it("measures a focused refinement at its effective padding", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div
            data-testid="focus-target"
            tabIndex={0}
            style={{
              display: "flex",
              width: "max-content",
              focus: { width: "max-content", padding: 12 },
            }}
          >
            <div style={{ width: 100, height: 20 }} />
          </div>
        </div>,
      )

      const target = root.renderer.findByTestId("focus-target")!
      root.renderer.focusElement(target.id)
      expect(boundsFor(root.renderer, "focus-target").width).toBeCloseTo(124, 4)
    } finally {
      root.unmount()
    }
  })
})

describe("intrinsic keyword probe cache (issue #310)", () => {
  it("reuses unchanged probes and invalidates on content and interaction changes", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      const render = (label: string) => {
        root.render(
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <div
              data-testid="cache-target"
              style={{ display: "flex", width: "max-content", hover: { width: "max-content" } }}
            >
              <text>{label}</text>
            </div>
          </div>,
        )
      }

      render("a")
      const initial = root.renderer.getIntrinsicProbeLayoutCount()
      root.renderer.flush()
      root.renderer.flush()
      expect(root.renderer.getIntrinsicProbeLayoutCount()).toBe(initial)

      render("a much longer child text")
      const afterText = root.renderer.getIntrinsicProbeLayoutCount()
      expect(afterText).toBeGreaterThan(initial)

      const target = root.renderer.findByTestId("cache-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      const afterHover = root.renderer.getIntrinsicProbeLayoutCount()
      expect(afterHover).toBeGreaterThan(afterText)

      root.renderer.nativeSimulateMouseMove(-1, -1)
      expect(root.renderer.getIntrinsicProbeLayoutCount()).toBeGreaterThan(afterHover)
    } finally {
      root.unmount()
    }
  })

  it("invalidates a max-content ancestor when a host descendant changes width on hover", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div data-testid="ancestor" style={{ display: "flex", width: "max-content" }}>
            <div
              data-testid="host-descendant"
              style={{ display: "flex", width: 40, height: 20, hover: { width: 80 } }}
            />
          </div>
        </div>,
      )

      expect(boundsFor(root.renderer, "ancestor").width).toBeCloseTo(40, 4)
      const initialProbes = root.renderer.getIntrinsicProbeLayoutCount()
      const target = root.renderer.findByTestId("host-descendant")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 80 })
      expect(boundsFor(root.renderer, "host-descendant").width).toBeCloseTo(80, 4)
      expect(root.renderer.getIntrinsicProbeLayoutCount()).toBeGreaterThan(initialProbes)
      // The ancestor's own state and subtree are unchanged; without the
      // interaction revision, its cached probe would therefore keep 40px
      // even though the descendant's painted width is now 80px.
      expect(boundsFor(root.renderer, "ancestor").width).toBeCloseTo(80, 4)
    } finally {
      root.unmount()
    }
  })

  it("invalidates a max-content ancestor for an img descendant hover width", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div data-testid="img-ancestor" style={{ display: "flex", width: "max-content" }}>
            <img
              data-testid="img-descendant"
              style={{ display: "flex", width: 40, height: 20, hover: { width: 80 } }}
            />
          </div>
        </div>,
      )

      expect(boundsFor(root.renderer, "img-ancestor").width).toBeCloseTo(40, 4)
      const initialProbes = root.renderer.getIntrinsicProbeLayoutCount()
      const target = root.renderer.findByTestId("img-descendant")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 80 })
      expect(boundsFor(root.renderer, "img-descendant").width).toBeCloseTo(80, 4)
      expect(root.renderer.getIntrinsicProbeLayoutCount()).toBeGreaterThan(initialProbes)
      // <img> is a custom root: the ancestor can only learn about its
      // interaction change through the shared revision in the cache key.
      expect(boundsFor(root.renderer, "img-ancestor").width).toBeCloseTo(80, 4)
    } finally {
      root.unmount()
    }
  })

  it("reuses a flex-shrunk intrinsic width and height probe while idle", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    try {
      root.render(
        <div style={{ display: "flex", width: 100, alignItems: "flex-start" }}>
          <div
            data-testid="flex-shrunk-intrinsic"
            style={{ display: "flex", flexShrink: 1, width: "max-content", height: "max-content" }}
          >
            <div style={{ width: 200, height: 40 }} />
          </div>
        </div>,
      )

      const firstPaint = root.renderer.getIntrinsicProbeLayoutCount()
      root.renderer.flush()
      root.renderer.flush()
      expect(root.renderer.getIntrinsicProbeLayoutCount()).toBe(firstPaint)
    } finally {
      root.unmount()
    }
  })
})
