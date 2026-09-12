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
    fragmentEntryPoint: string | undefined,
    vertexBuffers: string
  ): number
  createWebGpuBuffer?(
    deviceId: number,
    label: string | undefined,
    size: number,
    usage: number,
    initialData: Uint8Array
  ): number
  destroyWebGpuBuffer?(deviceId: number, bufferId: number): void
  writeWebGpuBuffer?(
    deviceId: number,
    bufferId: number,
    offset: number,
    data: Uint8Array
  ): void
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
export const GPUBufferUsage = Object.freeze({
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
})
export type GPUBufferUsageFlags = number
export type GPUBufferDescriptor = {
  label?: string
  size: number
  usage: GPUBufferUsageFlags
  mappedAtCreation?: boolean
}
export type GPUVertexFormat =
  | "uint8x2"
  | "uint8x4"
  | "sint8x2"
  | "sint8x4"
  | "unorm8x2"
  | "unorm8x4"
  | "snorm8x2"
  | "snorm8x4"
  | "uint16x2"
  | "uint16x4"
  | "sint16x2"
  | "sint16x4"
  | "unorm16x2"
  | "unorm16x4"
  | "snorm16x2"
  | "snorm16x4"
  | "float16x2"
  | "float16x4"
  | "float32"
  | "float32x2"
  | "float32x3"
  | "float32x4"
  | "uint32"
  | "uint32x2"
  | "uint32x3"
  | "uint32x4"
  | "sint32"
  | "sint32x2"
  | "sint32x3"
  | "sint32x4"
  | "unorm10-10-10-2"
