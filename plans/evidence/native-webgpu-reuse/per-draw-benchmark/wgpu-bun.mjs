import { create, globals, nativeVersion, seamStatus } from "wgpu-bun"

import { runWorkload } from "./workload.mjs"

Object.assign(globalThis, globals)
const gpu = create(["backend=metal"])
const adapter = await gpu.requestAdapter()
if (!adapter) throw new Error("wgpu-bun requestAdapter returned null")
const device = await adapter.requestDevice()
const texture = device.createTexture({
  size: [256, 256],
  format: "bgra8unorm",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
})
const view = texture.createView()

try {
  const version = nativeVersion()
  const seam = seamStatus()
  const result = await runWorkload({
    provider: `wgpu-bun@29.1.0 / ${version.text} / ${seam.mode}`,
    runtime: `Bun ${Bun.version}`,
    device,
    target: { acquireView: () => view },
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  texture.destroy()
  device.destroy()
}
