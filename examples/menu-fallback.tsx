/**
 * Fixture for menu-fallback.test.ts (#692).
 *
 * A window that presents no frames — `show: false`, or `focus: false`
 * opening fully behind menu-fallback-blocker.tsx's window — never runs the
 * on-next-frame callbacks that install GPUIX's deferred default menus. The
 * fallback under test installs them anyway, about 100ms after the window is
 * shown or created.
 *
 * Polls `testHasApplicationMenus()` until it reports `true` or a deadline
 * passes, reports the elapsed time, then posts Cmd+Q and exits once the
 * resulting quit completes, so a hang here means Cmd+Q did not reach the
 * quit action.
 *
 * `MENU_FALLBACK_SHOW=0` opens the window hidden. `MENU_FALLBACK_FOCUS=0`
 * opens it unfocused, behind menu-fallback-blocker.tsx's window.
 *
 * bun menu-fallback.tsx
 */

import React from 'react'
import { createRenderer, render, startFrameLoop } from '@gpuix/react'

const show = process.env.MENU_FALLBACK_SHOW !== '0'
const focus = process.env.MENU_FALLBACK_FOCUS !== '0'
const deadlineMs = 1_500

function App() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
      }}
    />
  )
}

const renderer = createRenderer()
const initedAt = Date.now()
renderer.init({ title: 'GPUIX menu fallback', width: 320, height: 200, show, focus })
const initCompletedAt = Date.now()
render(<App />, { renderer })
// A piped stdin (as in a spawned test) puts the renderer in automation mode,
// which does not drive render()'s own frame loop on its own; pump it
// directly, as first-frame.tsx does, and exit once Cmd+Q's quit reaches it.
startFrameLoop(renderer, { onTerminated: () => process.exit(0) })

function report(menus: boolean): void {
  const elapsedMs = Date.now() - initedAt
  const afterInitMs = Date.now() - initCompletedAt
  console.log(`MENU_FALLBACK ${JSON.stringify({ elapsedMs, afterInitMs, menus })}`)
}

function poll(): void {
  if (renderer.testHasApplicationMenus()) {
    report(true)
    renderer.simulateKeystrokes('cmd-q')
    return
  }
  if (Date.now() - initedAt > deadlineMs) {
    report(false)
    process.exit(1)
    return
  }
  setTimeout(poll, 20)
}
setTimeout(poll, 20)
