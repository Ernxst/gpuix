import type { ImageMimeType, ImageSource } from "../types/host.js"

type SerializableImageSource =
  | Extract<ImageSource, { kind: "path" | "url" }>
  | { kind: "data"; mimeType: ImageMimeType; bytes: readonly number[] }

type ImageRecord = {
  source: SerializableImageSource
  width: number
  height: number
  closed: boolean
}

const imageRecords = new WeakMap<object, ImageRecord>()

function sourceFromString(src: string): SerializableImageSource {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return { kind: "url", url: src }
  }
  return { kind: "path", path: src }
}

function loadEvent(type: "load" | "error"): Event {
  const EventConstructor = Reflect.get(globalThis, "Event") as
    | (new (type: string) => Event)
    | undefined
  return EventConstructor ? new EventConstructor(type) : ({ type } as Event)
}

class GpuixImage {
  onload: ((this: GlobalEventHandlers, event: Event) => unknown) | null = null
  onerror: OnErrorEventHandler = null
  width: number
  height: number
  naturalWidth = 0
  naturalHeight = 0
  complete = true

  private value = ""
  private generation = 0
  private decoded: Promise<void> = Promise.resolve()
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  constructor(width = 0, height = 0) {
    this.width = Number.isFinite(width) && width > 0 ? Number(width) : 0
    this.height = Number.isFinite(height) && height > 0 ? Number(height) : 0
  }

  get src(): string {
    return this.value
  }

  set src(value: string) {
    const src = String(value)
    const generation = ++this.generation
    this.value = src
    this.complete = false
    if (src.trim().length > 0) {
      imageRecords.set(this, {
        source: sourceFromString(src),
        width: this.width,
        height: this.height,
        closed: false,
      })
    } else {
      imageRecords.delete(this)
    }

    let resolveDecode: (() => void) | undefined
    let rejectDecode: ((reason: unknown) => void) | undefined
    this.decoded = new Promise<void>((resolve, reject) => {
      resolveDecode = resolve
      rejectDecode = reject
    })

    queueMicrotask(() => {
      if (generation !== this.generation) return
      if (src.trim().length === 0) {
        const error = new DOMException("Image src must not be empty", "EncodingError")
        this.complete = true
        rejectDecode?.(error)
        this.dispatch("error", error)
        return
      }

      this.complete = true
      this.naturalWidth = this.width
      this.naturalHeight = this.height
      resolveDecode?.()
      this.dispatch("load")
    })
  }

  decode(): Promise<void> {
    if (this.value.length === 0) {
      return Promise.reject(new DOMException("Image src is not set", "EncodingError"))
    }
    return this.decoded
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
    imageRecords.set(this, { ...record, closed: false })
  }

  close(): void {
    const record = imageRecords.get(this)
    if (record) record.closed = true
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
  if (record && !record.closed) {
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
      throw new DOMException(`Unsupported image MIME type ${JSON.stringify(source.type)}`, "EncodingError")
    }
    const bytes = Array.from(new Uint8Array(await source.arrayBuffer()))
    return new GpuixImageBitmap({
      source: { kind: "data", mimeType, bytes },
      width: 0,
      height: 0,
      closed: false,
    }) as unknown as ImageBitmap
  }

  throw new TypeError("GPUIX createImageBitmap expects an Image or Blob created in this module")
}

/** Internal recorder seam. The wire value remains source-keyed, never object-keyed. */
export function serializeCanvasImageSource(source: CanvasImageSource): string {
  const record = imageRecords.get(source as object)
  if (!record || record.closed) {
    throw new TypeError(
      "Canvas drawImage expects an Image or ImageBitmap imported from @gpuix/react"
    )
  }
  return JSON.stringify(record.source)
}
