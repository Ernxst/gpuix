/**
 * The idle frame pump returns within its bound while a native frame request
 * races it, and still services the thread-safe function call the request
 * queued.
 *
 * Runs frame-pump-race.ts in its own process, since the renderer owns the
 * process's only AppKit application.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable() ? describe : describe.skip

describeLive('idle frame pump racing a frame request', () => {
  it('returns in bounded time and services every queued callback', () => {
    const child = spawnSync('bun', ['frame-pump-race.ts'], {
      cwd: CWD,
      encoding: 'utf8',
      timeout: 2_000,
    })
    const output = `${child.stdout}${child.stderr}`

    expect(child.error, output).toBeUndefined()
    expect(child.status, output).toBe(0)
    expect(output).toContain('PUMP_RACE_RETURN ')
    expect(output).toContain('PUMP_RACE_CALLBACK ')
  }, 10_000)
})
