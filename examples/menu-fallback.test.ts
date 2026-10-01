/**
 * Regression guard for #692: a window that presents no frames still gets the
 * default menu bar (and so Cmd+Q) within a short delay, not just on its
 * second frame.
 *
 * Each case runs menu-fallback.tsx in its own process, since the renderer
 * owns the process's only AppKit application. The `focus: false` case also
 * runs menu-fallback-blocker.tsx, a covering window it opens fully behind.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))
const MARKER = 'MENU_FALLBACK '
const BLOCKER_READY = 'MENU_FALLBACK_BLOCKER ready'
// init() creates the native window and may spend variable time in AppKit.
// The fallback's timing budget starts once that setup has returned.
const FALLBACK_BOUND_MS = 500

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable() ? describe : describe.skip

interface MenuFallback {
  /** Milliseconds from entering `init` to the default menus installing. */
  elapsedMs: number
  /** Milliseconds after `init` returns, when the fallback can start. */
  afterInitMs: number
  /** Whether the default menus installed before the deadline. */
  menus: boolean
}

function waitForLine(
  child: ChildProcessWithoutNullStreams,
  predicate: (line: string) => boolean,
  label: string,
  timeoutMs = 10_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      child.stdout.off('data', onData)
      reject(new Error(`Timed out waiting for ${label}\n${buffer}`))
    }, timeoutMs)
    function onData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')
      const line = buffer.split('\n').find(predicate)
      if (line) {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        resolve(line)
      }
    }
    child.stdout.on('data', onData)
  })
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for process exit (posted Cmd+Q did not quit it)`))
    }, timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function runMenuFallback(env: Record<string, string>): Promise<{
  result: MenuFallback
  exitCode: number | null
}> {
  const child = spawn('bun', ['menu-fallback.tsx'], {
    cwd: CWD,
    env: { ...process.env, ...env },
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  try {
    const line = await waitForLine(child, (candidate) => candidate.startsWith(MARKER), 'menu fallback result')
    const result = JSON.parse(line.slice(MARKER.length)) as MenuFallback
    const exitCode = await waitForExit(child)
    return { result, exitCode }
  } catch (error) {
    child.kill()
    throw stderr ? new Error(`${(error as Error).message}\n${stderr}`) : error
  }
}

let blocker: ChildProcessWithoutNullStreams | undefined

afterEach(() => {
  blocker?.kill()
  blocker = undefined
})

describeLive('default menus for a window that presents no frames', () => {
  it('installs the default menus and honors Cmd+Q for a hidden window', async () => {
    const { result, exitCode } = await runMenuFallback({ MENU_FALLBACK_SHOW: '0' })
    expect(result.menus).toBe(true)
    expect(result.afterInitMs).toBeLessThan(FALLBACK_BOUND_MS)
    expect(exitCode).toBe(0)
  }, 30_000)

  it('installs the default menus and honors Cmd+Q for a window opened fully covered', async () => {
    blocker = spawn('bun', ['menu-fallback-blocker.tsx'], { cwd: CWD })
    await waitForLine(blocker, (line) => line.startsWith(BLOCKER_READY), 'blocker window ready')

    const { result, exitCode } = await runMenuFallback({ MENU_FALLBACK_FOCUS: '0' })
    expect(result.menus).toBe(true)
    expect(result.afterInitMs).toBeLessThan(FALLBACK_BOUND_MS)
    expect(exitCode).toBe(0)
  }, 30_000)
})
