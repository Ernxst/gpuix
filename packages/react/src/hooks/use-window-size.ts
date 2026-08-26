import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import type { EventPayload } from "@gpuix/native"
import { useGpuix } from "./use-gpuix.js"
import type {
  EdgeInsets,
  NativeRenderer,
  NativeWindowInsets,
} from "../types/host.js"

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

export interface WindowInsets extends NativeWindowInsets {
  /** Y coordinate where unobscured content ends. Equals window height when closed. */
  keyboardTop: number
  keyboardVisible: boolean
  visibleHeight: number
}

export interface WindowInsetsOptions {
  /** Poll interval in milliseconds. Defaults to 100. Set false for one read. */
  intervalMs?: number | false
}

const ZERO_EDGES: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function readWindowInsets(renderer: NativeRenderer | null): WindowInsets {
  let size = { width: 800, height: 600 }
  let insets: NativeWindowInsets = {
    safeArea: ZERO_EDGES,
    ime: ZERO_EDGES,
    effective: ZERO_EDGES,
  }
  try {
    size = renderer?.getWindowSize?.() ?? size
    insets = renderer?.getWindowInsets?.() ?? insets
  } catch {
    // Renderer window is still opening.
  }
  return {
    ...insets,
    keyboardTop: size.height - insets.ime.bottom,
    keyboardVisible: insets.ime.bottom > 0,
    visibleHeight: size.height - insets.effective.top - insets.effective.bottom,
  }
}

function sameWindowInsets(a: WindowInsets, b: WindowInsets): boolean {
  return (
    a.keyboardTop === b.keyboardTop &&
    a.keyboardVisible === b.keyboardVisible &&
    a.visibleHeight === b.visibleHeight &&
    a.safeArea.top === b.safeArea.top &&
    a.safeArea.right === b.safeArea.right &&
    a.safeArea.bottom === b.safeArea.bottom &&
    a.safeArea.left === b.safeArea.left &&
    a.ime.top === b.ime.top &&
    a.ime.right === b.ime.right &&
    a.ime.bottom === b.ime.bottom &&
    a.ime.left === b.ime.left
  )
}

/** Get safe-area and keyboard geometry, sampled every 100ms by default. */
export function useWindowInsets(options: WindowInsetsOptions = {}): WindowInsets {
  const { renderer } = useGpuix()
  const [insets, setInsets] = useState<WindowInsets>(() => readWindowInsets(renderer))
  const intervalMs = options.intervalMs ?? 100

  useEffect(() => {
    const update = () => {
      try {
        const next = readWindowInsets(renderer)
        setInsets((current) => (sameWindowInsets(current, next) ? current : next))
      } catch {
        // Renderer window is still opening.
      }
    }
    update()
    if (intervalMs === false) return
    const timer = setInterval(update, Math.max(16, intervalMs))
    return () => clearInterval(timer)
  }, [renderer, intervalMs])

  return insets
}
