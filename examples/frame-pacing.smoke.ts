import { launch } from "@gpuix/react/automation"
import {
  calibrateFramePacingWork,
  isPacingProgressing,
  isPumpCadenceBounded,
  meetsRefreshRatio,
} from "./frame-pacing-calibration"

const sampleCount = 60
const sampleIntervalMs = 1_000 / 60
const refreshHz = 1_000 / sampleIntervalMs
const calibrationMarginMs = Number(process.env.PACE_DEADLINE_MARGIN_MS ?? 1.5)
const targetWorkMs = Number(process.env.PACE_WORK_TARGET_MS ?? 12)
const minimumDisplayRefreshRatio = Number(process.env.PACE_ASSERT_DISPLAY_RATIO ?? 0.9)

interface PacingResult {
  presents: number
  durationMs: number
  hz: number
  workMs: number
  presentP50Ms: number
  tickP50Ms: number
  tickP95Ms: number
  ticks: number
  frameCallbacks: number
  frameSource: string
}

interface TickCalibrationResult {
  tickP50Ms: number
  ticks: number
}

class OperationTimeoutError extends Error {}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = 10_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new OperationTimeoutError(`Timed out during ${label}`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForVisibleWindow(app: Awaited<ReturnType<typeof launch>>): Promise<boolean> {
  const deadline = performance.now() + 1_500
  while (performance.now() < deadline) {
    const remaining = deadline - performance.now()
    try {
      const { text } = await withTimeout(
        app.call("getAllText", {}),
        "CoreVideo callback preflight",
        Math.min(300, remaining)
      )
      if (text.includes("PACING_PREFLIGHT ready")) return true
    } catch (error) {
      if (error instanceof OperationTimeoutError) return false
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function waitForResult(
  app: Awaited<ReturnType<typeof launch>>,
  prefix: string,
  label: string
): Promise<string> {
  const timeoutAt = performance.now() + 10_000
  while (performance.now() < timeoutAt) {
    const { text } = await withTimeout(app.call("getAllText", {}), label)
    const resultText = text.find((entry) => entry.startsWith(prefix))
    if (resultText) return resultText
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function calibrateTimerTick(): Promise<TickCalibrationResult | null> {
  const app = await launch({
    command: "bun",
    args: ["frame-pacing.tsx"],
    env: {
      PACE_FORCE_TIMER: "1",
      PACE_CALIBRATE_TIMER: "1",
      PACE_WORK_MS: "0",
    },
  })

  try {
    if (!(await waitForVisibleWindow(app))) return null
    const resultText = await waitForResult(
      app,
      "PACING_CALIBRATION ",
      "timer calibration result"
    )
    const result = JSON.parse(
      resultText.slice("PACING_CALIBRATION ".length)
    ) as TickCalibrationResult
    if (result.ticks < 8 || result.tickP50Ms <= 0) {
      throw new Error(
        `Timer calibration produced only ${result.ticks} ticks with p50 ${result.tickP50Ms.toFixed(2)}ms`
      )
    }
    return result
  } finally {
    await app.close()
  }
}

async function measure(forceTimer: boolean, workMs: number): Promise<PacingResult | null> {
  const app = await launch({
    command: "bun",
    args: ["frame-pacing.tsx"],
    env: {
      PACE_FORCE_TIMER: forceTimer ? "1" : "0",
      PACE_WORK_MS: workMs.toString(),
    },
  })

  try {
    if (!(await waitForVisibleWindow(app))) return null
    const startedAt = performance.now()

    const samples: Promise<unknown>[] = []
    const inFlight = new Set<Promise<unknown>>()
    for (let index = 0; index < sampleCount; index += 1) {
      const target = startedAt + index * sampleIntervalMs
      const wait = target - performance.now()
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
      }

      const sample = withTimeout(
        app.call("scrollWheel", {
          x: 240,
          y: 180,
          deltaX: 0,
          deltaY: -12,
          phase: index === 0 ? "started" : index === sampleCount - 1 ? "ended" : "moved",
          deltaUnit: "pixels",
        }),
        `scroll sample ${index + 1}`
      )
      samples.push(sample)
      inFlight.add(sample)
      void sample.then(
        () => inFlight.delete(sample),
        () => inFlight.delete(sample)
      )
      if (inFlight.size >= 2) await Promise.race(inFlight)
    }
    await Promise.all(samples)

    const resultText = await waitForResult(app, "PACING_RESULT ", "live pacing result")
    return JSON.parse(resultText.slice("PACING_RESULT ".length)) as PacingResult
  } finally {
    await app.close()
  }
}

function report(result: PacingResult): void {
  console.log(
    `frame pacing (${result.frameSource}): ${result.presents} presents / ${result.durationMs.toFixed(1)}ms = ${result.hz.toFixed(1)} Hz; present p50 ${result.presentP50Ms.toFixed(2)}ms; tick p50/p95 ${result.tickP50Ms.toFixed(2)}/${result.tickP95Ms.toFixed(2)}ms (${result.ticks} ticks, ${result.frameCallbacks} native callbacks, ${result.workMs}ms JS work)`
  )
}

const timerCalibration = await calibrateTimerTick()
if (!timerCalibration) {
  console.log("SKIP frame pacing: window occluded — cannot measure")
  process.exit(0)
}
const calibration = calibrateFramePacingWork(
  sampleIntervalMs,
  timerCalibration.tickP50Ms,
  calibrationMarginMs,
  targetWorkMs
)
console.log(
  `frame pacing calibration: tick p50 ${calibration.tickP50Ms.toFixed(2)}ms (${timerCalibration.ticks} timer ticks), refresh ${refreshHz.toFixed(1)}Hz / ${calibration.refreshPeriodMs.toFixed(2)}ms, calibrated JS work ${calibration.workMs.toFixed(2)}ms (${calibration.targetWorkMs.toFixed(1)}ms target, ${calibration.deadlineMarginMs.toFixed(1)}ms deadline margin)`
)

await new Promise((resolve) => setTimeout(resolve, 1_000))
const timer = await measure(true, calibration.workMs)
if (!timer) {
  console.log("SKIP frame pacing: window occluded — cannot measure")
  process.exit(0)
}
report(timer)
await new Promise((resolve) => setTimeout(resolve, 1_000))
const displayLink = await measure(false, calibration.workMs)
if (!displayLink) {
  console.log("SKIP frame pacing: window occluded — cannot measure")
  process.exit(0)
}
report(displayLink)

if (displayLink.frameSource !== "display-link") {
  throw new Error(`Expected the native display-link source, received ${displayLink.frameSource}`)
}
if (timer.frameSource !== "timer") {
  throw new Error(`Expected the forced timer source, received ${timer.frameSource}`)
}
for (const result of [timer, displayLink]) {
  if (!isPacingProgressing(result.presents, result.ticks, result.hz)) {
    throw new Error(
      `Expected ${result.frameSource} pacing to keep progressing, received ${result.presents} presents, ${result.ticks} ticks, and ${result.hz.toFixed(1)} Hz`
    )
  }
  if (!isPumpCadenceBounded(result.tickP95Ms, sampleIntervalMs)) {
    throw new Error(
      `Expected ${result.frameSource} tick p95 below one refresh period (${sampleIntervalMs.toFixed(2)}ms), received ${result.tickP95Ms.toFixed(2)}ms`
    )
  }
}
const minimumDisplayHz = refreshHz * minimumDisplayRefreshRatio
if (!meetsRefreshRatio(displayLink.hz, refreshHz, minimumDisplayRefreshRatio)) {
  throw new Error(
    `Expected display-link pacing at or above ${(minimumDisplayRefreshRatio * 100).toFixed(0)}% of refresh (${minimumDisplayHz.toFixed(1)} Hz), received ${displayLink.hz.toFixed(1)} Hz`
  )
}
