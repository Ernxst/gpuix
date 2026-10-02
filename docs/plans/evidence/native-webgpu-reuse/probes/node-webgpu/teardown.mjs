import { create, globals } from "webgpu"

Object.assign(globalThis, globals)
const mode = process.argv[2]
const pendingDestruction = new Set()
let gpu = create(["backend=metal"])
let adapter = await gpu.requestAdapter()
if (!adapter) throw new Error("requestAdapter returned null")
let device = await adapter.requestDevice()
let texture = mode.startsWith("texture")
  ? device.createTexture({
      size: [4, 4],
      format: "bgra8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  : undefined

if (mode.includes("settle")) await device.queue.onSubmittedWorkDone()
if (mode.startsWith("texture")) texture.destroy()
if (mode.includes("rooted")) {
  const rootedDevice = device
  const settled = device.queue.onSubmittedWorkDone()
  pendingDestruction.add(rootedDevice)
  device.destroy()
  settled.finally(() => pendingDestruction.delete(rootedDevice))
} else {
  device.destroy()
}

texture = undefined
device = undefined
adapter = undefined
gpu = undefined
if (mode.endsWith("gc")) Bun.gc(true)
await new Promise((resolve) => setTimeout(resolve, 25))
console.log(JSON.stringify({ mode, reachedEnd: true }))
