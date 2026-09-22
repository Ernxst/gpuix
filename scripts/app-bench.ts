/**
 * Repeatable benchmark harness for GPUIX apps.
 *
 * Measures bundle size, cold startup, idle memory, build/rebuild time, and
 * hot-reload latency for the fixtures in `examples/bench/`, against a plain
 * GPUI baseline built from the same GPUI checkout. See
 * `examples/bench/README.md` for what each metric means and why it is
 * measured the way it is.
 *
 * Run: `bun scripts/app-bench.ts [--runs N]` (default 10).
 *
 * Opens real windows — GUI window creation panics inside the Bash sandbox
 * ("Attempted to create a NULL object" from system-configuration). Run this
 * with the sandbox disabled.
 *
 * Requires, already built in this checkout:
 *   bun install --frozen-lockfile
 *   bun run build:native   # produces packages/native/*.node
 *   bun run build:react    # produces packages/react/dist
 *   bun run build:vite     # produces packages/plugins/dist, used by the Vite
 *                          # hot-reload measurement
 * and, once, the GPUI baseline binary:
 *   cd packages/native && cargo build --release --example hello_bench
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const BENCH_DIR = path.join(ROOT, "examples", "bench")
const NATIVE_DIR = path.join(ROOT, "packages", "native")
const EXAMPLES_DIR = path.join(ROOT, "examples")
const OUT_DIR = path.join(ROOT, "tmp", "app-bench")
const BIN_DIR = path.join(OUT_DIR, "bin")

const MARKER_PREFIX = "GPUIX_BENCH "
const READY_TIMEOUT_MS = 20_000
const IDLE_BEFORE_MEMORY_MS = 2_000
const HOT_RELOAD_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { runs: number } {
  const ix = argv.indexOf("--runs")
  const runs = ix === -1 ? 10 : Number(argv[ix + 1])
  if (!Number.isInteger(runs) || runs < 1) fail("--runs must be a positive integer")
  return { runs }
}

function fail(message: string): never {
  console.error(`app-bench: ${message}`)
  process.exit(1)
}

function log(message: string): void {
  console.log(`[app-bench] ${message}`)
}

// ---------------------------------------------------------------------------
// Process lifecycle — every child this script spawns is tracked here so a
// crash, a thrown error, or Ctrl-C still kills every open window.
// ---------------------------------------------------------------------------

const liveChildren = new Set<ChildProcess>()

function trackChild(child: ChildProcess): void {
  liveChildren.add(child)
  child.once("exit", () => liveChildren.delete(child))
}

function killAllTracked(): void {
  for (const child of liveChildren) {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
  }
}

process.on("exit", killAllTracked)
process.on("SIGINT", () => {
  killAllTracked()
  process.exit(130)
})

interface BenchMarker {
  event: string
  [key: string]: unknown
}

interface RunningApp {
  /** The `sh` wrapper; see `launch`. */
  child: ChildProcess
  markers: BenchMarker[]
}

function childPids(pid: number): number[] {
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
  return result.stdout
    .split("\n")
    .map(Number)
    .filter((child) => Number.isFinite(child) && child > 0)
}

function processName(pid: number): string {
  return spawnSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim()
}

/** The app process itself: the child of `script`, which is a child of the `sh` wrapper. */
function appPid(app: RunningApp): number | undefined {
  if (!app.child.pid) return undefined
  const wrapper = childPids(app.child.pid).find((pid) => processName(pid).endsWith("script"))
  return wrapper ? childPids(wrapper)[0] : undefined
}

function parseMarkerLine(line: string): BenchMarker | undefined {
  const ix = line.indexOf(MARKER_PREFIX)
  if (ix === -1) return undefined
  try {
    return JSON.parse(line.slice(ix + MARKER_PREFIX.length)) as BenchMarker
  } catch {
    return undefined
  }
}

