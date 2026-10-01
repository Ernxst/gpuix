/**
 * Phased scroll-wheel events reach a live window without a synchronous draw,
 * carry their modifiers and units, and hand the residual of a nested scroll to
 * the parent.
 *
 * Drives real input, so it runs in the serial project and needs the window on
 * screen.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, type ParamsOf } from '@gpuix/react/automation'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'

const CWD = path.dirname(fileURLToPath(import.meta.url))

const describeLive =
  process.platform === 'darwin' && isNativeTestRendererAvailable() ? describe : describe.skip

describeLive('live window scroll-wheel automation', () => {
  let app: Awaited<ReturnType<typeof launch>>

  beforeAll(async () => {
    app = await launch({ command: 'bun', args: ['live-scroll-wheel.tsx'], cwd: CWD })
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  async function scrollWithoutSynchronousDraw(params: ParamsOf<'scrollWheel'>): Promise<void> {
    const before = await app.call('getSynchronousScrollDrawCount', {})
    await app.call('scrollWheel', params)
    const after = await app.call('getSynchronousScrollDrawCount', {})
    expect(after.count - before.count, 'synchronous draws for one scroll event').toBe(0)
  }

  async function scrollOffset(elementId: number): Promise<number[] | null> {
    return (await app.call('getScrollOffset', { elementId })).offset
  }

  function expectOffset(offset: number[] | null, x: number, y: number): void {
    expect(offset).not.toBeNull()
    expect(offset![0]).toBeCloseTo(x, 2)
    expect(offset![1]).toBeCloseTo(y, 2)
  }

  it('delivers each phase with its modifiers and unit', async () => {
    const target = await app.getByTestId('scroll-target').element()
    const wheel = { x: 240, y: 180, deltaX: 0, modifiers: { alt: true } }

    await scrollWithoutSynchronousDraw({ ...wheel, deltaY: -24, phase: 'started', deltaUnit: 'pixels' })
    await app.getByText('Last wheel: started: 0, 24; alt=true').waitFor()
    await new Promise((resolve) => setTimeout(resolve, 16))

    await scrollWithoutSynchronousDraw({ ...wheel, deltaY: -2, phase: 'moved', deltaUnit: 'lines' })
    await app.getByText('Last wheel: moved: 0, 2; alt=true').waitFor()
    await new Promise((resolve) => setTimeout(resolve, 16))

    await scrollWithoutSynchronousDraw({ ...wheel, deltaY: -24, phase: 'ended', deltaUnit: 'pixels' })
    await app.getByText('Last wheel: ended: 0, 24; alt=true').waitFor()

    const offset = await scrollOffset(target.id)
    expect(offset?.[1], 'vertical scroll offset').toBeLessThan(0)
  }, 60_000)

  it('passes the residual of a nested scroll to the parent', async () => {
    const parent = await app.getByTestId('nested-scroll-parent').element()
    const inner = await app.getByTestId('nested-scroll-list').element()
    const { bounds } = await app.call('getBounds', { elementId: parent.id })
    expect(bounds, 'nested scroll parent bounds').toBeTruthy()
    const x = bounds!.x + 160

    await scrollWithoutSynchronousDraw({
      x,
      y: bounds!.y + 60,
      deltaX: 0,
      deltaY: -340,
      phase: 'started',
      deltaUnit: 'pixels',
    })
    expectOffset(await scrollOffset(inner.id), 0, -280)
    expectOffset(await scrollOffset(parent.id), 0, -60)

    await scrollWithoutSynchronousDraw({
      x,
      y: bounds!.y + 30,
      deltaX: 0,
      deltaY: 40,
      phase: 'moved',
      deltaUnit: 'pixels',
    })
    expectOffset(await scrollOffset(inner.id), 0, -240)
    expectOffset(await scrollOffset(parent.id), 0, -60)

    await scrollWithoutSynchronousDraw({
      x,
      y: bounds!.y + 30,
      deltaX: 0,
      deltaY: 0,
      phase: 'ended',
      deltaUnit: 'pixels',
    })
  }, 60_000)
})
