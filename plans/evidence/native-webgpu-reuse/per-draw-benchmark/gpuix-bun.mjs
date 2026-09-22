import React from "react"

import { createTestRoot } from "../../../../packages/react/src/testing.ts"
import { runWorkload } from "./workload.mjs"

const root = createTestRoot({ width: 256, height: 256, scaleFactor: 1 })
const canvasRef = React.createRef()

try {
  root.render(React.createElement("canvas", {
    ref: canvasRef,
    width: 256,
    height: 256,
    style: { width: 256, height: 256 },
  }))
  const canvas = canvasRef.current
  if (!canvas) throw new Error("GPU-IX did not mount the benchmark canvas")
  const context = canvas.getContext("webgpu")
  if (!context) throw new Error("GPU-IX did not provide a WebGPU canvas context")

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error("GPU-IX did not provide a WebGPU adapter")
  const device = await adapter.requestDevice()
  context.configure({ device, format: "bgra8unorm" })

  const result = await runWorkload({
    provider: "GPU-IX #525 (wgpu recorder and replay)",
    runtime: `Bun ${Bun.version}`,
    device,
    target: { acquireView: () => context.getCurrentTexture().createView() },
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  root.unmount()
}
