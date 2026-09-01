import type {
  CanvasImageLoadState,
  ImageMimeType,
  ImageSource,
  NativeRenderer,
} from "../types/host.js"

type SerializableImageSource =
  | Extract<ImageSource, { kind: "path" | "url" }>
  | { kind: "data"; mimeType: ImageMimeType; bytes: readonly number[] }
  | string

type ImageState = "unloaded" | "loading" | "loaded" | "broken" | "closed"

type DecodeWaiter = {
  resolve: () => void
  reject: (reason: unknown) => void
}

type ImageLoader = NativeRenderer & {
  loadCanvasImage(observerId: number, sourceJson: string): void
  getCanvasImageLoadState(observerId: number): CanvasImageLoadState | null
  releaseCanvasImage(observerId: number): void
}

type ImageRecord = {
  source?: SerializableImageSource
  state: ImageState
  width: number
  height: number
  error?: DOMException
  generation: number
  loader?: ImageLoader
  observerId?: number
  poll?: ReturnType<typeof setTimeout>
  waiters: Set<DecodeWaiter>
  owner?: GpuixImage
}

const imageRecords = new WeakMap<object, ImageRecord>()
const observedRecords = new Set<ImageRecord>()
const loaders = new Map<ImageLoader, number>()
let nextObserverId = 1

function sourceFromString(src: string): SerializableImageSource {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return { kind: "url", url: src }
  }
  if (src.slice(0, 5).toLowerCase() === "data:") return src
  return { kind: "path", path: src }
}

function loadEvent(type: "load" | "error"): Event {
  const EventConstructor = Reflect.get(globalThis, "Event") as
    | (new (type: string) => Event)
    | undefined
  return EventConstructor ? new EventConstructor(type) : ({ type } as Event)
}

function encodingError(message: string): DOMException {
  return new DOMException(message, "EncodingError")
}

function invalidStateError(message: string): DOMException {
  return new DOMException(message, "InvalidStateError")
}

function asImageLoader(renderer: NativeRenderer): ImageLoader | undefined {
  if (
    typeof renderer.loadCanvasImage !== "function" ||
    typeof renderer.getCanvasImageLoadState !== "function" ||
    typeof renderer.releaseCanvasImage !== "function"
  ) {
    return undefined
  }
  return renderer as ImageLoader
}

function availableLoader(): ImageLoader | undefined {
  return loaders.keys().next().value
}

function settleLoaded(record: ImageRecord, state: CanvasImageLoadState): void {
  if (state.status !== "loaded") return
  record.state = "loaded"
  record.width = state.width ?? 0
  record.height = state.height ?? 0
  record.error = undefined
  for (const waiter of record.waiters) waiter.resolve()
  record.waiters.clear()
  record.owner?.finishLoad(record.width, record.height)
}

function settleBroken(record: ImageRecord, message: string): void {
  const error = encodingError(message)
  record.state = "broken"
  record.width = 0
  record.height = 0
  record.error = error
  for (const waiter of record.waiters) waiter.reject(error)
  record.waiters.clear()
  record.owner?.finishError(error)
}

function stopObserving(record: ImageRecord): void {
  if (record.poll !== undefined) {
    clearTimeout(record.poll)
    record.poll = undefined
  }
  if (record.loader && record.observerId !== undefined) {
    record.loader.releaseCanvasImage(record.observerId)
  }
  record.loader = undefined
  record.observerId = undefined
  observedRecords.delete(record)
}

function pollImage(record: ImageRecord, generation: number): void {
  if (
    record.generation !== generation ||
    record.state !== "loading" ||
    !record.loader ||
    record.observerId === undefined
  ) {
    return
  }

  let state: CanvasImageLoadState | null
  try {
    state = record.loader.getCanvasImageLoadState(record.observerId)
  } catch (error) {
    stopObserving(record)
    settleBroken(record, error instanceof Error ? error.message : String(error))
    return
  }

  if (!state || state.status === "loading") {
    record.poll = setTimeout(() => pollImage(record, generation), 4)
    return
  }
  record.poll = undefined
  if (state.status === "loaded") settleLoaded(record, state)
  else settleBroken(record, state.error ?? "Native image decoding failed")
}

