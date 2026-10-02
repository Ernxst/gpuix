function describeError(error) {
  return {
    name: error?.name ?? error?.constructor?.name ?? typeof error,
    message: error instanceof Error ? error.message : String(error),
  }
}

function selectedLimits(limits) {
  return Object.fromEntries(
    [
      "maxBufferSize",
      "maxTextureDimension2D",
      "maxBindGroups",
      "maxVertexBuffers",
    ].map((name) => [name, limits[name]])
  )
}

export async function runBehavioralProbe({ provider, gpu }) {
  const observations = []
  const resources = []
  const devices = []

  async function observe(name, operation) {
    try {
      const detail = await operation()
      observations.push({ name, outcome: "pass", detail })
    } catch (error) {
      observations.push({ name, outcome: "fail", error: describeError(error) })
    }
  }

  let adapter
  await observe("adapter-acquisition", async () => {
    adapter = await gpu.requestAdapter()
    if (!adapter) throw new Error("requestAdapter returned null")
    return {
      features: [...adapter.features].sort(),
      limits: selectedLimits(adapter.limits),
      info: adapter.info
        ? {
            vendor: adapter.info.vendor,
            architecture: adapter.info.architecture,
            device: adapter.info.device,
            description: adapter.info.description,
          }
        : null,
    }
  })
  if (!adapter) return { provider, observations }

  await observe("unsupported-required-feature", async () => {
    try {
      await adapter.requestDevice({ requiredFeatures: ["gpuix-invalid-feature"] })
    } catch (error) {
      return describeError(error)
    }
    throw new Error("requestDevice accepted an invalid required feature")
  })

  await observe("unsupported-required-limit", async () => {
    const maxBufferSize = Number(adapter.limits.maxBufferSize)
    try {
      await adapter.requestDevice({ requiredLimits: { maxBufferSize: maxBufferSize + 1 } })
    } catch (error) {
      return describeError(error)
    }
    throw new Error("requestDevice accepted maxBufferSize above the adapter limit")
  })

  let device
  await observe("device-acquisition", async () => {
    device = await adapter.requestDevice()
    devices.push(device)
    return {
      features: [...device.features].sort(),
      limits: selectedLimits(device.limits),
    }
  })
  if (!device) return { provider, observations }

  await observe("invalid-wgsl-error-scope", async () => {
    device.pushErrorScope("validation")
    const shader = device.createShaderModule({
      code: "@vertex fn vertex_main( -> @builtin(position) vec4f {",
    })
    let compilation = null
    let compilationInfoError = null
    if (typeof shader.getCompilationInfo === "function") {
      try {
        compilation = await shader.getCompilationInfo()
      } catch (error) {
        compilationInfoError = describeError(error)
      }
    }
    const error = await device.popErrorScope()
    if (!error) throw new Error("invalid WGSL produced no scoped validation error")
    return {
      error: describeError(error),
      compilationInfoError,
      compilationMessages: compilation?.messages?.map((message) => ({
        type: message.type,
        message: message.message,
      })),
    }
  })

  await observe("invalid-buffer-error-scope", async () => {
    device.pushErrorScope("validation")
    let synchronousError = null
    try {
      const invalid = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_SRC,
      })
      resources.push(invalid)
    } catch (error) {
      synchronousError = describeError(error)
    }
    const scopedError = await device.popErrorScope()
    if (!synchronousError && !scopedError) {
      throw new Error("invalid MAP_READ usage produced no synchronous or scoped error")
    }
    return {
      synchronousError,
      scopedError: scopedError ? describeError(scopedError) : null,
    }
  })

  await observe("mapping-and-transfer", async () => {
    const buffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    })
    resources.push(buffer)
    const range = buffer.getMappedRange()
    new Uint32Array(range).set([1, 2, 3, 4])
    let overlapError
    try {
      buffer.getMappedRange(0, 8)
    } catch (error) {
      overlapError = describeError(error)
    }
    if (!overlapError) throw new Error("overlapping getMappedRange did not throw")
    structuredClone(range, { transfer: [range] })
    buffer.unmap()
    return {
      overlapError,
      transferredByteLength: range.byteLength,
      mapState: buffer.mapState,
    }
  })

  let source
  await observe("queue-order-and-map-read", async () => {
    source = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    })
    const destination = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    resources.push(source, destination)
    new Uint32Array(source.getMappedRange()).set([11, 22, 33, 44])
    source.unmap()

    const encoder = device.createCommandEncoder()
    encoder.copyBufferToBuffer(source, 0, destination, 0, 16)
    device.queue.submit([encoder.finish()])
    await destination.mapAsync(GPUMapMode.READ)
    const values = [...new Uint32Array(destination.getMappedRange())]
    destination.unmap()
    if (values.join(",") !== "11,22,33,44") {
      throw new Error(`unexpected copied values: ${values.join(",")}`)
    }
    return values
  })

  async function readFirstPixel(texture) {
    const readback = device.createBuffer({
      size: 256 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    resources.push(readback)
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow: 256, rowsPerImage: 4 },
      [4, 4, 1]
    )
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    const pixel = [...new Uint8Array(readback.getMappedRange(0, 4))]
    readback.unmap()
    return pixel
  }

  await observe("ordered-render-command-buffers", async () => {
    const texture = device.createTexture({
      size: [4, 4],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    resources.push(texture)
    const buffers = [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
    ].map((clearValue) => {
      const encoder = device.createCommandEncoder()
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: texture.createView(),
              clearValue,
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        })
        .end()
      return encoder.finish()
    })
    device.queue.submit(buffers)
    const pixel = await readFirstPixel(texture)
    if (pixel.join(",") !== "0,255,0,255") {
      throw new Error(`command buffers completed out of order: ${pixel.join(",")}`)
    }
    return pixel
  })

  await observe("sample-mask-zero", async () => {
    const texture = device.createTexture({
      size: [4, 4],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    resources.push(texture)
    const module = device.createShaderModule({
      code: `
        @vertex
        fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
          var positions = array<vec2f, 3>(
            vec2f(-1.0, -1.0),
            vec2f(3.0, -1.0),
            vec2f(-1.0, 3.0)
          );
          return vec4f(positions[index], 0.0, 1.0);
        }

        @fragment
        fn fragment_main() -> @location(0) vec4f {
          return vec4f(1.0, 0.0, 0.0, 1.0);
        }
      `,
    })
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertex_main" },
      fragment: {
        module,
        entryPoint: "fragment_main",
        targets: [{ format: "rgba8unorm" }],
      },
      multisample: { count: 1, mask: 0, alphaToCoverageEnabled: false },
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: [0, 1, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    const pixel = await readFirstPixel(texture)
    if (pixel.join(",") !== "0,255,0,255") {
      throw new Error(`sampleMask 0 changed the clear pixel: ${pixel.join(",")}`)
    }
    return pixel
  })

  let otherDevice
  await observe("cross-device-ownership", async () => {
    const otherAdapter = await gpu.requestAdapter()
    if (!otherAdapter) throw new Error("second requestAdapter returned null")
    otherDevice = await otherAdapter.requestDevice()
    devices.push(otherDevice)
    const destination = otherDevice.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST,
    })
    resources.push(destination)

    otherDevice.pushErrorScope("validation")
    let synchronousError
    try {
      const encoder = otherDevice.createCommandEncoder()
      encoder.copyBufferToBuffer(source, 0, destination, 0, 16)
      otherDevice.queue.submit([encoder.finish()])
    } catch (error) {
      synchronousError = describeError(error)
    }
    const scopedError = await otherDevice.popErrorScope()
    if (!synchronousError && !scopedError) {
      throw new Error("cross-device buffer use produced no error")
    }
    return {
      synchronousError,
      scopedError: scopedError ? describeError(scopedError) : null,
    }
  })

  await observe("device-destruction-isolation", async () => {
    otherDevice?.destroy()
    const survivor = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST,
    })
    resources.push(survivor)
    device.queue.writeBuffer(survivor, 0, new Uint32Array([9, 8, 7, 6]))
    await device.queue.onSubmittedWorkDone()
    return "first device remained operational"
  })

  for (const resource of resources) {
    try {
      resource.destroy?.()
    } catch {}
  }
  for (const ownedDevice of devices) {
    try {
      ownedDevice.destroy()
    } catch {}
  }

  return { provider, observations }
}
