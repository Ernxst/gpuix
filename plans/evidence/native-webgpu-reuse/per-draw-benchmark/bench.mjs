import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const harnessDirectory = new URL(".", import.meta.url).pathname
const repositoryDirectory = join(harnessDirectory, "../../../..")
const baselinePath = join(harnessDirectory, "baseline.json")
const nativeAddonPath = join(repositoryDirectory, "packages/native/gpuix-native.darwin-arm64.node")
const drawCounts = "100,1000,10000,50000,100000"
const RUNS_PER_CHECK = 5

export const REGRESSION_THRESHOLDS = {
  medianPercent: 10,
  p95Percent: 20,
}

function percentile(samples, fraction) {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.ceil(ordered.length * fraction) - 1]
}

function run(command, args, options = {}) {
  const result = Bun.spawnSync({ cmd: [command, ...args], ...options })
  if (result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim()
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`)
  }
  return result.stdout.toString().trim()
}

function requireReleaseAddon() {
  if (!existsSync(nativeAddonPath)) {
    throw new Error(
      "Missing release native addon. Run `bun run build:native` before `bun run bench:webgpu`; this benchmark never builds it.",
    )
  }
  const loadCommands = run("otool", ["-l", nativeAddonPath])
  if (loadCommands.includes("__DWARF")) {
    throw new Error(
      "The native addon contains debug sections. Run `bun run build:native` to replace it with a release addon before benchmarking.",
    )
  }
}

function normalise(result) {
  return {
    provider: result.provider,
    runtime: result.runtime,
    workload: result.workload,
    measurements: result.measurements.map((measurement) => {
      const wholeFrameMedianNs = measurement.encode.medianNs + measurement.finishSubmit.medianNs
      const wholeFrameP95Ns = measurement.encode.p95Ns + measurement.finishSubmit.p95Ns
      return {
        draws: measurement.draws,
        measuredFrames: measurement.measuredFrames,
        wholeFrameNs: { median: wholeFrameMedianNs, p95: wholeFrameP95Ns },
        nsPerDraw: {
          median: wholeFrameMedianNs / measurement.draws,
          p95: wholeFrameP95Ns / measurement.draws,
        },
      }
    }),
  }
}

function environment() {
  return {
    machine: run("sysctl", ["-n", "machdep.cpu.brand_string"]),
    macos: run("sw_vers", ["-productVersion"]),
    bun: Bun.version,
    buildProfile: "napi build --platform --release --features test-support",
  }
}

function formatNs(value) {
  return value.toFixed(1)
}

function renderComparison(baseline, current) {
  const rows = []
  let failed = false
  for (const measurement of current.measurements) {
    const prior = baseline.measurements.find(({ draws }) => draws === measurement.draws)
    if (!prior) {
      throw new Error(`Baseline has no ${measurement.draws}-draw measurement`)
    }
    for (const percentileName of ["median", "p95"]) {
      const baselineValue = prior.nsPerDraw[percentileName]
      const currentValue = measurement.nsPerDraw[percentileName]
      const deltaPercent = ((currentValue / baselineValue) - 1) * 100
      const threshold = REGRESSION_THRESHOLDS[`${percentileName}Percent`]
      if (deltaPercent > threshold) failed = true
      rows.push({
        draws: measurement.draws,
        percentile: percentileName,
        baseline: baselineValue,
        current: currentValue,
        deltaPercent,
        threshold,
      })
    }
  }

  console.log("| Draws | Percentile | Baseline ns/draw | Current ns/draw | Delta | Limit |")
  console.log("| ---: | --- | ---: | ---: | ---: | ---: |")
  for (const row of rows) {
    console.log(`| ${row.draws.toLocaleString()} | ${row.percentile} | ${formatNs(row.baseline)} | ${formatNs(row.current)} | ${row.deltaPercent >= 0 ? "+" : ""}${row.deltaPercent.toFixed(1)}% | +${row.threshold}% |`)
  }
  return failed
}

async function runGpuixTrial() {
  const output = run("bun", ["gpuix-bun.mjs"], {
    cwd: harnessDirectory,
    env: {
      ...process.env,
      PER_DRAW_COUNTS: drawCounts,
      PER_DRAW_TRIALS: String(RUNS_PER_CHECK),
    },
  })
  return JSON.parse(output).trials.map(normalise)
}

async function runGpuix() {
  const trials = await runGpuixTrial()
  const first = trials[0]
  return {
    ...first,
    trials: RUNS_PER_CHECK,
    measurements: first.measurements.map((measurement) => {
      const corresponding = trials.map((trial) => trial.measurements.find(({ draws }) => draws === measurement.draws))
      const median = (selector) => percentile(corresponding.map(selector), 0.5)
      return {
        draws: measurement.draws,
        measuredFrames: measurement.measuredFrames,
        wholeFrameNs: {
          median: median(({ wholeFrameNs }) => wholeFrameNs.median),
          p95: median(({ wholeFrameNs }) => wholeFrameNs.p95),
        },
        nsPerDraw: {
          median: median(({ nsPerDraw }) => nsPerDraw.median),
          p95: median(({ nsPerDraw }) => nsPerDraw.p95),
        },
      }
    }),
  }
}

function parseArguments(arguments_) {
  const updateBaseline = arguments_.includes("--update-baseline")
  const providerArgument = arguments_.find((argument) => argument.startsWith("--providers="))
  const providers = providerArgument?.slice("--providers=".length).split(",") ?? []
  const unknown = arguments_.filter((argument) => argument !== "--update-baseline" && argument !== providerArgument)
  if (unknown.length > 0) throw new Error(`Unknown benchmark option: ${unknown.join(", ")}`)
  return { updateBaseline, providers }
}

function runComparisonProvider(provider) {
  const commands = {
    dawn: ["dawn.mjs"],
    "wgpu-bun": ["wgpu-bun.mjs"],
    "wgpu-bun-dawn": ["wgpu-bun.mjs"],
  }
  const command = commands[provider]
  if (!command) throw new Error(`Unknown comparison provider: ${provider}`)
  const environment_ = { ...process.env, PER_DRAW_COUNTS: drawCounts }
  if (provider === "wgpu-bun-dawn") environment_.WGPU_BUN_IMPL = "dawn"
  console.log(`\nComparison provider: ${provider}`)
  console.log(run("bun", command, { cwd: harnessDirectory, env: environment_ }))
}

async function main() {
  const { updateBaseline, providers } = parseArguments(process.argv.slice(2))
  requireReleaseAddon()
  const current = await runGpuix()
  const record = { environment: environment(), ...current }

  if (updateBaseline) {
    await writeFile(baselinePath, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`Updated ${baselinePath}`)
  } else {
    if (!existsSync(baselinePath)) {
      throw new Error("Missing WebGPU benchmark baseline. Run `bun run bench:webgpu --update-baseline` after reviewing a release build.")
    }
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
    const failed = renderComparison(baseline, current)
    if (failed) {
      throw new Error(`WebGPU regression exceeds median +${REGRESSION_THRESHOLDS.medianPercent}% or p95 +${REGRESSION_THRESHOLDS.p95Percent}%`)
    }
  }

  for (const provider of providers) runComparisonProvider(provider)
}

await main()
