/// Regression test for issue #661: under `isolate: false`,
/// `@gpuix/react/testing/vitest` keeps the shared window open between test
/// files, so the reset it runs at a file boundary has to leave that window in
/// the state a freshly opened one is in. Menus, the debug frame overlay, the
/// in-memory clipboard, scripted picker results and a held, captured pointer
/// are all window-level state that the reset between tests leaves alone.
///
/// The fixtures under `fixtures/window-reuse/` each read that state and then
/// dirty it, and the first to run records what a fresh window reads. The pair
/// runs in one worker in both orders, so neither file's result can depend on
/// running first.

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { isNativeTestRendererAvailable } from "../testing.js"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

const FIXTURES = [
  "src/__tests__/fixtures/window-reuse/first.fixture.tsx",
  "src/__tests__/fixtures/window-reuse/second.fixture.tsx",
]

// See `testing-per-file-isolation.test.tsx` for why the child run needs a
// config file, a sequencer that keeps `include`'s order, and a plain object
// rather than `defineConfig`.
function childConfig(include: string[]): string {
  return `
class InOrderSequencer {
  async shard(files) {
    return files
  }
  async sort(files) {
    return files
  }
}

export default {
  test: {
    root: ${JSON.stringify(packageRoot)},
    include: ${JSON.stringify(include)},
    setupFiles: ["@gpuix/react/testing/vitest"],
    pool: "forks",
    isolate: false,
    fileParallelism: false,
    sequence: { hooks: "list", sequencer: InOrderSequencer },
  },
}
`
}

function runChild(
  args: string[],
  timeoutMs = 60_000
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bunx", args, { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.once("error", reject)
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`timed out waiting for child vitest run\n${output}`))
    }, timeoutMs)
    child.once("close", (code) => {
      clearTimeout(timeout)
      resolve({ code, output })
    })
  })
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("window reuse across files under vitest isolate: false", () => {
  it.each([
    ["first, then second", FIXTURES],
    ["second, then first", [...FIXTURES].reverse()],
  ])(
    "hands the next file the same window in a fresh window's state (%s)",
    async (_order, include) => {
      const configDir = mkdtempSync(join(tmpdir(), "gpuix-window-reuse-"))
      const configPath = join(configDir, "vitest.config.ts")
      writeFileSync(configPath, childConfig(include))

      try {
        const { code, output } = await runChild([
          "vitest",
          "run",
          "--config",
          configPath,
          "--no-color",
        ])

        expect(output).toMatch(/Test Files\s+2 passed/)
        expect(output).toMatch(/Tests\s+4 passed/)
        expect(code).toBe(0)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
