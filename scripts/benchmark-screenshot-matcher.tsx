import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import React from "react"

import { createTestRoot, isNativeTestRendererAvailable } from "../packages/react/src/testing.js"
import { readPngSize } from "../packages/react/src/testing-png.js"
import {
  toMatchScreenshot,
  type ScreenshotMatcherContext,
} from "../packages/react/src/testing-screenshot.js"

const CALLS = 20
const TRANSITION_MS = 160
const baseline = process.argv.includes("--baseline")

if (process.platform !== "darwin" || !isNativeTestRendererAvailable()) {
  throw new Error("This benchmark requires the macOS native test renderer")
}

const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-screenshot-benchmark-"))
const golden = path.join(directory, "golden.png")
const originalRead = fs.readFileSync
const originalWrite = fs.writeFileSync
let fileIoMs = 0

fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
  const start = performance.now()
  try {
    return originalRead(...args)
  } finally {
    fileIoMs += performance.now() - start
  }
}) as typeof fs.readFileSync
fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
  const start = performance.now()
  try {
    return originalWrite(...args)
  } finally {
    fileIoMs += performance.now() - start
  }
}) as typeof fs.writeFileSync
syncBuiltinESMExports()

const root = createTestRoot({ width: 1280, height: 800, scaleFactor: 2 })
const renderer = root.renderer
const context: ScreenshotMatcherContext = {
  task: {},
  testPath: "benchmark.test.tsx",
  currentTestName: "screenshot matcher benchmark",
}
const phases = {
  settleMs: 0,
  settleDraws: 0,
  captureMs: 0,
  cropMs: 0,
  encodeMs: 0,
  nativeWriteMs: 0,
  compareMs: 0,
}
type Measurement = typeof phases & { totalMs: number; fileIoMs: number; unaccountedMs: number }
const original = {
  flush: renderer.flush.bind(renderer),
  active: renderer.getActiveAnimationCount.bind(renderer),
  advance: renderer.advanceAsyncClock.bind(renderer),
  capture: renderer.captureScreenshotClipRaw.bind(renderer),
  compare: renderer.compareImagePixels.bind(renderer),
  capturePng: renderer.captureScreenshotClip.bind(renderer),
  comparePngs: renderer.compareImages.bind(renderer),
}

renderer.flush = (() => {
  const start = performance.now()
  try {
    return original.flush()
  } finally {
    phases.settleMs += performance.now() - start
    phases.settleDraws += 1
  }
}) as typeof renderer.flush
renderer.getActiveAnimationCount = (() => {
  const start = performance.now()
  try {
    return original.active()
  } finally {
    phases.settleMs += performance.now() - start
  }
}) as typeof renderer.getActiveAnimationCount
renderer.advanceAsyncClock = ((milliseconds: number) => {
  const start = performance.now()
  try {
    return original.advance(milliseconds)
  } finally {
    phases.settleMs += performance.now() - start
  }
}) as typeof renderer.advanceAsyncClock
renderer.captureScreenshotClipRaw = ((...args: Parameters<typeof renderer.captureScreenshotClipRaw>) => {
  const timing = original.capture(...args)
  phases.captureMs += timing.captureMs
  phases.cropMs += timing.cropMs
  return timing
}) as typeof renderer.captureScreenshotClipRaw
renderer.captureScreenshotClip = ((...args: Parameters<typeof renderer.captureScreenshotClip>) => {
  const timing = original.capturePng(...args)
  phases.captureMs += timing.captureMs
  phases.cropMs += timing.cropMs
  phases.encodeMs += timing.encodeMs
  phases.nativeWriteMs += timing.writeMs
  return timing
}) as typeof renderer.captureScreenshotClip
renderer.compareImagePixels = ((...args: Parameters<typeof renderer.compareImagePixels>) => {
  const start = performance.now()
  try {
    return original.compare(...args)
  } finally {
    phases.compareMs += performance.now() - start
  }
}) as typeof renderer.compareImagePixels

function tile(lit: boolean): React.ReactElement {
  return React.createElement("div", {
    "data-testid": "tile",
    style: {
      width: 1280,
      height: 800,
      backgroundColor: lit ? "#c8d2e0" : "#20242c",
      transition: { properties: ["backgroundColor"], durationMs: TRANSITION_MS },
    },
  })
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}

function settleAnimations(): void {
  const wasPaused = renderer.isClockPaused()
  renderer.clockPause()
  let elapsed = 0
  try {
    while (true) {
      renderer.flush()
      if (renderer.getActiveAnimationCount() === 0 || elapsed >= 10_000) break
      renderer.advanceAsyncClock(16)
      elapsed += 16
    }
  } finally {
    if (!wasPaused) renderer.clockResume()
  }
}

