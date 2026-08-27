import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { cancelAnimationFrame, requestAnimationFrame } from "../frame-clock.js"
import { createTestRoot, type TestRoot } from "../testing.js"

const FRAME_MS = 1000 / 60

let root: TestRoot | undefined

afterEach(() => {
  root?.unmount()
  root = undefined
  vi.unstubAllGlobals()
})

async function waitForLength(values: unknown[], length: number): Promise<void> {
  const startedAt = performance.now()
  while (values.length < length) {
    if (performance.now() - startedAt > 1_000) {
      throw new Error(`Timed out waiting for ${length} animation frames`)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe("requestAnimationFrame", () => {
  it("coalesces callbacks onto one native request and supports cancellation", async () => {
    root = createTestRoot()
    root.render(<text>frame clock</text>)
    const framesBefore = root.renderer.getDebugFrameOverlayStats().frames
    const callbacks: Array<[string, number]> = []

    const cancelled = requestAnimationFrame((timestamp) => {
      callbacks.push(["cancelled", timestamp])
    })
    const first = requestAnimationFrame((timestamp) => {
      callbacks.push(["first", timestamp])
    })
    const second = requestAnimationFrame((timestamp) => {
      callbacks.push(["second", timestamp])
    })
    cancelAnimationFrame(cancelled)

    expect(first).toEqual(expect.any(Number))
    expect(second).toEqual(expect.any(Number))
    expect(new Set([cancelled, first, second]).size).toBe(3)
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(1)
    expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesBefore)

    root.renderer.advanceAsyncClock(FRAME_MS)
    await waitForLength(callbacks, 2)

    expect(callbacks).toEqual([
      ["first", FRAME_MS],
      ["second", FRAME_MS],
    ])
  })

  it("runs a continuous loop at the deterministic 60 Hz test cadence", async () => {
    root = createTestRoot()
    root.render(<text>paced loop</text>)
    const timestamps: number[] = []

    const frame = (timestamp: number): void => {
      timestamps.push(timestamp)
      if (timestamps.length < 6) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)

    for (let index = 1; index <= 6; index += 1) {
      root.renderer.advanceAsyncClock(FRAME_MS)
      await waitForLength(timestamps, index)
    }

    expect(timestamps).toHaveLength(6)
    for (let index = 0; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeCloseTo(FRAME_MS * (index + 1), 8)
    }
    const offeredHz = ((timestamps.length - 1) * 1000) /
      (timestamps.at(-1)! - timestamps[0]!)
    expect(offeredHz).toBeCloseTo(60, 8)
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(6)
  })

  it("does not request or draw frames while idle", async () => {
    root = createTestRoot()
    root.render(<text>idle</text>)
    const requests = root.renderer.getAnimationFrameRequestCount()
    const frames = root.renderer.getDebugFrameOverlayStats().frames

    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(root.renderer.getAnimationFrameRequestCount()).toBe(requests)
    expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(frames)
  })

  it("delegates to the browser's frame clock when it is present", () => {
    const callback = vi.fn()
    const browserRequest = vi.fn(() => 73)
    const browserCancel = vi.fn()
    vi.stubGlobal("requestAnimationFrame", browserRequest)
    vi.stubGlobal("cancelAnimationFrame", browserCancel)

    expect(requestAnimationFrame(callback)).toBe(73)
    cancelAnimationFrame(73)

    expect(browserRequest).toHaveBeenCalledWith(callback)
    expect(browserCancel).toHaveBeenCalledWith(73)
  })
})
