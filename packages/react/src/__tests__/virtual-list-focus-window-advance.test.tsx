import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
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

  /** A slot the test releases explicitly, instead of a real timer: `onVisibleRange`
   *  defers its `setStart` until the test calls `release.current()`, so the
   *  gap between "request queued" and "request resolved" is exact and has no
   *  real-clock delay to be flaky about on a loaded machine. */
  function WindowedRowsDeferredVisibleRange({
    release,
  }: {
    release: { current: (() => void) | null }
  }) {
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
            onVisibleRange={(event) => {
              const next = Math.max(0, Math.floor(event.startIndex ?? 0) - 2)
              release.current = () => setStart((current) => (current === next ? current : next))
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

  it("does not steal focus back if it moves elsewhere before a deferred crossing resolves", () => {
    const screen = createTestRoot()
    const release: { current: (() => void) | null } = { current: null }

    try {
      screen.render(<WindowedRowsDeferredVisibleRange release={release} />)

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

      // Crosses the boundary and queues a request for Button 20. The
      // deferred `onVisibleRange` has captured a release but not called it,
      // so the request is still outstanding.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()
      expect(screen.queryByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeNull()
      expect(lastBuilt).toHaveFocus()
      expect(release.current).not.toBeNull()

      // The user focuses something else before the deferred update lands.
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" })
      screen.renderer.focusElement(elsewhere.id)
      expect(elsewhere).toHaveFocus()

      // Release it now, at a moment the test chose exactly: Button 20 exists
      // once this draws, but resolving the stale request must not pull focus
      // away from `elsewhere`. `act` flushes the commit synchronously, the
      // same guarantee `dispatchNativeEvents` gives a handler called from the
      // native event pipeline, since this call is not one.
      act(() => release.current!())
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByRole("button", { name: `Button ${WINDOW_ROWS}` })).toBeVisible()
      expect(elsewhere).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsWithMultiControlTarget() {
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
              // The crossing target has two ordinary (tabIndex 0) controls:
              // resolving the request has to pick the first one in document
              // order, not whichever one a plain unordered tree walk visits
              // first.
              return (
                <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                  <div role="button" tabIndex={0} ariaLabel="First" style={{ width: 40, height: 24 }} />
                  <div role="button" tabIndex={0} ariaLabel="Second" style={{ width: 40, height: 24 }} />
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

  it("resolves a crossing target's first focusable control in document order", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsWithMultiControlTarget />)

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

      expect(screen.getByRole("button", { name: "First" })).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsWithHiddenControlInTarget() {
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
              return (
                <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    ariaLabel="Hidden"
                    style={{ width: 40, height: 24, display: "none" }}
                  />
                  <div role="button" tabIndex={0} ariaLabel="Visible" style={{ width: 40, height: 24 }} />
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

  it("skips a display:none control when resolving a crossing target", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsWithHiddenControlInTarget />)

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

      expect(screen.getByRole("button", { name: "Visible" })).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function ListWithUnbuiltRowPastANonFocusableOne() {
    // itemCount 4, but only rows 0-1 are ever handed to the list: rows 2-3
    // are genuinely unbuilt, past a built row (1) with nothing focusable of
    // its own. Tab from row 0 must still cross to row 2, not treat row 1 as
    // the built window's edge and give up on it.
    const [start, setStart] = useState(0)
    const rows = start === 0 ? [0, 1] : [2, 3]
    return (
      <div>
        <virtual-list
          role="rowgroup"
          ariaLabel="Rows"
          itemCount={4}
          windowStart={start}
          estimatedItemHeight={24}
          style={{ width: 320, height: 240, display: "flex", flexDirection: "column" }}
          onVisibleRange={(event) => {
            // A small list reports a `startIndex` of 0 well before its
            // logical count actually reaches 0, so this reads `endIndex`
            // instead: whether the reported range's far edge has moved past
            // what is currently mounted. This app only has two window
            // states, 0 and 2 (matching `rows` below), so it jumps straight
            // to the far edge's row rather than trying to keep a buffer.
            const next = Math.max(0, (event.endIndex ?? 1) - 1)
            setStart((current) => (current === next ? current : next))
          }}
        >
          {rows.map((index) => (
            <div key={index} role="row" ariaLabel={`Row ${index}`} style={{ height: 24, display: "flex" }}>
              {index !== 1 && (
                <div role="button" tabIndex={0} ariaLabel={`Button ${index}`} style={{ width: 40, height: 24 }} />
              )}
            </div>
          ))}
        </virtual-list>
        <div role="button" tabIndex={0} ariaLabel="Outside" style={{ width: 40, height: 24 }} />
      </div>
    )
  }

  it("crosses past a built row with nothing focusable to reach a genuinely unbuilt one", () => {
    const screen = createTestRoot()

    try {
      screen.render(<ListWithUnbuiltRowPastANonFocusableOne />)

      const button0 = screen.getByRole("button", { name: "Button 0" })
      screen.renderer.focusElement(button0.id)
      screen.renderer.flush()
      expect(button0).toHaveFocus()
      expect(screen.queryByRole("row", { name: "Row 2" })).toBeNull()

      // Row 1 is built but has nothing focusable; Row 2 is not built at all.
      // Tab must widen the window to reach Row 2, not give up on Row 1 and
      // fall through to Outside.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByRole("button", { name: "Button 2" })).toBeVisible()
      expect(screen.getByRole("button", { name: "Button 2" })).toHaveFocus()
    } finally {
      screen.unmount()
    }
  })

  function WindowedRowsWithNonOverlappingSlide() {
    // onVisibleRange anchors the new window at the *end* of the reported
    // range rather than its start, so the requested row lands at the very
    // front of the new window instead of a few rows into it — the old
    // window and the new one share no rows, and the origin's own row is
    // unmounted by the very commit that builds the target.
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
            const next = Math.max(0, (event.endIndex ?? 1) - 1)
            setStart((current) => (current === next ? current : next))
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
    )
  }

  it("resolves the crossing even when widening the window unmounts the origin's own row", () => {
    const screen = createTestRoot()

    try {
      screen.render(<WindowedRowsWithNonOverlappingSlide />)

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

      // This app's `onVisibleRange` replaces the window outright: Button 19
      // (the request's origin) is unmounted in the same commit that mounts
      // Button 20. That is the request succeeding, not focus moving away.
      screen.renderer.focusNext()
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.queryByRole("button", { name: `Button ${WINDOW_ROWS - 1}` })).toBeNull()
      const nextButton = screen.getByRole("button", { name: `Button ${WINDOW_ROWS}` })
      expect(nextButton).toBeVisible()
      expect(nextButton).toHaveFocus()
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
