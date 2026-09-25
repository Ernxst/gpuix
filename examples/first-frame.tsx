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
 * `FIRST_FRAME_ACTIVATE=1` calls `activateWindow()` from a mount effect, which
 * runs inside the first commit, before the first pump.
 *
 * After the pump it runs the frame loop briefly and reports whether the
 * default menus, deferred until the shown window's second frame, installed.
 */

import React, { useEffect } from 'react'
import {
  cancelAnimationFrame,
  createRenderer,
  render,
  requestAnimationFrame,
  startFrameLoop,
  useGpuixRequired,
} from '@gpuix/react'

const focus = process.env.FIRST_FRAME_FOCUS !== '0'
const animate = process.env.FIRST_FRAME_RAF === '1'
const activate = process.env.FIRST_FRAME_ACTIVATE === '1'

function App() {
  const gpuix = useGpuixRequired()
  useEffect(() => {
    if (activate) gpuix.activateWindow?.()
  }, [gpuix])

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
// The capture needs the window, so it starts after `init`; the window stays
// hidden until the first pump or an `activateWindow()` during the commit.
renderer.startPresentTimingCapture()
render(<App />, { renderer })
renderer.tickIdle()
const presents = renderer.takePresentTimestamps().length

const loop = startFrameLoop(renderer)
setTimeout(() => {
  const menus = renderer.testHasApplicationMenus()
  loop.stop()
  console.log(`FIRST_FRAME ${JSON.stringify({ presents, menus })}`)
  renderer.quit()
  process.exit(0)
}, 500)
