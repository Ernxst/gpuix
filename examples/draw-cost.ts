/**
 * Measures what a full draw costs per element, for #480.
 *
 * The issue reports ~13µs per element on a 1128-element page and concludes the
 * fix is architectural. Before paying for that, this establishes whether the
 * cost is really linear in element count and what the constant is here.
 *
 * The fixture is built in this file rather than taken from `chat.tsx`, which
 * renders its turns through `<virtual-list>`: there, retained elements grow
 * while built and painted elements do not, so draw cost goes sublinear and
 * says nothing about a page that puts everything on screen. This tree is a
 * plain scroll container of styled rows, the shape the reported page has.
 *
 * Every sample is a forced full redraw of an unchanged tree (`flush()` marks
 * the window invalid, then draws) — the issue's "forced redraw, no scroll".
 *
 * bun draw-cost.ts
 */

import React from "react"
import { createTestRoot, isNativeTestRendererAvailable } from "@gpuix/react/testing"

const rowCounts = (process.env.DRAW_COST_ROWS ?? "40,120,240,480")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0)
const warmupDraws = Number(process.env.DRAW_COST_WARMUP ?? 5)
const measuredDraws = Number(process.env.DRAW_COST_SAMPLES ?? 30)

if (!isNativeTestRendererAvailable()) {
  console.error("draw-cost needs the native GPU test renderer; build it with bun run build:native")
  process.exit(1)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function round(value: number, places = 3): number {
  return Number(value.toFixed(places))
}

// Five host nodes per row: the row, a swatch, and three texts. Backgrounds,
// borders and radii are what the reported page carries, so the draw pays for
// quads and glyph runs rather than bare boxes.
function Row({ index }: { index: number }): React.ReactElement {
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 8,
        borderBottomWidth: 1,
        borderColor: "#26262b",
        backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
      },
    },
    React.createElement("div", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: index % 3 === 0 ? "#4ade80" : "#f59e0b",
      },
    }),
    React.createElement("text", { style: { color: "#e5e5e5", fontSize: 13 } }, `Row ${index}`),
    React.createElement(
      "text",
      { style: { color: "#a1a1aa", fontSize: 12 } },
      `${(index * 37) % 1000} events`,
    ),
    React.createElement(
      "text",
      { style: { color: "#71717a", fontSize: 12 } },
      index % 2 === 0 ? "healthy" : "degraded",
    ),
  )
}

// Same five host nodes per row as `Row`, with the styling stripped: what a
// draw costs when the element count is identical but there is no text to shape
// and no border or radius to raster.
function PlainRow({ index }: { index: number }): React.ReactElement {
  return React.createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 12, padding: 8 } },
    React.createElement("div", { style: { width: 10, height: 10 } }),
    React.createElement("div", { style: { width: 80, height: 12 } }),
    React.createElement("div", { style: { width: 60, height: 12 } }),
    React.createElement("div", { style: { width: 50, height: 12 } }),
  )
}

// Text in every leaf, but no backgrounds, borders or radii: isolates glyph
// work from the quad work `QuadRow` isolates.
function TextRow({ index }: { index: number }): React.ReactElement {
  return React.createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 12, padding: 8 } },
    React.createElement("text", { style: { fontSize: 13 } }, `Row ${index}`),
    React.createElement("text", { style: { fontSize: 12 } }, `${(index * 37) % 1000} events`),
    React.createElement("text", { style: { fontSize: 12 } }, index % 2 === 0 ? "up" : "down"),
    React.createElement("text", { style: { fontSize: 12 } }, "detail"),
  )
}

// Backgrounds, borders and radii in every leaf, but no text.
function QuadRow({ index }: { index: number }): React.ReactElement {
  const swatch = (size: number) => ({
    width: size,
    height: 12,
    borderRadius: 4,
    borderBottomWidth: 1,
    borderColor: "#26262b",
    backgroundColor: index % 3 === 0 ? "#4ade80" : "#f59e0b",
  })
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 8,
        borderBottomWidth: 1,
        borderColor: "#26262b",
        backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
      },
    },
    React.createElement("div", { style: swatch(10) }),
    React.createElement("div", { style: swatch(80) }),
    React.createElement("div", { style: swatch(60) }),
    React.createElement("div", { style: swatch(50) }),
  )
}

