import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import React from "react"
import { describe, expect, it, vi } from "vitest"

import { motion } from "../index.js"
import {
  cleanup,
  isNativeTestRendererAvailable,
  render,
  type RenderResult,
} from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const FROM = "#20242c"
const TO = "#c8d2e0"
const LABEL = "All Income Expenses Transfers"

function scratchDirectory(): string {
  return mkdtempSync(path.join(os.tmpdir(), "gpuix-screenshot-settle-"))
}

function busyWait(milliseconds: number): void {
  const end = performance.now() + milliseconds
  while (performance.now() < end) {
    // Burn wall-clock time without yielding, as a loaded worker can do.
  }
}

function Fader({
  lit,
  easing = "easeOut",
}: {
  lit: boolean
  easing?: "easeOut" | { type: "spring"; stiffness: number; damping: number; mass: number }
}): React.ReactElement {
  return (
    <div style={{ width: 240, height: 80, padding: 12, backgroundColor: "#1e2430" }}>
      <text
        data-testid="fade-label"
        style={{
          color: lit ? TO : FROM,
          fontSize: 13,
          transition: { properties: ["color"], durationMs: 160, easing },
        }}
      >
        {LABEL}
      </text>
    </div>
  )
}

function settledLabel(): React.ReactElement {
  return (
    <div style={{ width: 240, height: 80, padding: 12, backgroundColor: "#1e2430" }}>
      <text style={{ color: TO, fontSize: 13 }}>{LABEL}</text>
    </div>
  )
}

function screenshotPath(directory: string): (options: unknown) => string {
  return () => path.join(directory, "golden.png")
}

async function withResult(
  body: (result: RenderResult, directory: string) => Promise<void>
): Promise<void> {
  const directory = scratchDirectory()
  const result = render(settledLabel(), { width: 264, height: 104 })
  try {
    await body(result, directory)
  } finally {
    result.unmount()
    cleanup()
    rmSync(directory, { recursive: true, force: true })
  }
}

describeNative("toMatchScreenshot animation settling", () => {
  it("settles an armed transition to the endpoint across wall-clock jitter", async () => {
    await withResult(async (result, directory) => {
      const golden = path.join(directory, "golden.png")
      result.renderer.captureScreenshot(golden)

      for (let index = 0; index < 10; index += 1) {
        result.rerender(<Fader lit={false} />)
        result.renderer.flush()
        result.rerender(<Fader lit />)
        busyWait(Math.floor(Math.random() * 31))
        await expect(result).toMatchScreenshot({ resolveScreenshotPath: screenshotPath(directory) })
      }
    })
  })

  it("leaves an in-flight transition visible when animations are allowed", async () => {
    await withResult(async (result, directory) => {
      const golden = path.join(directory, "golden.png")
      result.renderer.captureScreenshot(golden)
      result.rerender(<Fader lit={false} />)
      result.renderer.flush()
      result.rerender(<Fader lit />)
      result.renderer.clockPause()
      result.renderer.advanceAsyncClock(50)

      await expect(
        expect(result).toMatchScreenshot({
          animations: "allow",
          resolveScreenshotPath: screenshotPath(directory),
        })
      ).rejects.toThrow(/Image diff|pixel/i)
    })
  })

  it("settles a spring transition to its endpoint", async () => {
    await withResult(async (result, directory) => {
      const golden = path.join(directory, "golden.png")
      result.renderer.captureScreenshot(golden)
      result.rerender(<Fader lit={false} easing={{ type: "spring", stiffness: 100, damping: 10, mass: 1 }} />)
      result.renderer.flush()
      result.rerender(<Fader lit easing={{ type: "spring", stiffness: 100, damping: 10, mass: 1 }} />)
      expect(result.renderer.getActiveAnimationCount()).toBeGreaterThan(0)

      await expect(result).toMatchScreenshot({ resolveScreenshotPath: screenshotPath(directory) })
      expect(result.renderer.getActiveAnimationCount()).toBe(0)
    })
  })

  it("warns and captures when a motion animation does not settle within the budget", async () => {
    await withResult(async (result, directory) => {
      const golden = path.join(directory, "golden.png")
      result.rerender(
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: 200 }}
          transition={{ duration: 1_000_000_000, ease: "linear" }}
          style={{ width: 200, height: 80, backgroundColor: "#1e2430" }}
        />
      )
      result.renderer.captureScreenshot(golden)
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
      try {
        await expect(result).toMatchScreenshot({ resolveScreenshotPath: screenshotPath(directory) })
        expect(warning).toHaveBeenCalledTimes(1)
        expect(warning.mock.calls[0]?.[0]).toMatch(
          /toMatchScreenshot.*window.*active animation\(s\) remain/
        )
      } finally {
        warning.mockRestore()
      }
    })
  })

  it("restores whether the clock was running or paused", async () => {
    await withResult(async (result, directory) => {
      const golden = path.join(directory, "golden.png")
      result.renderer.captureScreenshot(golden)
      expect(result.renderer.isClockPaused()).toBe(false)
      await expect(result).toMatchScreenshot({ resolveScreenshotPath: screenshotPath(directory) })
      expect(result.renderer.isClockPaused()).toBe(false)

      result.renderer.clockPause()
      expect(result.renderer.isClockPaused()).toBe(true)
      await expect(result).toMatchScreenshot({ resolveScreenshotPath: screenshotPath(directory) })
      expect(result.renderer.isClockPaused()).toBe(true)
    })
  })
})
