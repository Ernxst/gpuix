/**
 * Live-window screenshots through the automation client.
 *
 * Drawing a frame renders `GpuixView`, so the capture must lease the window
 * untyped. Leasing the view across the draw aborted the app process with an
 * entity reentrancy panic, and the client then waited forever for a reply that
 * could never arrive (#291). The offscreen `TestRenderer` never covered this:
 * it captures through the test app context, not a live window.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launch } from '@gpuix/react/automation'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(CWD, 'screenshots')
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable()
    ? describe
    : describe.skip

describeLive('live window automation', () => {
  it(
    'captures a screenshot of a running app',
    async () => {
      fs.mkdirSync(SHOTS, { recursive: true })
      const file = path.join(SHOTS, 'live-counter.png')
      fs.rmSync(file, { force: true })

      const app = await launch({
        command: 'bun',
        args: ['counter.tsx'],
        cwd: CWD,
        env: { GPUIX_BACKGROUND: '1' },
      })
      try {
        await app
          .getByText('Click the number or + to increment')
          .waitFor({ timeoutMs: 30_000 })

        expect(await app.screenshot({ path: file })).toBe(file)

        const png = fs.readFileSync(file)
        expect(png.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC)
        expect(png.byteLength).toBeGreaterThan(0)

        // The app must survive the capture: a crashed child leaves every later
        // request unanswered instead of failing.
        expect((await app.call('getPaintedText', {})).text).toContain(
          'Click the number or + to increment'
        )
      } finally {
        await app.close()
      }
    },
    60_000
  )
})
