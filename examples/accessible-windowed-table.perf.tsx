/** Measure GPUI draw and scroll cost for the 500-row table in both modes. */

import React, { useState } from "react"
import { createTestRoot, isNativeTestRendererAvailable } from "@gpuix/react/testing"

const ROWS = 500
const WINDOW_ROWS = 24
const WARMUP_SCROLLS = 20
const MEASURED_SCROLLS = 40

function Row({ index }: { index: number }) {
  return (
    <div
      role="row"
      ariaRowIndex={index + 2}
      style={{ display: "flex", alignItems: "center", minHeight: index % 7 === 0 ? 58 : 34, padding: 8 }}
    >
      <div role="cell" style={{ width: 180 }}><text>{`Item ${index + 1}`}</text></div>
      <div role="cell" style={{ width: 120 }}><text>{`${(index * 13) % 240} / min`}</text></div>
      <div role="cell" style={{ width: 120 }}>
        <button role="button" ariaLabel={`Inspect item ${index + 1}`} tabIndex={0}>
          <text>Details</text>
        </button>
      </div>
    </div>
  )
}

function Table({ virtual }: { virtual: boolean }) {
  const [windowStart, setWindowStart] = useState(0)
  const rowWindow = Array.from(
    { length: Math.min(WINDOW_ROWS, ROWS - windowStart) },
    (_, offset) => windowStart + offset,
  )
  const header = (
    <div role="row" ariaRowIndex={1} style={{ display: "flex", padding: 8 }}>
      <div role="columnheader" style={{ width: 180 }}><text>Item</text></div>
      <div role="columnheader" style={{ width: 120 }}><text>Balance</text></div>
      <div role="columnheader" style={{ width: 120 }}><text>Action</text></div>
    </div>
  )

  return (
    <div style={{ width: 640, height: 700, padding: 12 }}>
      <div role="table" ariaLabel="Performance fixture" ariaRowCount={ROWS + 1} style={{ height: 650 }}>
        {header}
        {virtual ? (
          <virtual-list
            role="rowgroup"
            itemCount={ROWS}
            windowStart={windowStart}
            estimatedItemHeight={38}
            overdraw={96}
            style={{ height: 560 }}
            onVisibleRange={(event) => {
              const nextStart = Math.max(0, Math.floor(event.startIndex ?? 0) - 3)
              setWindowStart((current) => (current === nextStart ? current : nextStart))
            }}
          >
            {rowWindow.map((index) => <Row key={index} index={index} />)}
          </virtual-list>
        ) : (
          <div role="rowgroup" style={{ height: 560, overflowY: "scroll" }}>
            {Array.from({ length: ROWS }, (_, index) => <Row key={index} index={index} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function percentile(sorted: number[], percent: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(percent / 100 * sorted.length) - 1)] ?? 0
}

function round(value: number): number {
  return Number(value.toFixed(3))
}

if (!isNativeTestRendererAvailable()) {
  throw new Error("This measurement needs the native GPU test renderer; run bun run build:native first")
}

const samples = new Map<boolean, { scrollMs: number[]; frameP90Ms: number[]; frameMaxMs: number[]; retainedElements: number[]; frameSamples: number; accessKit?: { tableRowCount?: number; rowIndices: number[] } }>([
  [false, { scrollMs: [], frameP90Ms: [], frameMaxMs: [], retainedElements: [], frameSamples: 0 }],
  [true, { scrollMs: [], frameP90Ms: [], frameMaxMs: [], retainedElements: [], frameSamples: 0 }],
])

// Interleave the order so a cold first draw does not belong to only one mode.
for (const virtual of [false, true, true, false, false, true]) {
  const root = createTestRoot()
  root.render(<Table virtual={virtual} />)
  for (let index = 0; index < 10; index += 1) root.renderer.flush()
  for (let index = 0; index < WARMUP_SCROLLS; index += 1) {
    root.renderer.dispatchScrollWheel(320, 380, 0, index % 2 === 0 ? -120 : 120)
  }
  root.renderer.resetDebugFrameOverlayStats()

  const scrollMs: number[] = []
  for (let index = 0; index < MEASURED_SCROLLS; index += 1) {
    const started = performance.now()
    root.renderer.dispatchScrollWheel(320, 380, 0, index % 2 === 0 ? -120 : 120)
    scrollMs.push(performance.now() - started)
  }

  const frame = root.renderer.getDebugFrameOverlayStats()
  const result = samples.get(virtual)!
  result.scrollMs.push(...scrollMs)
  result.frameP90Ms.push(frame.p90Ms ?? 0)
  result.frameMaxMs.push(frame.maxMs ?? 0)
  result.retainedElements.push(root.renderer.getRetainedElementCount())
  result.frameSamples += frame.samples
  if (virtual && !result.accessKit) {
    const nodes = Object.values(root.renderer.getAccessibilityTree().nodes)
    const table = nodes.find((node) => node.aria.role === "Table")
    result.accessKit = {
      tableRowCount: table?.aria.row_count,
      rowIndices: nodes.flatMap((node) => node.aria.role === "Row" && node.aria.row_index !== undefined
        ? [node.aria.row_index]
        : []),
    }
  }
  root.unmount()
}

for (const [virtual, result] of samples) {
  const sorted = [...result.scrollMs].sort((a, b) => a - b)
  console.log(JSON.stringify({
    mode: virtual ? "virtual-window" : "flat-all-rows",
    rows: ROWS,
    runs: result.retainedElements.length,
    warmupScrollsPerRun: WARMUP_SCROLLS,
    measuredScrollsPerRun: MEASURED_SCROLLS,
    retainedElements: result.retainedElements,
    accessKitSnapshot: result.accessKit,
    scrollDispatchP50Ms: round(percentile(sorted, 50)),
    scrollDispatchP95Ms: round(percentile(sorted, 95)),
    scrollDispatchMaxMs: round(sorted.at(-1) ?? 0),
    frameP90MsPerRun: result.frameP90Ms.map(round),
    frameMaxMs: round(Math.max(...result.frameMaxMs)),
    frameSamples: result.frameSamples,
  }))
}
