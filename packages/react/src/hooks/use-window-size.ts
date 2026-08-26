import { useCallback, useSyncExternalStore } from "react"
import type { EventPayload } from "@gpuix/native"
import type { NativeRenderer } from "../types/host.js"
import { useGpuix } from "./use-gpuix.js"

export interface WindowSize {
  width: number
  height: number
  /** Device pixels per logical GPUI pixel. */
  scaleFactor: number
}

export interface WindowResizeEvent extends EventPayload {
  eventType: "windowResize"
  width: number
  height: number
  scaleFactor: number
}

const DEFAULT_WINDOW_SIZE: WindowSize = { width: 800, height: 600, scaleFactor: 1 }

function normalizedDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalizedScaleFactor(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_WINDOW_SIZE.scaleFactor
}

function normalizeWindowSize(size: Partial<WindowSize> | null | undefined): WindowSize {
  return {
    width: normalizedDimension(size?.width, DEFAULT_WINDOW_SIZE.width),
    height: normalizedDimension(size?.height, DEFAULT_WINDOW_SIZE.height),
    scaleFactor: normalizedScaleFactor(size?.scaleFactor),
  }
}

class WindowSizeStore {
  private listeners = new Set<() => void>()
  private snapshot: WindowSize

  constructor(private readonly renderer: NativeRenderer) {
    this.snapshot = this.read()
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.listeners.size === 0) {
      // A store can outlive all consumers. Re-read before a later consumer
      // subscribes so its synchronous snapshot is not from a previous mount.
      this.snapshot = this.read()
      this.renderer.setWindowEventHandler?.(this.handleWindowEvent)
    }
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.renderer.setWindowEventHandler?.(null)
      }
    }
  }

  getSnapshot = (): WindowSize => this.snapshot

  private read(): WindowSize {
    try {
      return normalizeWindowSize(this.renderer.getWindowSize?.())
    } catch {
      return DEFAULT_WINDOW_SIZE
    }
  }

  private handleWindowEvent = (event: EventPayload): void => {
    if (
      event.eventType !== "windowResize" ||
      event.width === undefined ||
      event.height === undefined ||
      event.scaleFactor === undefined
    ) {
      return
    }

    const next = normalizeWindowSize(event)
    if (
      next.width === this.snapshot.width &&
      next.height === this.snapshot.height &&
      next.scaleFactor === this.snapshot.scaleFactor
    ) {
      return
    }

    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

const stores = new WeakMap<NativeRenderer, WindowSizeStore>()

function storeFor(renderer: NativeRenderer): WindowSizeStore {
  let store = stores.get(renderer)
  if (!store) {
    store = new WindowSizeStore(renderer)
    stores.set(renderer, store)
  }
  return store
}

/** Get live logical window dimensions and subscribe to native resize events. */
export function useWindowSize(): WindowSize {
  const { renderer } = useGpuix()
  const store = renderer ? storeFor(renderer) : null
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? (() => {}),
    [store]
  )
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? DEFAULT_WINDOW_SIZE, [store])

  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_WINDOW_SIZE)
}
