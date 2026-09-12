import React, { useEffect, useRef } from 'react'
import {
  cancelAnimationFrame,
  render,
  requestAnimationFrame,
  type CanvasPublicInstance,
} from '@gpuix/react'
import '@gpuix/react/globals'

const TRIANGLE_WGSL = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
  let positions = array(
    vec2f(-0.28, -0.45),
    vec2f(0.28, -0.45),
    vec2f(0.0, 0.45),
  );
  let alternate = f32(instance_index & 1u);
  var output: VertexOutput;
  output.position = vec4f(
    positions[vertex_index].x - 0.4 + alternate * 0.8,
    positions[vertex_index].y,
    0.0,
    1.0,
  );
  output.color = mix(
    vec3f(0.96, 0.28, 0.22),
    vec3f(0.18, 0.82, 0.52),
    alternate,
  );
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`

type NativeGpuRenderPass = {
  setPipeline(pipeline: unknown): void
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void
  end(): void
}

type NativeGpuDevice = {
  queue: { submit(buffers: Iterable<unknown>): void }
  createShaderModule(descriptor: { label?: string; code: string }): unknown
  createRenderPipeline(descriptor: {
    label?: string
    layout: 'auto'
    vertex: { module: unknown; entryPoint: string }
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

function AnimatedTriangle({ phase }: { phase: number }) {
  const canvas = useRef<CanvasPublicInstance>(null)

  useEffect(() => {
    let frame = 0
    let disposed = false
    let device: NativeGpuDevice | undefined

    void (async () => {
      const gpu = (navigator as Navigator & { gpu: NativeGpu }).gpu
      const adapter = await gpu.requestAdapter()
      device = await adapter.requestDevice()
      const context = canvas.current?.getContext('webgpu')
      if (!context) throw new Error('Native WebGPU is unavailable')
      context.configure({ device: device as never, format: 'bgra8unorm' })

      const module = device.createShaderModule({
        label: 'GPU-IX animated triangle',
        code: TRIANGLE_WGSL,
      })
      const pipeline = device.createRenderPipeline({
        label: 'GPU-IX animated triangle pipeline',
        layout: 'auto',
        vertex: { module, entryPoint: 'vertex_main' },
        fragment: {
          module,
          entryPoint: 'fragment_main',
          targets: [{ format: 'bgra8unorm' }],
        },
      })

      const draw = (timestamp: number) => {
        if (disposed) return
        const firstInstance = (Math.floor(timestamp / 700) + phase) & 1
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
        pass.draw(3, 1, 0, firstInstance)
        pass.end()
        device!.queue.submit([encoder.finish()])
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      device?.destroy()
    }
  }, [phase])

  return <canvas ref={canvas} width={240} height={180} style={{ width: 240, height: 180 }} />
}

function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, backgroundColor: '#101116' }}>
      <text style={{ color: '#f3f5f7', fontSize: 18, fontWeight: 600 }}>Native WebGPU shader pipelines</text>
      <div style={{ display: 'flex', gap: 16 }}>
        <AnimatedTriangle phase={0} />
        <AnimatedTriangle phase={1} />
      </div>
    </div>
  )
}

render(<App />, { title: 'GPUIX Native WebGPU', width: 544, height: 252 })
