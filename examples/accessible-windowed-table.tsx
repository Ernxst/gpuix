/**
 * Native accessibility spike for a large, variable-height reference table.
 *
 * Run with `bun --hot accessible-windowed-table.tsx` from `examples/`.
 * The short viewport keeps the virtual-list build boundary close for VoiceOver
 * navigation; `guidepup-accessible-windowed-table.ts` records the spoken output.
 */

import React, { useState } from "react"
import { render } from "@gpuix/react"

const DATA_ROWS = 500
const WINDOW_ROWS = 24

function TableRow({ index }: { index: number }) {
  const rowIndex = index + 2 // Header is row 1 in the logical table.
  const tall = index % 7 === 0
  return (
    <div
      role="row"
      ariaRowIndex={rowIndex}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: tall ? 58 : 34,
        padding: 8,
        borderBottomWidth: 1,
        borderColor: "#3b4252",
        backgroundColor: index % 2 === 0 ? "#202735" : "#252d3b",
      }}
    >
      <div role="cell" style={{ width: 180 }}>
        <text style={{ color: "#eceff4", fontSize: 13 }}>
          {`Item ${String(index + 1).padStart(3, "0")}`}
        </text>
      </div>
      <div role="cell" style={{ width: 120 }}>
        <text style={{ color: "#d8dee9", fontSize: 13 }}>{`${(index * 13) % 240} / min`}</text>
        {tall ? <text style={{ color: "#a3be8c", fontSize: 11 }}>Variable-height recipe note</text> : null}
      </div>
      <div role="cell" style={{ width: 120 }}>
        <button
          role="button"
          ariaLabel={`Inspect item ${index + 1}`}
          tabIndex={0}
          style={{ color: "#88c0d0", padding: 4 }}
        >
          <text>Details</text>
        </button>
      </div>
    </div>
  )
}

function App() {
  const [windowStart, setWindowStart] = useState(0)
  const end = Math.min(DATA_ROWS, windowStart + WINDOW_ROWS)

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 620,
        height: 300,
        padding: 20,
        gap: 8,
        backgroundColor: "#161b22",
      }}
    >
      <text style={{ color: "#eceff4", fontSize: 18 }}>Satisfactory item balance table spike</text>
      <text data-testid="window-marker" style={{ color: "#a3be8c", fontSize: 12 }}>
        {`React window ${windowStart + 1}–${end} of ${DATA_ROWS}`}
      </text>
      <div
        role="table"
        ariaLabel="Satisfactory item balance table"
        ariaRowCount={DATA_ROWS + 1}
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}
      >
        <div
          role="row"
          ariaRowIndex={1}
          style={{ display: "flex", gap: 12, padding: 8, backgroundColor: "#343f52" }}
        >
          <div role="columnheader" style={{ width: 180 }}>
            <text style={{ color: "#eceff4", fontSize: 13, fontWeight: "bold" }}>Item</text>
          </div>
          <div role="columnheader" style={{ width: 120 }}>
            <text style={{ color: "#eceff4", fontSize: 13, fontWeight: "bold" }}>Balance</text>
          </div>
          <div role="columnheader" style={{ width: 120 }}>
            <text style={{ color: "#eceff4", fontSize: 13, fontWeight: "bold" }}>Action</text>
          </div>
        </div>
        <virtual-list
          role="rowgroup"
          itemCount={DATA_ROWS}
          windowStart={windowStart}
          estimatedItemHeight={38}
          overdraw={96}
          style={{ flexGrow: 1, minHeight: 0 }}
          onVisibleRange={(event) => {
            const nextStart = Math.max(0, Math.floor(event.startIndex ?? 0) - 3)
            setWindowStart((current) => (current === nextStart ? current : nextStart))
          }}
        >
          {Array.from({ length: end - windowStart }, (_, offset) => (
            <TableRow key={windowStart + offset} index={windowStart + offset} />
          ))}
        </virtual-list>
      </div>
    </div>
  )
}

render(<App />, { title: "GPUIX Accessible Windowed Table", width: 660, height: 340 })
