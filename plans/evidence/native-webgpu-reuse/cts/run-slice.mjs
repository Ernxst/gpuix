import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ctsRoot = process.argv[2]
const providerName = process.argv[3]

if (!ctsRoot || !providerName) {
  console.error("usage: bun run-slice.mjs <cts-root> <provider>")
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const manifest = await Bun.file(resolve(here, "manifest.json")).json()
const providers = {
  "node-webgpu": "providers/node-webgpu.mjs",
  "bun-webgpu": "providers/bun-webgpu.mjs",
  "wgpu-bun-dawn": "providers/wgpu-bun-dawn.mjs",
}
const provider = providers[providerName]

if (!provider) {
  console.error(`unknown provider: ${providerName}`)
  process.exit(2)
}

const queries = manifest.selectors

function summary(stdout) {
  const count = label => Number(stdout.match(new RegExp(`${label}\\s*=\\s*(\\d+)\\s*\\/`))?.[1] ?? 0)
  const total = Number(stdout.match(/Passed\s+w\/o warnings\s*=\s*\d+\s*\/\s*(\d+)/)?.[1] ?? 0)
  return {
    total,
    passed: count("Passed\\s+w\\/o warnings"),
    warned: count("Passed with warnings"),
    skipped: count("Skipped"),
    failed: count("Failed"),
  }
}

async function run(query) {
  let timedOut = false
  const preload =
    providerName === "bun-webgpu"
      ? ["--preload", resolve(here, "providers/bun-webgpu-preload.mjs")]
      : []
  const child = Bun.spawn(
    [
      process.execPath,
      ...preload,
      "src/common/runtime/cmdline.ts",
      "--gpu-provider",
      resolve(here, provider),
      query,
    ],
    {
      cwd: resolve(ctsRoot),
      env: {
        ...process.env,
        ...(providerName === "wgpu-bun-dawn" ? { WGPU_BUN_IMPL: "dawn" } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 30_000)
  const exitCode = await child.exited
  clearTimeout(timeout)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  const counts = summary(stdout)
  const classification = timedOut
    ? "timeout"
    : exitCode >= 128
      ? "crash"
      : counts.total === 0
        ? "harness-error"
      : counts.failed > 0
        ? "assertion-failure"
        : counts.warned > 0
          ? "warning"
          : exitCode === 0
            ? "pass"
            : "harness-error"

  return {
    query,
    exitCode,
    classification,
    counts,
    ...(classification === "pass"
      ? {}
      : { output: `${stdout}\n${stderr}`.trim().slice(-4000) }),
  }
}

const results = []
for (const query of queries) {
  results.push(await run(query))
}

const totals = results.reduce(
  (all, result) => {
    for (const key of ["total", "passed", "warned", "skipped", "failed"]) {
      all[key] += result.counts[key]
    }
    all[result.classification] = (all[result.classification] ?? 0) + 1
    return all
  },
  { total: 0, passed: 0, warned: 0, skipped: 0, failed: 0 },
)

console.log(
  JSON.stringify(
    {
      ctsRevision: manifest.ctsRevision,
      provider: providerName,
      runtime: Bun.version,
      selectors: queries.length,
      totals,
      results,
    },
    null,
    2,
  ),
)

process.exit(results.every(result => result.classification === "pass") ? 0 : 1)
