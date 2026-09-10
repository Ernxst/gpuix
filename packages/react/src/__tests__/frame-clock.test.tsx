import React, { useEffect, useState } from "react"
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

async function settleFrameRequest(): Promise<void> {
  await Promise.resolve()
}

function BoundsAfterFrame({ onFrame }: { onFrame: () => void }) {
  useEffect(() => {
    requestAnimationFrame(onFrame)
  }, [onFrame])

  return (
    <div data-testid="frame-target" style={{ width: 80, height: 20 }}>
      <text>frame target</text>
    </div>
  )
}

function StateAfterFrame() {
  const [value, setValue] = useState("before")

  useEffect(() => {
    requestAnimationFrame(() => setValue("after"))
  }, [])

  return (
    <div data-testid="frame-state" style={{ width: 80, height: 20 }}>
      <text>{value}</text>
    </div>
  )
}

describe("requestAnimationFrame", () => {
  it("keeps the frame pump alive when one callback throws", () => {
    root = createTestRoot()
    root.render(<text>callback errors</text>)
    const reported = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("reportError", reported)
    const callbacks: string[] = []

    requestAnimationFrame(() => {
      throw new Error("frame callback failed")
    })
    requestAnimationFrame(() => {
      callbacks.push("sibling")
      requestAnimationFrame(() => callbacks.push("next"))
    })

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["sibling"])

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["sibling", "next"])

    expect(callbacks).toEqual(["sibling", "next"])
    expect(reported).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      "[gpuix] animation frame callback failed",
      expect.objectContaining({ message: "frame callback failed" })
    )
  })

  it("queues callbacks registered before a desktop render host attaches", () => {
    const timestamps: number[] = []
    const id = requestAnimationFrame((timestamp) => timestamps.push(timestamp))

    expect(id).toEqual(expect.any(Number))
    root = createTestRoot()
    root.render(<text>late host</text>)
    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(timestamps[0]).toBeCloseTo(FRAME_MS, 5)
  })

  it("does not issue a native frame token when the final callback is cancelled", async () => {
    root = createTestRoot()
    root.render(<text>cancelled demand</text>)
    const callbacks: string[] = []
    const requestsBefore = root.renderer.getAnimationFrameRequestCount()

    const cancelled = requestAnimationFrame(() => callbacks.push("cancelled"))
    cancelAnimationFrame(cancelled)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(root.renderer.getAnimationFrameRequestCount()).toBe(requestsBefore)

    const cancelledInFlight = requestAnimationFrame(() => callbacks.push("in-flight"))
    await settleFrameRequest()
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(requestsBefore + 1)
    cancelAnimationFrame(cancelledInFlight)

    requestAnimationFrame(() => callbacks.push("next"))
    await settleFrameRequest()
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(requestsBefore + 2)
    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["next"])
  })

  it("receives its deterministic timestamp from the native frame callback", () => {
    root = createTestRoot()
    root.render(<text>native timestamp</text>)
    const timestamps: number[] = []

    root.renderer.requestFrame((timestamp) => timestamps.push(timestamp))
    root.renderer.advanceAsyncClock(7)

    expect(timestamps[0]).toBeCloseTo(7, 8)
  })

  it("keeps delivering direct frame requests after one throws, and still dispatches events", () => {
    root = createTestRoot()
    root.render(<text>direct throw</text>)
    const order: string[] = []
    const dispatchNativeEvents = vi.spyOn(root.renderer, "dispatchNativeEvents")

    root.renderer.requestFrame(() => {
      order.push("first")
      throw new Error("first failed")
    })
    root.renderer.requestFrame(() => {
      order.push("second")
    })

    expect(() => root!.renderer.advanceAsyncClock(FRAME_MS)).toThrowError("first failed")
    expect(order).toEqual(["first", "second"])
    expect(dispatchNativeEvents).toHaveBeenCalled()
  })

  it("only advanceAsyncClock delivers a queued frame callback, not advanceTime or clockFastForward", () => {
    root = createTestRoot()
    root.render(<text>clock-only</text>)
    const callbacks: string[] = []

    requestAnimationFrame(() => callbacks.push("delivered"))

    root.renderer.advanceTime(16)
    expect(callbacks).toEqual([])

    root.renderer.clockFastForward(16)
    expect(callbacks).toEqual([])

    root.renderer.advanceAsyncClock(16)
    expect(callbacks).toEqual(["delivered"])
  })

  it("dispatches a native event produced by a callback's committed state before advanceAsyncClock returns", () => {
    root = createTestRoot()
    const handleFocus = vi.fn()
    let markReady: (() => void) | undefined

    function Harness() {
      const [label, setLabel] = useState("before")
      markReady = () => setLabel("after")
      return (
        <div style={{ width: 200, height: 40 }}>
          <input data-testid="target" onFocus={handleFocus} style={{ width: 80, height: 20 }} />
          <text>{label}</text>
        </div>
      )
    }

    root.render(<Harness />)
    const target = root.renderer.findByTestId("target")!

    requestAnimationFrame(() => {
      markReady?.()
      root!.renderer.focusElement(target.id)
    })

    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(root.renderer.getAllText()).toContain("after")
    expect(handleFocus).toHaveBeenCalledTimes(1)
  })

  it("delivers same-tick callbacks in order with one native timestamp", () => {
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
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(0)
    expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesBefore)

    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(callbacks.map(([name]) => name)).toEqual(["first", "second"])
    expect(callbacks[0]![1]).toBeCloseTo(FRAME_MS, 5)
    expect(callbacks[1]![1]).toBe(callbacks[0]![1])
  })

  it("cancels one of two pending callbacks", async () => {
    root = createTestRoot()
    root.render(<text>cancel one</text>)
    const callbacks: string[] = []

    const cancelled = requestAnimationFrame(() => callbacks.push("cancelled"))
    requestAnimationFrame(() => callbacks.push("kept"))
    cancelAnimationFrame(cancelled)

    await settleFrameRequest()
    root.renderer.advanceAsyncClock(FRAME_MS)
    await waitForLength(callbacks, 1)

    expect(callbacks).toEqual(["kept"])
  })

  it("honours cancelAnimationFrame of a sibling issued during delivery", () => {
    root = createTestRoot()
    root.render(<text>cancel sibling</text>)
    const callbacks: string[] = []

    let second = 0
    requestAnimationFrame(() => {
      callbacks.push("first")
      cancelAnimationFrame(second)
    })
    second = requestAnimationFrame(() => callbacks.push("second"))

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["first"])
  })

  it("waits until the next advance for a callback registered during delivery", () => {
    root = createTestRoot()
    root.render(<text>continuous loop</text>)
    const callbacks: string[] = []

    requestAnimationFrame(() => {
      callbacks.push("first")
      requestAnimationFrame(() => callbacks.push("next"))
    })

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["first"])

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callbacks).toEqual(["first", "next"])
  })

  it("runs a continuous loop at the deterministic 60 Hz test cadence", () => {
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
      expect(timestamps).toHaveLength(index)
    }

    expect(timestamps).toHaveLength(6)
    for (let index = 0; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeCloseTo(FRAME_MS * (index + 1), 5)
    }
    const offeredHz = ((timestamps.length - 1) * 1000) /
      (timestamps.at(-1)! - timestamps[0]!)
    expect(offeredHz).toBeCloseTo(60, 5)
    expect(root.renderer.getAnimationFrameRequestCount()).toBe(6)
  })

  it("delivers a callback that commits state before advanceAsyncClock returns", () => {
    root = createTestRoot()
    root.render(<StateAfterFrame />)

    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(root.renderer.findByTestId("frame-state")).toBeDefined()
    expect(root.renderer.getAllText()).toContain("after")
  })

  it("lets a committed effect read the rendered tree inside its frame callback", () => {
    root = createTestRoot()
    const seen: Array<{ x: number; y: number; width: number; height: number }> = []
    root.render(
      <BoundsAfterFrame
        onFrame={() => {
          const target = root!.renderer.findByTestId("frame-target")
          expect(target).toBeDefined()
          seen.push(root!.renderer.getElementBounds(target!.id) ?? { x: 0, y: 0, width: 0, height: 0 })
        }}
      />
    )

    root.renderer.advanceAsyncClock(16)

    expect(seen).toEqual([{ x: 0, y: 0, width: 80, height: 20 }])
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

describe("advanceAsyncClock across multiple roots", () => {
  it("does not issue a sibling root's native frame token", () => {
    const a = createTestRoot()
    const b = createTestRoot()
    try {
      a.render(<text>root a</text>)
      b.render(<text>root b</text>)

      const bRequestsBefore = b.renderer.getAnimationFrameRequestCount()
      // `createTestRoot` attaches its frame source last, so this callback is
      // routed to root b, the currently attached source.
      requestAnimationFrame(() => {})

      a.renderer.advanceAsyncClock(FRAME_MS)
      expect(b.renderer.getAnimationFrameRequestCount()).toBe(bRequestsBefore)

      b.renderer.advanceAsyncClock(FRAME_MS)
      expect(b.renderer.getAnimationFrameRequestCount()).toBe(bRequestsBefore + 1)
    } finally {
      a.unmount()
      b.unmount()
    }
  })
})
