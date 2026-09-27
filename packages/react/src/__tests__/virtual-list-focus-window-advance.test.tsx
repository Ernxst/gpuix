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

  function mountedButtonIndices(screen: ReturnType<typeof createTestRoot>): number[] {
    return screen.getAllByRole("button").map((button) => {
      const match = /^Button (\d+)$/.exec(button.semantics?.label ?? "")
      if (!match) throw new Error(`unexpected button label: ${button.semantics?.label}`)
      return Number(match[1])
    })
  }

  it("Shift+Tab past the first built row advances the window backward", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRows />)

      // Cross the forward boundary once first, the same cross-window Tab
      // path under test, so the window has moved past 0 and there is a
      // genuinely unmounted row below its new first row to cross back into.
      const start = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(start.id)
      screen.renderer.flush()
      for (let index = 0; index < WINDOW_ROWS; index += 1) {
        screen.renderer.focusNext()
        screen.renderer.flush()
        screen.renderer.drawPendingFrame()
      }

      // Focus whichever row the window now starts at directly — not by
      // continuing to Tab there, so this exercises exactly one backward
      // crossing rather than however many ordinary in-window hops it took
      // to arrive.
      const firstMounted = Math.min(...mountedButtonIndices(screen))
      expect(firstMounted).toBeGreaterThan(0)
      const beforeFirstMounted = firstMounted - 1
      expect(screen.queryByRole("row", { name: `Row ${beforeFirstMounted}` })).toBeNull()

      const firstBuilt = screen.getByRole("button", { name: `Button ${firstMounted}` })
      screen.renderer.focusElement(firstBuilt.id)
      screen.renderer.flush()
      expect(firstBuilt).toHaveFocus()

      screen.renderer.focusPrevious()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      const previousButton = screen.getByRole("button", { name: `Button ${beforeFirstMounted}` })
      expect(previousButton).toBeVisible()
      expect(previousButton).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsIgnoringVisibleRange() {
    const [start] = useState(0)
    const end = Math.min(ROW_COUNT, start + WINDOW_ROWS)
    return (
      <div>
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
            // Deliberately never widens the window: the app that ignores
            // the request, per the docs' own caveat that this needs
            // `onVisibleRange` to actually grow the window.
            onVisibleRange={() => {}}
          >
            {Array.from({ length: end - start }, (_, offset) => {
              const index = start + offset
              return (
                <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                  <div role="button" tabIndex={0} ariaLabel={`Button ${index}`} style={{ width: 40, height: 24 }} />
                </div>
              )
            })}
          </virtual-list>
        </div>
        <div role="button" tabIndex={0} ariaLabel="Elsewhere" style={{ width: 40, height: 24 }} />
      </div>
    )
  }

  it("does not steal focus back, and eventually gives up, when the app never widens the window", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsIgnoringVisibleRange />)

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

      // Crosses the boundary and queues a request for Button 20, which this
      // app's `onVisibleRange` will never build.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()
      expect(screen.queryByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeNull()
      // Still on the row that asked, not stranded off it: the request is
      // outstanding, not resolved.
      expect(lastBuilt).toHaveFocus()

      // The user focuses something else while it is still outstanding.
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" })
      screen.renderer.focusElement(elsewhere.id)
      expect(elsewhere).toHaveFocus()

      // A few more draws while the app keeps declining to build the row:
      // still doesn't reach back for it, no matter how many more times the
      // request is retried.
      for (let index = 0; index < 10; index += 1) {
        screen.renderer.flush()
        screen.renderer.drawPendingFrame()
      }

      expect(elsewhere).toHaveFocus()
      expect(screen.queryByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsDeferredVisibleRange() {
    const [start, setStart] = useState(0)
    const end = Math.min(ROW_COUNT, start + WINDOW_ROWS)
    return (
      <div>
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
            // Widens the window, but only after a real delay: an app whose
            // `onVisibleRange` fetches data (or otherwise defers) before
            // committing, rather than one that resolves in the same tick a
            // synthetic `visibleRange` event is delivered in.
            onVisibleRange={(event) => {
              const next = Math.max(0, Math.floor(event.startIndex ?? 0) - 2)
              setTimeout(() => setStart((current) => (current === next ? current : next)), 20)
            }}
          >
            {Array.from({ length: end - start }, (_, offset) => {
              const index = start + offset
              return (
                <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                  <div role="button" tabIndex={0} ariaLabel={`Button ${index}`} style={{ width: 40, height: 24 }} />
                </div>
              )
            })}
          </virtual-list>
        </div>
        <div role="button" tabIndex={0} ariaLabel="Elsewhere" style={{ width: 40, height: 24 }} />
      </div>
    )
  }

  it("does not steal focus back if it moves elsewhere before a deferred crossing resolves", async () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsDeferredVisibleRange />)

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

      // Crosses the boundary and queues a request for Button 20. The app's
      // timer has not fired yet, so it is still outstanding.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()
      expect(screen.queryByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeNull()
      expect(lastBuilt).toHaveFocus()

      // The user focuses something else before the timer fires.
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" })
      screen.renderer.focusElement(elsewhere.id)
      expect(elsewhere).toHaveFocus()

      // Let the deferred `setStart` land and React commit the wider window,
      // then draw: Button 20 exists now, but resolving the stale request
      // must not pull focus away from `elsewhere`.
      await new Promise((resolve) => setTimeout(resolve, 50))
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeVisible()
      expect(elsewhere).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsWithOrderedTarget() {
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
            if (index === WINDOW_ROWS) {
              // The crossing target: DOM order and tab order disagree, so
              // resolving the request has to pick by tab order, not by
              // walking the DOM front to back.
              return (
                <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                  <div role="button" tabIndex={5} ariaLabel="Dom-first" style={{ width: 40, height: 24 }} />
                  <div role="button" tabIndex={1} ariaLabel="Tab-order-first" style={{ width: 40, height: 24 }} />
                </div>
              )
            }
            return (
              <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                <div role="button" tabIndex={0} ariaLabel={`Button ${index}`} style={{ width: 40, height: 24 }} />
              </div>
            )
          })}
        </virtual-list>
      </div>
    )
  }

  it("resolves a crossing target by tab order, not DOM order", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsWithOrderedTarget />)

      const start = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(start.id)
      screen.renderer.flush()
      for (let index = 0; index < WINDOW_ROWS - 1; index += 1) {
        screen.renderer.focusNext()
        screen.renderer.flush()
        screen.renderer.drawPendingFrame()
      }
      expect(screen.getByRole("button", { name: `Button ${WINDOW_ROWS - 1}` })).toHaveFocus()

      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByRole("button", { name: "Tab-order-first" })).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function ShortListThenOutside() {
    return (
      <div>
        <virtual-list
          role="rowgroup"
          ariaLabel="Rows"
          style={{ width: 320, height: 240, display: "flex", flexDirection: "column" }}
        >
          <div role="row" ariaLabel="Row 0" style={{ height: 24, display: "flex" }}>
            <div role="button" tabIndex={0} ariaLabel="Button 0" style={{ width: 40, height: 24 }} />
          </div>
          {/* Built, mounted, but nothing focusable of its own. */}
          <div role="row" ariaLabel="Row 1" style={{ height: 24, display: "flex" }} />
        </virtual-list>
        <div role="button" tabIndex={0} ariaLabel="Outside" style={{ width: 40, height: 24 }} />
      </div>
    )
  }

  it("Tab past a built row with nothing focusable reaches what follows the list, not a cross-window request", () => {
    const screen = createTestRoot()

    try {
      screen.render(<ShortListThenOutside />)

      const button0 = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(button0.id)
      screen.renderer.flush()
      expect(button0).toHaveFocus()

      // Row 1 is already built (it is the list's only other row, and there
      // is no `itemCount` to widen past) — Tab has nowhere to advance a
      // window to, and must fall through to ordinary Tab order instead of
      // consuming the key on a request that can never resolve.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })
})
