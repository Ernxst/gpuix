import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function wheelPoint(root: ReturnType<typeof createTestRoot>): { x: number; y: number } {
  const scroller = root.getByTestId("scroller")
  const bounds = root.renderer.getElementBounds(scroller.id)!
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

describeNative("simulated input draws", () => {
  it("draws once for a wheel dispatched against a clean window", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div
          data-testid="scroller"
          style={{ width: 200, height: 100, overflowY: "scroll" }}
        >
          <div style={{ height: 300 }} />
        </div>
      )
      root.renderer.resetDebugFrameOverlayStats()

      const { x, y } = wheelPoint(root)
      root.renderer.dispatchScrollWheel(x, y, 0, -50)

      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(1)
    } finally {
      root.unmount()
    }
  })

  it("draws before and after dispatch when a committed state change dirties the window", () => {
    const root = createTestRoot()
    const wheels: number[] = []
    let enableWheel!: () => void

    function ScrollSurface() {
      const [enabled, setEnabled] = useState(false)
      enableWheel = () => setEnabled(true)
      return (
        <div
          data-testid="scroller"
          style={{ width: 200, height: 100, overflowY: "scroll" }}
          onWheel={enabled ? (event) => wheels.push(event.deltaY) : undefined}
        >
          <div style={{ height: 300 }} />
        </div>
      )
    }

    try {
      root.render(<ScrollSurface />)
      root.renderer.resetDebugFrameOverlayStats()

      act(() => enableWheel())
      const { x, y } = wheelPoint(root)
      root.renderer.dispatchScrollWheel(x, y, 0, -50)

      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(2)
      expect(wheels).toEqual([50])
    } finally {
      root.unmount()
    }
  })
})
