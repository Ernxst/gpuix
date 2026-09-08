import React from "react"
import { describe, expect, it } from "vitest"
import type { StyleDesc } from "../types/host.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const columns = [{ type: "repeat" as const, count: 3, tracks: [{ type: "fr" as const, value: 1 }] }]
const rows = [
  { type: "px" as const, value: 40 },
  { type: "px" as const, value: 40 },
]

function renderGrid(childStyle: StyleDesc) {
  const root = createTestRoot({ width: 600, height: 80, scaleFactor: 1 })
  root.render(
    <div
      style={{
        display: "grid",
        width: 600,
        height: 80,
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
      }}
    >
      <div data-testid="item" style={childStyle} />
    </div>,
  )
  return root
}

function itemBounds(root: ReturnType<typeof renderGrid>) {
  const item = root.renderer.findByTestId("item")
  expect(item).toBeDefined()
  return root.renderer.getElementBounds(item!.id)!
}

describeNative("CSS Grid item placement", () => {
  it("places a grid column across the full width with a negative end line", () => {
    const root = renderGrid({ gridColumn: "1 / -1" })
    try {
      // Three 1fr columns divide 600px into 200px tracks; lines 1 to -1 span all 3.
      expect(itemBounds(root)).toEqual([0, 0, 600, 40])
    } finally {
      root.unmount()
    }
  })

  it("sizes a span from the auto-placed first column", () => {
    const root = renderGrid({ gridColumn: "span 2" })
    try {
      // A two-column span covers 2 × (600px / 3) = 400px.
      expect(itemBounds(root)).toEqual([0, 0, 400, 40])
    } finally {
      root.unmount()
    }
  })

  it("places a numeric column line", () => {
    const root = renderGrid({ gridColumn: 3 })
    try {
      // Column line 3 starts after 2 × (600px / 3) = 400px.
      expect(itemBounds(root)).toEqual([400, 0, 200, 40])
    } finally {
      root.unmount()
    }
  })

  it("places a numeric row line", () => {
    const root = renderGrid({ gridRow: 2 })
    try {
      // Row line 2 starts after the first fixed 40px row.
      expect(itemBounds(root)).toEqual([0, 40, 200, 40])
    } finally {
      root.unmount()
    }
  })

  it("maps gridArea in row-start / column-start / row-end / column-end order", () => {
    const root = renderGrid({ gridArea: "2 / 1 / 3 / 3" })
    try {
      // Rows 2 to 3 give y = 40; columns 1 to 3 give 2 × 200px = 400px.
      expect(itemBounds(root)).toEqual([0, 40, 400, 40])
    } finally {
      root.unmount()
    }
  })

  it("lets an explicit column start override the shorthand start", () => {
    const root = renderGrid({ gridColumn: "1 / 3", gridColumnStart: 2 })
    try {
      // The explicit start line 2 wins; line 3 ends at 3 × 200px, so width is 200px.
      expect(itemBounds(root)).toEqual([200, 0, 200, 40])
    } finally {
      root.unmount()
    }
  })

  it("lets a hover refinement's declared auto reset the base placement", () => {
    const root = renderGrid({
      gridColumn: "1 / -1",
      hover: { gridColumn: "auto" },
    })
    try {
      // Idle: the base placement spans all 3 columns, 600px wide.
      expect(itemBounds(root)).toEqual([0, 0, 600, 40])

      // Hovered: the declared `auto` is a real value that overrides the
      // inherited base placement, falling back to a single auto-placed cell.
      root.renderer.nativeSimulateMouseMove(10, 10)
      expect(itemBounds(root)).toEqual([0, 0, 200, 40])
    } finally {
      root.unmount()
    }
  })
})
