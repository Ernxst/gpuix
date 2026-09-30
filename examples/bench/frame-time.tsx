/** GPUI draw time for scrolling and animation in the GPU-backed test window. */

import React from 'react'
import { createTestRoot } from '@gpuix/react/testing'

const { render, renderer, unmount } = createTestRoot({ width: 640, height: 560 })
let scrollId: number | undefined

const rows = Array.from({ length: 1128 }, (_, index) => (
  <div key={index} style={{ height: 24, flexShrink: 0, backgroundColor: index % 2 ? '#202532' : '#252b39' }}>
    <text style={{ color: '#e5e7eb', fontSize: 14 }}>{`Row ${index}: frame benchmark content`}</text>
  </div>
))

function scene(width: number) {
  return (
    <div style={{ width: 640, height: 560, padding: 12, backgroundColor: '#151a23' }}>
      <div style={{ width, height: 24, backgroundColor: '#fbbf24' }} />
      <div
        ref={(node) => { scrollId = node?.id }}
        style={{ width: 616, height: 490, overflow: 'scroll', flexDirection: 'column' }}
      >
        {rows}
      </div>
    </div>
  )
}

function summary(samples: number[]) {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { n: samples.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), minMs: sorted[0], maxMs: sorted.at(-1), samples }
}

function draw(update: () => void): { gpuiMs: number; cycleMs: number } {
  const before = renderer.getDebugFrameOverlayStats().frames
  const start = performance.now()
  update()
  const cycleMs = performance.now() - start
  const after = renderer.getDebugFrameOverlayStats()
  if (after.frames <= before || after.currentMs === null || after.currentMs === undefined) {
    throw new Error(`GPUI did not draw: ${JSON.stringify({ before, after })}`)
  }
  return { gpuiMs: after.currentMs, cycleMs }
}

try {
  render(scene(40))
  if (scrollId === undefined) throw new Error('scroll fixture did not mount')
  const id = scrollId

  for (let index = 0; index < 12; index++) draw(() => renderer.dispatchScrollWheel(300, 300, 0, -24))
  renderer.resetDebugFrameOverlayStats()
  const scroll: number[] = []
  const scrollCycle: number[] = []
  for (let index = 0; index < 120; index++) {
    const sample = draw(() => renderer.dispatchScrollWheel(300, 300, 0, -24))
    scroll.push(sample.gpuiMs)
    scrollCycle.push(sample.cycleMs)
  }
  const offset = renderer.getScrollOffset(id)
  if (offset === null || offset[1] >= 0) throw new Error(`scroll fixture did not move: ${offset}`)

  for (let index = 0; index < 12; index++) draw(() => render(scene(40 + (index % 60) * 3)))
  renderer.resetDebugFrameOverlayStats()
  const animation: number[] = []
  const animationCycle: number[] = []
  for (let index = 0; index < 120; index++) {
    const sample = draw(() => render(scene(40 + (index % 60) * 3)))
    animation.push(sample.gpuiMs)
    animationCycle.push(sample.cycleMs)
  }

  console.log(`GPUIX_FRAME_BENCH ${JSON.stringify({ scroll: summary(scroll), scrollCycle: summary(scrollCycle), animation: summary(animation), animationCycle: summary(animationCycle) })}`)
} finally {
  unmount()
}
