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
    id: number
  }> = []
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
    fragmentEntryPoint: string | undefined
  ): number {
    const id = this.nextId++
    this.pipelines.push({
      deviceId,
      label,
      vertexModuleId,
      vertexEntryPoint,
      fragmentModuleId,
      fragmentEntryPoint,
      id,
    })
    return id
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
    device.destroy()
    device.destroy()

    expect(transport.destroyedDevices).toEqual([1])
    expect(() => device.createCommandEncoder()).toThrow(/destroyed/)
    expect(() => module.nativeId()).toThrow(/destroyed/)
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
})
