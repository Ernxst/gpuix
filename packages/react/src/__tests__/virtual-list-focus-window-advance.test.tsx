import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const ROW_COUNT = 60
const WINDOW_ROWS = 20

function WindowedRows() {
  const [start, setStart] = useState(0)
  const end = Math.min(ROW_COUNT, start + WINDOW_ROWS)
  return (
    <div role="table" ariaLabel="Demo" ariaRowCount={ROW_COUNT}>
      <virtual-list
        role="rowgroup"
        ariaLabel="Rows"
        itemCount={ROW_COUNT}
        windowStart={start}
        estimatedItemHeight={24}
        style={{
          width: 320,
          height: 240,
          display: "flex",
          flexDirection: "column",
          overflowY: "scroll",
        }}
        onVisibleRange={(event) => {
          const next = Math.max(0, Math.floor(event.startIndex ?? 0) - 2)
          setStart((current) => (current === next ? current : next))
        }}
      >
        {Array.from({ length: end - start }, (_, offset) => {
          const index = start + offset
          return (
            <div
              key={index}
              role="row"
              ariaLabel={`Row ${index}`}
              style={{ height: 24, display: "flex" }}
            >
              <div
                role="button"
                tabIndex={0}
                ariaLabel={`Button ${index}`}
                style={{ width: 40, height: 24 }}
              />
            </div>
          )
        })}
      </virtual-list>
    </div>
  )
}

describeNative("<virtual-list> cross-window focus navigation", () => {
  it("Tab past the last built row advances the window and focuses it", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRows />)

      // Nothing beyond the initial window is built yet.
      expect(screen.queryByRole("row", { name: `Row ${WINDOW_ROWS}` })).toBeNull()

      // Walk forward one row at a time to the last row the initial window
      // built. Only the viewport's worth of rows is painted at mount, so an
      // earlier row's Tab first reveals (but does not yet advance the app's
      // own window past) whatever this pass built but had not painted —
      // exactly the pre-existing "reveal an unpainted virtual row" path.
      const start = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(start.id)
      screen.renderer.flush()
      for (let index = 0; index < WINDOW_ROWS - 1; index += 1) {
        screen.renderer.focusNext()
        screen.renderer.flush()
        screen.renderer.drawPendingFrame()
      }
      const lastBuilt = screen.getByRole("button", { name: `Button ${WINDOW_ROWS - 1}` })
      expect(lastBuilt).toHaveFocus()

      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      const nextButton = screen.getByRole("button", { name: `Button ${WINDOW_ROWS}` })
      expect(nextButton).toBeVisible()
      expect(nextButton).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  it("Shift+Tab past the first built row advances the window backward", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRows />)

      // Walk forward past the original window first, the same cross-window
      // Tab path under test, so there is a nonzero windowStart to cross back
      // past below. Each step needs its own round trip: `focusNext` delivers
      // the `visibleRange` event that widens the app's window, and the
      // followup flush lets native rebuild with the row that request unlocked.
      const firstTarget = WINDOW_ROWS + 5
      const start = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(start.id)
      screen.renderer.flush()
      for (let index = 0; index < firstTarget; index += 1) {
        screen.renderer.focusNext()
        screen.renderer.flush()
        screen.renderer.drawPendingFrame()
      }

      const firstBuilt = screen.getByRole("button", { name: `Button ${firstTarget}` })
      expect(firstBuilt).toHaveFocus()
      expect(screen.queryByRole("row", { name: "Row 0" })).toBeNull()

      screen.renderer.focusPrevious()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      const previousButton = screen.getByRole("button", { name: `Button ${firstTarget - 1}` })
      expect(previousButton).toBeVisible()
      expect(previousButton).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })
})
