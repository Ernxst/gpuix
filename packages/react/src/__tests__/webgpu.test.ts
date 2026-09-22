import { describe, expect, it, vi } from "vitest"

import {
  GPUAdapter,
  GPUCanvasContext,
  GPUDevice,
  invalidateWebGpuTransport,
  type WebGpuCanvasTransport,
} from "../canvas/webgpu.js"

const SHADER = `
@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array(vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.0, 0.5));
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment fn fragment_main() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
`

class RecordingTransport implements WebGpuCanvasTransport {
  nextId = 1
  devices: number[] = []
  destroyedDevices: number[] = []
  shaderModules: Array<{ deviceId: number; label: string | undefined; code: string; id: number }> = []
  pipelines: Array<{
    deviceId: number
    label: string | undefined
    vertexModuleId: number
    vertexEntryPoint: string | undefined
    fragmentModuleId: number
    fragmentEntryPoint: string | undefined
    vertexBuffers: string
    sampleMask: number
    id: number
  }> = []
  buffers: Array<{
    deviceId: number
    label: string | undefined
    size: number
    usage: number
    initialData: number[]
    id: number
  }> = []
  destroyedBuffers: Array<{ deviceId: number; bufferId: number }> = []
  destroyedShaderModules: Array<{ deviceId: number; shaderModuleId: number }> = []
  destroyedRenderPipelines: Array<{ deviceId: number; renderPipelineId: number }> = []
  writes: Array<{ deviceId: number; bufferId: number; offset: number; data: number[] }> = []
  frames: Array<{
    id: number
    width: number
    height: number
    deviceId: number
    rgba: number
    ops: number[]
    operands: number[]
  }> = []
  submissions: Array<{
    deviceId: number
    submission: {
      frames: Array<{ id: number; width: number; height: number }>
      passes: Array<{
        frame: number
        rgba: number
        opStart: number
        opCount: number
        operandStart: number
        operandCount: number
      }>
    }
    ops: number[]
    operands: number[]
  }> = []

  presentWebGpuClear(): void {}

  createWebGpuDevice(): number {
    const id = this.nextId++
    this.devices.push(id)
    return id
  }

  destroyWebGpuDevice(deviceId: number): void {
    this.destroyedDevices.push(deviceId)
  }

  createWebGpuShaderModule(
    deviceId: number,
    label: string | undefined,
    code: string
  ): number {
    const id = this.nextId++
    this.shaderModules.push({ deviceId, label, code, id })
    return id
  }

  createWebGpuRenderPipeline(
    deviceId: number,
    label: string | undefined,
    vertexModuleId: number,
    vertexEntryPoint: string | undefined,
    fragmentModuleId: number,
    fragmentEntryPoint: string | undefined,
    vertexBuffers: string,
    sampleMask: number
  ): number {
    const id = this.nextId++
    this.pipelines.push({
      deviceId,
      label,
      vertexModuleId,
      vertexEntryPoint,
      fragmentModuleId,
      fragmentEntryPoint,
      vertexBuffers,
      sampleMask,
      id,
    })
    return id
  }

  createWebGpuBuffer(
    deviceId: number,
    label: string | undefined,
    size: number,
    usage: number,
    initialData: Uint8Array
  ): number {
    const id = this.nextId++
    this.buffers.push({
      deviceId,
      label,
      size,
      usage,
      initialData: Array.from(initialData),
      id,
    })
    return id
  }

  destroyWebGpuBuffer(deviceId: number, bufferId: number): void {
    this.destroyedBuffers.push({ deviceId, bufferId })
  }

  destroyWebGpuShaderModule(deviceId: number, shaderModuleId: number): void {
    this.destroyedShaderModules.push({ deviceId, shaderModuleId })
  }

  destroyWebGpuRenderPipeline(deviceId: number, renderPipelineId: number): void {
    this.destroyedRenderPipelines.push({ deviceId, renderPipelineId })
  }

  writeWebGpuBuffer(
    deviceId: number,
    bufferId: number,
    offset: number,
    data: Uint8Array
  ): void {
    this.writes.push({ deviceId, bufferId, offset, data: Array.from(data) })
  }

