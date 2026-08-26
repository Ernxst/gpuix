/**
 * Live-window frame-pacing regression target.
 *
 * The controller injects a 60 Hz phased scroll gesture. Each scroll callback
 * performs a small, configurable amount of JavaScript work before yielding.
 */

import React, { useState } from "react"
import type { EventPayload } from "@gpuix/native"
import { createRenderer, render, startFrameLoop } from "@gpuix/react"

const renderer = createRenderer()
const workMs = Number(process.env.PACE_WORK_MS ?? 12)
const forceTimer = process.env.PACE_FORCE_TIMER === "1"
let frameSource = "timer"

renderer.init({ title: "GPUIX frame pacing", width: 528, height: 408 })

let startedAt = 0
let startedFrames = 0
let startedTicks = 0
const tickDurations: number[] = []

function doScrollWork(): void {
  const deadline = performance.now() + workMs
  while (performance.now() < deadline) {
    // Deliberately occupy the JavaScript thread across a refresh deadline.
  }
}

function FramePacing() {
  const [result, setResult] = useState("PACING_PENDING")

  const handleScroll = (event: EventPayload): void => {
    if (event.touchPhase === "started") {
      startedAt = performance.now()
      startedFrames = renderer.getDebugFrameOverlayStats().frames
      startedTicks = tickDurations.length
    }

    doScrollWork()

    if (event.touchPhase === "ended") {
      const endedAt = performance.now()
      setTimeout(() => {
        const frames = renderer.getDebugFrameOverlayStats().frames - startedFrames
        const durationMs = endedAt - startedAt
        const hz = (frames * 1_000) / durationMs
        const measuredTicks = tickDurations.slice(startedTicks).sort((a, b) => a - b)
        const tickP50Ms = measuredTicks[Math.floor(measuredTicks.length / 2)] ?? 0
        setResult(
          `PACING_RESULT ${JSON.stringify({ frames, durationMs, hz, workMs, tickP50Ms, ticks: measuredTicks.length, frameSource })}`
        )
      }, 100)
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
      <text testId="pacing-result" style={{ color: "#a3e635" }}>
        {result}
      </text>
      <div
        testId="scroll-target"
        style={{ flex: 1, overflow: "scroll", backgroundColor: "#262626", padding: 12 }}
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
  const installed = renderer.setFrameRequestHandler(callback)
  if (callback && installed) frameSource = "display-link"
  return installed
}
startFrameLoop(
  {
    requiresTick: renderer.requiresTick.bind(renderer),
    tick: measuredTick,
    quit: renderer.quit.bind(renderer),
    ...(forceTimer
      ? {}
      : {
          setFrameRequestHandler,
          tickIdle: renderer.tickIdle.bind(renderer),
        }),
  }
)
