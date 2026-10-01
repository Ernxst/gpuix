import { create, globals } from "webgpu"

import { runWorkload } from "./workload.mjs"

Object.assign(globalThis, globals)
const gpu = create(["backend=metal"])
const adapter = await gpu.requestAdapter()
if (!adapter) throw new Error("Dawn requestAdapter returned null")
const device = await adapter.requestDevice()
const texture = device.createTexture({
  size: [256, 256],
  format: "bgra8unorm",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
})
const view = texture.createView()

try {
  const result = await runWorkload({
    provider: "Dawn webgpu@0.6.1",
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
    device,
    target: { acquireView: () => view },
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  texture.destroy()
  device.destroy()
}