  submitWebGpuCommands(
    deviceId: number,
    submissionJson: string,
    ops: Uint32Array,
    operands: Float64Array
  ): void {
    const submission = JSON.parse(
      submissionJson,
    ) as RecordingTransport["submissions"][number]["submission"]
    const opValues = Array.from(ops)
    const operandValues = Array.from(operands)
    this.submissions.push({ deviceId, submission, ops: opValues, operands: operandValues })
    submission.frames.forEach((frame, frameIndex) => {
      const passes = submission.passes.filter((pass) => pass.frame === frameIndex)
      this.frames.push({
        ...frame,
        deviceId,
        rgba: passes[0]?.rgba ?? 0,
        ops: passes.flatMap((pass) => opValues.slice(pass.opStart, pass.opStart + pass.opCount)),
        operands: passes.flatMap((pass) =>
          operandValues.slice(pass.operandStart, pass.operandStart + pass.operandCount),
        ),
      })
    })
  }
}

async function pipelineFixture(transport = new RecordingTransport()) {
  const device = await new GPUAdapter().requestDevice()
  const context = new GPUCanvasContext(transport, 17, () => ({ width: 96, height: 72 }))
  context.configure({ device, format: "bgra8unorm" })
  const module = device.createShaderModule({ label: "triangle shader", code: SHADER })
  const pipeline = device.createRenderPipeline({
    label: "triangle pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vertex_main" },
    fragment: {
      module,
      entryPoint: "fragment_main",
      targets: [{ format: "bgra8unorm" }],
    },
  })
  return { context, device, module, pipeline, transport }
}

function trackedResourceCount(device: GPUDevice): number {
  return (device as unknown as { resources: Set<unknown> }).resources.size
}

