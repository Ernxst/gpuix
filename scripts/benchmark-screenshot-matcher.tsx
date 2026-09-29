import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import React from "react"

import { createTestRoot, isNativeTestRendererAvailable } from "../packages/react/src/testing.js"
import {
  toMatchScreenshot,
  type ScreenshotMatcherContext,
} from "../packages/react/src/testing-screenshot.js"

const CALLS = 20
const TRANSITION_MS = 160

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
type Measurement = typeof phases & { totalMs: number; fileIoMs: number }
const original = {
  flush: renderer.flush.bind(renderer),
  active: renderer.getActiveAnimationCount.bind(renderer),
  advance: renderer.advanceAsyncClock.bind(renderer),
  capture: renderer.captureScreenshotClipRaw.bind(renderer),
  compare: renderer.compareImagePixels.bind(renderer),
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

function print(label: string, measurements: Measurement[]): void {
  const value = (field: keyof Measurement): number[] => measurements.map((row) => row[field])
  console.log(`${label}: ${measurements.length} calls; median total ${median(value("totalMs")).toFixed(2)} ms`)
  console.log(
    `  settle ${median(value("settleMs")).toFixed(2)} ms; draws ${median(value("settleDraws")).toFixed(0)}; ` +
      `native capture ${median(value("captureMs")).toFixed(2)} ms; crop ${median(value("cropMs")).toFixed(2)} ms; ` +
      `PNG encode ${median(value("encodeMs")).toFixed(2)} ms; file I/O ${median(value("fileIoMs")).toFixed(2)} ms; ` +
      `compare ${median(value("compareMs")).toFixed(2)} ms`
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
    const result = await toMatchScreenshot.call(context, element, {
      resolveScreenshotPath: () => golden,
    })
    measurements.push({ ...phases, totalMs: performance.now() - before, fileIoMs })
    if (!result.pass) throw new Error(`${label} screenshot did not match its reference:\n${result.message()}`)
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
