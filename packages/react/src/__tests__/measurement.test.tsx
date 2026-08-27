import React, { useLayoutEffect, useRef, useState } from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("ref element measurement", () => {
  it("agrees with the renderer bounds read for the same painted element", () => {
    const root = createTestRoot()
    const ref = React.createRef<PublicInstance>()

    try {
      root.render(
        <div style={{ padding: 17 }}>
          <div ref={ref} testId="measured" style={{ width: 123, height: 45 }} />
        </div>
      )

      const instance = ref.current
      expect(instance).not.toBeNull()
      const rawBounds = root.renderer.getElementBounds(instance!.id)
      expect(rawBounds).not.toBeNull()
      expect(instance!.getBounds()).toEqual({
        x: rawBounds![0],
        y: rawBounds![1],
        width: rawBounds![2],
        height: rawBounds![3],
      })
    } finally {
      root.unmount()
    }
  })

  it("reads the current layout after a state-driven update without a prior tree query", () => {
    const root = createTestRoot()
    const measured = React.createRef<PublicInstance>()

    function Resizer() {
      const [wide, setWide] = useState(false)
      return (
        <div>
          <div ref={measured} style={{ width: wide ? 220 : 100, height: 40 }} />
          <div testId="resize" onClick={() => setWide(true)} style={{ width: 20, height: 20 }} />
        </div>
      )
    }

    try {
      root.render(<Resizer />)
      root.renderer.nativeSimulateClick(10, 50)

      // This is intentionally the first post-update layout read. `getBounds`
      // itself is the rendered-state boundary, rather than a tree query.
      expect(measured.current!.getBounds()).toMatchObject({ width: 220, height: 40 })
    } finally {
      root.unmount()
    }
  })

  it("measures swapped content before setting an explicit transitioning width", () => {
    const root = createTestRoot()
    const dock = React.createRef<PublicInstance>()
    const outlet = React.createRef<PublicInstance>()

    function Dock() {
      const [expanded, setExpanded] = useState(false)
      const [width, setWidth] = useState<number | undefined>()
      const measuredOutlet = useRef(false)

      useLayoutEffect(() => {
        const bounds = outlet.current?.getBounds()
        if (!bounds) return
        if (!measuredOutlet.current) {
          measuredOutlet.current = true
          setWidth(bounds.width)
          return
        }
        setWidth(bounds.width)
      }, [expanded])

      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
          <div
            ref={dock}
            onClick={() => setExpanded(true)}
            style={{
              width,
              height: 40,
              overflow: "hidden",
              transition: { properties: ["width"], durationMs: 100, easing: "linear" },
            }}
          >
            <div ref={outlet} style={{ width: expanded ? 220 : 100, height: 40, flexShrink: 0 }}>
              <text style={{ fontSize: 16 }}>
                {expanded ? "A considerably wider dock outlet" : "Short"}
              </text>
            </div>
          </div>
        </div>
      )
    }

    try {
      root.renderer.clockPause()
      root.render(<Dock />)
      const before = dock.current!.getBounds()!

      root.renderer.nativeSimulateClick(
        before.x + before.width / 2,
        before.y + before.height / 2
      )
      const target = outlet.current!.getBounds()!
      expect(target.width).toBeGreaterThan(before.width)
      expect(root.renderer.getResolvedStyle(dock.current!.id)).toMatchObject({ width: before.width })

      root.renderer.advanceAsyncClock(50)
      expect(dock.current!.getBounds()!.width).toBeCloseTo((before.width + target.width) / 2, 0)
    } finally {
      root.unmount()
    }
  })
})
