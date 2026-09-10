import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { flushSync } from "../reconciler/reconciler.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const WEBP_BYTES = Buffer.from(
  "UklGRpYAAABXRUJQVlA4TIkAAAAvH8AFADegJpIUNvmBMvU4QBFqGkmBs+U5+IASB+hASRtJkH9hi1fDGvgOH5j/+MXAS889Jc+ezBjYRLatJiQABXDqVNHBqfn61/A+g4CI/itw20bxMcMzAi9DtZ2tVPoBKGUWkDOU+BgkknFwBtHIm0Qz7xRdPKgzdbd6mfrd6n9R/pv6X30JAQA=",
  "base64",
)
// Same decodable PNG fixture img.test.tsx uses; a second, distinct source so
// this test can swap what an `<img>` decodes to without re-deriving bytes.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYEAIAAABEobQgAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCBoKIR2W0ZKSAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA4LTI2VDEwOjMzOjI5KzAwOjAwyAamDgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOC0yNlQxMDozMzoyOSswMDowMLlbHrIAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDgtMjZUMTA6MzM6MjkrMDA6MDDuTj9tAAAB+klEQVRYw2NUUQkPP3qUYcgCpoF2wKgHBtoBI94DLORpk/8k4PV2lu8OzefnvTzj1MQvL5HZx6/w7s8Ty4+3hbi2r7j1Rjdis/t1ScPtD4U+7BBOpp0HGIkvhdj7WH79calmcdy/6am/vebW8yHE6Nq47bqr4eZWlv2ufmI/S/9wsOwaAA+wd7P8+OO2rirab7KLzBl+jXefSbXmieHHa0L8Qd1Lt+Xu+Fn8h41lD7U8QFQeqP7vuGfTC/KcDgEy5/m13n2sZnLcu+k5tZxOlAfk3wt4vJ3r766567w/5Zb5O2luPx8k/1nA6+0sOnnAd4fm8/Oe1LIMbuYL6plJwAOe0Wqil5dR1wOeUWoil5fTyQMyx/nV3n2jrgcoyUske+CJ88cHQszU9cAT84+3hLjp5IHtc289002grge2z7/1QjeWTh7Y7HFd0nAbdT2w2fO6hOF2OnngIf+H7cKpG49c9zFcRbllG/dd9zRc91Dgww7hFDp5AAJaf+538JOlJO0+sf54R4ij9e9+Jz8pajkdAkhpC/Ww/PzjWs3guHfTc39XzR3nA4nRtfHgdW/DNa2/9zv4Sf8s/sNOvUYEyR5ABvLvBTzezkFpjZ7gV3v37Yn9x3tCrNvn3Hqmm7DZ47qk4faHAh+2Uy/BUM0DgwcM+Q7NqAcGGgAAPwXJOwU9zvkAAAAASUVORK5CYII=",
  "base64",
)

