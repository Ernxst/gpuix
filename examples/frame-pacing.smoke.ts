import { launch } from "@gpuix/react/automation"

const sampleCount = 60
const sampleIntervalMs = 1_000 / 60
const minimumDisplayHz = Number(process.env.PACE_ASSERT_MIN_HZ ?? 50)
const maximumTimerHz = Number(process.env.PACE_ASSERT_TIMER_MAX_HZ ?? 45)
const minimumImprovementHz = Number(process.env.PACE_ASSERT_DELTA_HZ ?? 15)

interface PacingResult {
  presents: number
  durationMs: number
  hz: number
  workMs: number
  presentP50Ms: number
  tickP50Ms: number
  ticks: number
  frameCallbacks: number
  frameSource: string
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

async function measure(forceTimer: boolean): Promise<PacingResult | null> {
  const app = await launch({
    command: "bun",
    args: ["frame-pacing.tsx"],
    env: {
      PACE_FORCE_TIMER: forceTimer ? "1" : "0",
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

    const timeoutAt = performance.now() + 10_000
    let resultText: string | undefined
    while (performance.now() < timeoutAt) {
      const { text } = await withTimeout(app.call("getAllText", {}), "pacing result poll")
      resultText = text.find((entry) => entry.startsWith("PACING_RESULT "))
      if (resultText) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    if (!resultText) {
      throw new Error("Timed out waiting for the live pacing result")
    }

    return JSON.parse(resultText.slice("PACING_RESULT ".length)) as PacingResult
  } finally {
    await app.close()
  }
}

function report(result: PacingResult): void {
  console.log(
    `frame pacing (${result.frameSource}): ${result.presents} presents / ${result.durationMs.toFixed(1)}ms = ${result.hz.toFixed(1)} Hz; present p50 ${result.presentP50Ms.toFixed(2)}ms; tick p50 ${result.tickP50Ms.toFixed(2)}ms (${result.ticks} ticks, ${result.frameCallbacks} native callbacks, ${result.workMs}ms JS work)`
  )
}

const timer = await measure(true)
if (!timer) {
  console.log("SKIP frame pacing: window occluded — cannot measure")
  process.exit(0)
}
report(timer)
await new Promise((resolve) => setTimeout(resolve, 1_000))
const displayLink = await measure(false)
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
if (timer.hz > maximumTimerHz) {
  throw new Error(
    `Expected the forced timer control at or below ${maximumTimerHz.toFixed(1)} Hz, received ${timer.hz.toFixed(1)} Hz`
  )
}
if (displayLink.hz < minimumDisplayHz) {
  throw new Error(
    `Expected at least ${minimumDisplayHz.toFixed(1)} Hz under paced scroll work, received ${displayLink.hz.toFixed(1)} Hz`
  )
}
if (displayLink.hz - timer.hz < minimumImprovementHz) {
  throw new Error(
    `Expected display-link pacing to improve by at least ${minimumImprovementHz.toFixed(1)} Hz, received ${(displayLink.hz - timer.hz).toFixed(1)} Hz`
  )
}
