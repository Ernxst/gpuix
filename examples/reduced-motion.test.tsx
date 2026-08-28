import React from 'react'
import { createRenderer, createRoot, flushSync } from '@gpuix/react'
import { connectTest, liveRendererAsTest } from '@gpuix/react/automation'
import { describe, expect, it } from 'vitest'

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

describe('reduced-motion example', () => {
  it.skipIf(process.platform !== 'darwin')(
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
        await deliverPlatformPreference(renderer, false)
        flushSync(() => root.render(<ReducedMotionTarget expanded={false} />))

        const styleTarget = await app.getByTestId('style-transition-target').element()
        const motionTarget = await app.getByTestId('motion-target').element()
        const width = (id: number): number => {
          const bounds = renderer.getElementBounds(id)
          if (!bounds) throw new Error('Reduced-motion target did not paint')
          return bounds[2]
        }
        expect(width(styleTarget.id)).toBeCloseTo(140)
        expect(width(motionTarget.id)).toBeCloseTo(140)

        flushSync(() => root.render(<ReducedMotionTarget expanded />))
        expect(width(styleTarget.id)).toBeCloseTo(140)
        expect(width(motionTarget.id)).toBeCloseTo(140)
        renderer.clockFastForward(100)
        expect(width(styleTarget.id)).toBeCloseTo(210)
        expect(width(motionTarget.id)).toBeCloseTo(210)

        await deliverPlatformPreference(renderer, true)
        expect(width(styleTarget.id)).toBeCloseTo(280)
        expect(width(motionTarget.id)).toBeCloseTo(280)

        await deliverPlatformPreference(renderer, false)
        expect(width(styleTarget.id)).toBeCloseTo(280)
        expect(width(motionTarget.id)).toBeCloseTo(280)
      } finally {
        root.unmount()
        await app.close()
        renderer.quit()
      }

      expect(renderer.isInitialized()).toBe(false)
      expect(renderer.testHasEmbeddedRuntime()).toBe(false)
    },
  )
})
