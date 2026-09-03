import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: bounds![0], y: bounds![1], width: bounds![2], height: bounds![3] }
}

describe("percentage layout inside scroll containers", () => {
  it("uses the scrollport on the scrolling axis and preserves the cross-axis basis", () => {
    const root = createTestRoot()
    const xScrollport = React.createRef<PublicInstance>()
    const xHalf = React.createRef<PublicInstance>()
    const xFull = React.createRef<PublicInstance>()
    const xMinimum = React.createRef<PublicInstance>()
    const xControl = React.createRef<PublicInstance>()
    const xWide = React.createRef<PublicInstance>()

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            ref={xScrollport}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              width: 240,
              height: 120,
              overflowX: "scroll",
            }}
          >
            <div ref={xHalf} style={{ width: "50%", minWidth: 0, height: 20 }}>
              <div ref={xControl} style={{ width: 10, height: "100%" }} />
            </div>
            <div ref={xFull} style={{ width: "100%", height: 20 }} />
            <div ref={xMinimum} style={{ minWidth: "100%", height: 20 }}>
              <div style={{ width: 80, height: 20 }} />
            </div>
            <div ref={xWide} style={{ width: 400, height: 20 }} />
          </div>

          <div
            data-testid="overflow-y-scrollport"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              width: 240,
              height: 120,
              overflowY: "scroll",
            }}
          >
            <div data-testid="overflow-y-half" style={{ width: 40, height: "50%", minHeight: 0 }}>
              <div data-testid="overflow-y-control" style={{ width: "100%", height: 10 }} />
            </div>
            <div data-testid="overflow-y-full" style={{ width: 40, height: "100%" }} />
            <div data-testid="overflow-y-minimum" style={{ width: 40, minHeight: "100%" }}>
              <div style={{ width: 40, height: 40 }} />
            </div>
            <div data-testid="overflow-y-tall" style={{ width: 40, height: 300 }} />
          </div>
        </div>,
      )

      const xScrollportBounds = xScrollport.current!.getBounds()!
      const xHalfBounds = xHalf.current!.getBounds()!
      const xFullBounds = xFull.current!.getBounds()!
      const xMinimumBounds = xMinimum.current!.getBounds()!
      const xControlBounds = xControl.current!.getBounds()!
      const xWideBounds = xWide.current!.getBounds()!
      const yScrollportBounds = boundsFor(root.renderer, "overflow-y-scrollport")
      const yHalfBounds = boundsFor(root.renderer, "overflow-y-half")
      const yFullBounds = boundsFor(root.renderer, "overflow-y-full")
      const yMinimumBounds = boundsFor(root.renderer, "overflow-y-minimum")
      const yControlBounds = boundsFor(root.renderer, "overflow-y-control")
      const yTallBounds = boundsFor(root.renderer, "overflow-y-tall")

      expect(xControlBounds.height).toBeCloseTo(xHalfBounds.height, 4)
      expect(yControlBounds.width).toBeCloseTo(yHalfBounds.width, 4)
      expect(xWideBounds.width).toBeGreaterThan(xScrollportBounds.width)
      expect(yTallBounds.height).toBeGreaterThan(yScrollportBounds.height)

      expect(yHalfBounds.height).toBeCloseTo(yScrollportBounds.height * 0.5, 4)
      expect(yFullBounds.height).toBeCloseTo(yScrollportBounds.height, 4)
      expect(yMinimumBounds.height).toBeCloseTo(yScrollportBounds.height, 4)

      expect(xHalfBounds.width).toBeCloseTo(xScrollportBounds.width * 0.5, 4)
      expect(xFullBounds.width).toBeCloseTo(xScrollportBounds.width, 4)
      expect(xMinimumBounds.width).toBeCloseTo(xScrollportBounds.width, 4)
    } finally {
      root.unmount()
    }
  })

  // Issue #294: the scroll axis is the *main* axis of the scroller. The cases
  // above all put `overflowX: "scroll"` on a `flexDirection: "column"` box,
  // where x is the cross axis.
  it("resolves a percentage minWidth against a row scrollport wider than its content", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", width: 400, height: 200 }}>
          <div
            data-testid="main-axis-outer"
            style={{ display: "flex", flexDirection: "row", flexGrow: 1, overflowX: "scroll" }}
          >
            <div
              data-testid="main-axis-inner"
              style={{ display: "flex", flexDirection: "column", flexShrink: 0, minWidth: "100%" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 120, height: 20 }} />
            </div>
          </div>
        </div>,
      )

      const outer = boundsFor(root.renderer, "main-axis-outer")
      const inner = boundsFor(root.renderer, "main-axis-inner")

      expect(outer.width).toBeCloseTo(400, 4)
      expect(inner.width).toBeCloseTo(outer.width, 4)
    } finally {
      root.unmount()
    }
  })

  // The percentage is the binding constraint here: 150% of the 400px scrollport
  // is 600px, while the widest row is only 200px. Resolving `minWidth` against
  // the child's own content instead of the scrollport would yield 200px.
  it("resolves a percentage minWidth larger than the row scrollport into overflow", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", width: 400, height: 200 }}>
          <div
            data-testid="wide-main-axis-outer"
            style={{ display: "flex", flexDirection: "row", flexGrow: 1, overflowX: "scroll" }}
          >
            <div
              data-testid="wide-main-axis-inner"
              style={{ display: "flex", flexDirection: "column", flexShrink: 0, minWidth: "150%" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 200, height: 20 }} />
            </div>
          </div>
        </div>,
      )

      const outer = boundsFor(root.renderer, "wide-main-axis-outer")
      const inner = boundsFor(root.renderer, "wide-main-axis-inner")

      expect(outer.width).toBeCloseTo(400, 4)
      expect(inner.width).toBeCloseTo(600, 4)
      expect(inner.width).toBeGreaterThan(outer.width)
    } finally {
      root.unmount()
    }
  })

  // No `flexGrow`/`flexShrink`/`flexBasis` authored, so the child takes GPUIX's
  // internal `flex_none` default; the percentage must still see the scrollport.
  it("resolves a percentage minWidth on a row scrollport child with no authored flex", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", width: 400, height: 200 }}>
          <div
            data-testid="default-flex-outer"
            style={{ display: "flex", flexDirection: "row", flexGrow: 1, overflowX: "scroll" }}
          >
            <div
              data-testid="default-flex-inner"
              style={{ display: "flex", flexDirection: "column", minWidth: "100%" }}
            >
              <div style={{ width: 80, height: 20 }} />
              <div style={{ width: 120, height: 20 }} />
            </div>
          </div>
        </div>,
      )

      const outer = boundsFor(root.renderer, "default-flex-outer")
      const inner = boundsFor(root.renderer, "default-flex-inner")

      expect(outer.width).toBeCloseTo(400, 4)
      expect(inner.width).toBeCloseTo(outer.width, 4)
    } finally {
      root.unmount()
    }
  })

  it("preserves an authored flex basis on a scroll-container child", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            width: 240,
            height: 40,
            overflowX: "scroll",
          }}
        >
          <div data-testid="basis-child" style={{ width: 40, height: 20, flexBasis: 120 }} />
        </div>,
      )

      expect(boundsFor(root.renderer, "basis-child").width).toBeCloseTo(120, 4)
    } finally {
      root.unmount()
    }
  })

  it("preserves authored flex shrink on a scroll-container child", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            width: 240,
            height: 40,
            overflowX: "scroll",
          }}
        >
          <div data-testid="shrinking-child" style={{ width: 200, height: 20, flexShrink: 1 }} />
          <div data-testid="fixed-after-shrink" style={{ width: 200, height: 20 }} />
        </div>,
      )

      expect(boundsFor(root.renderer, "shrinking-child").width).toBeCloseTo(40, 4)
      expect(boundsFor(root.renderer, "fixed-after-shrink").width).toBeCloseTo(200, 4)
    } finally {
      root.unmount()
    }
  })

  it("preserves authored flex grow on a scroll-container child", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            width: 240,
            height: 40,
            overflowX: "scroll",
          }}
        >
          <div data-testid="growing-child" style={{ width: 40, height: 20, flexGrow: 1 }} />
          <div data-testid="fixed-after-grow" style={{ width: 40, height: 20 }} />
        </div>,
      )

      expect(boundsFor(root.renderer, "growing-child").width).toBeCloseTo(200, 4)
      expect(boundsFor(root.renderer, "fixed-after-grow").width).toBeCloseTo(40, 4)
    } finally {
      root.unmount()
    }
  })
})
