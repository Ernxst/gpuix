const FRAME_CLOCK_SLOT_KEY = "__gpuixAnimationFrameClock"
const MAX_ANIMATION_FRAME_ID = 0xffff_ffff

export type FrameRequestCallback = (timestamp: number) => void

type FrameSource = {
  owner: object
  request: (callback: FrameRequestCallback) => void
}

type FrameCallbackEntry = {
  callback: FrameRequestCallback
  /** Null until a desktop render host claims a pre-render registration. */
  generation: number | null
}

type FrameClockSlot = {
  callbacks: Map<number, FrameCallbackEntry>
  deferredRequest?: () => void
  generation: number
  nextId: number
  requestGeneration: number
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
    requestGeneration: 0,
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
  console.error("[gpuix] animation frame callback failed", error)
}

function allocateFrameId(slot: FrameClockSlot): number {
  for (;;) {
    const id = slot.nextId
    slot.nextId = id === MAX_ANIMATION_FRAME_ID ? 1 : id + 1
    if (!slot.callbacks.has(id)) return id
  }
}

function cancelPendingNativeFrame(slot: FrameClockSlot): void {
  if (!slot.requestPending) return
  slot.requestPending = false
  slot.requestGeneration += 1
}

function requestNativeFrame(slot: FrameClockSlot): void {
  if (slot.requestPending || slot.callbacks.size === 0) return
  const source = slot.source
  if (!source) return

  slot.requestPending = true
  const generation = slot.generation
  const requestGeneration = (slot.requestGeneration += 1)
  const deferredRequest = (): void => {
    const queued = frameClockSlot()
    if (
      !queued.requestPending ||
      queued.requestGeneration !== requestGeneration ||
      queued.generation !== generation ||
      queued.source !== source ||
      queued.callbacks.size === 0
    ) {
      return
    }

    try {
      source.request((timestamp) => {
        const current = frameClockSlot()
        if (
          !current.requestPending ||
          current.requestGeneration !== requestGeneration ||
          current.generation !== generation ||
          current.source !== source
        ) {
          return
        }

        current.requestPending = false

        // Snapshot the queue so a callback registered during delivery waits
        // for the next frame, but consult the live map per entry: a
        // cancelAnimationFrame issued by an earlier callback in this frame
        // removes its sibling, as the HTML animation-frame steps do.
        for (const [id, entry] of [...current.callbacks]) {
          if (current.callbacks.get(id) !== entry) continue
          current.callbacks.delete(id)
          try {
            entry.callback(timestamp)
          } catch (error) {
            reportFrameCallbackError(error)
          }
        }
      })
    } catch (error) {
      if (queued.requestGeneration === requestGeneration) {
        queued.requestPending = false
      }
      console.error("[gpuix] animation frame request failed", error)
    }
  }
  slot.deferredRequest = deferredRequest
  queueMicrotask(() => {
    const queued = frameClockSlot()
    if (queued.deferredRequest !== deferredRequest) return
    queued.deferredRequest = undefined
    deferredRequest()
  })
}

/**
 * Flush the deferred native frame request, if one is queued for `owner`.
 *
 * The clock slot is a process-wide singleton shared by every test renderer,
 * but at most one renderer's `FrameSource` is attached at a time —
 * `attachAnimationFrameSource` replaces it on each new root. A caller whose
 * renderer is not the currently attached source did not create the pending
 * request, so it must not be the one to flush it: that would let one root's
 * `advanceAsyncClock()` issue a *different* root's native frame token.
 */
export function flushFrameRequests(owner: object): void {
  const slot = frameClockSlot()
  if (slot.source?.owner !== owner) return
  const deferredRequest = slot.deferredRequest
  if (!deferredRequest) return
  slot.deferredRequest = undefined
  deferredRequest()
}

/**
 * Queue a callback on the GPUIX frame clock itself, bypassing any browser
 * `requestAnimationFrame`.
 *
 * `requestAnimationFrame` below defers to a browser implementation when one
 * is installed on `globalThis`; `@gpuix/react/globals` installs *this*
 * function as that browser implementation, so it must never re-check for
 * one itself, or it would recurse into the global it just became.
 *
 * @internal
 */
export function requestNativeAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof callback !== "function") {
    throw new TypeError("requestAnimationFrame callback must be a function")
  }

  const slot = frameClockSlot()
  const id = allocateFrameId(slot)
  slot.callbacks.set(id, {
    callback,
    generation: slot.source ? slot.generation : null,
  })
  requestNativeFrame(slot)
  return id
}

/**
 * Cancel a callback queued by `requestNativeAnimationFrame`, bypassing any
 * browser `cancelAnimationFrame`. See `requestNativeAnimationFrame` for why
 * this does not itself check for a browser implementation.
 *
 * @internal
 */
export function cancelNativeAnimationFrame(id: number): void {
  const slot = frameClockSlot()
  slot.callbacks.delete(id)
  if (slot.callbacks.size === 0) cancelPendingNativeFrame(slot)
}

/**
 * Queue a one-shot callback for the next display-paced GPUIX frame.
 *
 * In a browser this delegates to the browser's own requestAnimationFrame.
 */
export function requestAnimationFrame(callback: FrameRequestCallback): number {
  const browserRequest = browserRequestAnimationFrame()
  if (browserRequest) return browserRequest.call(globalThis, callback)
  return requestNativeAnimationFrame(callback)
}

/** Cancel a callback queued by requestAnimationFrame. */
export function cancelAnimationFrame(id: number): void {
  const browserCancel = Reflect.get(globalThis, "cancelAnimationFrame")
  if (typeof browserCancel === "function") {
    browserCancel.call(globalThis, id)
    return
  }
  cancelNativeAnimationFrame(id)
}

export function attachAnimationFrameSource(source: FrameSource): void {
  const slot = frameClockSlot()
  const replacingSource = slot.source !== undefined
  cancelPendingNativeFrame(slot)
  slot.generation += 1
  if (replacingSource) {
    for (const [id, entry] of slot.callbacks) {
      if (entry.generation !== null) slot.callbacks.delete(id)
    }
  }
  slot.source = source
  for (const entry of slot.callbacks.values()) entry.generation = slot.generation
  requestNativeFrame(slot)
}

export function detachAnimationFrameSource(owner: object): void {
  const slot = frameClockSlot()
  if (slot.source?.owner !== owner) return
  cancelPendingNativeFrame(slot)
  slot.generation += 1
  slot.callbacks.clear()
  slot.source = undefined
}
