const FRAME_CLOCK_SLOT_KEY = "__gpuixAnimationFrameClock"
const MAX_ANIMATION_FRAME_ID = 0xffff_ffff

export type FrameRequestCallback = (timestamp: number) => void

type FrameSource = {
  owner: object
  request: (callback: () => void) => void
  now: () => number
}

type FrameClockSlot = {
  callbacks: Map<number, FrameRequestCallback>
  generation: number
  nextId: number
  requestPending: boolean
  source?: FrameSource
}

function frameClockSlot(): FrameClockSlot {
  const existing = Reflect.get(globalThis, FRAME_CLOCK_SLOT_KEY) as
    | FrameClockSlot
    | undefined
  if (existing) return existing

  const created: FrameClockSlot = {
    callbacks: new Map(),
    generation: 0,
    nextId: 1,
    requestPending: false,
  }
  Reflect.set(globalThis, FRAME_CLOCK_SLOT_KEY, created)
  return created
}

function browserRequestAnimationFrame(): typeof globalThis.requestAnimationFrame | undefined {
  const request = Reflect.get(globalThis, "requestAnimationFrame")
  return typeof request === "function"
    ? (request as typeof globalThis.requestAnimationFrame)
    : undefined
}

function reportFrameCallbackError(error: unknown): void {
  const reportError = Reflect.get(globalThis, "reportError")
  if (typeof reportError === "function") {
    reportError.call(globalThis, error)
    return
  }
  queueMicrotask(() => {
    throw error
  })
}

function allocateFrameId(slot: FrameClockSlot): number {
  for (;;) {
    const id = slot.nextId
    slot.nextId = id === MAX_ANIMATION_FRAME_ID ? 1 : id + 1
    if (!slot.callbacks.has(id)) return id
  }
}

function requestNativeFrame(slot: FrameClockSlot): void {
  if (slot.requestPending || slot.callbacks.size === 0) return
  const source = slot.source
  if (!source) {
    throw new Error(
      "requestAnimationFrame() requires an active GPUIX render host in the desktop runtime"
    )
  }

  slot.requestPending = true
  const generation = slot.generation
  try {
    source.request(() => {
      const current = frameClockSlot()
      if (current.generation !== generation || current.source !== source) return

      current.requestPending = false
      const callbacks = [...current.callbacks.values()]
      current.callbacks.clear()
      const timestamp = source.now()

      for (const callback of callbacks) {
        try {
          callback(timestamp)
        } catch (error) {
          reportFrameCallbackError(error)
        }
      }
    })
  } catch (error) {
    slot.requestPending = false
    throw error
  }
}

/**
 * Queue a one-shot callback for the next display-paced GPUIX frame.
 *
 * In a browser this delegates to the browser's own requestAnimationFrame.
 */
export function requestAnimationFrame(callback: FrameRequestCallback): number {
  const browserRequest = browserRequestAnimationFrame()
  if (browserRequest) return browserRequest.call(globalThis, callback)
  if (typeof callback !== "function") {
    throw new TypeError("requestAnimationFrame callback must be a function")
  }

  const slot = frameClockSlot()
  const id = allocateFrameId(slot)
  slot.callbacks.set(id, callback)
  try {
    requestNativeFrame(slot)
  } catch (error) {
    slot.callbacks.delete(id)
    throw error
  }
  return id
}

/** Cancel a callback queued by requestAnimationFrame. */
export function cancelAnimationFrame(id: number): void {
  const browserCancel = Reflect.get(globalThis, "cancelAnimationFrame")
  if (typeof browserCancel === "function") {
    browserCancel.call(globalThis, id)
    return
  }
  frameClockSlot().callbacks.delete(id)
}

export function attachAnimationFrameSource(source: FrameSource): void {
  const slot = frameClockSlot()
  slot.generation += 1
  slot.callbacks.clear()
  slot.requestPending = false
  slot.source = source
}

export function detachAnimationFrameSource(owner: object): void {
  const slot = frameClockSlot()
  if (slot.source?.owner !== owner) return
  slot.generation += 1
  slot.callbacks.clear()
  slot.requestPending = false
  slot.source = undefined
}
