/** Browser-shaped state for GPU-IX's incremental native WebGPU implementation. */
export interface WebGpuCanvasTransport {
  presentWebGpuClear?(id: number, width: number, height: number, rgba: number): void
  createWebGpuDevice?(): number
  destroyWebGpuDevice?(deviceId: number): void
  createWebGpuShaderModule?(deviceId: number, label: string | undefined, code: string): number
  createWebGpuRenderPipeline?(
    deviceId: number,
    label: string | undefined,
    vertexModuleId: number,
    vertexEntryPoint: string | undefined,
    fragmentModuleId: number,
    fragmentEntryPoint: string | undefined
  ): number
  presentWebGpuCommands?(
    id: number,
    width: number,
    height: number,
    deviceId: number,
    rgba: number,
    ops: Uint32Array,
    operands: Float64Array
  ): void
}

export type GPUColor = { r?: number; g?: number; b?: number; a?: number }
export type GPUTextureFormat = "bgra8unorm"
export type GPUShaderModuleDescriptor = { label?: string; code: string }
export type GPUVertexState = {
  module: GPUShaderModule
  entryPoint?: string
  buffers?: readonly never[]
}
export type GPUFragmentState = {
  module: GPUShaderModule
  entryPoint?: string
  targets: readonly ({ format: GPUTextureFormat } | null)[]
}
export type GPURenderPipelineDescriptor = {
  label?: string
  layout?: "auto"
  vertex: GPUVertexState
  fragment: GPUFragmentState
  primitive?: {
    topology?: "triangle-list"
    frontFace?: "ccw"
    cullMode?: "none"
  }
  multisample?: { count?: 1; mask?: number; alphaToCoverageEnabled?: false }
}

type Configure = { device: GPUDevice; format: GPUTextureFormat }
type Attachment = {
  view: GPUTextureView
  clearValue?: GPUColor
  loadOp?: "clear"
  storeOp?: "store"
}
type DrawCommand = {
  pipeline: GPURenderPipeline
  vertexCount: number
  instanceCount: number
  firstVertex: number
  firstInstance: number
}
type RenderPassRecord = {
  view: GPUTextureView
  color: GPUColor
  commands: DrawCommand[]
  ended: boolean
}

// Keep these internal wire opcodes in sync with packages/native/src/webgpu_canvas.rs.
const WEB_GPU_SET_PIPELINE = 1
const WEB_GPU_DRAW = 2

function unsupported(message: string): DOMException {
  return new DOMException(message, "NotSupportedError")
}

