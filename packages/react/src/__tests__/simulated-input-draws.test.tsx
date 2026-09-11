import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function wheelPoint(root: ReturnType<typeof createTestRoot>): { x: number; y: number } {
  const scroller = root.getByTestId("scroller")
  const bounds = root.renderer.getElementBounds(scroller.id)!
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

/**
 * `resetDebugFrameOverlayStats()` clears the sampled draw durations, but
 * (like the on-screen overlay it feeds) it does that through
 * `Window::reset_debug_frame_overlay_stats`, which calls `window.refresh()`
 * so the overlay repaints with the cleared numbers immediately. That marks
 * the window dirty as a side effect of resetting — calling it and then
 * dispatching an event immediately after would always take
 * `simulate_event`'s pre-dispatch draw branch, regardless of the state this
 * test means to put the window in.
 *
 * Settling that one self-inflicted draw with `drawPendingFrame()` (which
 * only draws when already dirty, and does not itself request another
 * repaint) leaves the window genuinely clean and the sample count at a known
 * baseline of 1 — the settle draw itself, not yet anything the test cares
 * about. Every test below reads `samples - baseline` instead of the raw
 * total, and takes no further reset between settling and the dispatch under
 * test, so nothing between them can dirty the window again.
 */
function settledSampleBaseline(root: ReturnType<typeof createTestRoot>): number {
  root.renderer.resetDebugFrameOverlayStats()
  root.renderer.drawPendingFrame()
  return root.renderer.getDebugFrameOverlayStats().samples
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

      const { x, y } = wheelPoint(root)
      const baseline = settledSampleBaseline(root)

      root.renderer.dispatchScrollWheel(x, y, 0, -50)

      const drawsFromDispatch = root.renderer.getDebugFrameOverlayStats().samples - baseline
      expect(drawsFromDispatch).toBe(1)
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

      const { x, y } = wheelPoint(root)
      const baseline = settledSampleBaseline(root)

      // Attaching the handler is a real host mutation (not a no-op state
      // bump React could bail out of), and it commits synchronously without
      // drawing: the window is left dirty, not repainted, so the dispatch
      // below is the first draw to observe it.
      act(() => enableWheel())
      root.renderer.dispatchScrollWheel(x, y, 0, -50)

      const drawsFromDispatch = root.renderer.getDebugFrameOverlayStats().samples - baseline
      expect(drawsFromDispatch).toBe(2)
      expect(wheels).toEqual([50])
    } finally {
      root.unmount()
    }
  })
})
