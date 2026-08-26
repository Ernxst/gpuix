import { launch } from "@gpuix/react/automation"

const sampleCount = 60
const sampleIntervalMs = 1_000 / 60
const minimumHz = Number(process.env.PACE_ASSERT_MIN_HZ ?? 50)

interface PacingResult {
  frames: number
  durationMs: number
  hz: number
  workMs: number
  tickP50Ms: number
  ticks: number
  frameSource: string
}

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out during ${label}`)), 10_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function measure(forceTimer: boolean): Promise<PacingResult> {
  const app = await launch({
    command: "bun",
    args: ["frame-pacing.tsx"],
    env: {
      PACE_FORCE_TIMER: forceTimer ? "1" : "0",
    },
  })

  try {
    const startedAt = performance.now()

    for (let index = 0; index < sampleCount; index += 1) {
      const target = startedAt + index * sampleIntervalMs
      const wait = target - performance.now()
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
      }

      await withTimeout(
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
    }

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
    `frame pacing (${result.frameSource}): ${result.frames} frames / ${result.durationMs.toFixed(1)}ms = ${result.hz.toFixed(1)} Hz; tick p50 ${result.tickP50Ms.toFixed(2)}ms (${result.ticks} ticks, ${result.workMs}ms JS work)`
  )
}

const displayLink = await measure(false)
report(displayLink)
const timer = await measure(true)
report(timer)

if (displayLink.frameSource !== "display-link") {
  throw new Error(`Expected the native display-link source, received ${displayLink.frameSource}`)
}
if (displayLink.hz < minimumHz) {
  throw new Error(
    `Expected at least ${minimumHz.toFixed(1)} Hz under paced scroll work, received ${displayLink.hz.toFixed(1)} Hz`
  )
}
