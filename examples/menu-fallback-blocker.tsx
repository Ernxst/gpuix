/**
 * Covering window for menu-fallback.test.ts (#692).
 *
 * Opens a default (shown, focused) window the same size as
 * menu-fallback.tsx's, at the same centered position, so a target window
 * that opens with `focus: false` afterwards opens fully behind it: `focus:
 * false` opens a window behind whichever app is currently active, and this
 * process is that active app once its window is up.
 *
 * Prints a readiness marker once shown, then stays running until the harness
 * kills it.
 *
 * bun menu-fallback-blocker.tsx
 */

import React from 'react'
import { createRenderer, render, startFrameLoop } from '@gpuix/react'

function App() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#11111b',
      }}
    />
  )
}

const renderer = createRenderer()
renderer.init({ title: 'GPUIX menu fallback blocker', width: 320, height: 200 })
render(<App />, { renderer })
// A piped stdin (as in a spawned test) puts the renderer in automation mode,
// which does not drive render()'s own frame loop on its own; pump it directly,
// as first-frame.tsx does.
startFrameLoop(renderer)
console.log('MENU_FALLBACK_BLOCKER ready')
