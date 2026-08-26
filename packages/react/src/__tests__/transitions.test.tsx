import path from "node:path"

import React from "react"
import { describe, expect, it } from "vitest"

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
      root.renderer.advanceAsyncClock(50)
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
        borderRadius: 8,
      })

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 150,
        opacity: 0.5,
        borderRadius: 18,
      })
      root.renderer.captureScreenshot(middlePath)

      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 180,
        opacity: 0.8,
        borderRadius: 28,
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
})
