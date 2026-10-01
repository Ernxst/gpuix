/**
 * Clicks and hovers reach a live window, both through the automation client
 * and as real AppKit mouse events sent to the window's screen position.
 *
 * Drives real input, so it runs in the serial project and needs the window on
 * screen.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launch } from '@gpuix/react/automation'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable() ? describe : describe.skip

describeLive('live window click automation', () => {
  it('delivers automation and AppKit clicks to the painted element', async () => {
    const app = await launch({ command: 'bun', args: ['live-click.tsx'], cwd: CWD })

    try {
      const clickable = app.getByTestId('appkit-click-anchor')
      const child = await app.getByTestId('appkit-click-painted-child').element()
      const { bounds } = await app.call('getBounds', { elementId: child.id })
      expect(bounds, 'painted child bounds').toBeTruthy()

      await clickable.click()
      await app.getByText('AppKit clicks: 1').waitFor({ timeoutMs: 10_000 })
      await clickable.hover()
      await app.getByText('Pointer is over the clickable element').waitFor({ timeoutMs: 10_000 })

      await app.call('appKitClick', {
        x: bounds!.x + bounds!.width / 2,
        y: bounds!.y + bounds!.height / 2,
      })
      await app.getByText('AppKit clicks: 2').waitFor({ timeoutMs: 10_000 })
    } finally {
      await app.close()
    }
  }, 60_000)
})
