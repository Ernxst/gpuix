/**
 * Measures whether the embedded AppKit pump starves the JavaScript runtime,
 * the shape upstream reported in remorses/gpuix#39 (mirrored as #236).
 *
 * A continuously producing child process stands in for upstream's PTY, a 4 ms
 * interval measures timer lag, and a setImmediate chain measures how often the
 * event loop comes back around. Drawing stays cheap on purpose: the question is
 * what tick() costs when GPUI has almost nothing to do.
 *
 * GPUIX=0 runs the same producers with no renderer, as the baseline the
 * renderer numbers are read against.
 *
 * bun tick-starvation.ts
 */

import { spawn } from "node:child_process"
import React, { useEffect, useState } from "react"
import { createRenderer, createRoot, startFrameLoop } from "@gpuix/react"

const runMs = Number(process.env.TICK_RUN_MS ?? 5_000)
const frameMs = Number(process.env.TICK_FRAME_MS ?? 8)
const timerIntervalMs = 4
const withRenderer = process.env.GPUIX !== "0"

const tickDurations: number[] = []
const timerLags: number[] = []
let producerChunks = 0
let producerBytes = 0
let loopTurns = 0
let totalTickMs = 0

// Startup pays for window creation and the first present, so the worst sample
// is reported with the moment it happened: an outlier in the first frames is a
// different claim from one during steady production.
let worstTick = { ms: 0, atMs: 0 }
let worstTimerLag = { ms: 0, atMs: 0 }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function round(value: number, places = 3): number {
  return Number(value.toFixed(places))
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1) ?? 0),
  }
}

// A child process writing without pause: its chunks arrive on the same event
// loop the pump shares, so a blocked pump shows up as a lower delivery rate.
const producer = spawn("bash", ["-c", "while :; do printf 'gpuix%.0s' {1..512}; done"], {
  stdio: ["ignore", "pipe", "ignore"],
})
producer.stdout.on("data", (chunk: Buffer) => {
  producerChunks += 1
  producerBytes += chunk.byteLength
})

const timer = setInterval(() => {
  const expectedAt = lastTimerAt + timerIntervalMs
  const now = performance.now()
  const lag = Math.max(0, now - expectedAt)
  timerLags.push(lag)
  if (lag > worstTimerLag.ms) worstTimerLag = { ms: lag, atMs: now - startedAt }
  lastTimerAt = now
}, timerIntervalMs)
let lastTimerAt = performance.now()

let looping = true
const spinEventLoop = (): void => {
  if (!looping) return
  loopTurns += 1
  setImmediate(spinEventLoop)
}
spinEventLoop()

function Counter(): React.ReactElement {
  const [chunks, setChunks] = useState(0)
  useEffect(() => {
    // Keep the window dirty at about refresh rate without making the draw
    // itself expensive: one text node changes per frame.
    const handle = setInterval(() => setChunks(producerChunks), 16)
    return () => clearInterval(handle)
  }, [])
  return React.createElement(
    "div",
    { style: { padding: 24, backgroundColor: "#171717" } },
    React.createElement("text", { style: { color: "#a3e635", fontSize: 18 } }, `chunks ${chunks}`),
  )
}

const renderer = withRenderer ? createRenderer() : null
let stopLoop: (() => void) | undefined
let root: ReturnType<typeof createRoot> | undefined

if (renderer) {
  renderer.init({ title: "GPUIX tick starvation", width: 420, height: 220 })
  root = createRoot(renderer)
  root.render(React.createElement(Counter))
  const measuredTick = (): boolean => {
    const started = performance.now()
    try {
      return renderer.tick()
    } finally {
      const finished = performance.now()
      const elapsed = finished - started
      tickDurations.push(elapsed)
      totalTickMs += elapsed
      if (elapsed > worstTick.ms) worstTick = { ms: elapsed, atMs: finished - startedAt }
    }
  }
  const measuredIdleTick = (): boolean => {
    const started = performance.now()
    try {
      return renderer.tickIdle()
    } finally {
      const finished = performance.now()
      const elapsed = finished - started
      tickDurations.push(elapsed)
      totalTickMs += elapsed
      if (elapsed > worstTick.ms) worstTick = { ms: elapsed, atMs: finished - startedAt }
    }
  }
  stopLoop = startFrameLoop(
    {
      capabilities: renderer.capabilities.bind(renderer),
      tick: measuredTick,
      quit: renderer.quit.bind(renderer),
      setFrameRequestHandler: renderer.setFrameRequestHandler.bind(renderer),
      tickIdle: measuredIdleTick,
    },
    { frameMs },
  ).stop
}

const startedAt = performance.now()
setTimeout(() => {
  const wallMs = performance.now() - startedAt
  looping = false
  clearInterval(timer)
  producer.kill("SIGKILL")
  stopLoop?.()
  root?.unmount()

  console.log(
    `TICK_STARVATION ${JSON.stringify({
      mode: withRenderer ? "renderer" : "baseline",
      wallMs: round(wallMs, 1),
      frameMs,
      tickMs: summarize(tickDurations),
      wallShareInTickPercent: round((totalTickMs / wallMs) * 100, 2),
      producerChunksPerSecond: round((producerChunks * 1_000) / wallMs, 1),
      producerMbPerSecond: round((producerBytes * 1_000) / wallMs / 1_000_000, 2),
      timerLagMs: summarize(timerLags),
      worstTickAtMs: round(worstTick.atMs, 1),
      worstTimerLagAtMs: round(worstTimerLag.atMs, 1),
      loopTurnsPerSecond: round((loopTurns * 1_000) / wallMs, 1),
    })}`,
  )

  renderer?.quit()
  setTimeout(() => process.exit(0), 250)
}, runMs)
