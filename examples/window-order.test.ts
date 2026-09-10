/**
 * Regression guard for #322: sibling processes opening a window at the same
 * moment can lose the race for OS activation, landing their window behind
 * the active app with no visible sign of it beyond the on-screen stacking
 * order. Activation is cooperative on macOS 14+ (the OS can refuse
 * `activateIgnoringOtherApps:`), and Windows' foreground-activation lock
 * blocks `SetForegroundWindow` from a process the user hasn't just
 * interacted with — either way, a losing process previously had no way to
 * bring its window forward.
 *
 * Launches four copies of window-order.tsx at once and asserts every one of
 * them ends up in front, by polling the native on-screen window order for
 * each child's PID.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launch, type App } from '@gpuix/react/automation'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'
import { testOnScreenWindowOwnerPids } from '@gpuix/native'

const CWD = path.dirname(fileURLToPath(import.meta.url))

// Four windows racing for activation take focus from whatever the developer is
// doing, so this runs in CI or when opted into with GPUIX_WINDOW_ORDER_TEST=1.
const describeLive =
  (process.platform === 'darwin' || process.platform === 'win32') &&
  (Boolean(process.env.CI) || process.env.GPUIX_WINDOW_ORDER_TEST === '1') &&
  isNativeTestRendererAvailable()
    ? describe
    : describe.skip

async function pidOf(app: App): Promise<number> {
  const node = await app.getByText(/^\d+$/).waitFor({ timeoutMs: 30_000 })
  return Number(node.text ?? '')
}

describeLive('sibling window activation order', () => {
  it(
    'opens every sibling window in front, even when activation is refused',
    async () => {
      const names = ['window-order-a', 'window-order-b', 'window-order-c', 'window-order-d']
      const apps = await Promise.all(
        names.map((name) => launch({ command: 'bun', args: ['window-order.tsx', name], cwd: CWD }))
      )

      try {
        const pids = new Set(await Promise.all(apps.map(pidOf)))
        expect(pids.size).toBe(apps.length)

        const deadline = Date.now() + 5_000
        let observed: number[] = []
        for (;;) {
          observed = testOnScreenWindowOwnerPids()
          const front = new Set(observed.slice(0, pids.size))
          if (front.size === pids.size && [...pids].every((pid) => front.has(pid))) {
            return
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `Expected the four sibling PIDs ${[...pids].join(', ')} to occupy the front ` +
                `${pids.size} on-screen windows; observed order: ${observed.join(', ')}`
            )
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } finally {
        await Promise.all(apps.map((app) => app.close()))
      }
    },
    60_000
  )
})
