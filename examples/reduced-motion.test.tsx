import React from 'react'
import { createRenderer, createRoot, flushSync } from '@gpuix/react'
import { connectTest, liveRendererAsTest } from '@gpuix/react/automation'
import { describe, expect, it, vi } from 'vitest'

import { ReducedMotionTarget } from './reduced-motion'

// The platform applies a preference change on a later pump of its event loop,
// not inside the call that delivers it: macOS defers the notification to the
// main dispatch queue, Windows to the UI thread. An app's frame loop pumps
// continuously; this test has none, so it pumps before every read.
const runsOnThisPlatform = process.platform === 'darwin' || process.platform === 'win32'

describe('reduced-motion example', () => {
  it.skipIf(!runsOnThisPlatform)(
    'snaps an in-flight transition after the real platform notification',
    async () => {
      const renderer = createRenderer()
      renderer.init({
        title: 'GPUIX reduced-motion integration',
        width: 420,
        height: 220,
        menus: [],
        focus: false,
        show: false,
      })
      const root = createRoot(renderer)
      const app = await connectTest(liveRendererAsTest(renderer))

      try {
        renderer.clockPause()
        renderer.testSetPlatformReducedMotion(false)
        flushSync(() => root.render(<ReducedMotionTarget expanded={false} />))

        const styleTarget = await app.getByTestId('style-transition-target').element()
        const motionTarget = await app.getByTestId('motion-target').element()
        const width = (id: number): number => {
          const bounds = renderer.getElementBounds(id)
          if (!bounds) throw new Error('Reduced-motion target did not paint')
          return bounds.width
        }
        const expectWidths = async (expected: number): Promise<void> => {
          await vi.waitFor(
            () => {
              renderer.tickIdle()
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

        renderer.testSetPlatformReducedMotion(true)
        await expectWidths(280)

        renderer.testSetPlatformReducedMotion(false)
        await expectWidths(280)
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
