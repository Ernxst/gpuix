/**
 * Fixture for first-frame.test.ts (#600).
 *
 * Commits a tree into a freshly initialised renderer, then pumps AppKit once
 * and reports how many frames GPUI presented during that pump. The window is
 * revealed by that first pump, after the commit, so it must present the
 * committed tree there rather than show what it held while hidden until the
 * display link starts.
 *
 * `FIRST_FRAME_FOCUS=0` opens the window unfocused. `FIRST_FRAME_RAF=1` starts
 * a `requestAnimationFrame` loop from an effect, whose pending next-frame
 * callback subjects an inactive window's frames to GPUI's throttle.
 */

import React, { useEffect } from 'react'
import {
  cancelAnimationFrame,
  createRenderer,
  render,
  requestAnimationFrame,
} from '@gpuix/react'

const focus = process.env.FIRST_FRAME_FOCUS !== '0'
const animate = process.env.FIRST_FRAME_RAF === '1'

function App() {
  useEffect(() => {
    if (!animate) return
    let id = requestAnimationFrame(function loop() {
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
      }}
    >
      <div style={{ color: '#cdd6f4', fontSize: 20 }}>First frame</div>
    </div>
  )
}

const renderer = createRenderer()
renderer.init({ title: 'GPUIX first frame', width: 320, height: 200, focus })
render(<App />, { renderer })

renderer.startPresentTimingCapture()
renderer.tickIdle()
const presents = renderer.takePresentTimestamps().length

console.log(`FIRST_FRAME ${JSON.stringify({ presents })}`)
renderer.quit()
process.exit(0)