/**
 * Runs the app under `script` so its stdin is a terminal that stays open, as
 * when a person launches it. A non-TTY stdin turns on GPUIX automation
 * (`createRenderer`), which adds memory and startup cost a real launch does
 * not pay, and a stdin that ends makes Vite's dev server exit. `script` needs
 * a real pipe on its own stdin (Bun's `"pipe"` is a socket, which it rejects),
 * so `tail -f /dev/null` feeds it one that never closes.
 */
function launch(
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): RunningApp {
  const child = spawn(
    "/bin/sh",
    ["-c", 'tail -f /dev/null | script -q /dev/null "$@"', "sh", command, ...args],
    {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  trackChild(child)
  const app: RunningApp = { child, markers: [] }
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue
    let buffer = ""
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      let ix: number
      while ((ix = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, ix).replace(/\r$/, "")
        buffer = buffer.slice(ix + 1)
        const marker = parseMarkerLine(line)
        if (marker) app.markers.push(marker)
      }
    })
  }
  return app
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls `app.markers` rather than parsing per-event, since a marker can arrive before the caller starts waiting for it. */
async function waitForMarker(
  app: RunningApp,
  predicate: (marker: BenchMarker) => boolean,
  timeoutMs: number,
  seen = 0,
): Promise<BenchMarker | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (let i = seen; i < app.markers.length; i++) {
      if (predicate(app.markers[i]!)) return app.markers[i]
    }
    if (app.child.exitCode !== null) {
      log(`process exited with code ${app.child.exitCode} before the expected marker`)
      return undefined
    }
    if (Date.now() > deadline) return undefined
    await sleep(20)
  }
}

