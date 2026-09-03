import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

// Issue #302: overflow / overflowX / overflowY rejected "auto", the most
// common overflow value in browser stylesheets, so the element was not a
// scroll container at all. "auto" scrolls exactly like "scroll" here: no
// scrollbar gutter is painted for either, so the browsers' one difference
// between the two (gutter reservation) has nothing to reserve.
describeNative("overflow: auto (issue #302)", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ strictStyles: true })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  it("is accepted by the style validator on all three overflow props", () => {
    testRoot.render(
      <div>
        <div data-testid="shorthand" style={{ overflow: "auto", width: 40, height: 40 }} />
        <div data-testid="x-axis" style={{ overflowX: "auto", width: 40, height: 40 }} />
        <div data-testid="y-axis" style={{ overflowY: "auto", width: 40, height: 40 }} />
      </div>
    )

    expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("scrolls like a scroll container once content overflows", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={ref} style={{ width: 200, height: 100, overflowY: "auto" }}>
        <div style={{ height: 500, flexShrink: 0 }}>
          <text>Very tall content</text>
        </div>
      </div>
    )

    const scroller = ref.current!
    expect(scroller.clientHeight).toBe(100)
    expect(scroller.scrollHeight).toBe(500)

    scroller.scrollTop = scroller.scrollHeight
    testRoot.renderer.flush()
    // Clamped natively to the last full viewport, exactly like the DOM.
    expect(scroller.scrollTop).toBe(400)

    scroller.scrollTo({ top: 40 })
    testRoot.renderer.flush()
    expect(scroller.scrollTop).toBe(40)
  })

  it("has nothing to scroll while content fits, like a browser's auto", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={ref} style={{ width: 200, height: 100, overflow: "auto" }}>
        <div style={{ height: 60, flexShrink: 0 }}>
          <text>Short content</text>
        </div>
      </div>
    )

    const scroller = ref.current!
    // The DOM reports the viewport as the scroll extent when nothing
    // overflows, and a scroll attempt clamps straight back to 0.
    expect(scroller.scrollHeight).toBe(scroller.clientHeight)
    scroller.scrollTop = 50
    testRoot.renderer.flush()
    expect(scroller.scrollTop).toBe(0)
  })

  it("pans a wide child on overflowX: auto while the viewport width holds", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ display: "flex", width: 300, height: 120 }}>
        <div ref={ref} style={{ width: 150, height: 100, overflowX: "auto" }}>
          <div style={{ width: 400, height: 40, flexShrink: 0 }} />
        </div>
      </div>
    )

    const scroller = ref.current!
    const bounds = scroller.getBounds()!
    expect(bounds.width).toBeCloseTo(150, 4)
    expect(scroller.scrollWidth).toBe(400)

    scroller.scrollLeft = 100
    testRoot.renderer.flush()
    expect(scroller.scrollLeft).toBe(100)
  })
})
