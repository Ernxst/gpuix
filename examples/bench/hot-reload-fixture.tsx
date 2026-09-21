/**
 * Hot-reload fixture for `scripts/app-bench.ts`.
 *
 * Used two ways, both by the same file:
 *   - `bun --hot hot-reload-fixture.tsx` (remount reload)
 *   - the `@gpuix/vite` plugin, in `examples/bench/vite.config.ts` (native dev)
 *
 * The harness edits VERSION below, in place, and times how long it takes for
 * a fresh "mounted" marker carrying the new value to reach stdout, then
 * restores the file. Do not add other top-level state: a remount is exactly
 * "unmount the previous tree, mount this one", so the timing must reflect
 * only that, not leftover state from a previous edit.
 */

import React, { useEffect } from 'react'
import { render, requestAnimationFrame } from '@gpuix/react'

const VERSION = 'v1'

function App() {
  useEffect(() => {
    // rAF after commit, per scripts/app-bench.ts's hot-reload methodology.
    requestAnimationFrame(() => {
      const marker = {
        event: 'mounted',
        version: VERSION,
        atEpochMs: performance.timeOrigin + performance.now(),
      }
      console.log(`GPUIX_BENCH ${JSON.stringify(marker)}`)
    })
  })

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 400,
        height: 300,
        backgroundColor: '#1e1e2e',
      }}
    >
      <div style={{ color: '#cdd6f4', fontSize: 24 }}>{VERSION}</div>
    </div>
  )
}

render(<App />, {
  title: 'GPUIX Bench Hot Reload',
  width: 400,
  height: 300,
  // See the matching note in hello-gpuix.tsx: an unfocused window can open
  // covered, and requestAnimationFrame pauses while it is, so
  // scripts/app-bench.ts does not set GPUIX_BENCH_BACKGROUND.
  focus: process.env.GPUIX_BENCH_BACKGROUND !== '1',
})