async function stop(app: RunningApp): Promise<void> {
  if (app.child.exitCode !== null || app.child.killed) return
  const shell = app.child.pid
  const pids = [appPid(app), ...(shell ? childPids(shell) : [])]
  for (const pid of pids) {
    if (!pid) continue
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
  const exited = new Promise<void>((resolve) => app.child.once("exit", () => resolve()))
  app.child.kill("SIGTERM")
  await Promise.race([exited, sleep(2000)])
  if (app.child.exitCode === null) app.child.kill("SIGKILL")
  await exited
}

// ---------------------------------------------------------------------------
// Memory sampling
// ---------------------------------------------------------------------------

interface MemorySample {
  physFootprintMB?: number
  rssMB?: number
}

function unitToMB(value: number, unit: string): number {
  switch (unit.toUpperCase().replace(/B$/, "")) {
    case "K":
      return value / 1024
    case "M":
      return value
    case "G":
      return value * 1024
    default:
      return value
  }
}

function readFootprintMB(pid: number): number | undefined {
  const result = spawnSync("footprint", [String(pid)], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  const match = /Footprint:\s*([\d.]+)\s*([KMG]B)/.exec(result.stdout)
  return match ? unitToMB(Number(match[1]), match[2]!) : undefined
}

function readVmmapPhysFootprintMB(pid: number): number | undefined {
  const result = spawnSync("vmmap", ["--summary", String(pid)], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  const match = /Physical footprint:\s*([\d.]+)([KMG])/.exec(result.stdout)
  return match ? unitToMB(Number(match[1]), match[2]!) : undefined
}

function readRssMB(pid: number): number | undefined {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  const kb = Number(result.stdout.trim())
  return Number.isFinite(kb) ? kb / 1024 : undefined
}

function sampleMemory(pid: number): MemorySample {
  return {
    physFootprintMB: readFootprintMB(pid) ?? readVmmapPhysFootprintMB(pid),
    rssMB: readRssMB(pid),
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface Stats {
  median: number
  min: number
  max: number
  n: number
}

function stats(samples: number[]): Stats | undefined {
  if (samples.length === 0) return undefined
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return { median, min: sorted[0]!, max: sorted[sorted.length - 1]!, n: sorted.length }
}

function fmt(value: number | undefined, digits = 1): string {
  return value === undefined ? "–" : value.toFixed(digits)
}

function fmtStats(s: Stats | undefined, digits = 0): string {
  if (!s) return "–"
  return `${fmt(s.median, digits)} (${fmt(s.min, digits)}–${fmt(s.max, digits)})`
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  id: string
  label: string
  /** Builds the shipped artefact; returns its path and the build's wall time. */
  build: (kind: "cold" | "rebuild") => { binary: string; buildMs: number }
  /** Launches the shipped artefact for a startup/memory sample. */
  spawnForRun: () => RunningApp
  readyPredicate: (marker: BenchMarker) => boolean
  /** Present only for fixtures the harness also runs from source (skips a rebuild round-trip). */
  measuresBuild: boolean
  measuresHotReload: boolean
}

const HELLO_GPUIX_ENTRY = path.join(BENCH_DIR, "hello-gpuix.tsx")
const HELLO_GPUI_SRC = path.join(NATIVE_DIR, "examples", "hello_bench.rs")
const HELLO_GPUI_BIN = path.join(NATIVE_DIR, "target", "release", "examples", "hello_bench")
const CHAT_ENTRY = path.join(EXAMPLES_DIR, "chat.tsx")
const HOT_RELOAD_ENTRY = path.join(BENCH_DIR, "hot-reload-fixture.tsx")

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): { ok: boolean; ms: number; stderr: string } {
  const start = Date.now()
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  const ms = Date.now() - start
  return { ok: result.status === 0, ms, stderr: result.stderr ?? "" }
}

function bunCompile(entry: string, outfile: string): { ok: boolean; ms: number; stderr: string } {
  fs.mkdirSync(path.dirname(outfile), { recursive: true })
  return runCommand(
    "bun",
    ["build", "--compile", "--production", entry, "--outfile", outfile],
    path.dirname(entry),
  )
}

/** Appends then removes a trailing comment line, to force a rebuild without changing behaviour. */
function withTouchedFile<T>(file: string, run: () => T): T {
  const original = fs.readFileSync(file, "utf8")
  fs.writeFileSync(file, `${original}\n// app-bench: touched to force a rebuild\n`)
  try {
    return run()
  } finally {
    fs.writeFileSync(file, original)
  }
}

const gpuixHello: Fixture = {
  id: "gpuix-hello",
  label: "GPUIX hello-world",
  measuresBuild: true,
  measuresHotReload: true,
  readyPredicate: (m) => m.event === "ready",
  build(kind) {
    const outfile = path.join(BIN_DIR, "hello-gpuix")
    if (kind === "cold") {
      const result = bunCompile(HELLO_GPUIX_ENTRY, outfile)
      if (!result.ok) fail(`bun build --compile (gpuix-hello, cold) failed:\n${result.stderr}`)
      return { binary: outfile, buildMs: result.ms }
    }
    fs.mkdirSync(BIN_DIR, { recursive: true })
    const result = withTouchedFile(HELLO_GPUIX_ENTRY, () => bunCompile(HELLO_GPUIX_ENTRY, outfile))
    if (!result.ok) fail(`bun build --compile (gpuix-hello, rebuild) failed:\n${result.stderr}`)
    return { binary: outfile, buildMs: result.ms }
  },
  spawnForRun() {
    const binary = path.join(BIN_DIR, "hello-gpuix")
    // Focused, not GPUIX_BENCH_BACKGROUND=1: an unfocused window opens behind
    // the active app, and requestAnimationFrame pauses while it is covered,
    // so the ready marker may never arrive. See examples/bench/README.md.
    return launch(binary, [], { cwd: BENCH_DIR })
  },
}

const gpuiHello: Fixture = {
  id: "gpui-hello",
  label: "GPUI hello-world (baseline)",
  measuresBuild: true,
  measuresHotReload: false,
  readyPredicate: (m) => m.event === "ready",
  build(kind) {
    if (kind === "cold") {
      const clean = runCommand("cargo", ["clean", "-p", "gpuix-native", "--release"], NATIVE_DIR)
      if (!clean.ok) fail(`cargo clean (gpui-hello) failed:\n${clean.stderr}`)
      const build = runCommand(
        "cargo",
        ["build", "--release", "--example", "hello_bench"],
        NATIVE_DIR,
      )
      if (!build.ok) fail(`cargo build (gpui-hello, cold) failed:\n${build.stderr}`)
      return { binary: HELLO_GPUI_BIN, buildMs: build.ms }
    }
    const build = withTouchedFile(HELLO_GPUI_SRC, () =>
      runCommand("cargo", ["build", "--release", "--example", "hello_bench"], NATIVE_DIR),
    )
    if (!build.ok) fail(`cargo build (gpui-hello, rebuild) failed:\n${build.stderr}`)
    return { binary: HELLO_GPUI_BIN, buildMs: build.ms }
  },
  spawnForRun() {
    return launch(HELLO_GPUI_BIN, [], { cwd: NATIVE_DIR })
  },
}

const gpuixChat: Fixture = {
  id: "gpuix-chat",
  label: "GPUIX chat (realistic)",
  measuresBuild: false,
  measuresHotReload: false,
  readyPredicate: (m) => m.event === "ready",
  build(kind) {
    if (kind === "rebuild") return { binary: path.join(BIN_DIR, "chat"), buildMs: 0 }
    const outfile = path.join(BIN_DIR, "chat")
    const result = bunCompile(CHAT_ENTRY, outfile)
    if (!result.ok) fail(`bun build --compile (gpuix-chat) failed:\n${result.stderr}`)
    return { binary: outfile, buildMs: result.ms }
  },
  spawnForRun() {
    const binary = path.join(BIN_DIR, "chat")
    // GPUIX_BENCH turns on the marker (see examples/chat.tsx); GPUIX_BACKGROUND
    // stays unset so the window is focused — see the note on gpuix-hello above.
    return launch(binary, [], { cwd: EXAMPLES_DIR, env: { GPUIX_BENCH: "1" } })
  },
}

const FIXTURES: Fixture[] = [gpuixHello, gpuiHello, gpuixChat]

// ---------------------------------------------------------------------------
// Bundle + build
// ---------------------------------------------------------------------------

interface BuildResult {
  bundleMB?: number
  coldBuildS?: number
  rebuildS?: number
}

async function measureBuild(fixture: Fixture): Promise<BuildResult> {
  // Every fixture needs its binary compiled once for the startup/memory
  // runs below, even one whose bundle/build numbers this harness doesn't
  // report (gpuix-chat — see examples/bench/README.md).
  log(`${fixture.id}: ${fixture.measuresBuild ? "cold build" : "build"}`)
  const cold = fixture.build("cold")
  if (!fixture.measuresBuild) return {}
  const bundleMB = fs.statSync(cold.binary).size / (1024 * 1024)
  log(`${fixture.id}: rebuild`)
  const rebuild = fixture.build("rebuild")
  return { bundleMB, coldBuildS: cold.buildMs / 1000, rebuildS: rebuild.buildMs / 1000 }
}

// ---------------------------------------------------------------------------
// Startup + memory (interleaved across fixtures, run by run)
// ---------------------------------------------------------------------------

interface StartupMemorySamples {
  startupMs: number[]
  physFootprintMB: number[]
  rssMB: number[]
}

async function measureStartupAndMemoryRun(fixture: Fixture): Promise<{
  startupMs?: number
  physFootprintMB?: number
  rssMB?: number
}> {
  const spawnEpochMs = Date.now()
  const app = fixture.spawnForRun()
  try {
    const marker = await waitForMarker(app, fixture.readyPredicate, READY_TIMEOUT_MS)
    if (!marker) {
      log(`${fixture.id}: no ready marker within ${READY_TIMEOUT_MS}ms, skipping this run`)
      return {}
    }
    const readyAtEpochMs = marker.readyAtEpochMs as number
    const startupMs = readyAtEpochMs - spawnEpochMs
    await sleep(IDLE_BEFORE_MEMORY_MS)
    const pid = appPid(app)
    const memory = pid ? sampleMemory(pid) : {}
    return { startupMs, ...memory }
  } finally {
    await stop(app)
  }
}

// ---------------------------------------------------------------------------
// Hot reload
// ---------------------------------------------------------------------------

async function measureHotReload(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  runs: number,
): Promise<number[]> {
  const original = fs.readFileSync(HOT_RELOAD_ENTRY, "utf8")
  const samples: number[] = []
  const app = launch(command, args, { cwd })
  try {
    const initial = await waitForMarker(app, (m) => m.event === "mounted", READY_TIMEOUT_MS)
    if (!initial) {
      log(`hot reload (${label}): fixture never mounted within ${READY_TIMEOUT_MS}ms`)
      return samples
    }
    let seen = app.markers.length
    for (let i = 0; i < runs; i++) {
      const version = `v1-bench-${i}-${Date.now()}`
      const edited = original.replace("const VERSION = 'v1'", `const VERSION = '${version}'`)
      const writeEpochMs = Date.now()
      fs.writeFileSync(HOT_RELOAD_ENTRY, edited)
      const marker = await waitForMarker(
        app,
        (m) => m.event === "mounted" && m.version === version,
        HOT_RELOAD_TIMEOUT_MS,
        seen,
      )
      seen = app.markers.length
      fs.writeFileSync(HOT_RELOAD_ENTRY, original)
      // Let the reload the restore triggers finish, so the next edit is not
      // queued behind it and timed with it.
      await waitForMarker(
        app,
        (m) => m.event === "mounted" && m.version === "v1",
        HOT_RELOAD_TIMEOUT_MS,
        seen,
      )
      seen = app.markers.length
      if (!marker) {
        log(`hot reload (${label}): edit ${i} never reflected within ${HOT_RELOAD_TIMEOUT_MS}ms`)
        continue
      }
      samples.push((marker.atEpochMs as number) - writeEpochMs)
    }
  } finally {
    fs.writeFileSync(HOT_RELOAD_ENTRY, original)
    await stop(app)
  }
  return samples
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface FixtureReport {
  id: string
  label: string
  bundleMB?: number
  coldBuildS?: number
  rebuildS?: number
  /** The launch straight after the build, which macOS scans before running. */
  firstLaunchMs?: number
  startup?: Stats
  startupSamples: number[]
  physFootprint?: Stats
  rss?: Stats
  hotReloadBunHot?: Stats
  hotReloadVite?: Stats
  notes: string[]
}

// Jamon Holmgren's published figures for the same shape of app, kept as a
// fixed reference — not remeasured here. See the brief for the source.
const JAMON_REFERENCE: Record<string, string> = {
  "gpuix-hello": "bundle 83.0 MB · startup 1249 ms · memory 140 MB · build 0.4 s · rebuild 0.5 s · hot reload N/A",
  "gpui-hello": "bundle 6.9 MB · startup 215 ms · memory 83.6 MB",
}

function printReport(reports: FixtureReport[]): void {
  const header =
    "| Fixture | Bundle (MB) | First launch ms | Startup ms (median, min–max) | Memory phys/RSS (MB, median) | Build cold/rebuild (s) | Hot reload bun/vite (ms, median) | Jamon reference |"
  const divider = "|---|---|---|---|---|---|---|---|"
  console.log(header)
  console.log(divider)
  for (const r of reports) {
    const memory = `${fmt(r.physFootprint?.median)} / ${fmt(r.rss?.median)}`
    const build = `${fmt(r.coldBuildS, 2)} / ${fmt(r.rebuildS, 2)}`
    const hotReload = `${fmt(r.hotReloadBunHot?.median, 0)} / ${fmt(r.hotReloadVite?.median, 0)}`
    console.log(
      `| ${r.label} | ${fmt(r.bundleMB)} | ${fmt(r.firstLaunchMs, 0)} | ${fmtStats(r.startup)} | ${memory} | ${build} | ${hotReload} | ${JAMON_REFERENCE[r.id] ?? "–"} |`,
    )
  }
  for (const r of reports) {
    for (const note of r.notes) console.log(`- ${r.label}: ${note}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { runs } = parseArgs(process.argv.slice(2))
  fs.mkdirSync(BIN_DIR, { recursive: true })
  log(`runs=${runs}`)

  const buildResults = new Map<string, BuildResult>()
  for (const fixture of FIXTURES) {
    buildResults.set(fixture.id, await measureBuild(fixture))
  }

  // The first launch of a newly written executable waits for a macOS
  // malware scan that scales with file size, so it is reported on its own
  // rather than mixed into the warm startup samples.
  const firstLaunch = new Map<string, number | undefined>()
  for (const fixture of FIXTURES) {
    log(`first launch: ${fixture.id}`)
    firstLaunch.set(fixture.id, (await measureStartupAndMemoryRun(fixture)).startupMs)
  }

  // Startup/memory: interleave fixtures run by run — single-run timings on
  // this machine vary by up to 45%, and batching would let a machine-wide
  // slowdown land entirely on whichever fixture ran last.
  const startupMemory = new Map<string, StartupMemorySamples>(
    FIXTURES.map((f) => [f.id, { startupMs: [], physFootprintMB: [], rssMB: [] }]),
  )
  for (let run = 0; run < runs; run++) {
    for (const fixture of FIXTURES) {
      log(`run ${run + 1}/${runs}: ${fixture.id} startup + memory`)
      const sample = await measureStartupAndMemoryRun(fixture)
      const bucket = startupMemory.get(fixture.id)!
      if (sample.startupMs !== undefined) bucket.startupMs.push(sample.startupMs)
      if (sample.physFootprintMB !== undefined) bucket.physFootprintMB.push(sample.physFootprintMB)
      if (sample.rssMB !== undefined) bucket.rssMB.push(sample.rssMB)
    }
  }

  log("hot reload: bun --hot")
  const hotReloadBunHot = await measureHotReload(
    "bun --hot",
    "bun",
    ["--hot", HOT_RELOAD_ENTRY],
    BENCH_DIR,
    runs,
  )

  log("hot reload: @gpuix/plugins/vite")
  const hotReloadVite = await measureHotReload(
    "vite",
    "bun",
    ["run", "--bun", "vite", "--config", "vite.config.ts"],
    BENCH_DIR,
    runs,
  )

  const reports: FixtureReport[] = FIXTURES.map((fixture) => {
    const build = buildResults.get(fixture.id)!
    const sm = startupMemory.get(fixture.id)!
    const notes: string[] = []
    if (!fixture.measuresBuild) notes.push("bundle/build not measured — see examples/bench/README.md")
    if (!fixture.measuresHotReload) notes.push("hot reload not applicable")
    const report: FixtureReport = {
      id: fixture.id,
      label: fixture.label,
      bundleMB: build.bundleMB,
      coldBuildS: build.coldBuildS,
      rebuildS: build.rebuildS,
      firstLaunchMs: firstLaunch.get(fixture.id),
      startup: stats(sm.startupMs),
      startupSamples: sm.startupMs,
      physFootprint: stats(sm.physFootprintMB),
      rss: stats(sm.rssMB),
      notes,
    }
    if (fixture.id === gpuixHello.id) {
      report.hotReloadBunHot = stats(hotReloadBunHot)
      report.hotReloadVite = stats(hotReloadVite)
      if (hotReloadVite.length === 0) {
        notes.push(
          "@gpuix/plugins/vite hot reload not measured: the fixture produced no marker under the plugin",
        )
      }
    }
    return report
  })

  printReport(reports)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(OUT_DIR, `${timestamp}.json`)
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      { runs, generatedAt: new Date().toISOString(), reports, hotReloadBunHot, hotReloadVite },
      null,
      2,
    ),
  )
  log(`wrote ${path.relative(ROOT, jsonPath)}`)
}

await main()
