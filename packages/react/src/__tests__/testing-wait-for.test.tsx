import React, { useEffect, useState } from "react"
import { describe, expect, it } from "vitest"

import { cancelAnimationFrame, requestAnimationFrame } from "../frame-clock.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function PromiseLabel({ load }: { load: () => Promise<string> }) {
  const [label, setLabel] = useState("pending")

  useEffect(() => {
    let active = true
    void load().then((value) => {
      if (active) setLabel(value)
    })
    return () => {
      active = false
    }
  }, [load])

  return <text>{`label:${label}`}</text>
}

function FrameCounter({ target }: { target: number }) {
  const [frames, setFrames] = useState(0)

  useEffect(() => {
    if (frames >= target) return
    const id = requestAnimationFrame(() => setFrames((count) => count + 1))
    return () => cancelAnimationFrame(id)
  }, [frames, target])

  return <text>{`frames:${frames}`}</text>
}

function DelayedPanel() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 40)
    return () => clearTimeout(timer)
  }, [])

  if (!ready) return <text>waiting</text>

  return (
    <div testId="panel" role="button" ariaLabel="Confirm">
      <text>ready</text>
    </div>
  )
}

describeNative("createTestRoot waitFor", () => {
  it("retries until promise-driven state settles", async () => {
    const screen = createTestRoot()

    try {
      const load = () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 40))
      screen.render(<PromiseLabel load={load} />)

      expect(() => screen.getByText(/label:done/)).toThrow(/Unable to find an element with text/)

      const settled = await screen.waitFor(() => screen.getByText(/label:done/))
      expect(settled.text).toBe("label:done")
    } finally {
      screen.unmount()
    }
  })

  it("pumps the frame clock so timer-driven UI can settle", async () => {
    const screen = createTestRoot()

    try {
      screen.render(<FrameCounter target={3} />)

      // Control: animation frames only fire when the native clock advances, so
      // wall-clock waiting alone leaves this UI parked on its first frame.
      await new Promise((resolve) => setTimeout(resolve, 200))
      screen.renderer.flush()
      expect(screen.getByText(/frames:0/)).toBeDefined()

      const settled = await screen.waitFor(() => screen.getByText(/frames:3/))
      expect(settled.text).toBe("frames:3")
    } finally {
      screen.unmount()
    }
  })

  it("resolves findBy queries once the element appears", async () => {
    const screen = createTestRoot()

    try {
      screen.render(<DelayedPanel />)

      expect(screen.queryByTestId("panel")).toBeNull()

      const panel = await screen.findByTestId("panel")
      expect(await screen.findByRole("button", { name: "Confirm" })).toBe(panel)
      expect(await screen.findByText("ready")).toBe(screen.getByText("ready"))
      expect(await screen.findAllByText("ready")).toEqual([screen.getByText("ready")])
      expect(await screen.findAllByTestId("panel")).toEqual([panel])
      expect(await screen.findAllByRole("button")).toEqual([panel])
      expect(await screen.within(panel).findByText("ready")).toBe(screen.getByText("ready"))
    } finally {
      screen.unmount()
    }
  })

  it("rethrows the last query error when the timeout expires", async () => {
    const screen = createTestRoot()

    try {
      screen.render(<text>steady</text>)

      await expect(
        screen.findByTestId("absent", undefined, { timeout: 80, interval: 10 })
      ).rejects.toThrow(/Unable to find an element with test ID/)

      let attempts = 0
      await expect(
        screen.waitFor(
          () => {
            attempts += 1
            throw new Error("never settles")
          },
          { timeout: 80, interval: 10 }
        )
      ).rejects.toThrow(/never settles/)
      expect(attempts).toBeGreaterThan(1)

      await expect(
        screen.waitFor(() => "ok", { timeout: 80, interval: 0 })
      ).rejects.toThrow(/waitFor interval must be a finite positive number/)
    } finally {
      screen.unmount()
    }
  })
})