function Page({ rows }: { rows: number }): React.ReactElement {
  return React.createElement(
    "div",
    { style: { width: 1200, height: 800, overflowY: "scroll", backgroundColor: "#0b0b0e" } },
    Array.from({ length: rows }, (_, index) =>
      React.createElement(Row, { key: index, index }),
    ),
  )
}

// A dense data table, the shape the consuming app actually scrolls. There is no
// table element yet (#367), so this is what one costs today: a CSS grid whose
// columns are shared across rows, one host node per cell.
const tableColumns = Number(process.env.DRAW_COST_COLUMNS ?? 8)
// Content-sized columns make every cell in every row part of track sizing,
// which is both the expensive case and the reason a table cannot be row
// virtualised. `DRAW_COST_TRACK=fixed` prices the alternative.
const tableTrack = process.env.DRAW_COST_TRACK === "fixed" ? "140px" : "max-content"

function TableRow({ index }: { index: number }): React.ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    ...Array.from({ length: tableColumns }, (_, column) =>
      React.createElement(
        "text",
        {
          key: column,
          style: {
            color: column === 0 ? "#e5e5e5" : "#a1a1aa",
            fontSize: 12,
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 10,
            paddingRight: 10,
            borderBottomWidth: 1,
            borderColor: "#26262b",
            backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
          },
        },
        column === 0 ? `Row ${index}` : `${(index * (column + 7)) % 1000}`,
      ),
    ),
  )
}

function TablePage({ rows }: { rows: number }): React.ReactElement {
  return React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: `repeat(${tableColumns}, ${tableTrack})`,
        width: 1200,
        height: 800,
        overflowY: "scroll",
        backgroundColor: "#0b0b0e",
      },
    },
    Array.from({ length: rows }, (_, index) =>
      React.createElement(TableRow, { key: index, index }),
    ),
  )
}

// The same table through `<virtual-list>`: rows are built only near the
// viewport. Columns must be fixed-width here, because a track shared across the
// whole grid cannot be sized from rows that were never built — which is why
// pinning widths matters for virtualisation even though, measured on the grid
// fixture, it costs the same as `max-content`.
function VirtualRow({ index }: { index: number }): React.ReactElement {
  return React.createElement(
    "div",
    { style: { display: "flex", alignItems: "center" } },
    ...Array.from({ length: tableColumns }, (_, column) =>
      React.createElement(
        "text",
        {
          key: column,
          style: {
            width: 140,
            color: column === 0 ? "#e5e5e5" : "#a1a1aa",
            fontSize: 12,
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 10,
            paddingRight: 10,
            borderBottomWidth: 1,
            borderColor: "#26262b",
            backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
          },
        },
        column === 0 ? `Row ${index}` : `${(index * (column + 7)) % 1000}`,
      ),
    ),
  )
}

function VirtualTablePage({ rows }: { rows: number }): React.ReactElement {
  return React.createElement(
    "virtual-list",
    {
      estimatedItemHeight: 31,
      style: { width: 1200, height: 800, backgroundColor: "#0b0b0e" },
    },
    Array.from({ length: rows }, (_, index) =>
      React.createElement(VirtualRow, { key: index, index }),
    ),
  )
}

// Structurally identical to `Row`, differing only in that every node declares
// state styles. Real app rows do: a row hover, plus hover and focus-visible on
// each link or button inside. Each refinement is another `apply_styles` call
// for that node, so this is the pessimistic end of what style derivation costs.
function makeRefinementRow(
  refinement: Record<string, unknown>,
): ({ index }: { index: number }) => React.ReactElement {
  return function RefinedRow({ index }: { index: number }): React.ReactElement {
    const cell = (color: string) => ({ color, fontSize: 12, ...refinement })
    return React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 8,
          borderBottomWidth: 1,
          borderColor: "#26262b",
          backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
          ...refinement,
        },
      },
      React.createElement("div", {
        style: {
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: index % 3 === 0 ? "#4ade80" : "#f59e0b",
          ...refinement,
        },
      }),
      React.createElement("text", { style: cell("#e5e5e5") }, `Row ${index}`),
      React.createElement("text", { style: cell("#a1a1aa") }, `${(index * 37) % 1000} events`),
      React.createElement(
        "text",
        { style: cell("#71717a") },
        index % 2 === 0 ? "healthy" : "degraded",
      ),
    )
  }
}

