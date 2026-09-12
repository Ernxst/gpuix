import React, { useEffect, useRef } from 'react'
import {
  cancelAnimationFrame,
  render,
  requestAnimationFrame,
  type CanvasPublicInstance,
} from '@gpuix/react'
import '@gpuix/react/globals'

type NativeGpu = {
  requestAdapter(): Promise<{
    requestDevice(): Promise<{
      queue: { submit(buffers: Iterable<unknown>): void }
      createCommandEncoder(): {
        beginRenderPass(descriptor: unknown): { end(): void }
        finish(): unknown
      }
      destroy(): void
    }>
  }>
}

function AnimatedCanvas({ phase }: { phase: number }) {
  const canvas = useRef<CanvasPublicInstance>(null)

  useEffect(() => {
    let frame = 0
    let disposed = false
    let device: Awaited<ReturnType<Awaited<ReturnType<NativeGpu['requestAdapter']>>['requestDevice']>> | undefined

    void (async () => {
      const gpu = (navigator as Navigator & { gpu: NativeGpu }).gpu
      const adapter = await gpu.requestAdapter()
      device = await adapter.requestDevice()
      const context = canvas.current?.getContext('webgpu')
      if (!context) throw new Error('Native WebGPU is unavailable')
      context.configure({ device: device as never, format: 'bgra8unorm' })

      const draw = (timestamp: number) => {
        if (disposed) return
        const wave = (Math.sin(timestamp / 650 + phase) + 1) / 2
        const encoder = device!.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: phase === 0
              ? { r: 0.12, g: 0.3 + wave * 0.6, b: 0.82, a: 1 }
              : { r: 0.92, g: 0.2 + wave * 0.55, b: 0.16, a: 1 },
          }],
        })
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
      <text style={{ color: '#f3f5f7', fontSize: 18, fontWeight: 600 }}>Native WebGPU production slice</text>
      <div style={{ display: 'flex', gap: 16 }}>
        <AnimatedCanvas phase={0} />
        <AnimatedCanvas phase={Math.PI} />
      </div>
    </div>
  )
}

render(<App />, { title: 'GPUIX Native WebGPU', width: 544, height: 252 })
