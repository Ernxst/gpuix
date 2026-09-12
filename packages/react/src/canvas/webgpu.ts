/** Narrow browser-shaped state for the native WebGPU clear-and-present proof. */
export interface WebGpuCanvasTransport {
  presentWebGpuClear?(id: number, width: number, height: number, rgba: number): void
}

export type GPUColor = { r?: number; g?: number; b?: number; a?: number }
type Configure = { device: GPUDevice; format: "bgra8unorm" }
type Attachment = { view: GPUTextureView; clearValue?: GPUColor }

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

class GPUCommandBuffer {
  constructor(readonly device: GPUDevice, readonly view: GPUTextureView | null, readonly color: GPUColor) {}
}

export class GPUCommandEncoder {
  private view: GPUTextureView | null = null
  private color: GPUColor = { a: 1 }
  private finished = false
  constructor(private readonly device: GPUDevice) {}
  beginRenderPass(descriptor: { colorAttachments: readonly (Attachment | null)[] }): GPURenderPassEncoder {
    if (this.finished) throw new DOMException("The command encoder is already finished", "InvalidStateError")
    const attachment = descriptor.colorAttachments[0]
    if (!attachment) throw new TypeError("A color attachment is required")
    if (attachment.view.texture.device !== this.device) {
      throw new TypeError("Texture view belongs to a different device")
    }
    attachment.view.texture.context.assertCurrent(attachment.view.generation)
    this.view = attachment.view
    this.color = attachment.clearValue ?? { a: 1 }
    return new GPURenderPassEncoder()
  }
  finish(): GPUCommandBuffer {
    if (this.finished) throw new DOMException("The command encoder is already finished", "InvalidStateError")
    this.finished = true
    return new GPUCommandBuffer(this.device, this.view, this.color)
  }
}

export class GPURenderPassEncoder {
  private ended = false
  end(): void {
    if (this.ended) throw new DOMException("The render pass is already ended", "InvalidStateError")
    this.ended = true
  }
}

export class GPUQueue {
  constructor(private readonly device: GPUDevice) {}
  submit(buffers: Iterable<GPUCommandBuffer>): void {
    this.device.assertAlive()
    for (const buffer of buffers) {
      if (buffer.device !== this.device) throw new TypeError("Command buffer belongs to a different device")
      if (!buffer.view) continue
      const context = buffer.view.texture.context
      context.assertOwner(this.device)
      context.assertCurrent(buffer.view.generation)
      context.present(colorToRgba(buffer.color))
    }
  }
}

export class GPUDevice {
  readonly queue = new GPUQueue(this)
  private destroyed = false
  createCommandEncoder(): GPUCommandEncoder { this.assertAlive(); return new GPUCommandEncoder(this) }
  destroy(): void { this.destroyed = true }
  assertAlive(): void {
    if (this.destroyed) throw new DOMException("The logical GPUDevice is destroyed", "InvalidStateError")
  }
}

export class GPUAdapter { async requestDevice(): Promise<GPUDevice> { return new GPUDevice() } }
export class GPU { async requestAdapter(): Promise<GPUAdapter> { return new GPUAdapter() } }

export class GPUCanvasContext {
  private configured: Configure | null = null
  private generation = 0
  private presented = false
  private disposed = false
  constructor(private readonly transport: WebGpuCanvasTransport, private readonly id: number, private readonly dimensions: () => { width: number; height: number }) {}
  configure(configuration: Configure): void {
    if (this.disposed) throw new DOMException("The canvas is removed", "InvalidStateError")
    if (!(configuration.device instanceof GPUDevice)) throw new TypeError("configure requires a GPUDevice")
    configuration.device.assertAlive()
    if (configuration.format !== "bgra8unorm") throw new TypeError("Only bgra8unorm is supported")
    this.configured = configuration; this.generation++; this.presented = false
  }
  getCurrentTexture(): GPUTexture {
    if (!this.configured) throw new DOMException("The context is not configured", "InvalidStateError")
    this.configured.device.assertAlive(); this.generation++; this.presented = false
    return new GPUTexture(this, this.configured.device, this.generation)
  }
  assertOwner(device: GPUDevice): void {
    if (!this.configured || this.configured.device !== device) {
      throw new TypeError("Canvas context belongs to a different device")
    }
  }
  assertCurrent(generation: number): void {
    if (this.disposed || !this.configured || generation !== this.generation || this.presented) throw new DOMException("The canvas texture is stale", "InvalidStateError")
    this.configured.device.assertAlive()
  }
  present(rgba: number): void {
    if (!this.transport.presentWebGpuClear) throw new DOMException("Native WebGPU is unavailable", "NotSupportedError")
    const { width, height } = this.dimensions()
    this.transport.presentWebGpuClear(this.id, width, height, rgba)
    this.presented = true
  }
  dispose(): void { this.disposed = true; this.generation++ }
}

const contexts = new WeakMap<object, GPUCanvasContext>()
export function getOrCreateWebGpuContext(owner: object, transport: WebGpuCanvasTransport, id: number, dimensions: () => { width: number; height: number }): GPUCanvasContext | null {
  if (!transport.presentWebGpuClear) return null
  let context = contexts.get(owner)
  if (!context) { context = new GPUCanvasContext(transport, id, dimensions); contexts.set(owner, context) }
  return context
}
export function webGpuContext(owner: object): GPUCanvasContext | undefined { return contexts.get(owner) }
export function disposeWebGpuContext(owner: object): void { contexts.get(owner)?.dispose(); contexts.delete(owner) }
export function installWebGpuGlobal(): void {
  let navigatorValue: object | undefined
  try {
    navigatorValue = Reflect.get(globalThis, "navigator") as object | undefined
  } catch {
    return
  }
  if (navigatorValue && !Reflect.has(navigatorValue, "gpu")) Object.defineProperty(navigatorValue, "gpu", { configurable: true, value: new GPU() })
}
function colorToRgba(color: GPUColor): number {
  const channel = (value: number | undefined, fallback: number) => Math.round(Math.max(0, Math.min(1, value ?? fallback)) * 255)
  return ((channel(color.r, 0) << 24) | (channel(color.g, 0) << 16) | (channel(color.b, 0) << 8) | channel(color.a, 1)) >>> 0
}
