/**
 * Live-window frame-pacing regression target.
 *
 * The controller injects a 60 Hz phased scroll gesture. Each scroll callback
 * queues a small, configurable amount of JavaScript work before the next turn.
 */

import React, { useState } from "react"
import type { EventPayload } from "@gpuix/native"
import { createRenderer, render, startFrameLoop } from "@gpuix/react"

const renderer = createRenderer()
const workMs = Number(process.env.PACE_WORK_MS ?? 12)
const forceTimer = process.env.PACE_FORCE_TIMER === "1"
const calibrateTimer = process.env.PACE_CALIBRATE_TIMER === "1"
const calibrationWarmupMs = 250

renderer.init({ title: "GPUIX frame pacing", width: 528, height: 408 })

let startedTicks = 0
let startedFrameCallbacks = 0
let frameCallbacks = 0
const tickDurations: number[] = []
let markPreflightReady: (() => void) | undefined
let publishCalibration: ((result: string) => void) | undefined
const requiredPreflightCallbacks = 4

function doScrollWork(): void {
  const deadline = performance.now() + workMs
  while (performance.now() < deadline) {
    // Deliberately occupy the JavaScript thread across a refresh deadline.
  }
}

function FramePacing() {
  const [preflight, setPreflight] = useState("PACING_PREFLIGHT pending")
  const [result, setResult] = useState("PACING_PENDING")
  markPreflightReady = () => setPreflight("PACING_PREFLIGHT ready")
  publishCalibration = setResult

  const handleScroll = (event: EventPayload): void => {
    if (event.touchPhase === "started") {
      renderer.startPresentTimingCapture()
      startedTicks = tickDurations.length
      startedFrameCallbacks = frameCallbacks
    }

    queueMicrotask(doScrollWork)

    if (event.touchPhase === "ended") {
      setTimeout(() => {
        const presentTimestamps = renderer.takePresentTimestamps()
        const presentIntervals = presentTimestamps
          .slice(1)
          .map((timestamp, index) => timestamp - presentTimestamps[index])
        const durationMs = presentTimestamps.at(-1) ?? 0
        const hz = durationMs > 0 ? ((presentTimestamps.length - 1) * 1_000) / durationMs : 0
        const sortedPresentIntervals = presentIntervals.toSorted((a, b) => a - b)
        const presentP50Ms =
          sortedPresentIntervals[Math.floor(sortedPresentIntervals.length / 2)] ?? 0
        const measuredTicks = tickDurations.slice(startedTicks).sort((a, b) => a - b)
        const tickP50Ms = measuredTicks[Math.floor(measuredTicks.length / 2)] ?? 0
        const observedFrameCallbacks = frameCallbacks - startedFrameCallbacks
        setResult(
          `PACING_RESULT ${JSON.stringify({ presents: presentTimestamps.length, durationMs, hz, workMs, presentP50Ms, tickP50Ms, ticks: measuredTicks.length, frameCallbacks: observedFrameCallbacks, frameSource: observedFrameCallbacks > 0 ? "display-link" : "timer" })}`
        )
      }, 150)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        width: 480,
        height: 360,
        backgroundColor: "#171717",
      }}
    >
      <text style={{ color: "#f5f5f5", fontSize: 18 }}>Display-link frame pacing</text>
      <text testId="pacing-preflight" style={{ color: "#fbbf24" }}>
        {preflight}
      </text>
      <text testId="pacing-result" style={{ color: "#a3e635" }}>
        {result}
      </text>
      <div
        testId="scroll-target"
        style={{ flexGrow: 1, overflow: "scroll", backgroundColor: "#262626", padding: 12 }}
        onScroll={handleScroll}
      >
        <div style={{ height: 2400 }}>
          <text style={{ color: "#d4d4d4" }}>
            Caller-paced scroll samples keep this surface dirty for one second.
          </text>
        </div>
      </div>
    </div>
  )
}

render(<FramePacing />, { renderer })
const measuredTick = (): boolean => {
  const started = performance.now()
  try {
    return renderer.tick()
  } finally {
    tickDurations.push(performance.now() - started)
  }
}
const setFrameRequestHandler = (callback: (() => void) | null): boolean => {
  return renderer.setFrameRequestHandler(
    callback
      ? () => {
          frameCallbacks += 1
          if (!preflightReady && frameCallbacks >= requiredPreflightCallbacks) {
            preflightReady = true
            queueMicrotask(() => {
              if (forceTimer) {
                loop.stop()
                loop = startFrameLoop({
                  requiresTick: renderer.requiresTick.bind(renderer),
                  tick: measuredTick,
                  quit: renderer.quit.bind(renderer),
                })
                if (calibrateTimer) {
                  const calibrationStartedTicks = tickDurations.length
                  setTimeout(() => {
                    const ticks = tickDurations
                      .slice(calibrationStartedTicks)
                      .sort((a, b) => a - b)
                    const tickP50Ms = ticks[Math.floor(ticks.length / 2)] ?? 0
                    publishCalibration?.(
                      `PACING_CALIBRATION ${JSON.stringify({ tickP50Ms, ticks: ticks.length })}`
                    )
                  }, calibrationWarmupMs)
                }
              }
              markPreflightReady?.()
            })
          }
          callback()
        }
      : null
  )
}
let preflightReady = false
let loop = startFrameLoop({
  requiresTick: renderer.requiresTick.bind(renderer),
  tick: measuredTick,
  quit: renderer.quit.bind(renderer),
  setFrameRequestHandler,
  tickIdle: renderer.tickIdle.bind(renderer),
})

for (const delayMs of [0, 100, 250, 500, 750, 1_000]) {
  setTimeout(() => {
    if (!preflightReady) renderer.activateWindow()
  }, delayMs)
}
