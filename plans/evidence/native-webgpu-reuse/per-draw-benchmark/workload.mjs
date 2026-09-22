const DRAW_COUNTS = (process.env.PER_DRAW_COUNTS ?? "100,1000,10000,50000,100000")
  .split(",")
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0)
if (DRAW_COUNTS.length === 0) throw new Error("PER_DRAW_COUNTS must contain positive integers")
const WARMUP_FRAMES = 50
const MEASURED_FRAMES = 300
const LARGE_WORKLOAD_MEASURED_FRAMES = 100

function measuredFramesFor(draws) {
  return draws >= 50_000 ? LARGE_WORKLOAD_MEASURED_FRAMES : MEASURED_FRAMES
}

const WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertex_main(@location(0) position: vec2f) -> VertexOutput {
  return VertexOutput(vec4f(position, 0.0, 1.0));
}

@fragment
fn fragment_main() -> @location(0) vec4f {
  return vec4f(0.2, 0.7, 1.0, 1.0);
}
`

function elapsedNanoseconds(start) {
  return Number(process.hrtime.bigint() - start)
}

function percentile(samples, fraction) {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.ceil(ordered.length * fraction) - 1]
}

function summary(samples) {
  return {
    medianNs: percentile(samples, 0.5),
    p95Ns: percentile(samples, 0.95),
  }
}

export function createResources(device) {
  const shader = device.createShaderModule({ code: WGSL })
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vertex_main",
      buffers: [{
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
      }],
    },
    fragment: {
      module: shader,
      entryPoint: "fragment_main",
      targets: [{ format: "bgra8unorm" }],
    },
  })
  const vertexBuffer = device.createBuffer({
    size: 24,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  })
  new Float32Array(vertexBuffer.getMappedRange()).set([
    0, 0.5,
    -0.5, -0.5,
    0.5, -0.5,
  ])
  vertexBuffer.unmap()
  const indexBuffer = device.createBuffer({
    // WebGPU requires mapped-at-creation buffers to have a four-byte-aligned
    // size. The first three uint16 entries form the indexed triangle.
    size: 8,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  })
  new Uint16Array(indexBuffer.getMappedRange()).set([0, 1, 2])
  indexBuffer.unmap()
  return { pipeline, vertexBuffer, indexBuffer }
}

async function frame(device, resources, target, draws, measureGpuCompletion) {
  const encoder = device.createCommandEncoder()
  const view = target.acquireView()

  const encodeStarted = process.hrtime.bigint()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  })
  pass.setPipeline(resources.pipeline)
  for (let index = 0; index < draws; index++) {
    pass.setVertexBuffer(0, resources.vertexBuffer)
    pass.setIndexBuffer(resources.indexBuffer, "uint16")
    pass.drawIndexed(3)
  }
  pass.end()
  const encodeNs = elapsedNanoseconds(encodeStarted)

  const submitStarted = process.hrtime.bigint()
  const commandBuffer = encoder.finish()
  device.queue.submit([commandBuffer])
  const finishSubmitNs = elapsedNanoseconds(submitStarted)

  let gpuCompleteNs = null
  if (measureGpuCompletion) {
    await device.queue.onSubmittedWorkDone()
    gpuCompleteNs = elapsedNanoseconds(submitStarted)
  }
  return { encodeNs, finishSubmitNs, gpuCompleteNs }
}

/**
 * Run the shared WebGPU calls. Providers may only differ in `target`: GPU-IX
 * acquires a canvas texture and Dawn returns an off-screen texture view.
 */
export async function runWorkload({ provider, runtime, device, target, resources = createResources(device) }) {
  const supportsGpuCompletion = typeof device.queue.onSubmittedWorkDone === "function"
  const measurements = []

  for (const draws of DRAW_COUNTS) {
    const measuredFrames = measuredFramesFor(draws)
    for (let frameIndex = 0; frameIndex < WARMUP_FRAMES; frameIndex++) {
      await frame(device, resources, target, draws, supportsGpuCompletion)
    }

    const encode = []
    const finishSubmit = []
    const gpuComplete = []
    for (let frameIndex = 0; frameIndex < measuredFrames; frameIndex++) {
      const result = await frame(device, resources, target, draws, supportsGpuCompletion)
      encode.push(result.encodeNs)
      finishSubmit.push(result.finishSubmitNs)
      if (result.gpuCompleteNs !== null) gpuComplete.push(result.gpuCompleteNs)
    }
    measurements.push({
      draws,
      measuredFrames,
      encode: summary(encode),
      finishSubmit: summary(finishSubmit),
      gpuComplete: gpuComplete.length === 0 ? null : summary(gpuComplete),
    })
  }

  return {
    provider,
    runtime,
    workload: {
      target: "256x256 bgra8unorm",
      warmupFrames: WARMUP_FRAMES,
      measuredFrames: `300 through 10,000 draws; ${LARGE_WORKLOAD_MEASURED_FRAMES} at 50,000 and 100,000 draws`,
      draws: DRAW_COUNTS,
      commands: "setPipeline once; setVertexBuffer + setIndexBuffer + drawIndexed repeated",
      gpuCompleteTiming: supportsGpuCompletion
        ? "submit invocation until queue.onSubmittedWorkDone() resolves; one frame is completed before the next"
        : "unsupported by this provider",
    },
    measurements,
  }
}
