import { describe, expect, it } from "vitest"

import {
  GPUAdapter,
  GPUCanvasContext,
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
    vertexBuffers: string
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

  writeWebGpuBuffer(
    deviceId: number,
    bufferId: number,
    offset: number,
    data: Uint8Array
  ): void {
    this.writes.push({ deviceId, bufferId, offset, data: Array.from(data) })
  }

  presentWebGpuCommands(
    id: number,
    width: number,
    height: number,
    deviceId: number,
    rgba: number,
    ops: Uint32Array,
    operands: Float64Array
  ): void {
    this.frames.push({
      id,
      width,
      height,
      deviceId,
      rgba,
      ops: Array.from(ops),
      operands: Array.from(operands),
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
})
