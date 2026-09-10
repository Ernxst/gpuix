import React from 'react'
import { createRenderer, createRoot, flushSync } from '@gpuix/react'
import { connectTest, liveRendererAsTest } from '@gpuix/react/automation'
import { describe, expect, it, vi } from 'vitest'

import { ReducedMotionTarget } from './reduced-motion'

async function deliverPlatformPreference(
  renderer: ReturnType<typeof createRenderer>,
  reduceMotion: boolean,
): Promise<void> {
  renderer.testSetPlatformReducedMotion(reduceMotion)
  for (let index = 0; index < 4; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    renderer.tickIdle()
  }
}

const runsOnThisPlatform = process.platform === 'darwin' || process.platform === 'win32'

describe('reduced-motion override example', () => {
  it.skipIf(!runsOnThisPlatform)(
    'keeps both animation engines enabled when false overrides an OS-on preference',
    async () => {
      const renderer = createRenderer()
      renderer.init({
        title: 'GPUIX reduced-motion override integration',
        width: 420,
        height: 300,
        menus: [],
        focus: false,
        show: false,
        reducedMotion: false,
      })
      const root = createRoot(renderer)
      const app = await connectTest(liveRendererAsTest(renderer))

      try {
        renderer.clockPause()
        await deliverPlatformPreference(renderer, true)
        flushSync(() => root.render(<ReducedMotionTarget expanded={false} />))

        const styleTarget = await app.getByTestId('style-transition-target').element()
        const motionTarget = await app.getByTestId('motion-target').element()
        const width = (id: number): number => {
          const bounds = renderer.getElementBounds(id)
          if (!bounds) throw new Error('Reduced-motion target did not paint')
          return bounds[2]
        }
        const expectWidths = async (expected: number): Promise<void> => {
          await vi.waitFor(
            () => {
              expect(width(styleTarget.id)).toBeCloseTo(expected)
              expect(width(motionTarget.id)).toBeCloseTo(expected)
            },
            { timeout: 2000 },
          )
        }

        await expectWidths(140)

        flushSync(() => root.render(<ReducedMotionTarget expanded />))
        await expectWidths(140)
        renderer.clockFastForward(100)
        await expectWidths(210)
      } finally {
        root.unmount()
        await app.close()
        renderer.quit()
      }

      // The threaded renderer finishes terminating on its UI thread after
      // quit() returns, so the lifecycle flips to terminated asynchronously.
      await vi.waitFor(() => {
        expect(renderer.isInitialized()).toBe(false)
      })
      expect(renderer.testHasEmbeddedRuntime()).toBe(false)
    },
  )
})
