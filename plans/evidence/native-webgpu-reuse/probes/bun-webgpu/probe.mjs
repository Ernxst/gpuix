import { setupGlobals } from "bun-webgpu"

import { runBehavioralProbe } from "../shared/behavioral-probe.mjs"

await setupGlobals()
const gpu = navigator.gpu
const result = await runBehavioralProbe({ provider: "bun-webgpu@0.1.7", gpu })
console.log(JSON.stringify(result, null, 2))

gpu.destroy?.()
Bun.gc(true)