function startObserving(record: ImageRecord): void {
  if (record.state !== "loading" || !record.source || record.loader) return
  const loader = availableLoader()
  if (!loader) return

  const observerId = nextObserverId++
  record.loader = loader
  record.observerId = observerId
  observedRecords.add(record)
  try {
    loader.loadCanvasImage(observerId, JSON.stringify(record.source))
  } catch (error) {
    stopObserving(record)
    settleBroken(record, error instanceof Error ? error.message : String(error))
    return
  }
  record.poll = setTimeout(() => pollImage(record, record.generation), 0)
}

function beginLoad(record: ImageRecord, source: SerializableImageSource): void {
  stopObserving(record)
  const replaced = encodingError("Image source changed before decoding completed")
  for (const waiter of record.waiters) waiter.reject(replaced)
  record.waiters.clear()
  record.source = source
  record.state = "loading"
  record.width = 0
  record.height = 0
  record.error = undefined
  record.generation += 1
  observedRecords.add(record)
  startObserving(record)
}

function waitForDecode(record: ImageRecord): Promise<void> {
  if (record.state === "loaded") return Promise.resolve()
  if (record.state === "broken" || record.state === "closed") {
    return Promise.reject(record.error ?? encodingError("Image is not decodable"))
  }
  if (record.state === "unloaded" || !record.source) {
    return Promise.reject(encodingError("Image src is not set"))
  }
  startObserving(record)
  return new Promise<void>((resolve, reject) => {
    record.waiters.add({ resolve, reject })
  })
}

/** Attach the native image loader owned by a GPUIX root without changing globals. */
export function attachCanvasImageLoader(renderer: NativeRenderer): void {
  const loader = asImageLoader(renderer)
  if (!loader) return
  loaders.set(loader, (loaders.get(loader) ?? 0) + 1)
  for (const record of observedRecords) startObserving(record)
}

/** Release shim observers owned by an unmounted GPUIX root. */
export function detachCanvasImageLoader(renderer: NativeRenderer): void {
  const loader = asImageLoader(renderer)
  if (!loader) return
  const count = loaders.get(loader)
  if (count === undefined) return
  if (count > 1) {
    loaders.set(loader, count - 1)
    return
  }
  loaders.delete(loader)

  for (const record of [...observedRecords]) {
    if (record.loader !== loader) continue
    stopObserving(record)
    if (record.state === "loading") startObserving(record)
  }
}

class GpuixImage {
  onload: ((this: GlobalEventHandlers, event: Event) => unknown) | null = null
  onerror: OnErrorEventHandler = null
  naturalWidth = 0
  naturalHeight = 0
  complete = true

  private specifiedWidth: number | undefined
  private specifiedHeight: number | undefined
  private value = ""
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  private readonly record: ImageRecord

  constructor(width?: number, height?: number) {
    if (width !== undefined) this.width = width
    if (height !== undefined) this.height = height
    this.record = {
      state: "unloaded",
      width: 0,
      height: 0,
      generation: 0,
      waiters: new Set(),
      owner: this,
    }
    imageRecords.set(this, this.record)
  }

  get width(): number {
    return this.specifiedWidth ?? this.naturalWidth
  }

  set width(value: number) {
    this.specifiedWidth = Number.isFinite(value) && value > 0 ? Number(value) : 0
  }

  get height(): number {
    return this.specifiedHeight ?? this.naturalHeight
  }

  set height(value: number) {
    this.specifiedHeight = Number.isFinite(value) && value > 0 ? Number(value) : 0
  }

  get src(): string {
    return this.value
  }

  set src(value: string) {
    const src = String(value)
    this.value = src
    this.complete = false
    this.naturalWidth = 0
    this.naturalHeight = 0

    if (src.trim().length === 0) {
      stopObserving(this.record)
      this.record.source = undefined
      this.record.state = "broken"
      this.record.width = 0
      this.record.height = 0
      this.record.generation += 1
      const error = encodingError("Image src must not be empty")
      this.record.error = error
      for (const waiter of this.record.waiters) waiter.reject(error)
      this.record.waiters.clear()
      queueMicrotask(() => this.finishError(error))
      return
    }
    beginLoad(this.record, sourceFromString(src))
  }

