/// Regression test for issue #469: `@gpuix/react/testing/vitest`'s
/// `beforeAll` / `afterAll` must restore `configureTestWindow` and
/// `configureScreenshots` defaults, and close the shared window, at the end of
/// every test file — not just the first one a worker runs. That distinction
/// only shows up under `isolate: false`, where `setupFiles` re-executes per
/// file but the modules it imports do not, so this spawns a real child vitest
/// run over two fixture files sharing one worker rather than asserting on
/// module state directly.

import { spawn } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

// vitest's CLI has no `--setupFiles` flag — it is config-only — so the child
// run needs a real (if temporary) config file, not a longer argv. It also
// needs `01-configure` to run strictly before `02-verify`: `BaseSequencer`
// orders collected files by cached duration/size, not by `include` order, so
// a plain glob makes which file runs first nondeterministic. This sequencer
// keeps `include`'s order.
const CHILD_CONFIG = `
import { defineConfig } from "vitest/config"

class InOrderSequencer {
  async shard(files) {
    return files
  }
  async sort(files) {
    return files
  }
}

export default defineConfig({
  test: {
    include: [
      "src/__tests__/fixtures/per-file-isolation/01-configure.fixture.tsx",
      "src/__tests__/fixtures/per-file-isolation/02-verify.fixture.tsx",
    ],
    setupFiles: ["src/testing-vitest.ts"],
    pool: "forks",
    isolate: false,
    fileParallelism: false,
    sequence: { sequencer: InOrderSequencer },
  },
})
`

function runChildWithStatus(
  command: string,
  args: string[],
  timeoutMs = 60_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
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
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, output })
    })
  })
}

describe("per-file isolation under vitest isolate: false", () => {
  it(
    "restores configureTestWindow / configureScreenshots defaults and closes the shared window between files in one worker",
    async () => {
      const configPath = join(packageRoot, "vitest.config.per-file-isolation.tmp.ts")
      writeFileSync(configPath, CHILD_CONFIG)

      try {
        const { code, output } = await runChildWithStatus("bunx", [
          "vitest",
          "run",
          "--config",
          configPath,
          "--no-color",
        ])

        expect(output).toMatch(/Test Files\s+2 passed/)
        expect(output).toMatch(/Tests\s+2 passed/)
        expect(code).toBe(0)
      } finally {
        try {
          unlinkSync(configPath)
        } catch {}
      }
    },
    60_000
  )
})