function gpuSize32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`)
  }
  return value
}

export class GPUTextureView {
  constructor(readonly texture: GPUTexture, readonly generation: number) {}
}

export class GPUTexture {
  constructor(
    readonly context: GPUCanvasContext,
    readonly device: GPUDevice,
    readonly generation: number
  ) {}

  createView(): GPUTextureView {
    this.context.assertCurrent(this.generation)
    return new GPUTextureView(this, this.generation)
  }
}

export class GPUShaderModule {
  private nativeIdValue: number | null = null

  constructor(
    readonly device: GPUDevice,
    readonly descriptor: GPUShaderModuleDescriptor
  ) {}

  nativeId(): number {
    this.device.assertAlive()
    if (this.nativeIdValue !== null) return this.nativeIdValue
    const { transport, deviceId } = this.device.nativeBinding()
    if (!transport.createWebGpuShaderModule) {
      throw unsupported("Native WebGPU shader modules are unavailable")
    }
    this.nativeIdValue = transport.createWebGpuShaderModule(
      deviceId,
      this.descriptor.label,
      this.descriptor.code
    )
    return this.nativeIdValue
  }
}

export class GPURenderPipeline {
  private nativeIdValue: number | null = null

  constructor(
    readonly device: GPUDevice,
    readonly descriptor: GPURenderPipelineDescriptor
  ) {}

  nativeId(): number {
    this.device.assertAlive()
    if (this.nativeIdValue !== null) return this.nativeIdValue
    const { transport, deviceId } = this.device.nativeBinding()
    if (!transport.createWebGpuRenderPipeline) {
      throw unsupported("Native WebGPU render pipelines are unavailable")
    }
    this.nativeIdValue = transport.createWebGpuRenderPipeline(
      deviceId,
      this.descriptor.label,
      this.descriptor.vertex.module.nativeId(),
      this.descriptor.vertex.entryPoint,
      this.descriptor.fragment.module.nativeId(),
      this.descriptor.fragment.entryPoint
    )
    return this.nativeIdValue
  }
}

class GPUCommandBuffer {
  private submitted = false

  constructor(
    readonly device: GPUDevice,
    private readonly passes: readonly RenderPassRecord[]
  ) {}

  consume(device: GPUDevice): readonly RenderPassRecord[] {
    if (this.device !== device) throw new TypeError("Command buffer belongs to a different device")
    if (this.submitted) {
      throw new DOMException("The command buffer was already submitted", "InvalidStateError")
    }
    this.submitted = true
    return this.passes
  }
}

export class GPUCommandEncoder {
  private readonly passes: RenderPassRecord[] = []
  private activePass: GPURenderPassEncoder | null = null
  private finished = false

  constructor(private readonly device: GPUDevice) {}

  beginRenderPass(descriptor: {
    colorAttachments: readonly (Attachment | null)[]
  }): GPURenderPassEncoder {
    this.assertRecording()
    if (this.activePass) {
      throw new DOMException("A render pass is already active", "InvalidStateError")
    }
    const attachment = descriptor.colorAttachments[0]
    if (!attachment) throw new TypeError("A color attachment is required")
    if (attachment.loadOp !== undefined && attachment.loadOp !== "clear") {
      throw unsupported("Only clear render-pass loads are supported")
    }
    if (attachment.storeOp !== undefined && attachment.storeOp !== "store") {
      throw unsupported("Only stored color attachments are supported")
    }
    if (attachment.view.texture.device !== this.device) {
      throw new TypeError("Texture view belongs to a different device")
    }
    attachment.view.texture.context.assertCurrent(attachment.view.generation)

    const record: RenderPassRecord = {
      view: attachment.view,
      color: attachment.clearValue ?? { a: 1 },
      commands: [],
      ended: false,
    }
    const pass = new GPURenderPassEncoder(this, this.device, record)
    this.passes.push(record)
    this.activePass = pass
    return pass
  }

  finish(): GPUCommandBuffer {
    this.assertRecording()
    if (this.activePass) {
      throw new DOMException("The active render pass must be ended", "InvalidStateError")
    }
    this.finished = true
    return new GPUCommandBuffer(this.device, this.passes)
  }

  endPass(pass: GPURenderPassEncoder): void {
    if (this.activePass !== pass) {
      throw new DOMException("The render pass is not active", "InvalidStateError")
    }
    this.activePass = null
  }

  private assertRecording(): void {
    this.device.assertAlive()
    if (this.finished) {
      throw new DOMException("The command encoder is already finished", "InvalidStateError")
    }
  }
}

export class GPURenderPassEncoder {
  private pipeline: GPURenderPipeline | null = null

  constructor(
    private readonly encoder: GPUCommandEncoder,
    private readonly device: GPUDevice,
    private readonly record: RenderPassRecord
  ) {}

  setPipeline(pipeline: GPURenderPipeline): void {
    this.assertActive()
    if (!(pipeline instanceof GPURenderPipeline)) {
      throw new TypeError("setPipeline requires a GPURenderPipeline")
    }
    if (pipeline.device !== this.device) {
      throw new TypeError("Render pipeline belongs to a different device")
    }
    this.pipeline = pipeline
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.assertActive()
    if (!this.pipeline) {
      throw new DOMException("A render pipeline must be set before draw", "InvalidStateError")
    }
    this.record.commands.push({
      pipeline: this.pipeline,
      vertexCount: gpuSize32(vertexCount, "vertexCount"),
      instanceCount: gpuSize32(instanceCount, "instanceCount"),
      firstVertex: gpuSize32(firstVertex, "firstVertex"),
      firstInstance: gpuSize32(firstInstance, "firstInstance"),
    })
  }

  end(): void {
    this.assertActive()
    this.record.ended = true
    this.encoder.endPass(this)
  }

  private assertActive(): void {
    this.device.assertAlive()
    if (this.record.ended) {
      throw new DOMException("The render pass is already ended", "InvalidStateError")
    }
  }
}

export class GPUQueue {
  constructor(private readonly device: GPUDevice) {}

  submit(buffers: Iterable<GPUCommandBuffer>): void {
    this.device.assertAlive()
    for (const buffer of buffers) {
      if (!(buffer instanceof GPUCommandBuffer)) {
        throw new TypeError("queue.submit requires GPUCommandBuffer values")
      }
      for (const pass of buffer.consume(this.device)) {
        const context = pass.view.texture.context
        context.assertOwner(this.device)
        context.assertCurrent(pass.view.generation)
        context.present(this.device, pass.color, pass.commands)
      }
    }
  }
}

export class GPUDevice {
  readonly queue = new GPUQueue(this)
  private destroyed = false
  private transport: WebGpuCanvasTransport | null = null
  private nativeIdValue: number | null = null

  createCommandEncoder(): GPUCommandEncoder {
    this.assertAlive()
    return new GPUCommandEncoder(this)
  }

  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
    this.assertAlive()
    if (typeof descriptor.code !== "string") {
      throw new TypeError("createShaderModule requires WGSL source code")
    }
    const module = new GPUShaderModule(this, { label: descriptor.label, code: descriptor.code })
    if (this.transport) module.nativeId()
    return module
  }

  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    this.assertAlive()
    validateRenderPipelineDescriptor(this, descriptor)
    const pipeline = new GPURenderPipeline(this, descriptor)
    if (this.transport) pipeline.nativeId()
    return pipeline
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.nativeIdValue !== null) {
      this.transport?.destroyWebGpuDevice?.(this.nativeIdValue)
    }
  }

  bind(transport: WebGpuCanvasTransport): void {
    this.assertAlive()
    if (this.transport && this.transport !== transport) {
      throw new TypeError("GPUDevice is already bound to a different renderer")
    }
    this.transport = transport
  }

  nativeBinding(): { transport: WebGpuCanvasTransport; deviceId: number } {
    this.assertAlive()
    if (!this.transport) {
      throw new DOMException(
        "GPUDevice must configure a canvas before native resources are used",
        "InvalidStateError"
      )
    }
    if (this.nativeIdValue === null) {
      if (!this.transport.createWebGpuDevice) {
        throw unsupported("Native WebGPU shader pipelines are unavailable")
      }
      this.nativeIdValue = this.transport.createWebGpuDevice()
    }
    return { transport: this.transport, deviceId: this.nativeIdValue }
  }

  assertAlive(): void {
    if (this.destroyed) {
      throw new DOMException("The logical GPUDevice is destroyed", "InvalidStateError")
    }
  }
}

function validateRenderPipelineDescriptor(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor
): void {
  if (descriptor.layout !== undefined && descriptor.layout !== "auto") {
    throw unsupported("Only automatic pipeline layouts are supported")
  }
  if (!(descriptor.vertex?.module instanceof GPUShaderModule)) {
    throw new TypeError("A vertex shader module is required")
  }
  if (descriptor.vertex.module.device !== device) {
    throw new TypeError("Vertex shader module belongs to a different device")
  }
  if (descriptor.vertex.buffers && descriptor.vertex.buffers.length > 0) {
    throw unsupported("Vertex buffers are not supported yet")
  }
  if (!(descriptor.fragment?.module instanceof GPUShaderModule)) {
    throw new TypeError("A fragment shader module is required")
  }
  if (descriptor.fragment.module.device !== device) {
    throw new TypeError("Fragment shader module belongs to a different device")
  }
  if (
    descriptor.fragment.targets.length !== 1 ||
    descriptor.fragment.targets[0]?.format !== "bgra8unorm"
  ) {
    throw unsupported("Exactly one bgra8unorm color target is supported")
  }
  if (descriptor.primitive?.topology && descriptor.primitive.topology !== "triangle-list") {
    throw unsupported("Only triangle-list topology is supported")
  }
  if (descriptor.primitive?.frontFace && descriptor.primitive.frontFace !== "ccw") {
    throw unsupported("Only counter-clockwise front faces are supported")
  }
  if (descriptor.primitive?.cullMode && descriptor.primitive.cullMode !== "none") {
    throw unsupported("Face culling is not supported yet")
  }
  if (descriptor.multisample?.count !== undefined && descriptor.multisample.count !== 1) {
    throw unsupported("Multisampling is not supported yet")
  }
  if (descriptor.multisample?.alphaToCoverageEnabled) {
    throw unsupported("Alpha-to-coverage is not supported yet")
  }
}

export class GPUAdapter {
  async requestDevice(): Promise<GPUDevice> {
    return new GPUDevice()
  }
}

export class GPU {
  async requestAdapter(): Promise<GPUAdapter> {
    return new GPUAdapter()
  }
}

export class GPUCanvasContext {
  private configured: Configure | null = null
  private generation = 0
  private presented = false
  private disposed = false

  constructor(
    private readonly transport: WebGpuCanvasTransport,
    private readonly id: number,
    private readonly dimensions: () => { width: number; height: number }
  ) {}

  configure(configuration: Configure): void {
    if (this.disposed) throw new DOMException("The canvas is removed", "InvalidStateError")
    if (!(configuration.device instanceof GPUDevice)) {
      throw new TypeError("configure requires a GPUDevice")
    }
    configuration.device.assertAlive()
    if (configuration.format !== "bgra8unorm") {
      throw new TypeError("Only bgra8unorm is supported")
    }
    configuration.device.bind(this.transport)
    this.configured = configuration
    this.generation++
    this.presented = false
  }

  getCurrentTexture(): GPUTexture {
    if (!this.configured) {
      throw new DOMException("The context is not configured", "InvalidStateError")
    }
    this.configured.device.assertAlive()
    this.generation++
    this.presented = false
    return new GPUTexture(this, this.configured.device, this.generation)
  }

  assertOwner(device: GPUDevice): void {
    if (!this.configured || this.configured.device !== device) {
      throw new TypeError("Canvas context belongs to a different device")
    }
  }

  assertCurrent(generation: number): void {
    if (this.disposed || !this.configured || generation !== this.generation || this.presented) {
      throw new DOMException("The canvas texture is stale", "InvalidStateError")
    }
    this.configured.device.assertAlive()
  }

  present(device: GPUDevice, color: GPUColor, commands: readonly DrawCommand[]): void {
    const { width, height } = this.dimensions()
    const rgba = colorToRgba(color)
    if (commands.length === 0) {
      if (!this.transport.presentWebGpuClear) {
        throw unsupported("Native WebGPU canvas presentation is unavailable")
      }
      this.transport.presentWebGpuClear(this.id, width, height, rgba)
    } else {
      const { transport, deviceId } = device.nativeBinding()
      if (transport !== this.transport) {
        throw new TypeError("GPUDevice is bound to a different renderer")
      }
      if (!transport.presentWebGpuCommands) {
        throw unsupported("Native WebGPU draw commands are unavailable")
      }
      const ops: number[] = []
      const operands: number[] = []
      for (const command of commands) {
        ops.push(WEB_GPU_SET_PIPELINE)
        operands.push(command.pipeline.nativeId())
        ops.push(WEB_GPU_DRAW)
        operands.push(
          command.vertexCount,
          command.instanceCount,
          command.firstVertex,
          command.firstInstance
        )
      }
      transport.presentWebGpuCommands(
        this.id,
        width,
        height,
        deviceId,
        rgba,
        Uint32Array.from(ops),
        Float64Array.from(operands)
      )
    }
    this.presented = true
  }

  dispose(): void {
    this.disposed = true
    this.generation++
  }
}

const contexts = new WeakMap<object, GPUCanvasContext>()

export function getOrCreateWebGpuContext(
  owner: object,
  transport: WebGpuCanvasTransport,
  id: number,
  dimensions: () => { width: number; height: number }
): GPUCanvasContext | null {
  if (!transport.presentWebGpuClear) return null
  let context = contexts.get(owner)
  if (!context) {
    context = new GPUCanvasContext(transport, id, dimensions)
    contexts.set(owner, context)
  }
  return context
}

export function webGpuContext(owner: object): GPUCanvasContext | undefined {
  return contexts.get(owner)
}

export function disposeWebGpuContext(owner: object): void {
  contexts.get(owner)?.dispose()
  contexts.delete(owner)
}

export function installWebGpuGlobal(): void {
  let navigatorValue: object | undefined
  try {
    navigatorValue = Reflect.get(globalThis, "navigator") as object | undefined
  } catch {
    return
  }
  if (navigatorValue && !Reflect.has(navigatorValue, "gpu")) {
    Object.defineProperty(navigatorValue, "gpu", { configurable: true, value: new GPU() })
  }
}

function colorToRgba(color: GPUColor): number {
  const channel = (value: number | undefined, fallback: number) =>
    Math.round(Math.max(0, Math.min(1, value ?? fallback)) * 255)
  return (
    ((channel(color.r, 0) << 24) |
      (channel(color.g, 0) << 16) |
      (channel(color.b, 0) << 8) |
      channel(color.a, 1)) >>>
    0
  )
}
