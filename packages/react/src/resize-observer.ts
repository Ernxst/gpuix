import type { EventPayload } from "@gpuix/native"
import type { Container, NativeRenderer, PublicInstance } from "./types/host.js"
import { containerForPublicInstance } from "./reconciler/host-config.js"

export type ResizeObserverBoxOptions =
  | "content-box"
  | "border-box"
  | "device-pixel-content-box"

export interface ResizeObserverOptions {
  box?: ResizeObserverBoxOptions
}

export type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver
) => void

type NativeResizeEntry = NonNullable<EventPayload["entries"]>[number]
type Size = { width: number; height: number }

type Observation = {
  container: Container
  box: ResizeObserverBoxOptions
  lastReported: Size
}

const observationsByRenderer = new WeakMap<NativeRenderer, Set<ResizeObserver>>()
const referenceCountsByRenderer = new WeakMap<NativeRenderer, Map<number, number>>()

function invalidTarget(): TypeError {
  return new TypeError("Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'.")
}

function resolveBox(options: ResizeObserverOptions | undefined): ResizeObserverBoxOptions {
  const box = options?.box ?? "content-box"
  if (box !== "content-box" && box !== "border-box" && box !== "device-pixel-content-box") {
    throw new TypeError(`Failed to execute 'observe' on 'ResizeObserver': '${box}' is not a valid box option.`)
  }
  return box
}

function retainNativeObservation(renderer: NativeRenderer, id: number, observer: ResizeObserver): void {
  let observers = observationsByRenderer.get(renderer)
  if (!observers) {
    observers = new Set()
    observationsByRenderer.set(renderer, observers)
  }
  observers.add(observer)

  let counts = referenceCountsByRenderer.get(renderer)
  if (!counts) {
    counts = new Map()
    referenceCountsByRenderer.set(renderer, counts)
  }
  const count = counts.get(id) ?? 0
  counts.set(id, count + 1)
  renderer.observeResize?.(id)
}

function releaseNativeObservation(renderer: NativeRenderer, id: number, observer: ResizeObserver): void {
  const counts = referenceCountsByRenderer.get(renderer)
  if (counts) {
    const count = counts.get(id) ?? 0
    if (count <= 1) {
      counts.delete(id)
      renderer.unobserveResize?.(id)
    } else {
      counts.set(id, count - 1)
    }
  }

  const observers = observationsByRenderer.get(renderer)
  if (observers && !observer.hasRenderer(renderer)) {
    observers.delete(observer)
    if (observers.size === 0) observationsByRenderer.delete(renderer)
  }
}

function selectedSize(entry: NativeResizeEntry, box: ResizeObserverBoxOptions): Size {
  if (box === "border-box") {
    return { width: entry.borderBox.width, height: entry.borderBox.height }
  }
  if (box === "device-pixel-content-box") {
    return {
      width: Math.round(entry.contentBox.width * entry.scaleFactor),
      height: Math.round(entry.contentBox.height * entry.scaleFactor),
    }
  }
  return { width: entry.contentBox.width, height: entry.contentBox.height }
}

function sameSize(left: Size, right: Size): boolean {
  return left.width === right.width && left.height === right.height
}

export class ResizeObserverEntry {
  readonly target: PublicInstance
  readonly contentRect: {
    x: number
    y: number
    width: number
    height: number
    top: number
    left: number
    right: number
    bottom: number
  }
  readonly borderBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
  readonly contentBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
  readonly devicePixelContentBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>

  constructor(target: PublicInstance, entry: NativeResizeEntry) {
    const contentRect = {
      x: entry.paddingLeft,
      y: entry.paddingTop,
      width: entry.contentBox.width,
      height: entry.contentBox.height,
      top: entry.paddingTop,
      left: entry.paddingLeft,
      right: entry.paddingLeft + entry.contentBox.width,
      bottom: entry.paddingTop + entry.contentBox.height,
    }
    this.target = target
    this.contentRect = contentRect
    this.borderBoxSize = Object.freeze([
      Object.freeze({ inlineSize: entry.borderBox.width, blockSize: entry.borderBox.height }),
    ])
    this.contentBoxSize = Object.freeze([
      Object.freeze({ inlineSize: entry.contentBox.width, blockSize: entry.contentBox.height }),
    ])
    this.devicePixelContentBoxSize = Object.freeze([
      Object.freeze({
        inlineSize: Math.round(entry.contentBox.width * entry.scaleFactor),
        blockSize: Math.round(entry.contentBox.height * entry.scaleFactor),
      }),
    ])
  }
}

export class ResizeObserver {
  private readonly observations = new Map<PublicInstance, Observation>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: PublicInstance, options?: ResizeObserverOptions): void {
    const container = containerForPublicInstance(target)
    if (!container) throw invalidTarget()
    const box = resolveBox(options)
    this.unobserve(target)
    const observation: Observation = {
      container,
      box,
      lastReported: { width: -1, height: -1 },
    }
    this.observations.set(target, observation)
    try {
      retainNativeObservation(container.native, target.id, this)
    } catch (error) {
      this.observations.delete(target)
      releaseNativeObservation(container.native, target.id, this)
      throw error
    }
  }

  unobserve(target: PublicInstance): void {
    const container = containerForPublicInstance(target)
    if (!container) throw invalidTarget()
    const observation = this.observations.get(target)
    if (!observation) return
    this.observations.delete(target)
    releaseNativeObservation(observation.container.native, target.id, this)
  }

  disconnect(): void {
    const observations = [...this.observations]
    this.observations.clear()
    for (const [target, observation] of observations) {
      releaseNativeObservation(observation.container.native, target.id, this)
    }
  }

  hasRenderer(renderer: NativeRenderer): boolean {
    for (const observation of this.observations.values()) {
      if (observation.container.native === renderer) return true
    }
    return false
  }

  deliver(nativeEntries: readonly NativeResizeEntry[]): void {
    const byId = new Map(nativeEntries.map((entry) => [entry.elementId, entry]))
    const delivered: ResizeObserverEntry[] = []
    const unmounted: PublicInstance[] = []
    for (const [target, observation] of this.observations) {
      const nativeEntry = byId.get(target.id)
      if (!nativeEntry) continue
      const size = selectedSize(nativeEntry, observation.box)
      const isUnmounted = !observation.container.eventTargets.has(target.id)
      if (isUnmounted || !sameSize(size, observation.lastReported)) {
        observation.lastReported = size
        delivered.push(new ResizeObserverEntry(target, nativeEntry))
      }
      if (isUnmounted) unmounted.push(target)
    }
    try {
      if (delivered.length > 0) {
        const callback = this.callback
        try {
          callback(delivered, this)
        } catch (error) {
          queueMicrotask(() => {
            throw error
          })
        }
      }
    } finally {
      for (const target of unmounted) {
        if (this.observations.has(target)) this.unobserve(target)
      }
    }
  }
}

export function dispatchResizeObservation(
  payload: EventPayload,
  renderer: NativeRenderer
): { defaultPrevented: boolean; propagationStopped: boolean } {
  const observers = observationsByRenderer.get(renderer)
  if (!observers || !payload.entries) {
    return { defaultPrevented: false, propagationStopped: false }
  }
  for (const observer of [...observers]) observer.deliver(payload.entries)
  return { defaultPrevented: false, propagationStopped: false }
}
