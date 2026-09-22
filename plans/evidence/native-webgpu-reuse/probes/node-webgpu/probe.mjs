import { create, globals } from "webgpu"

import { runBehavioralProbe } from "../shared/behavioral-probe.mjs"

Object.assign(globalThis, globals)
let gpu = create(["backend=metal"])

const result = await runBehavioralProbe({ provider: "webgpu@0.6.1", gpu })
console.log(JSON.stringify(result, null, 2))

gpu = undefined
globalThis.gc?.()
globalThis.Bun?.gc?.(true)