describe("native WebGPU command model", () => {
  it("materialises renderer-owned resources and encodes a browser-shaped draw", async () => {
    const { context, device, pipeline, transport } = await pipelineFixture()
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.draw(3, 2, 1, 4)
    pass.end()
    device.queue.submit([encoder.finish()])

    expect(transport.devices).toEqual([1])
    expect(transport.shaderModules).toEqual([
      { deviceId: 1, label: "triangle shader", code: SHADER, id: 2 },
    ])
    expect(transport.pipelines).toEqual([
      {
        deviceId: 1,
        label: "triangle pipeline",
        vertexModuleId: 2,
        vertexEntryPoint: "vertex_main",
        fragmentModuleId: 2,
        fragmentEntryPoint: "fragment_main",
        vertexBuffers: "[]",
        sampleMask: 0xffff_ffff,
        id: 3,
      },
    ])
    expect(transport.frames).toEqual([
      {
        id: 17,
        width: 96,
        height: 72,
        deviceId: 1,
        rgba: 0x1a334dff,
        ops: [1, 2],
        operands: [3, 3, 2, 1, 4],
      },
    ])
  })

  it("allows shaders and pipelines to be described before a canvas binds the device", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const module = device.createShaderModule({ code: SHADER })
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertex_main" },
      fragment: { module, entryPoint: "fragment_main", targets: [{ format: "bgra8unorm" }] },
    })
    expect(transport.devices).toEqual([])

    const context = new GPUCanvasContext(transport, 4, () => ({ width: 32, height: 32 }))
    context.configure({ device, format: "bgra8unorm" })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView() }],
    })
    pass.setPipeline(pipeline)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])

    expect(transport.devices).toEqual([1])
    expect(transport.frames).toHaveLength(1)
  })

  it("enforces device ownership and encoder/pass lifetimes", async () => {
    const { context, device, pipeline } = await pipelineFixture()
    const otherDevice = await new GPUAdapter().requestDevice()
    const otherModule = otherDevice.createShaderModule({ code: SHADER })
    expect(() =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module: otherModule, entryPoint: "vertex_main" },
        fragment: {
          module: otherModule,
          entryPoint: "fragment_main",
          targets: [{ format: "bgra8unorm" }],
        },
      })
    ).toThrow(/different device/)

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView() }],
    })
    expect(() => pass.draw(3)).toThrow(/pipeline must be set/)
    expect(() => encoder.finish()).toThrow(/must be ended/)
    pass.setPipeline(pipeline)
    pass.draw(3)
    pass.end()
    expect(() => pass.setPipeline(pipeline)).toThrow(/already ended/)

    const commandBuffer = encoder.finish()
    device.queue.submit([commandBuffer])
    expect(() => device.queue.submit([commandBuffer])).toThrow(/already submitted/)
  })

  it("destroys each logical device once and rejects its surviving wrappers", async () => {
    const { device, module, transport } = await pipelineFixture()
    const buffer = device.createBuffer({ size: 16, usage: 0x08 })
    device.destroy()
    device.destroy()

    expect(transport.destroyedDevices).toEqual([1])
    expect(() => device.createCommandEncoder()).toThrow(/destroyed/)
    expect(() => module.nativeId()).toThrow(/destroyed/)
    expect(() => buffer.nativeId()).toThrow(/destroyed/)
    expect(() => buffer.destroy()).not.toThrow()
    expect(transport.destroyedBuffers).toEqual([])
  })

  it("does not let one logical device cross renderer ownership", async () => {
    const first = new RecordingTransport()
    const second = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    new GPUCanvasContext(first, 1, () => ({ width: 10, height: 10 })).configure({
      device,
      format: "bgra8unorm",
    })
    expect(() =>
      new GPUCanvasContext(second, 2, () => ({ width: 10, height: 10 })).configure({
        device,
        format: "bgra8unorm",
      })
    ).toThrow(/different renderer/)
  })

  it("uploads mapped buffers and encodes an indexed draw with vertex layouts", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const vertices = device.createBuffer({
      label: "quad vertices",
      size: 48,
      usage: 0x20 | 0x08,
      mappedAtCreation: true,
    })
    new Float32Array(vertices.getMappedRange()).set([
      -0.5, -0.5, 1, 0,
      0.5, -0.5, 0, 1,
      0, 0.5, 0, 0,
    ])
    vertices.unmap()

    const indices = device.createBuffer({
      label: "quad indices",
      size: 8,
      usage: 0x10,
      mappedAtCreation: true,
    })
    new Uint16Array(indices.getMappedRange()).set([0, 1, 2])
    indices.unmap()

    const module = device.createShaderModule({ code: SHADER })
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertex_main",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fragment_main", targets: [{ format: "bgra8unorm" }] },
    })
    const context = new GPUCanvasContext(transport, 21, () => ({ width: 80, height: 60 }))
    device.queue.writeBuffer(vertices, 16, new Uint16Array([99, 100, 7, 8]), 2, 2)
    expect(transport.devices).toEqual([])
    expect(transport.writes).toEqual([])
    context.configure({ device, format: "bgra8unorm" })

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView() }],
    })
    pass.setPipeline(pipeline)
    pass.setVertexBuffer(0, vertices)
    pass.setIndexBuffer(indices, "uint16", 0, 6)
    pass.drawIndexed(3, 2, 0, -1, 4)
    pass.end()
    device.queue.submit([encoder.finish()])

    expect(transport.buffers).toEqual([
      {
        deviceId: 1,
        label: "quad vertices",
        size: 48,
        usage: 40,
        initialData: Array.from(
          new Uint8Array(
            new Float32Array([
              -0.5, -0.5, 1, 0,
              0.5, -0.5, 0, 1,
              0, 0.5, 0, 0,
            ]).buffer
          )
        ),
        id: 4,
      },
      {
        deviceId: 1,
        label: "quad indices",
        size: 8,
        usage: 16,
        initialData: [0, 0, 1, 0, 2, 0, 0, 0],
        id: 5,
      },
    ])
    expect(transport.writes).toEqual([
      { deviceId: 1, bufferId: 4, offset: 16, data: [7, 0, 8, 0] },
    ])
    expect(transport.pipelines[0]?.vertexBuffers).toBe(
      JSON.stringify([
        {
          arrayStride: 16,
          stepMode: "vertex",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
          ],
        },
      ])
    )
    expect(transport.frames[0]?.ops).toEqual([1, 3, 4, 5])
    expect(transport.frames[0]?.operands).toEqual([
      3,
      0, 4, 0, 48,
      5, 0, 0, 6,
      3, 2, 0, -1, 4,
    ])
  })

  it("enforces mapped-range, buffer usage, ownership, and destruction state", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const mapped = device.createBuffer({
      size: 16,
      usage: 0x20,
      mappedAtCreation: true,
    })
    const range = mapped.getMappedRange(8, 8)
    expect(() => mapped.getMappedRange(8, 4)).toThrow(/overlap/)
    expect(() => mapped.getMappedRange(4, 4)).toThrow(/multiple of 8/)
    mapped.unmap()
    expect(range.byteLength).toBe(0)
    expect(() => mapped.getMappedRange()).toThrow(/not mapped/)

    const context = new GPUCanvasContext(transport, 8, () => ({ width: 32, height: 32 }))
    context.configure({ device, format: "bgra8unorm" })
    expect(() => device.queue.writeBuffer(mapped, 0, new Uint32Array([1]))).toThrow(/COPY_DST/)

    const writable = device.createBuffer({ size: 16, usage: 0x08 })
    expect(() => device.queue.writeBuffer(writable, 2, new Uint32Array([1]))).toThrow(
      /multiple of 4/
    )
    expect(() => device.queue.writeBuffer(writable, 16, new Uint32Array([1]))).toThrow(
      /exceeds/
    )

    const otherDevice = await new GPUAdapter().requestDevice()
    expect(() => otherDevice.queue.writeBuffer(writable, 0, new Uint32Array([1]))).toThrow(
      /different device/
    )

    writable.destroy()
    writable.destroy()
    expect(transport.destroyedBuffers).toEqual([{ deviceId: 1, bufferId: 2 }])
    expect(() => writable.destroy()).not.toThrow()
    expect(() => device.queue.writeBuffer(writable, 0, new Uint32Array([1]))).toThrow(/destroyed/)
  })

  it("keeps one current texture through ordered passes and expires it after submission", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 31, () => ({ width: 48, height: 24 }))
    context.configure({ device, format: "bgra8unorm" })
    const texture = context.getCurrentTexture()
    expect(context.getCurrentTexture()).toBe(texture)
    const view = texture.createView()
    const encoder = device.createCommandEncoder()
    for (const clearValue of [
      { r: 1, a: 1 },
      { b: 1, a: 1 },
    ]) {
      encoder.beginRenderPass({ colorAttachments: [{ view, clearValue }] }).end()
    }

    device.queue.submit([encoder.finish()])

    expect(transport.submissions).toHaveLength(1)
    expect(transport.submissions[0]?.submission.frames).toEqual([{ id: 31, width: 48, height: 24 }])
    expect(transport.submissions[0]?.submission.passes.map((pass) => pass.rgba)).toEqual([
      0xff0000ff, 0x0000ffff,
    ])
    expect(() => texture.createView()).toThrow(/stale/)
    expect(context.getCurrentTexture()).not.toBe(texture)
  })

  it("snapshots dictionary and array clear colors while recording", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 32, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    const dictionary = { r: 1, g: 0, b: 0, a: 1 }
    const encoder = device.createCommandEncoder()
    encoder
      .beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), clearValue: dictionary },
        ],
      })
      .end()
    dictionary.r = 0
    dictionary.g = 1
    device.queue.submit([encoder.finish()])
    expect(transport.frames[0]?.rgba).toBe(0xff0000ff)

    const next = device.createCommandEncoder()
    next
      .beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), clearValue: [1, 0, 0, 1] },
        ],
      })
      .end()
    device.queue.submit([next.finish()])
    expect(transport.frames[1]?.rgba).toBe(0xff0000ff)
  })

  it("defaults clears to transparent black and rejects non-finite clear colours", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 37, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    const encoder = device.createCommandEncoder()
    encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView() }] }).end()
    device.queue.submit([encoder.finish()])
    expect(transport.frames[0]?.rgba).toBe(0x00000000)

    expect(() =>
      device.createCommandEncoder().beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), clearValue: { r: Number.NaN } },
        ],
      }),
    ).toThrow(TypeError)
  })

  it("routes sample masks and rejects premultiplied canvas configuration", async () => {
    const { context, device, module, transport } = await pipelineFixture()
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertex_main" },
      fragment: { module, entryPoint: "fragment_main", targets: [{ format: "bgra8unorm" }] },
      multisample: { mask: 0 },
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView() }],
    })
    pass.setPipeline(pipeline)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    expect(transport.pipelines.at(-1)?.sampleMask).toBe(0)

    const otherContext = new GPUCanvasContext(transport, 33, () => ({ width: 8, height: 8 }))
    expect(() =>
      otherContext.configure({ device, format: "bgra8unorm", alphaMode: "premultiplied" }),
    ).toThrow(/not supported/)
  })

  it("finishes destruction after a caller transfers a mapped range", async () => {
    const device = await new GPUAdapter().requestDevice()
    const mapped = device.createBuffer({ size: 16, usage: 0x20, mappedAtCreation: true })
    const range = mapped.getMappedRange()
    structuredClone(range, { transfer: [range] })
    expect(() => device.destroy()).not.toThrow()
    expect(() => device.createCommandEncoder()).toThrow(/destroyed/)
  })

  it("removes explicitly destroyed resources from device tracking", async () => {
    const device = await new GPUAdapter().requestDevice()
    const buffer = device.createBuffer({ size: 16, usage: 0x08 })
    expect(trackedResourceCount(device)).toBe(1)
    buffer.destroy()
    expect(trackedResourceCount(device)).toBe(0)
  })

  it("invalidates every device wrapper when its renderer is replaced", async () => {
    const transport = new RecordingTransport()
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 34, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    const buffer = device.createBuffer({ size: 16, usage: 0x08 })
    invalidateWebGpuTransport(transport)
    expect(() => device.createCommandEncoder()).toThrow(/replaced/)
    expect(() => device.queue.writeBuffer(buffer, 0, new Uint32Array([1]))).toThrow(/replaced/)
    expect(() => device.createShaderModule({ code: SHADER })).toThrow(/replaced/)
    expect(() => device.destroy()).not.toThrow()
  })

  it("attributes native validation failures to one logical device", async () => {
    const transport = new RecordingTransport()
    transport.createWebGpuShaderModule = () => {
      throw new Error("WGSL parse error")
    }
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 35, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    device.pushErrorScope("validation")
    const module = device.createShaderModule({ code: "not wgsl" })
    expect(() =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module },
        fragment: { module, targets: [{ format: "bgra8unorm" }] },
      }),
    ).not.toThrow()
    await expect(device.popErrorScope()).resolves.toMatchObject({
      name: "GPUValidationError",
      message: "WGSL parse error",
    })

    const otherTransport = new RecordingTransport()
    const otherDevice = await new GPUAdapter().requestDevice()
    const otherContext = new GPUCanvasContext(otherTransport, 36, () => ({ width: 8, height: 8 }))
    otherContext.configure({ device: otherDevice, format: "bgra8unorm" })
    expect(() => otherDevice.createShaderModule({ code: SHADER })).not.toThrow()
    expect(() => otherDevice.createCommandEncoder()).not.toThrow()
  })

  it("delivers uncaptured errors to listeners and the event handler", async () => {
    const transport = new RecordingTransport()
    transport.createWebGpuShaderModule = () => {
      throw new Error("WGSL parse error")
    }
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 38, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    const listener = vi.fn()
    const handler = vi.fn()
    device.addEventListener("uncapturederror", listener)
    device.onuncapturederror = handler
    device.pushErrorScope("internal")

    const module = device.createShaderModule({ code: "not wgsl" })
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module },
      fragment: { module, targets: [{ format: "bgra8unorm" }] },
    })

    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "uncapturederror",
      error: { name: "GPUValidationError", message: "WGSL parse error" },
    })
    await expect(device.popErrorScope()).resolves.toBeNull()
  })

  it("does not skip a populated inner error scope", async () => {
    const transport = new RecordingTransport()
    transport.createWebGpuShaderModule = () => {
      throw new Error("WGSL parse error")
    }
    const device = await new GPUAdapter().requestDevice()
    const context = new GPUCanvasContext(transport, 39, () => ({ width: 8, height: 8 }))
    context.configure({ device, format: "bgra8unorm" })
    const uncaptured = vi.fn()
    device.addEventListener("uncapturederror", uncaptured)
    device.pushErrorScope("validation")
    device.pushErrorScope("validation")

    for (let index = 0; index < 2; index++) {
      const module = device.createShaderModule({ code: `not wgsl ${index}` })
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module },
        fragment: { module, targets: [{ format: "bgra8unorm" }] },
      })
    }

    await expect(device.popErrorScope()).resolves.toMatchObject({ name: "GPUValidationError" })
    await expect(device.popErrorScope()).resolves.toBeNull()
    await Promise.resolve()
    expect(uncaptured).not.toHaveBeenCalled()
  })

  it("rejects popping an empty error scope with OperationError", async () => {
    const device = await new GPUAdapter().requestDevice()
    await expect(device.popErrorScope()).rejects.toMatchObject({ name: "OperationError" })
  })
})
