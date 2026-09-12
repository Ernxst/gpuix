import React, { useEffect, useRef } from 'react'
import {
  cancelAnimationFrame,
  render,
  requestAnimationFrame,
  type CanvasPublicInstance,
} from '@gpuix/react'
import '@gpuix/react/globals'

const INDEXED_GEOMETRY_WGSL = `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.color = input.color;
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`

type NativeGpuBuffer = {
  getMappedRange(offset?: number, size?: number): ArrayBuffer
  unmap(): void
  destroy(): void
}

type NativeGpuRenderPass = {
  setPipeline(pipeline: unknown): void
  setVertexBuffer(slot: number, buffer: NativeGpuBuffer): void
  setIndexBuffer(buffer: NativeGpuBuffer, format: 'uint16' | 'uint32'): void
  drawIndexed(indexCount: number): void
  end(): void
}

type NativeGpuDevice = {
  queue: {
    submit(buffers: Iterable<unknown>): void
    writeBuffer(buffer: NativeGpuBuffer, offset: number, data: ArrayBufferView): void
  }
  createBuffer(descriptor: {
    label?: string
    size: number
    usage: number
    mappedAtCreation?: boolean
  }): NativeGpuBuffer
  createShaderModule(descriptor: { label?: string; code: string }): unknown
  createRenderPipeline(descriptor: {
    label?: string
    layout: 'auto'
    vertex: {
      module: unknown
      entryPoint: string
      buffers: Array<{
        arrayStride: number
        attributes: Array<{ shaderLocation: number; offset: number; format: string }>
      }>
    }
    fragment: {
      module: unknown
      entryPoint: string
      targets: Array<{ format: 'bgra8unorm' }>
    }
  }): unknown
  createCommandEncoder(): {
    beginRenderPass(descriptor: unknown): NativeGpuRenderPass
    finish(): unknown
  }
  destroy(): void
}

type NativeGpu = {
  requestAdapter(): Promise<{ requestDevice(): Promise<NativeGpuDevice> }>
}

type NativeGpuBufferUsage = { VERTEX: number; INDEX: number; COPY_DST: number }

function vertices(timestamp: number, phase: number): Float32Array {
  const wave = Math.sin(timestamp / 700 + phase) * 0.45
  const red = phase === 0 ? 0.96 : 0.18
  const green = phase === 0 ? 0.28 : 0.82
  const blue = phase === 0 ? 0.22 : 0.52
  return new Float32Array([
    wave - 0.26, -0.42, red, green, blue,
    wave + 0.26, -0.42, red, green, blue,
    wave - 0.26, 0.42, red, green, blue,
    wave + 0.26, 0.42, red, green, blue,
  ])
}

function AnimatedIndexedQuad({ phase }: { phase: number }) {
  const canvas = useRef<CanvasPublicInstance>(null)

  useEffect(() => {
    let frame = 0
    let disposed = false
    let device: NativeGpuDevice | undefined
    let vertexBuffer: NativeGpuBuffer | undefined
    let indexBuffer: NativeGpuBuffer | undefined

    void (async () => {
      const gpu = (navigator as Navigator & { gpu: NativeGpu }).gpu
      const adapter = await gpu.requestAdapter()
      device = await adapter.requestDevice()
      if (disposed) {
        device.destroy()
        return
      }
      const context = canvas.current?.getContext('webgpu')
      if (!context) throw new Error('Native WebGPU is unavailable')
      context.configure({ device: device as never, format: 'bgra8unorm' })

      const module = device.createShaderModule({
        label: 'GPU-IX indexed geometry',
        code: INDEXED_GEOMETRY_WGSL,
      })
      const pipeline = device.createRenderPipeline({
        label: 'GPU-IX indexed geometry pipeline',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vertex_main',
          buffers: [{
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x3' },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: 'fragment_main',
          targets: [{ format: 'bgra8unorm' }],
        },
      })
      const usage = (globalThis as typeof globalThis & {
        GPUBufferUsage: NativeGpuBufferUsage
      }).GPUBufferUsage
      const initialVertices = vertices(0, phase)
      vertexBuffer = device.createBuffer({
        label: 'GPU-IX dynamic quad vertices',
        size: initialVertices.byteLength,
        usage: usage.VERTEX | usage.COPY_DST,
        mappedAtCreation: true,
      })
      new Float32Array(vertexBuffer.getMappedRange()).set(initialVertices)
      vertexBuffer.unmap()
      indexBuffer = device.createBuffer({
        label: 'GPU-IX quad indices',
        size: 12,
        usage: usage.INDEX,
        mappedAtCreation: true,
      })
      new Uint16Array(indexBuffer.getMappedRange()).set([0, 1, 2, 2, 1, 3])
      indexBuffer.unmap()

      const draw = (timestamp: number) => {
        if (disposed) return
        device!.queue.writeBuffer(vertexBuffer!, 0, vertices(timestamp, phase))
        const encoder = device!.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.035, g: 0.045, b: 0.075, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        })
        pass.setPipeline(pipeline)
        pass.setVertexBuffer(0, vertexBuffer!)
        pass.setIndexBuffer(indexBuffer!, 'uint16')
        pass.drawIndexed(6)
        pass.end()
        device!.queue.submit([encoder.finish()])
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      vertexBuffer?.destroy()
      indexBuffer?.destroy()
      device?.destroy()
    }
  }, [phase])

  return <canvas ref={canvas} width={240} height={180} style={{ width: 240, height: 180 }} />
}

function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, backgroundColor: '#101116' }}>
      <text style={{ color: '#f3f5f7', fontSize: 18, fontWeight: 600 }}>Native WebGPU indexed buffers</text>
      <div style={{ display: 'flex', gap: 16 }}>
        <AnimatedIndexedQuad phase={0} />
        <AnimatedIndexedQuad phase={Math.PI} />
      </div>
    </div>
  )
}

render(<App />, { title: 'GPUIX Native WebGPU', width: 544, height: 252 })
