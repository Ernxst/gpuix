/** Live-window GPUI draw time for a large scroll surface and a steady animation. */

import React, { useState } from "react"
import { createRenderer, render } from "@gpuix/react"

const renderer = createRenderer()
renderer.init({ title: "GPUIX frame benchmark", width: 640, height: 560 })

let scrollId: number | undefined
let setAnimationWidth: ((width: number) => void) | undefined

function AnimatedBox() {
  const [width, setWidth] = useState(40)
  setAnimationWidth = setWidth
  return <div style={{ width, height: 24, backgroundColor: "#fbbf24" }} />
}

const rows = Array.from({ length: 1128 }, (_, index) => (
  <div key={index} style={{ height: 24, flexShrink: 0, backgroundColor: index % 2 ? "#202532" : "#252b39" }}>
    <text style={{ color: "#e5e7eb", fontSize: 14 }}>{`Row ${index}: frame benchmark content`}</text>
  </div>
))

render(
  <div style={{ width: 640, height: 560, padding: 12, backgroundColor: "#151a23" }}>
    <AnimatedBox />
    <div
      ref={(node) => { scrollId = node?.id }}
      style={{ width: 616, height: 490, overflow: "scroll", flexDirection: "column" }}
    >
      {rows}
    </div>
  </div>,
  { renderer },
)
renderer.activateWindow()
renderer.tick()
for (const delay of [100, 250, 500, 750, 1_000]) {
  setTimeout(() => renderer.activateWindow(), delay)
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16))
}

async function measuredDraw(update: () => void): Promise<number> {
  const before = renderer.getDebugFrameOverlayStats().frames
  const offsetBefore = scrollId === undefined ? null : renderer.getScrollOffset(scrollId)
  update()
  let running = true
  for (let attempt = 0; attempt < 30; attempt++) {
    running = renderer.tick()
    const stats = renderer.getDebugFrameOverlayStats()
    if (stats.frames > before && stats.currentMs !== null && stats.currentMs !== undefined) {
      await pause()
      return stats.currentMs
    }
    await pause()
  }
  const offsetAfter = scrollId === undefined ? null : renderer.getScrollOffset(scrollId)
  throw new Error(`GPUI did not draw within 30 event-loop pumps: ${JSON.stringify({ before, after: renderer.getDebugFrameOverlayStats(), running, offsetBefore, offsetAfter, capabilities: renderer.capabilities() })}`)
}

function summary(samples: number[]) {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { n: samples.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), minMs: sorted[0], maxMs: sorted.at(-1), samples }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("Frame fixture timed out", renderer.getDebugFrameOverlayStats())
    process.exit(1)
  }, 30_000)
  for (let index = 0; index < 75; index++) {
    renderer.tick()
    await pause()
  }
  if (scrollId === undefined || !setAnimationWidth) throw new Error("fixture did not mount")
  await measuredDraw(() => setAnimationWidth!(41))

  for (let index = 0; index < 12; index++) {
    await measuredDraw(() => renderer.scrollTo(scrollId!, 0, -(index + 1) * 20))
  }
  renderer.resetDebugFrameOverlayStats()
  renderer.tick()
  const scroll: number[] = []
  for (let index = 0; index < 120; index++) {
    scroll.push(await measuredDraw(() => renderer.scrollTo(scrollId!, 0, -(index + 20) * 24)))
  }

  for (let index = 0; index < 12; index++) {
    await measuredDraw(() => setAnimationWidth!(40 + (index % 60) * 3))
  }
  renderer.resetDebugFrameOverlayStats()
  renderer.tick()
  const animation: number[] = []
  for (let index = 0; index < 120; index++) {
    animation.push(await measuredDraw(() => setAnimationWidth!(40 + (index % 60) * 3)))
  }

  clearTimeout(watchdog)
  console.log(`GPUIX_FRAME_BENCH ${JSON.stringify({ scroll: summary(scroll), animation: summary(animation) })}`)
  setTimeout(() => process.exit(0), 100)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
