/**
 * Fixture for window-order.test.ts (#322).
 *
 * Renders a small window titled from `process.argv[2]` and shows its own
 * `process.pid` as text, so a harness that launches several copies at once
 * can match each on-screen window back to the child process that opened it.
 *
 * Must use the default launch path (activation requested): this fixture
 * exists to race for activation, so it does not set `GPUIX_BACKGROUND`,
 * which requests the opposite — a background launch that skips the race.
 */

import React from 'react'
import { render } from '@gpuix/react'

const title = process.argv[2] ?? 'window-order'

function App() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#11111b',
      }}
    >
      <div style={{ color: '#cdd6f4', fontSize: 20 }}>{process.pid}</div>
    </div>
  )
}

render(<App />, {
  title,
  width: 240,
  height: 160,
})
