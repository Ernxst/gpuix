// Depth curve + ablation for GPUIX #364.
//
// Run from packages/react:
//   bunx vitest run --config ../../docs/measurements/fixtures/layout-cache.vitest.config.ts \
//     -t 'base auto-width wrappers'
//
// p90 of Window::draw over 8 flushes after 3 warm-up flushes, per point.
// Set GPUIX_LAYOUT_BENCH_OUTPUT to write the accumulated JSON results.
import { writeFileSync } from 'node:fs'
import React from 'react'
import { describe, test } from 'vitest'
import { createTestRoot } from '../../../packages/react/src/testing.ts'
import type { ReactNode } from 'react'

const outputPath = process.env.GPUIX_LAYOUT_BENCH_OUTPUT
const results: unknown[] = []
const ROWS = 60

const autoRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  minHeight: 36,
  paddingTop: 4,
  paddingBottom: 4,
  flexShrink: 0,
} as const
const base = { display: 'flex', flexDirection: 'column', gap: 1 } as const

function Rows({ rowStyle }: { rowStyle: Record<string, unknown> }) {
  return (
    <>
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} style={rowStyle}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 230,
              flexGrow: 1,
              flexBasis: 0,
            }}
          >
            <span>{'Item ' + i}</span>
          </span>
          <span style={{ display: 'flex', justifyContent: 'flex-end', width: 132, flexShrink: 0 }}>
            <span>{i}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: 300, flexShrink: 0 }}>
            <span>{'Route ' + i}</span>
          </span>
        </div>
      ))}
    </>
  )
}

function wrap(
  levels: number,
  styleFor: (i: number) => Record<string, unknown>,
  node: ReactNode,
): ReactNode {
  let out = node
  for (let i = levels - 1; i >= 0; i--) out = <div style={styleFor(i)}>{out}</div>
  return out
}

function measure(
  label: string,
  levels: number,
  styleFor: (i: number) => Record<string, unknown>,
  rowStyle: Record<string, unknown> = autoRow,
) {
  const root = createTestRoot({ width: 1440, height: 900 })
  root.render(
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
        }}
      >
        {wrap(levels, styleFor, <Rows rowStyle={rowStyle} />)}
      </div>
    </div>,
  )
  const renderer = root.renderer
  renderer.setDebugFrameOverlay('minimal')
  for (let i = 0; i < 3; i++) renderer.flush()
  renderer.resetDebugFrameOverlayStats()
  for (let i = 0; i < 8; i++) renderer.flush()
  const p90 = Number((renderer.getDebugFrameOverlayStats().p90Ms ?? 0).toFixed(2))
  results.push({ label, levels, drawP90Ms: p90 })
  console.log('[probe] ' + label + ' levels=' + levels + ' p90=' + p90)
  if (outputPath) writeFileSync(outputPath, JSON.stringify(results, null, 2))
  root.unmount()
}

describe('curve', () => {
  // The exponent: auto-width flex-column wrappers.
  test.for([[0], [2], [4], [6]] as const)('base auto-width wrappers, %i levels', ([l]) =>
    measure('base', l, () => ({ ...base })),
  )
  // Removing the cross-axis (width) content measurement flattens it.
  test.for([[0], [2], [4], [6]] as const)('definite-width wrappers, %i levels', ([l]) =>
    measure('definiteWidth', l, () => ({ ...base, width: 1425 })),
  )
  // Controls at 6 levels.
  test('6 levels: minHeight 0 on wrappers', () =>
    measure('minHeight0', 6, () => ({ ...base, minHeight: 0 })),
  )
  test('6 levels: alignItems flex-start on wrappers', () =>
    measure('alignItemsFlexStart', 6, () => ({ ...base, alignItems: 'flex-start' })),
  )
  test('6 levels: definite width on innermost wrapper only', () =>
    measure('widthInnermostOnly', 6, (i) =>
      i === 5 ? { ...base, width: 1425 } : { ...base },
    ),
  )
  test('6 levels: definite width on outermost wrapper only', () =>
    measure('widthOutermostOnly', 6, (i) =>
      i === 0 ? { ...base, width: 1425 } : { ...base },
    ),
  )
  test('6 levels: definite-width rows', () =>
    measure('rowsDefiniteWidth', 6, () => ({ ...base }), { ...autoRow, width: 1425 }),
  )
  test('6 levels: definite-height rows', () =>
    measure(
      'rowsDefiniteHeight',
      6,
      () => ({ ...base }),
      { display: 'flex', alignItems: 'center', gap: 16, height: 36, flexShrink: 0 },
    ),
  )
})