function print(label: string, measurements: Measurement[]): void {
  const value = (field: keyof Measurement): number[] => measurements.map((row) => row[field])
  console.log(`${label}: ${measurements.length} calls; median total ${median(value("totalMs")).toFixed(2)} ms`)
  console.log(
    `  settle ${median(value("settleMs")).toFixed(2)} ms; draws ${median(value("settleDraws")).toFixed(0)}; ` +
      `native capture ${median(value("captureMs")).toFixed(2)} ms; crop ${median(value("cropMs")).toFixed(2)} ms; ` +
      `PNG encode ${median(value("encodeMs")).toFixed(2)} ms; file I/O ${median(value("fileIoMs")).toFixed(2)} ms; ` +
      `compare ${median(value("compareMs")).toFixed(2)} ms; ` +
      `unaccounted ${median(value("unaccountedMs")).toFixed(2)} ms`
  )
}

async function measure(label: string, activeTransition: boolean): Promise<void> {
  const element = root.getByTestId("tile")
  const measurements: Measurement[] = []
  for (let index = 0; index < CALLS; index += 1) {
    if (activeTransition) {
      root.render(tile(false))
      original.flush()
      root.render(tile(true))
      original.flush()
    }
    Object.keys(phases).forEach((key) => {
      phases[key as keyof typeof phases] = 0
    })
    fileIoMs = 0
    const before = performance.now()
    let passed: boolean
    if (baseline) {
      const scratchStart = performance.now()
      const scratch = mkdtempSync(path.join(os.tmpdir(), "gpuix-screenshot-call-"))
      fileIoMs += performance.now() - scratchStart
      try {
        settleAnimations()
        renderer.prepareScreenshotCapture()
        const rect = element.getBoundingClientRect()
        const scale = renderer.getWindowSize().scaleFactor
        const actual = path.join(scratch, "actual.png")
        renderer.captureScreenshotClip(
          actual,
          Math.round(rect.left * scale),
          Math.round(rect.top * scale),
          Math.round(rect.width * scale),
          Math.round(rect.height * scale)
        )
        const referenceBytes = readFileSync(golden)
        const actualBytes = readFileSync(actual)
        readPngSize(referenceBytes, golden)
        readPngSize(actualBytes, actual)
        const compareStart = performance.now()
        const comparison = original.comparePngs(golden, actual, 0)
        phases.compareMs += performance.now() - compareStart
        passed = comparison.differingPixelRatio === 0
      } finally {
        const cleanupStart = performance.now()
        rmSync(scratch, { recursive: true, force: true })
        fileIoMs += performance.now() - cleanupStart
      }
    } else {
      const result = await toMatchScreenshot.call(context, element, {
        resolveScreenshotPath: () => golden,
      })
      passed = result.pass
    }
    const totalMs = performance.now() - before
    const measuredPhaseMs =
      phases.settleMs +
      phases.captureMs +
      phases.cropMs +
      phases.encodeMs +
      fileIoMs +
      phases.nativeWriteMs +
      phases.compareMs
    measurements.push({
      ...phases,
      totalMs,
      fileIoMs: fileIoMs + phases.nativeWriteMs,
      unaccountedMs: totalMs - measuredPhaseMs,
    })
    if (!passed) throw new Error(`${label} screenshot did not match its reference`)
  }
  print(label, measurements)
}

try {
  root.render(tile(true))
  const element = root.getByTestId("tile")
  const rect = element.getBoundingClientRect()
  const scale = renderer.getWindowSize().scaleFactor
  renderer.captureScreenshotClip(
    golden,
    Math.round(rect.left * scale),
    Math.round(rect.top * scale),
    Math.round(rect.width * scale),
    Math.round(rect.height * scale)
  )
  readFileSync(golden)
  console.log(
    `mode: ${baseline ? "legacy PNG round-trip" : "native RGBA compare"}; ` +
      `fixture: 2560x1600; calls per case: ${CALLS}; machine: ${os.type()} ${os.arch()}; ` +
      `runtime: Bun ${process.versions.bun}`
  )
  await measure("settled", false)
  Object.keys(phases).forEach((key) => {
    phases[key as keyof typeof phases] = 0
  })
  fileIoMs = 0
  await measure("active-transition", true)
} finally {
  root.unmount()
  rmSync(directory, { recursive: true, force: true })
}
