/** React DOM comparison: the unknown `<virtual-list>` tag gets ordinary DOM children. */

import React from "react"
// @ts-expect-error react-dom is a workspace peer used only by this browser spike.
import { createRoot } from "react-dom/client"

const DATA_ROWS = 500
const WINDOW_ROWS = 24

function App() {
  const rows = Array.from({ length: WINDOW_ROWS }, (_, index) => index)
  return (
    <>
      <h1>Satisfactory item balance table spike</h1>
      <p id="report" role="status" aria-live="polite">
        Waiting for React DOM inspection…
      </p>
      <div role="table" aria-label="Satisfactory item balance table" aria-rowcount={DATA_ROWS + 1}>
        <div role="row" aria-rowindex={1}>
          <div role="columnheader">Item</div>
          <div role="columnheader">Balance</div>
          <div role="columnheader">Action</div>
        </div>
        <virtual-list
          role="rowgroup"
          itemCount={DATA_ROWS}
          windowStart={0}
          estimatedItemHeight={38}
          aria-label="React DOM leaves this custom element unwindowed"
        >
          {rows.map((index) => (
            <div key={index} role="row" aria-rowindex={index + 2}>
              <div role="cell">{`Item ${index + 1}`}</div>
              <div role="cell">{`${(index * 13) % 240} / min`}</div>
              <div role="cell"><button type="button">{`Details ${index + 1}`}</button></div>
            </div>
          ))}
        </virtual-list>
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(<App />)

requestAnimationFrame(() => {
  const table = document.querySelector('[role="table"]')
  const list = document.querySelector("virtual-list")
  const report = document.getElementById("report")!
  report.textContent = JSON.stringify({
    tableRole: table?.getAttribute("role"),
    ariaLabel: table?.getAttribute("aria-label"),
    ariaRowCount: table?.getAttribute("aria-rowcount"),
    rowgroupRole: list?.getAttribute("role"),
    itemCountAttribute: list?.getAttribute("itemcount"),
    mountedRows: list?.querySelectorAll('[role="row"]').length,
    lastRowIndex: list?.querySelector('[role="row"]:last-child')?.getAttribute("aria-rowindex"),
    listHeight: list?.scrollHeight,
    viewportHeight: list?.clientHeight,
  })
})