function RefinementRow({ index }: { index: number }): React.ReactElement {
  const cell = (color: string) => ({
    color,
    fontSize: 12,
    hover: { color: "#ffffff" },
    focusVisible: { outlineColor: "#89b4fa" },
  })
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 8,
        borderBottomWidth: 1,
        borderColor: "#26262b",
        backgroundColor: index % 2 === 0 ? "#111114" : "#141418",
        hover: { backgroundColor: "#1d1d22" },
      },
    },
    React.createElement("div", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: index % 3 === 0 ? "#4ade80" : "#f59e0b",
        hover: { backgroundColor: "#a3e635" },
        active: { opacity: 0.6 },
      },
    }),
    React.createElement("text", { style: cell("#e5e5e5") }, `Row ${index}`),
    React.createElement("text", { style: cell("#a1a1aa") }, `${(index * 37) % 1000} events`),
    React.createElement("text", { style: cell("#71717a") }, index % 2 === 0 ? "healthy" : "degraded"),
  )
}

// Depth against breadth at identical node count. A real page nests about five
// deep per row; these fixtures were two. Same nodes, same text, same styles —
// only the arrangement differs, so any difference is what nesting costs.
function DeepRow({ index }: { index: number }): React.ReactElement {
  const leaf = (label: string) =>
    React.createElement("text", { style: { color: "#a1a1aa", fontSize: 12 } }, label)
  const wrap = (child: React.ReactElement, depth: number): React.ReactElement =>
    depth === 0
      ? child
      : React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center" } },
          wrap(child, depth - 1),
        )
  return React.createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 12, padding: 8 } },
    wrap(leaf(`Row ${index}`), 3),
    wrap(leaf(`${(index * 37) % 1000} events`), 3),
  )
}

// The same 9 nodes and the same 2 texts as DeepRow, arranged as siblings.
function ShallowRow({ index }: { index: number }): React.ReactElement {
  const leaf = (label: string) =>
    React.createElement("text", { style: { color: "#a1a1aa", fontSize: 12 } }, label)
  const filler = () =>
    React.createElement("div", { style: { display: "flex", alignItems: "center" } })
  return React.createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 12, padding: 8 } },
    leaf(`Row ${index}`),
    leaf(`${(index * 37) % 1000} events`),
    filler(),
    filler(),
    filler(),
    filler(),
    filler(),
    filler(),
  )
}

const FIXTURES = {
  table: TablePage,
  "virtual-table": VirtualTablePage,
} as const

interface ResultRow {
  rows: number
  elements: number
  drawP50Ms: number
  drawP95Ms: number
  usPerElement: number
  buildMsPerDraw: number
  buildSharePercent: number
  applyStylesMsPerDraw: number
  applyStylesSharePercent: number
}

const results: ResultRow[] = []

for (const rows of rowCounts) {
  const testRoot = createTestRoot()
  const { render, renderer } = testRoot
  const fixture = FIXTURES[process.env.DRAW_COST_FIXTURE as keyof typeof FIXTURES] ?? Page
  render(React.createElement(fixture, { rows }))

  for (let index = 0; index < warmupDraws; index += 1) renderer.flush()
  renderer.takeRenderBuildMicros()
  renderer.takeApplyStylesMicros()

  const samples: number[] = []
  for (let index = 0; index < measuredDraws; index += 1) {
    const started = performance.now()
    renderer.flush()
    samples.push(performance.now() - started)
  }
  // Summed over the measured draws, so this is a mean against a median draw.
  const buildMsPerDraw = renderer.takeRenderBuildMicros() / 1_000 / measuredDraws
  // A subset of the rebuild: what re-deriving styles costs, which is what a
  // per-node style cache could remove.
  const applyStylesMsPerDraw = renderer.takeApplyStylesMicros() / 1_000 / measuredDraws

  const sorted = [...samples].sort((a, b) => a - b)
  const elements = renderer.getRetainedElementCount()
  const drawP50Ms = percentile(sorted, 50)
  results.push({
    rows,
    elements,
    drawP50Ms: round(drawP50Ms),
    drawP95Ms: round(percentile(sorted, 95)),
    usPerElement: round((drawP50Ms * 1_000) / Math.max(1, elements), 2),
    buildMsPerDraw: round(buildMsPerDraw),
    buildSharePercent: round((buildMsPerDraw / Math.max(0.001, drawP50Ms)) * 100, 1),
    applyStylesMsPerDraw: round(applyStylesMsPerDraw),
    applyStylesSharePercent: round((applyStylesMsPerDraw / Math.max(0.001, drawP50Ms)) * 100, 1),
  })

  const disposable = testRoot as { unmount?: () => void; cleanup?: () => void }
  disposable.unmount?.()
  disposable.cleanup?.()
}

