import React from "react"

import "../../../../packages/react/src/globals.ts"
import { createTestRoot } from "../../../../packages/react/src/testing.ts"
import { createResources, runWorkload } from "./workload.mjs"

const root = createTestRoot({ width: 256, height: 256, scaleFactor: 1 })
const canvasRef = React.createRef()
const trialCount = Number(process.env.PER_DRAW_TRIALS ?? "1")
if (!Number.isInteger(trialCount) || trialCount < 1) {
  throw new Error("PER_DRAW_TRIALS must be a positive integer")
}

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
  const resources = createResources(device)

  const trials = []
  for (let trial = 0; trial < trialCount; trial++) {
    trials.push(await runWorkload({
      provider: "GPU-IX #525 (wgpu recorder and replay)",
      runtime: `Bun ${Bun.version}`,
      device,
      resources,
      target: { acquireView: () => context.getCurrentTexture().createView() },
    }))
  }
  console.log(JSON.stringify(trialCount === 1 ? trials[0] : { trials }, null, 2))
} finally {
  root.unmount()
}