  decode(): Promise<void> {
    return waitForDecode(this.record)
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null
  ): void {
    if (!listener) return
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null
  ): void {
    if (!listener) return
    this.listeners.get(type)?.delete(listener)
  }

  finishLoad(width: number, height: number): void {
    this.complete = true
    this.naturalWidth = width
    this.naturalHeight = height
    this.dispatch("load")
  }

  finishError(error: DOMException): void {
    this.complete = true
    this.naturalWidth = 0
    this.naturalHeight = 0
    this.dispatch("error", error)
  }

  private dispatch(type: "load" | "error", error?: unknown): void {
    const event = loadEvent(type)
    if (type === "load") {
      this.onload?.call(this as unknown as GlobalEventHandlers, event)
    } else {
      this.onerror?.call(
        this as unknown as GlobalEventHandlers,
        event,
        this.value,
        0,
        0,
        error instanceof Error ? error : undefined
      )
    }
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener.call(this, event)
      else listener.handleEvent(event)
    }
  }
}

class GpuixImageBitmap {
  readonly width: number
  readonly height: number

  constructor(record: ImageRecord) {
    this.width = record.width
    this.height = record.height
    imageRecords.set(this, {
      source: record.source,
      state: "loaded",
      width: record.width,
      height: record.height,
      generation: 0,
      waiters: new Set(),
    })
  }

  close(): void {
    const record = imageRecords.get(this)
    if (record) record.state = "closed"
  }
}

/**
 * Import this constructor instead of installing a native shim on globalThis.
 * Its instances are typed as HTMLImageElement so ordinary Canvas 2D drawing
 * code can pass them to drawImage without a fork-only cast.
 */
export const Image = GpuixImage as unknown as {
  new (width?: number, height?: number): HTMLImageElement
}

/** Browser-shaped bitmap creation for GPUIX Image instances and Blob bytes. */
export async function createImageBitmap(
  source: ImageBitmapSource,
  ...options: unknown[]
): Promise<ImageBitmap> {
  if (options.length > 1) {
    throw new TypeError("GPUIX createImageBitmap does not support source-rectangle cropping")
  }

  const record = imageRecords.get(source as object)
  if (record && record.state !== "closed") {
    await waitForDecode(record)
    return new GpuixImageBitmap(record) as unknown as ImageBitmap
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const mimeType = source.type as ImageMimeType
    if (
      mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/webp" &&
      mimeType !== "image/gif" &&
      mimeType !== "image/svg+xml"
    ) {
      throw encodingError(`Unsupported image MIME type ${JSON.stringify(source.type)}`)
    }
    const bytes = Array.from(new Uint8Array(await source.arrayBuffer()))
    const blobRecord: ImageRecord = {
      state: "unloaded",
      width: 0,
      height: 0,
      generation: 0,
      waiters: new Set(),
    }
    beginLoad(blobRecord, { kind: "data", mimeType, bytes })
    await waitForDecode(blobRecord)
    stopObserving(blobRecord)
    return new GpuixImageBitmap(blobRecord) as unknown as ImageBitmap
  }

  throw new TypeError("GPUIX createImageBitmap expects an Image or Blob created in this module")
}

/** Internal recorder seam. The wire value remains source-keyed, never object-keyed. */
export function serializeCanvasImageSource(source: CanvasImageSource): string {
  const record = imageRecords.get(source as object)
  if (!record || record.state === "closed") {
    throw new TypeError(
      "Canvas drawImage expects an Image or ImageBitmap imported from @gpuix/react"
    )
  }
  if (record.state === "broken") {
    throw invalidStateError(record.error?.message ?? "The image is broken")
  }
  if (!record.source) {
    throw invalidStateError("The image has no usable source")
  }
  return JSON.stringify(record.source)
}
