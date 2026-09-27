/** Live-window GPUI draw time for a large scroll surface and a steady animation. */

import React, { useState } from "react"
import { createRenderer, render, requestAnimationFrame, startFrameLoop } from "@gpuix/react"

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
startFrameLoop(renderer)
renderer.activateWindow()

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function measuredDraw(update: () => void): Promise<number> {
  const before = renderer.getDebugFrameOverlayStats().frames
  update()
  for (let attempt = 0; attempt < 8; attempt++) {
    await nextFrame()
    const stats = renderer.getDebugFrameOverlayStats()
    if (stats.frames > before && stats.currentMs !== null && stats.currentMs !== undefined) {
      return stats.currentMs
    }
  }
  throw new Error("GPUI did not draw within eight display frames")
}

function summary(samples: number[]) {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { n: samples.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), minMs: sorted[0], maxMs: sorted.at(-1), samples }
}

async function main() {
  await nextFrame()
  await nextFrame()
  if (scrollId === undefined || !setAnimationWidth) throw new Error("fixture did not mount")

  for (let index = 0; index < 12; index++) {
    await measuredDraw(() => renderer.scrollTo(scrollId!, 0, -(index + 1) * 20))
  }
  renderer.resetDebugFrameOverlayStats()
  await nextFrame()
  const scroll: number[] = []
  for (let index = 0; index < 120; index++) {
    scroll.push(await measuredDraw(() => renderer.scrollTo(scrollId!, 0, -(index + 20) * 24)))
  }

  for (let index = 0; index < 12; index++) {
    await measuredDraw(() => setAnimationWidth!(40 + (index % 60) * 3))
  }
  renderer.resetDebugFrameOverlayStats()
  await nextFrame()
  const animation: number[] = []
  for (let index = 0; index < 120; index++) {
    animation.push(await measuredDraw(() => setAnimationWidth!(40 + (index % 60) * 3)))
  }

  console.log(`GPUIX_FRAME_BENCH ${JSON.stringify({ scroll: summary(scroll), animation: summary(animation) })}`)
  setTimeout(() => process.exit(0), 100)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