describeNative("instance reads reuse a clean rendered frame", () => {
  it("does not draw repeated bounds and client-rect reads", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 500, height: 120, padding: 10 }}>
          <div data-testid="first" style={{ width: 100, height: 30 }} />
          <div data-testid="second" style={{ width: 140, height: 40 }} />
          <div data-testid="third" style={{ width: 180, height: 50 }} />
        </div>,
      )

      root.renderer.resetDebugFrameOverlayStats()
      const elements = [
        root.renderer.findByTestId("first")!,
        root.renderer.findByTestId("second")!,
        root.renderer.findByTestId("third")!,
      ]
      expect(root.renderer.getElementBounds(elements[0]!.id)).toEqual({ x: 10, y: 10, width: 100, height: 30 })
      const framesAfterFirstRead = root.renderer.getDebugFrameOverlayStats().frames

      for (let iteration = 0; iteration < 10; iteration += 1) {
        for (const element of elements) {
          expect(root.renderer.getElementBounds(element.id)).not.toBeNull()
          expect(element.getBoundingClientRect().width).toBeGreaterThan(0)
        }
      }

      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesAfterFirstRead)
    } finally {
      root.unmount()
    }
  })

  it("draws once when a rerender changes an element's bounds", () => {
    const root = createTestRoot()
    try {
      root.render(<div data-testid="target" style={{ width: 100, height: 40 }} />)
      const target = root.renderer.findByTestId("target")!
      expect(root.renderer.getElementBounds(target.id).width).toBe(100)
      root.renderer.resetDebugFrameOverlayStats()
      expect(root.renderer.getElementBounds(target.id).width).toBe(100)
      const framesBeforeChangedRead = root.renderer.getDebugFrameOverlayStats().frames

      flushSync(() => {
        root.root.render(<div data-testid="target" style={{ width: 240, height: 40 }} />)
      })
      expect(root.renderer.getElementBounds(target.id).width).toBe(240)
      const framesAfterChangedRead = root.renderer.getDebugFrameOverlayStats().frames
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesAfterChangedRead)
      expect(framesAfterChangedRead - framesBeforeChangedRead).toBe(1)
    } finally {
      root.unmount()
    }
  })

  it("reads settled geometry when a child gains an intrinsic size in the same batch", () => {
    const root = createTestRoot({ width: 400, height: 300 })
    const tree = (withChild: boolean) => (
      <div style={{ display: "flex", flexDirection: "row" }}>
        <div data-testid="pill" style={{ display: "flex", flexDirection: "row", padding: 4 }}>
          <div style={{ width: 20, height: 20 }} />
          {withChild ? (
            <img
              src={{ kind: "data", mimeType: "image/webp", bytes: WEBP_BYTES }}
            />
          ) : null}
        </div>
      </div>
    )
    try {
      root.render(tree(false))
      flushSync(() => root.root.render(tree(true)))
      const pill = root.renderer.findByTestId("pill")!
      const framesBefore = root.renderer.getDebugFrameOverlayStats().frames
      expect(root.renderer.getElementBounds(pill.id)).toEqual({ x: 0, y: 0, width: 60, height: 32 })
      const framesAfterFirstRead = root.renderer.getDebugFrameOverlayStats().frames
      expect(root.renderer.getElementBounds(pill.id)).toEqual({ x: 0, y: 0, width: 60, height: 32 })
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesAfterFirstRead)
      expect(framesAfterFirstRead - framesBefore).toBe(2)
    } finally {
      root.unmount()
    }
  })

  it("settles an auto-width pill when an img source swaps and a text label appears together", () => {
    // Pins the shape a status reporter renders: an auto-width flex pill of
    // fixed-size avatar images that grows to fit a label added alongside an
    // avatar swap, all in one batch. The swap-vs-decode mechanism this guards
    // is already covered by the intrinsic-size test above; this test only
    // pins that the settled bounds include the label once both land together.
    const root = createTestRoot({ width: 400, height: 300 })
    const label = "online"
    const pill = (state: "initial" | "changed") => (
      <div style={{ display: "flex", flexDirection: "row" }}>
        <div data-testid="pill" style={{ display: "flex", flexDirection: "row" }}>
          <img
            style={{ width: 18, height: 18 }}
            src={{ kind: "data", mimeType: "image/webp", bytes: WEBP_BYTES }}
          />
          <img
            style={{ width: 18, height: 18 }}
            src={
              state === "initial"
                ? { kind: "data", mimeType: "image/png", bytes: PNG_BYTES }
                : { kind: "data", mimeType: "image/webp", bytes: WEBP_BYTES }
            }
          />
          {state === "changed" ? <text>{label}</text> : null}
        </div>
        <text data-testid="label-reference">{label}</text>
      </div>
    )
    try {
      root.render(pill("initial"))
      flushSync(() => root.root.render(pill("changed")))

      const pillInstance = root.renderer.findByTestId("pill")!
      const framesBeforeFirstRead = root.renderer.getDebugFrameOverlayStats().frames
      const bounds = root.renderer.getElementBounds(pillInstance.id)!
      const framesAfterFirstRead = root.renderer.getDebugFrameOverlayStats().frames

      const labelReference = root.renderer.findByTestId("label-reference")!
      const labelWidth = root.renderer.getElementBounds(labelReference.id)!.width!

      // Both fixed-size images always contribute 18px each; the pill's width
      // grows to fit the label only if the settled read saw it.
      expect(bounds.width).toBeCloseTo(18 + 18 + labelWidth, 3)

      const framesBeforeSecondRead = root.renderer.getDebugFrameOverlayStats().frames
      expect(root.renderer.getElementBounds(pillInstance.id)).toEqual(bounds)
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesBeforeSecondRead)
      expect(framesAfterFirstRead).toBeGreaterThanOrEqual(framesBeforeFirstRead)
    } finally {
      root.unmount()
    }
  })

  it("measures a sibling committed in the same layout-effect batch", () => {
    const root = createTestRoot()
    let measuredWidth: number | undefined

    function Fixture({ wide }: { wide: boolean }) {
      const sibling = React.useRef<PublicInstance>(null)

      React.useLayoutEffect(() => {
        if (wide) {
          measuredWidth = sibling.current?.getBoundingClientRect().width
        }
      }, [wide])

      return (
        <div>
          <div ref={sibling} style={{ width: wide ? 220 : 100, height: 40 }} />
          <div style={{ width: 20, height: 20 }} />
        </div>
      )
    }

    try {
      root.render(<Fixture wide={false} />)
      flushSync(() => root.root.render(<Fixture wide />))
      expect(measuredWidth).toBe(220)
    } finally {
      root.unmount()
    }
  })

  it("draws a pending resize before reading percentage geometry", () => {
    const root = createTestRoot({ width: 320, height: 200 })
    try {
      root.render(<div data-testid="target" style={{ width: "100%", height: 40 }} />)
      const target = root.renderer.findByTestId("target")!
      expect(target.getBoundingClientRect().width).toBe(320)

      root.renderer.simulateResize(180, 200)
      expect(target.getBoundingClientRect().width).toBe(180)
    } finally {
      root.unmount()
    }
  })

  it("draws a pending transition before reading resolved style", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      const card = (expanded: boolean) => (
        <div
          data-testid="target"
          style={{
            width: expanded ? 200 : 100,
            height: 40,
            transition: { properties: ["width"], durationMs: 100, easing: "linear" },
          }}
        />
      )

      root.render(card(false))
      const target = root.renderer.findByTestId("target")!
      root.renderer.getResolvedStyle(target.id)
      root.render(card(true))
      root.renderer.advanceAsyncClock(50)

      expect(root.renderer.getResolvedStyle(target.id)?.width).toBe(150)
    } finally {
      root.unmount()
    }
  })

  it("does not redraw repeated reads while a transition is running", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      const card = (expanded: boolean) => (
        <div
          data-testid="target"
          style={{
            width: expanded ? 200 : 100,
            height: 40,
            transition: { properties: ["width"], durationMs: 100, easing: "linear" },
          }}
        />
      )

      root.render(card(false))
      const target = root.renderer.findByTestId("target")!
      root.renderer.getResolvedStyle(target.id)
      root.render(card(true))
      root.renderer.advanceAsyncClock(50)
      const framesBefore = root.renderer.getDebugFrameOverlayStats().frames

      // A running transition expresses its remaining demand as a next-frame
      // callback, not window dirtiness; a settled read must not consume it,
      // so neither the first read nor the five that follow should draw.
      expect(root.renderer.getResolvedStyle(target.id)?.width).toBe(150)
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesBefore)
      for (let read = 0; read < 5; read += 1) {
        expect(root.renderer.getResolvedStyle(target.id)?.width).toBe(150)
      }
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesBefore)
    } finally {
      root.unmount()
    }
  })

  it("draws the hover invalidation before reading hovered geometry", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="target"
          style={{ width: 100, height: 40, hover: { width: 220 } }}
        />,
      )
      const target = root.renderer.findByTestId("target")!
      expect(target.getBoundingClientRect().width).toBe(100)

      root.renderer.nativeSimulateMouseMove(20, 20)

      expect(root.renderer.getElementBounds(target.id).width).toBe(220)
    } finally {
      root.unmount()
    }
  })
})
