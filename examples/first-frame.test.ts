/**
 * Regression guard for #600: a window's first visible frame shows the
 * rendered tree, not the empty scene GPUI presented while React had not yet
 * committed.
 *
 * `init` opens the macOS window hidden and the first pump reveals it. Showing
 * it makes AppKit ask GPUI for the layer's contents, and GPUI must present the
 * committed tree in that same pump. Before this, the window was on screen from
 * `init` and the tree's first present waited for the display link; a
 * throttled reveal frame left the stale contents up the same way.
 *
 * Each case runs first-frame.tsx in its own process, since the renderer owns
 * the process's only AppKit application.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))
const MARKER = 'FIRST_FRAME '

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable() ? describe : describe.skip

interface FirstFrame {
  /** Frames presented while the window was revealed. */
  presents: number
  /** Whether the deferred default menus installed once frames ran. */
  menus: boolean
}

function runFirstFrame(env: Record<string, string>): FirstFrame {
  const child = spawnSync('bun', ['first-frame.tsx'], {
    cwd: CWD,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  })
  const line = child.stdout.split('\n').find((candidate) => candidate.startsWith(MARKER))
  if (!line) {
    throw new Error(
      `first-frame.tsx exited with ${child.status} and no result\n${child.stdout}\n${child.stderr}`
    )
  }
  return JSON.parse(line.slice(MARKER.length)) as FirstFrame
}

describeLive('first presented frame', () => {
  it.each([
    ['a focused window', {}],
    ['an unfocused window', { FIRST_FRAME_FOCUS: '0' }],
    ['a window animating from an effect', { FIRST_FRAME_RAF: '1' }],
    ['an unfocused window animating from an effect', { FIRST_FRAME_FOCUS: '0', FIRST_FRAME_RAF: '1' }],
  ])('presents the committed tree when revealing %s', (_name, env) => {
    expect(runFirstFrame(env).presents).toBeGreaterThan(0)
  }, 60_000)

  it('keeps the first frame and default menus when a mount effect activates the window', () => {
    expect(runFirstFrame({ FIRST_FRAME_ACTIVATE: '1' })).toEqual({ presents: 1, menus: true })
  }, 60_000)

  it('installs the default menus after revealing a focused window', () => {
    expect(runFirstFrame({}).menus).toBe(true)
  }, 60_000)
})
