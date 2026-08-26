import { GpuixRenderer } from "../packages/native/index.js"

const sampleCount = Number(process.env.PUMP_RACE_SAMPLES ?? 64)
const maximumPumpMs = Number(process.env.PUMP_RACE_MAX_MS ?? 1_000 / 60)
const renderer = new GpuixRenderer(() => {})
renderer.init({ title: "GPUIX frame pump race", width: 320, height: 200, menus: [] })
for (let index = 0; index < 4; index += 1) renderer.tick()

let callbacks = 0

const pumpDurations: number[] = []
for (let index = 0; index < sampleCount; index += 1) {
  let resolveCallback: (() => void) | undefined
  const callbackServiced = new Promise<void>((resolve) => (resolveCallback = resolve))
  const startedAt = performance.now()
  const running = renderer.testIdlePumpFrameRequestRace(() => {
    callbacks += 1
    resolveCallback?.()
  })
  const pumpMs = performance.now() - startedAt

  if (!running) throw new Error("Idle pump terminated during the frame-request race")
  if (pumpMs >= maximumPumpMs) {
    throw new Error(
      `Idle pump exceeded its ${maximumPumpMs.toFixed(1)}ms bound: ${pumpMs.toFixed(2)}ms`
    )
  }
  pumpDurations.push(pumpMs)

  await Promise.race([
    callbackServiced,
    Bun.sleep(500).then(() => {
      throw new Error(`Late native frame-request callback ${index + 1} was not serviced`)
    }),
  ])
}

if (callbacks !== sampleCount) {
  throw new Error(`Expected ${sampleCount} queued TSFNs, received ${callbacks}`)
}
const sortedPumpDurations = pumpDurations.toSorted((a, b) => a - b)
const pumpP95Ms = sortedPumpDurations[Math.ceil(sortedPumpDurations.length * 0.95) - 1] ?? 0
console.log(
  `PUMP_RACE_RETURN p95 ${pumpP95Ms.toFixed(2)}ms / max ${Math.max(...pumpDurations).toFixed(2)}ms`
)
console.log(`PUMP_RACE_CALLBACK ${callbacks}/${sampleCount} TSFNs serviced`)
await Bun.sleep(10)
process.exit(0)
