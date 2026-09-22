import { create, globals, nativeVersion, seamStatus } from "wgpu-bun"

import { runBehavioralProbe } from "../shared/behavioral-probe.mjs"

Object.assign(globalThis, globals)
const version = nativeVersion()
const seam = seamStatus()
let gpu = create(["backend=metal"])

const result = await runBehavioralProbe({
  provider: `wgpu-bun@29.1.0 / ${version.text} / ${seam.mode}`,
  gpu,
})
console.log(JSON.stringify(result, null, 2))

gpu = undefined
Bun.gc(true)
