/// Regression test for issue #469: `@gpuix/react/testing/vitest`'s
/// `beforeAll`-returned cleanup must restore `configureTestWindow` and
/// `configureScreenshots` defaults, and close the shared window, at the end of
/// every test file — not just the first one a worker runs. That distinction
/// only shows up under `isolate: false`, where `setupFiles` re-executes per
/// file but the modules it imports do not, so this spawns a real child vitest
/// run over three fixture files sharing one worker rather than asserting on
/// module state directly.
///
/// `sequence.hooks: "list"` exercises the harder ordering `beforeAll`'s
/// returned cleanup exists for: under `"list"` (and `"parallel"`, the
/// default), a plain `afterAll` registered by the setup entry can run before,
/// or concurrently with, a fixture's own `afterAll` — a returned cleanup
/// cannot lose that race, since it is this `beforeAll`'s own teardown rather
/// than a competing entry in the file's `afterAll` list.

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

// vitest's CLI has no `--setupFiles` flag — it is config-only — so the child
// run needs a real (if temporary) config file, not a longer argv. It also
// needs the fixtures to run strictly in the order listed: `BaseSequencer`
// orders collected files by cached duration/size, not by `include` order, so
// a plain glob makes which file runs first nondeterministic. `InOrderSequencer`
// keeps `include`'s order. `root: packageRoot` resolves `include` and
// `setupFiles` from the package rather than the temp directory this config
// itself lives in.
//
// No `import { defineConfig } from "vitest/config"` here: this file is
// loaded from a `mkdtemp` directory outside the package's `node_modules`
// resolution chain, so that bare specifier cannot resolve. `defineConfig` is
// an identity function for inline type-checking only — a plain object is the
// same config.
const CHILD_CONFIG = `
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
    include: [
      "src/__tests__/fixtures/per-file-isolation/01-menu.fixture.tsx",
      "src/__tests__/fixtures/per-file-isolation/02-configure.fixture.tsx",
      "src/__tests__/fixtures/per-file-isolation/03-verify.fixture.tsx",
    ],
    setupFiles: ["@gpuix/react/testing/vitest"],
    pool: "forks",
    isolate: false,
    fileParallelism: false,
    sequence: { hooks: "list", sequencer: InOrderSequencer },
  },
}
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
      const configDir = mkdtempSync(join(tmpdir(), "gpuix-per-file-isolation-"))
      const configPath = join(configDir, "vitest.config.ts")
      writeFileSync(configPath, CHILD_CONFIG)

      try {
        const { code, output } = await runChildWithStatus("bunx", [
          "vitest",
          "run",
          "--config",
          configPath,
          "--no-color",
        ])

        expect(output).toMatch(/Test Files\s+3 passed/)
        expect(output).toMatch(/Tests\s+3 passed/)
        expect(code).toBe(0)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
