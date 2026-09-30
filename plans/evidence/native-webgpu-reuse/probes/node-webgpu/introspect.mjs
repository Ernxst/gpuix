const moduleNamespace = await import("webgpu")
const { create, globals } = moduleNamespace
Object.assign(globalThis, globals)

let gpu = create(["backend=metal"])
const adapter = await gpu.requestAdapter()
if (!adapter) throw new Error("requestAdapter returned null")
const device = await adapter.requestDevice()
const texture = device.createTexture({
  size: [4, 4],
  format: "bgra8unorm",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
})

console.log(
  JSON.stringify(
    {
      moduleExports: Object.keys(moduleNamespace).sort(),
      globalExports: Object.keys(globals).sort(),
      textureOwnKeys: Reflect.ownKeys(texture).map(String),
      texturePrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(texture)).sort(),
      deviceOwnKeys: Reflect.ownKeys(device).map(String),
      devicePrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(device)).sort(),
    },
    null,
    2
  )
)

texture.destroy()
device.destroy()
gpu = undefined
Bun.gc(true)
