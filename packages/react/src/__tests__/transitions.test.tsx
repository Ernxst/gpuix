import path from "node:path"

import React from "react"
import { describe, expect, it, vi } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("native style transitions", () => {
  it("interpolates React-driven style updates from the visible value", () => {
    const root = createTestRoot()
    const card = (expanded: boolean) => (
      <div
        testId="updated-target"
        style={{
          width: expanded ? 200 : 100,
          height: 80,
          opacity: expanded ? 0.8 : 0.2,
          backgroundColor: expanded ? "#ffffff" : "#000000",
          transition: {
            properties: ["width", "opacity", "backgroundColor"],
            durationMs: 100,
            easing: "linear",
          },
        }}
      />
    )

    try {
      root.renderer.clockPause()
      root.render(card(false))
      const target = root.renderer.findByTestId("updated-target")!

      root.render(card(true))
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 100,
        opacity: 0.2,
      })
      const framesBeforeAdvance = root.renderer.getDebugFrameOverlayStats().frames
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(
        framesBeforeAdvance + 1
      )
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 150,
        opacity: 0.5,
      })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 200,
        opacity: 0.8,
      })
    } finally {
      root.unmount()
    }
  })

  it("interpolates img width and opacity on the paused frame clock", () => {
    const root = createTestRoot()
    const image = (expanded: boolean) => (
      <img
        testId="transitioning-image"
        style={{
          width: expanded ? 200 : 100,
          height: expanded ? 80 : 40,
          opacity: expanded ? 0.8 : 0.2,
          borderRadius: expanded ? 24 : 8,
          transition: {
            properties: ["width", "height", "opacity", "borderRadius"],
            durationMs: 100,
            easing: "linear",
          },
        }}
      />
    )

    try {
      root.renderer.clockPause()
      root.render(image(false))
      const target = root.renderer.findByTestId("transitioning-image")!

      root.render(image(true))
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 100,
        height: 40,
        opacity: 0.2,
        borderTopLeftRadius: 8,
      })

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 150,
        height: 60,
        opacity: 0.5,
        borderTopLeftRadius: 16,
      })

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 200,
        height: 80,
        opacity: 0.8,
        borderTopLeftRadius: 24,
      })
    } finally {
      root.unmount()
    }
  })

  it("warns once for unsupported transition declarations in non-strict roots", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: false })

    try {
      root.render(
        <virtual-list
          itemCount={0}
          testId="inert-transition"
          style={{
            transition: {
              properties: ["opacity"],
              durationMs: 100,
              delayMs: 0,
              easing: "linear",
            },
          }}
        />
      )
      root.render(
        <virtual-list
          itemCount={0}
          testId="inert-transition"
          style={{
            transition: {
              properties: ["opacity"],
              durationMs: 200,
              delayMs: 0,
              easing: "linear",
            },
          }}
        />
      )

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('<virtual-list testId="inert-transition">')
      )
    } finally {
      warn.mockRestore()
      root.unmount()
    }
  })

  it("interpolates hover, active, and focus refinements on the paused frame clock", () => {
    const root = createTestRoot()
    const beforePath = path.join(SHOTS_DIR, "transition-hover-before.png")
    const middlePath = path.join(SHOTS_DIR, "transition-hover-middle.png")
    const afterPath = path.join(SHOTS_DIR, "transition-hover-after.png")

    try {
      root.renderer.clockPause()
      root.render(
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#11111b",
          }}
        >
          <div
            testId="transition-target"
            tabIndex={0}
            style={{
              width: 120,
              height: 120,
              opacity: 0.2,
              backgroundColor: "#000000",
              borderRadius: 8,
              hover: {
                width: 180,
                opacity: 0.8,
                backgroundColor: "#ffffff",
                borderRadius: 28,
              },
              active: { opacity: 1 },
              focus: { opacity: 0.6 },
              transition: {
                properties: [
                  "width",
                  "opacity",
                  "backgroundColor",
                  "borderRadius",
                ],
                durationMs: 100,
                easing: "linear",
              },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("transition-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      const centerX = x + width / 2
      const centerY = y + height / 2

      root.renderer.captureScreenshot(beforePath)
      root.renderer.nativeSimulateMouseMove(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 120,
        opacity: 0.2,
        borderTopLeftRadius: 8,
      })

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 150,
        opacity: 0.5,
        borderTopLeftRadius: 18,
      })
      root.renderer.captureScreenshot(middlePath)

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 180,
        opacity: 0.8,
        borderTopLeftRadius: 28,
      })
      root.renderer.captureScreenshot(afterPath)
      expectScreenshotsDiffer(beforePath, middlePath)
      expectScreenshotsDiffer(middlePath, afterPath)

      root.renderer.nativeSimulateMouseDown(centerX, centerY)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBeCloseTo(0.9)
      root.renderer.nativeSimulateMouseUp(centerX, centerY)

      root.renderer.nativeSimulateMouseMove(8, 8)
      root.renderer.advanceAsyncClock(100)
      // The press focused this tab stop, so leaving hover settles on `focus`.
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBeCloseTo(0.6)
    } finally {
      root.unmount()
    }
  })

  it("snaps state refinements when GPUI reduced motion is enabled", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.renderer.setReducedMotion(true)
      root.render(
        <div style={{ width: 300, height: 120, padding: 20 }}>
          <div
            testId="reduced-target"
            style={{
              width: 100,
              height: 60,
              opacity: 0.2,
              hover: { width: 180, opacity: 0.8 },
              transition: {
                properties: ["width", "opacity"],
                durationMs: 1_000,
              },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("reduced-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)

      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 180,
        opacity: 0.8,
      })
    } finally {
      root.unmount()
    }
  })

  it("drops retained tracks when their host element unmounts", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div>
          <div
            testId="leaving-target"
            style={{
              opacity: 0.5,
              transition: { properties: ["opacity"], durationMs: 100 },
            }}
          />
        </div>
      )
      expect(root.renderer.getStyleTransitionCount()).toBe(1)

      root.render(<div />)
      expect(root.renderer.getStyleTransitionCount()).toBe(0)
    } finally {
      root.unmount()
    }
  })

  it("throws for unsupported transition declarations in strict roots", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: true })

    try {
      root.render(
        <virtual-list
          itemCount={0}
          style={{
            transition: {
              properties: ["opacity"],
              durationMs: 100,
              delayMs: 0,
              easing: "linear",
            },
          }}
        />
      )

      expect(error.mock.calls.flat()).toContainEqual(
        expect.objectContaining({
          name: "UnsupportedStyleTransitionError",
          message: expect.stringContaining("<virtual-list> does not support style.transition"),
        })
      )
    } finally {
      error.mockRestore()
      root.unmount()
    }
  })
})