console.log(`DRAW_COST ${JSON.stringify({ warmupDraws, measuredDraws, rows: results })}`)

// Same element count for every variant, so the differences are what the
// content costs rather than how much of it there is.
const variantRows = Number(process.env.DRAW_COST_VARIANT_ROWS ?? 240)
const variants: Array<[string, ({ index }: { index: number }) => React.ReactElement]> = [
  ["plain", PlainRow],
  ["quads", QuadRow],
  ["text", TextRow],
  ["full", Row],
  ["refinements", RefinementRow],
  // Which refinement carries the cost: focus styles force a native focus
  // handle per node, hover and active do not.
  ["hover-only", makeRefinementRow({ hover: { backgroundColor: "#1d1d22" } })],
  ["focus-only", makeRefinementRow({ focusVisible: { outlineColor: "#89b4fa" } })],
  ["active-only", makeRefinementRow({ active: { opacity: 0.6 } })],
  // Identical node count and text; only the nesting differs.
  ["deep", DeepRow],
  ["shallow", ShallowRow],
]
const variantResults: Array<{
  variant: string
  elements: number
  drawP50Ms: number
  usPerElement: number
  buildMsPerDraw: number
  buildSharePercent: number
  applyStylesMsPerDraw: number
  applyStylesSharePercent: number
}> = []

for (const [variant, RowComponent] of variants) {
  const testRoot = createTestRoot()
  const { render, renderer } = testRoot
  render(
    React.createElement(
      "div",
      { style: { width: 1200, height: 800, overflowY: "scroll", backgroundColor: "#0b0b0e" } },
      Array.from({ length: variantRows }, (_, index) =>
        React.createElement(RowComponent, { key: index, index }),
      ),
    ),
  )

  for (let index = 0; index < warmupDraws; index += 1) renderer.flush()
  renderer.takeRenderBuildMicros()
  renderer.takeApplyStylesMicros()

  const samples: number[] = []
  for (let index = 0; index < measuredDraws; index += 1) {
    const started = performance.now()
    renderer.flush()
    samples.push(performance.now() - started)
  }
  const buildMsPerDraw = renderer.takeRenderBuildMicros() / 1_000 / measuredDraws
  const applyStylesMsPerDraw = renderer.takeApplyStylesMicros() / 1_000 / measuredDraws

  const sorted = [...samples].sort((a, b) => a - b)
  const elements = renderer.getRetainedElementCount()
  const drawP50Ms = percentile(sorted, 50)
  variantResults.push({
    variant,
    elements,
    drawP50Ms: round(drawP50Ms),
    usPerElement: round((drawP50Ms * 1_000) / Math.max(1, elements), 2),
    buildMsPerDraw: round(buildMsPerDraw),
    buildSharePercent: round((buildMsPerDraw / Math.max(0.001, drawP50Ms)) * 100, 1),
    applyStylesMsPerDraw: round(applyStylesMsPerDraw),
    applyStylesSharePercent: round((applyStylesMsPerDraw / Math.max(0.001, drawP50Ms)) * 100, 1),
  })

  const disposable = testRoot as { unmount?: () => void; cleanup?: () => void }
  disposable.unmount?.()
  disposable.cleanup?.()
}

console.log(`DRAW_COST_VARIANTS ${JSON.stringify({ variantRows, variants: variantResults })}`)

// Linear cost keeps µs/element flat as the tree grows. A constant that falls
// with size means fixed per-draw overhead dominates instead.
const first = results.at(0)
const last = results.at(-1)
if (first && last && first.elements > 0) {
  console.log(
    `DRAW_COST_TREND ${JSON.stringify({
      smallest: { elements: first.elements, usPerElement: first.usPerElement },
      largest: { elements: last.elements, usPerElement: last.usPerElement },
      elementRatio: round(last.elements / Math.max(1, first.elements), 2),
      drawRatio: round(last.drawP50Ms / Math.max(0.001, first.drawP50Ms), 2),
    })}`,
  )
}