export type GPUVertexAttribute = {
  format: GPUVertexFormat
  offset: number
  shaderLocation: number
}
export type GPUVertexBufferLayout = {
  arrayStride: number
  stepMode?: "vertex" | "instance"
  attributes: readonly GPUVertexAttribute[]
}
export type GPUVertexState = {
  module: GPUShaderModule
  entryPoint?: string
  buffers?: readonly GPUVertexBufferLayout[]
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
type SetPipelineCommand = {
  kind: "setPipeline"
  pipeline: GPURenderPipeline
}
type SetVertexBufferCommand = {
  kind: "setVertexBuffer"
  slot: number
  buffer: GPUBuffer
  offset: number
  size: number
}
type SetIndexBufferCommand = {
  kind: "setIndexBuffer"
  buffer: GPUBuffer
  indexFormat: "uint16" | "uint32"
  offset: number
  size: number
}
type DrawCommand = {
  kind: "draw"
  vertexCount: number
  instanceCount: number
  firstVertex: number
  firstInstance: number
}
type DrawIndexedCommand = {
  kind: "drawIndexed"
  indexCount: number
  instanceCount: number
  firstIndex: number
  baseVertex: number
  firstInstance: number
}
type RenderCommand =
  | SetPipelineCommand
  | SetVertexBufferCommand
  | SetIndexBufferCommand
  | DrawCommand
  | DrawIndexedCommand
type RenderPassRecord = {
  view: GPUTextureView
  color: GPUColor
  commands: RenderCommand[]
  ended: boolean
}

// Keep these internal wire opcodes in sync with packages/native/src/webgpu_canvas.rs.
const WEB_GPU_SET_PIPELINE = 1
const WEB_GPU_DRAW = 2
const WEB_GPU_SET_VERTEX_BUFFER = 3
const WEB_GPU_SET_INDEX_BUFFER = 4
const WEB_GPU_DRAW_INDEXED = 5

const WEB_GPU_BUFFER_USAGE_MASK = 0x03ff
const MAX_SAFE_GPU_SIZE = Number.MAX_SAFE_INTEGER

function unsupported(message: string): DOMException {
  return new DOMException(message, "NotSupportedError")
}

function gpuSize32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`)
  }
  return value
}

function gpuSize64(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_GPU_SIZE) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function gpuSigned32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new RangeError(`${name} must be a signed 32-bit integer`)
  }
  return value
}

function operationError(message: string): DOMException {
  return new DOMException(message, "OperationError")
}

function detachArrayBuffer(buffer: ArrayBuffer): void {
  structuredClone(buffer, { transfer: [buffer] })
}

function copyBufferSource(
  data: ArrayBuffer | ArrayBufferView,
  dataOffset = 0,
  size?: number
): Uint8Array {
  const isArrayBuffer = data instanceof ArrayBuffer
  const view = isArrayBuffer ? null : data
  if (!isArrayBuffer && !ArrayBuffer.isView(data)) {
    throw new TypeError("writeBuffer data must be an ArrayBuffer or ArrayBufferView")
  }
  const bytesPerElement =
    view && !(view instanceof DataView)
      ? Number((view as ArrayBufferView & { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1)
      : 1
  const byteLength = isArrayBuffer ? data.byteLength : view!.byteLength
  const elementLength = byteLength / bytesPerElement
  const sourceOffset = gpuSize64(dataOffset, "dataOffset")
  const sourceSize = size === undefined ? elementLength - sourceOffset : gpuSize64(size, "size")
  if (sourceOffset > elementLength || sourceSize < 0 || sourceOffset + sourceSize > elementLength) {
    throw operationError("writeBuffer source range exceeds the supplied data")
  }
  const copyByteLength = sourceSize * bytesPerElement
  if (copyByteLength % 4 !== 0) {
    throw operationError("writeBuffer size must be a multiple of 4 bytes")
  }
  const buffer = isArrayBuffer ? data : view!.buffer
  const byteOffset = (isArrayBuffer ? 0 : view!.byteOffset) + sourceOffset * bytesPerElement
  return new Uint8Array(buffer, byteOffset, copyByteLength).slice()
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

type MappedRange = { offset: number; data: ArrayBuffer }
type PendingBufferWrite = { offset: number; data: Uint8Array }

export class GPUBuffer {
  readonly size: number
  readonly usage: GPUBufferUsageFlags
  private nativeIdValue: number | null = null
  private destroyed = false
  private mapStateValue: "mapped" | "unmapped"
  private mappedRanges: MappedRange[] = []
  private initialData: Uint8Array | null = null
  private pendingWrites: PendingBufferWrite[] = []

  constructor(
    readonly device: GPUDevice,
    readonly descriptor: GPUBufferDescriptor
  ) {
    this.size = descriptor.size
    this.usage = descriptor.usage
    this.mapStateValue = descriptor.mappedAtCreation ? "mapped" : "unmapped"
  }

  get mapState(): "mapped" | "unmapped" {
    return this.mapStateValue
  }

  getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
    this.assertUsable()
    if (this.mapStateValue !== "mapped") {
      throw new DOMException("The GPUBuffer is not mapped", "InvalidStateError")
    }
    const rangeOffset = gpuSize64(offset, "offset")
    const rangeSize = gpuSize64(size, "size")
    if (rangeOffset % 8 !== 0) throw operationError("Mapped range offset must be a multiple of 8")
    if (rangeSize % 4 !== 0) throw operationError("Mapped range size must be a multiple of 4")
    if (rangeOffset + rangeSize > this.size) {
      throw operationError("Mapped range exceeds the GPUBuffer")
    }
    if (
      this.mappedRanges.some(
        (range) => rangeOffset < range.offset + range.data.byteLength && range.offset < rangeOffset + rangeSize
      )
    ) {
      throw operationError("Mapped ranges must not overlap")
    }
    const data = new ArrayBuffer(rangeSize)
    this.mappedRanges.push({ offset: rangeOffset, data })
    return data
  }

  unmap(): void {
    this.assertUsable()
    if (this.mapStateValue !== "mapped") return
    const initialData = new Uint8Array(this.size)
    for (const range of this.mappedRanges) {
      initialData.set(new Uint8Array(range.data), range.offset)
    }
    for (const range of this.mappedRanges) detachArrayBuffer(range.data)
    this.mappedRanges = []
    this.initialData = initialData
    this.mapStateValue = "unmapped"
    if (this.device.isBound()) this.nativeId()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.device.forgetBuffer(this)
    this.detachMappedRanges()
    this.initialData = null
    this.pendingWrites = []
    if (this.nativeIdValue !== null) {
      const binding = this.device.nativeBindingIfAlive()
      binding?.transport.destroyWebGpuBuffer?.(binding.deviceId, this.nativeIdValue)
    }
  }

  nativeId(): number {
    this.assertUsable()
    if (this.mapStateValue === "mapped") {
      throw new DOMException("A mapped GPUBuffer cannot be used by the GPU", "InvalidStateError")
    }
    if (this.nativeIdValue !== null) return this.nativeIdValue
    const { transport, deviceId } = this.device.nativeBinding()
    if (!transport.createWebGpuBuffer) {
      throw unsupported("Native WebGPU buffers are unavailable")
    }
    const initialData = this.initialData ?? new Uint8Array()
    this.nativeIdValue = transport.createWebGpuBuffer(
      deviceId,
      this.descriptor.label,
      this.size,
      this.usage,
      initialData
    )
    this.initialData = null
    if (this.pendingWrites.length > 0) {
      if (!transport.writeWebGpuBuffer) {
        throw unsupported("Native WebGPU buffer writes are unavailable")
      }
      for (const write of this.pendingWrites) {
        transport.writeWebGpuBuffer(deviceId, this.nativeIdValue, write.offset, write.data)
      }
      this.pendingWrites = []
    }
    return this.nativeIdValue
  }

  write(offset: number, data: Uint8Array): void {
    this.assertUsable()
    if (this.mapStateValue === "mapped") {
      throw new DOMException("A mapped GPUBuffer cannot be written by the queue", "InvalidStateError")
    }
    if ((this.usage & GPUBufferUsage.COPY_DST) === 0) {
      throw operationError("GPUBuffer usage must include COPY_DST for writeBuffer")
    }
    const bufferOffset = gpuSize64(offset, "bufferOffset")
    if (bufferOffset % 4 !== 0) {
      throw operationError("writeBuffer bufferOffset must be a multiple of 4")
    }
    if (bufferOffset + data.byteLength > this.size) {
      throw operationError("writeBuffer destination range exceeds the GPUBuffer")
    }
    if (!this.device.isBound()) {
      this.pendingWrites.push({ offset: bufferOffset, data })
      return
    }
    const { transport, deviceId } = this.device.nativeBinding()
    if (!transport.writeWebGpuBuffer) {
      throw unsupported("Native WebGPU buffer writes are unavailable")
    }
    transport.writeWebGpuBuffer(deviceId, this.nativeId(), bufferOffset, data)
  }

  destroyFromDevice(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.detachMappedRanges()
    this.initialData = null
    this.pendingWrites = []
  }

  private assertUsable(): void {
    this.device.assertAlive()
    if (this.destroyed) {
      throw new DOMException("The GPUBuffer is destroyed", "InvalidStateError")
    }
  }

  private detachMappedRanges(): void {
    for (const range of this.mappedRanges) detachArrayBuffer(range.data)
    this.mappedRanges = []
    this.mapStateValue = "unmapped"
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
      this.descriptor.fragment.entryPoint,
      JSON.stringify(normalizeVertexBuffers(this.descriptor.vertex.buffers))
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
  private indexBuffer: GPUBuffer | null = null

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
    this.record.commands.push({ kind: "setPipeline", pipeline })
  }

  setVertexBuffer(slot: number, buffer: GPUBuffer, offset = 0, size?: number): void {
    this.assertActive()
    if (!(buffer instanceof GPUBuffer)) throw new TypeError("setVertexBuffer requires a GPUBuffer")
    if (buffer.device !== this.device) {
      throw new TypeError("Vertex buffer belongs to a different device")
    }
    if ((buffer.usage & GPUBufferUsage.VERTEX) === 0) {
      throw operationError("GPUBuffer usage must include VERTEX")
    }
    const bufferOffset = gpuSize64(offset, "offset")
    const bufferSize = size === undefined ? buffer.size - bufferOffset : gpuSize64(size, "size")
    if (bufferOffset > buffer.size || bufferSize < 0 || bufferOffset + bufferSize > buffer.size) {
      throw operationError("Vertex buffer binding exceeds the GPUBuffer")
    }
    this.record.commands.push({
      kind: "setVertexBuffer",
      slot: gpuSize32(slot, "slot"),
      buffer,
      offset: bufferOffset,
      size: bufferSize,
    })
  }

  setIndexBuffer(
    buffer: GPUBuffer,
    indexFormat: "uint16" | "uint32",
    offset = 0,
    size?: number
  ): void {
    this.assertActive()
    if (!(buffer instanceof GPUBuffer)) throw new TypeError("setIndexBuffer requires a GPUBuffer")
    if (buffer.device !== this.device) {
      throw new TypeError("Index buffer belongs to a different device")
    }
    if ((buffer.usage & GPUBufferUsage.INDEX) === 0) {
      throw operationError("GPUBuffer usage must include INDEX")
    }
    if (indexFormat !== "uint16" && indexFormat !== "uint32") {
      throw new TypeError("Index format must be uint16 or uint32")
    }
    const bufferOffset = gpuSize64(offset, "offset")
    const bufferSize = size === undefined ? buffer.size - bufferOffset : gpuSize64(size, "size")
    if (bufferOffset > buffer.size || bufferSize < 0 || bufferOffset + bufferSize > buffer.size) {
      throw operationError("Index buffer binding exceeds the GPUBuffer")
    }
    const alignment = indexFormat === "uint16" ? 2 : 4
    if (bufferOffset % alignment !== 0 || bufferSize % alignment !== 0) {
      throw operationError(`Index buffer offset and size must align to ${alignment} bytes`)
    }
    this.indexBuffer = buffer
    this.record.commands.push({
      kind: "setIndexBuffer",
      buffer,
      indexFormat,
      offset: bufferOffset,
      size: bufferSize,
    })
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.assertActive()
    if (!this.pipeline) {
      throw new DOMException("A render pipeline must be set before draw", "InvalidStateError")
    }
    this.record.commands.push({
      kind: "draw",
      vertexCount: gpuSize32(vertexCount, "vertexCount"),
      instanceCount: gpuSize32(instanceCount, "instanceCount"),
      firstVertex: gpuSize32(firstVertex, "firstVertex"),
      firstInstance: gpuSize32(firstInstance, "firstInstance"),
    })
  }

  drawIndexed(
    indexCount: number,
    instanceCount = 1,
    firstIndex = 0,
    baseVertex = 0,
    firstInstance = 0
  ): void {
    this.assertActive()
    if (!this.pipeline) {
      throw new DOMException("A render pipeline must be set before drawIndexed", "InvalidStateError")
    }
    if (!this.indexBuffer) {
      throw new DOMException("An index buffer must be set before drawIndexed", "InvalidStateError")
    }
    this.record.commands.push({
      kind: "drawIndexed",
      indexCount: gpuSize32(indexCount, "indexCount"),
      instanceCount: gpuSize32(instanceCount, "instanceCount"),
      firstIndex: gpuSize32(firstIndex, "firstIndex"),
      baseVertex: gpuSigned32(baseVertex, "baseVertex"),
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

  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset = 0,
    size?: number
  ): void {
    this.device.assertAlive()
    if (!(buffer instanceof GPUBuffer)) throw new TypeError("writeBuffer requires a GPUBuffer")
    if (buffer.device !== this.device) {
      throw new TypeError("GPUBuffer belongs to a different device")
    }
    buffer.write(bufferOffset, copyBufferSource(data, dataOffset, size))
  }

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
  private readonly buffers = new Set<GPUBuffer>()

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

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    this.assertAlive()
    validateBufferDescriptor(descriptor)
    const buffer = new GPUBuffer(this, {
      label: descriptor.label,
      size: descriptor.size,
      usage: descriptor.usage,
      mappedAtCreation: descriptor.mappedAtCreation ?? false,
    })
    this.buffers.add(buffer)
    if (this.transport && !descriptor.mappedAtCreation) buffer.nativeId()
    return buffer
  }

  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    this.assertAlive()
    const snapshot = snapshotRenderPipelineDescriptor(descriptor)
    validateRenderPipelineDescriptor(this, snapshot)
    const pipeline = new GPURenderPipeline(this, snapshot)
    if (this.transport) pipeline.nativeId()
    return pipeline
  }

  destroy(): void {
    if (this.destroyed) return
    for (const buffer of this.buffers) buffer.destroyFromDevice()
    this.buffers.clear()
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

  nativeBindingIfAlive(): { transport: WebGpuCanvasTransport; deviceId: number } | null {
    if (this.destroyed || !this.transport || this.nativeIdValue === null) return null
    return { transport: this.transport, deviceId: this.nativeIdValue }
  }

  isBound(): boolean {
    return this.transport !== null
  }

  forgetBuffer(buffer: GPUBuffer): void {
    this.buffers.delete(buffer)
  }

  assertAlive(): void {
    if (this.destroyed) {
      throw new DOMException("The logical GPUDevice is destroyed", "InvalidStateError")
    }
  }
}

const vertexFormatSizes: Readonly<Record<GPUVertexFormat, number>> = {
  uint8x2: 2,
  uint8x4: 4,
  sint8x2: 2,
  sint8x4: 4,
  unorm8x2: 2,
  unorm8x4: 4,
  snorm8x2: 2,
  snorm8x4: 4,
  uint16x2: 4,
  uint16x4: 8,
  sint16x2: 4,
  sint16x4: 8,
  unorm16x2: 4,
  unorm16x4: 8,
  snorm16x2: 4,
  snorm16x4: 8,
  float16x2: 4,
  float16x4: 8,
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x2: 8,
  uint32x3: 12,
  uint32x4: 16,
  sint32: 4,
  sint32x2: 8,
  sint32x3: 12,
  sint32x4: 16,
  "unorm10-10-10-2": 4,
}

function validateBufferDescriptor(descriptor: GPUBufferDescriptor): void {
  const size = gpuSize64(descriptor.size, "GPUBuffer size")
  const usage = gpuSize32(descriptor.usage, "GPUBuffer usage")
  if (usage === 0 || (usage & ~WEB_GPU_BUFFER_USAGE_MASK) !== 0) {
    throw new TypeError("GPUBuffer usage must contain only supported WebGPU usage flags")
  }
  if ((usage & GPUBufferUsage.MAP_READ) !== 0 && (usage & ~(
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  )) !== 0) {
    throw new TypeError("MAP_READ may only be combined with COPY_DST")
  }
  if ((usage & GPUBufferUsage.MAP_WRITE) !== 0 && (usage & ~(
    GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
  )) !== 0) {
    throw new TypeError("MAP_WRITE may only be combined with COPY_SRC")
  }
  if (descriptor.mappedAtCreation && size % 4 !== 0) {
    throw operationError("A buffer mapped at creation must have a size that is a multiple of 4")
  }
}

function normalizeVertexBuffers(
  buffers: readonly GPUVertexBufferLayout[] | undefined
): Array<{
  arrayStride: number
  stepMode: "vertex" | "instance"
  attributes: Array<GPUVertexAttribute>
}> {
  return (buffers ?? []).map((buffer) => ({
    arrayStride: buffer.arrayStride,
    stepMode: buffer.stepMode ?? "vertex",
    attributes: buffer.attributes.map((attribute) => ({ ...attribute })),
  }))
}

function snapshotRenderPipelineDescriptor(
  descriptor: GPURenderPipelineDescriptor
): GPURenderPipelineDescriptor {
  return {
    label: descriptor.label,
    layout: descriptor.layout,
    vertex: {
      module: descriptor.vertex.module,
      entryPoint: descriptor.vertex.entryPoint,
      buffers: normalizeVertexBuffers(descriptor.vertex.buffers),
    },
    fragment: {
      module: descriptor.fragment.module,
      entryPoint: descriptor.fragment.entryPoint,
      targets: descriptor.fragment.targets.map((target) => target && { format: target.format }),
    },
    primitive: descriptor.primitive && { ...descriptor.primitive },
    multisample: descriptor.multisample && { ...descriptor.multisample },
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
  const shaderLocations = new Set<number>()
  for (const buffer of descriptor.vertex.buffers ?? []) {
    const arrayStride = gpuSize64(buffer.arrayStride, "arrayStride")
    if (arrayStride === 0 || arrayStride > 2048 || arrayStride % 4 !== 0) {
      throw operationError("Vertex buffer arrayStride must be a non-zero multiple of 4 up to 2048")
    }
    if (buffer.stepMode !== undefined && buffer.stepMode !== "vertex" && buffer.stepMode !== "instance") {
      throw new TypeError("Vertex buffer stepMode must be vertex or instance")
    }
    for (const attribute of buffer.attributes) {
      const shaderLocation = gpuSize32(attribute.shaderLocation, "shaderLocation")
      if (shaderLocations.has(shaderLocation)) {
        throw operationError(`Vertex shader location ${shaderLocation} is used more than once`)
      }
      shaderLocations.add(shaderLocation)
      const offset = gpuSize64(attribute.offset, "vertex attribute offset")
      const formatSize = vertexFormatSizes[attribute.format]
      if (formatSize === undefined) {
        throw new TypeError(`Unsupported vertex format: ${String(attribute.format)}`)
      }
      if (offset + formatSize > arrayStride) {
        throw operationError("Vertex attribute exceeds its buffer arrayStride")
      }
    }
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

  present(device: GPUDevice, color: GPUColor, commands: readonly RenderCommand[]): void {
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
        switch (command.kind) {
          case "setPipeline":
            ops.push(WEB_GPU_SET_PIPELINE)
            operands.push(command.pipeline.nativeId())
            break
          case "setVertexBuffer":
            ops.push(WEB_GPU_SET_VERTEX_BUFFER)
            operands.push(
              command.slot,
              command.buffer.nativeId(),
              command.offset,
              command.size
            )
            break
          case "setIndexBuffer":
            ops.push(WEB_GPU_SET_INDEX_BUFFER)
            operands.push(
              command.buffer.nativeId(),
              command.indexFormat === "uint16" ? 0 : 1,
              command.offset,
              command.size
            )
            break
          case "draw":
            ops.push(WEB_GPU_DRAW)
            operands.push(
              command.vertexCount,
              command.instanceCount,
              command.firstVertex,
              command.firstInstance
            )
            break
          case "drawIndexed":
            ops.push(WEB_GPU_DRAW_INDEXED)
            operands.push(
              command.indexCount,
              command.instanceCount,
              command.firstIndex,
              command.baseVertex,
              command.firstInstance
            )
            break
        }
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
  if (!Reflect.has(globalThis, "GPUBufferUsage")) {
    Object.defineProperty(globalThis, "GPUBufferUsage", {
      configurable: true,
      value: GPUBufferUsage,
    })
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
