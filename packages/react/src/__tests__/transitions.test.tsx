import path from "node:path"

import React from "react"
import { describe, expect, it, vi } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip
const STYLE_TRANSITION_SUPPORT_MESSAGE =
  "Style transitions are available on <div>, <text>, <img>, <canvas>, <code>, " +
  "<diff>, <input>, <textarea>, <markdown>, and <anchored>."

const customTransitionStyle = (expanded: boolean) => ({
  width: expanded ? 140 : 100,
  height: 52,
  opacity: expanded ? 0.8 : 0.2,
  backgroundColor: expanded ? "#ffffff" : "#000000",
  transition: {
    properties: ["width", "opacity", "backgroundColor"] as Array<
      "width" | "opacity" | "backgroundColor"
    >,
    durationMs: 100,
    easing: "linear" as const,
  },
})

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

  it("interpolates React-driven container styles on every enabled custom surface", () => {
    const fixtures = [
      {
        name: "canvas",
        render: (expanded: boolean) => (
          <canvas testId="custom-family-target" style={customTransitionStyle(expanded)} />
        ),
      },
      {
        name: "code",
        render: (expanded: boolean) => (
          <code
            code="const covered = true"
            testId="custom-family-target"
            style={customTransitionStyle(expanded)}
          />
        ),
      },
      {
        name: "diff",
        render: (expanded: boolean) => (
          <diff patch="" testId="custom-family-target" style={customTransitionStyle(expanded)} />
        ),
      },
      {
        name: "input",
        render: (expanded: boolean) => (
          <input
            value="covered"
            testId="custom-family-target"
            style={customTransitionStyle(expanded)}
          />
        ),
      },
      {
        name: "textarea",
        render: (expanded: boolean) => (
          <textarea
            value="covered"
            testId="custom-family-target"
            style={customTransitionStyle(expanded)}
          />
        ),
      },
      {
        name: "markdown",
        render: (expanded: boolean) => (
          <markdown
            source="covered"
            testId="custom-family-target"
            style={customTransitionStyle(expanded)}
          />
        ),
      },
      {
        name: "anchored",
        render: (expanded: boolean) => (
          <anchored
            position={{ x: 20, y: 20 }}
            testId="custom-family-target"
            style={customTransitionStyle(expanded)}
          >
            <text style={{ color: "#ffffff" }}>covered</text>
          </anchored>
        ),
      },
    ]

    for (const fixture of fixtures) {
      const root = createTestRoot()
      try {
        root.renderer.clockPause()
        root.render(fixture.render(false))
        const target = root.renderer.findByTestId("custom-family-target")!

        root.render(fixture.render(true))
        expect(root.renderer.getResolvedStyle(target.id), fixture.name).toMatchObject({
          width: 100,
          opacity: 0.2,
        })
        root.renderer.advanceAsyncClock(50)
        expect(root.renderer.getResolvedStyle(target.id), fixture.name).toMatchObject({
          width: 120,
          opacity: 0.5,
        })
        root.renderer.advanceAsyncClock(50)
        expect(root.renderer.getResolvedStyle(target.id), fixture.name).toMatchObject({
          width: 140,
          opacity: 0.8,
        })
      } finally {
        root.unmount()
      }
    }
  })

  it("interpolates input focus refinements through the retained custom-surface track", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <input
          value="focus"
          testId="focus-transition-input"
          style={{
            width: 120,
            height: 52,
            opacity: 0.2,
            focus: { width: 180, opacity: 0.8 },
            transition: {
              properties: ["width", "opacity"],
              durationMs: 100,
              easing: "linear",
            },
          }}
        />
      )
      const target = root.renderer.findByTestId("focus-transition-input")!

      root.renderer.focusElement(target.id)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 120, opacity: 0.2 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 150, opacity: 0.5 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 180, opacity: 0.8 })
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
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(STYLE_TRANSITION_SUPPORT_MESSAGE))
    } finally {
      warn.mockRestore()
      root.unmount()
    }
  })

  it("interpolates hoverWithin refinements from the hovered group", () => {
    const root = createTestRoot()
    const beforePath = path.join(SHOTS_DIR, "transition-hover-within-before.png")
    const middlePath = path.join(SHOTS_DIR, "transition-hover-within-middle.png")
    const afterPath = path.join(SHOTS_DIR, "transition-hover-within-after.png")

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
            hoverGroup="transition-group"
            testId="transition-group"
            style={{ width: 240, height: 180, padding: 30, backgroundColor: "#242438" }}
          >
            <div
              testId="hover-within-target"
              style={{
                width: 100,
                height: 100,
                pointerEvents: "none",
                opacity: 0.2,
                backgroundColor: "#000000",
                borderRadius: 8,
                hoverWithin: {
                  width: 180,
                  opacity: 0.8,
                  backgroundColor: "#ffffff",
                  borderRadius: 28,
                },
                transition: {
                  properties: ["width", "opacity", "backgroundColor", "borderRadius"],
                  durationMs: 100,
                  easing: "linear",
                },
              }}
            />
          </div>
        </div>
      )

      const group = root.renderer.findByTestId("transition-group")!
      const target = root.renderer.findByTestId("hover-within-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(group.id)!

      root.renderer.captureScreenshot(beforePath)
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 100,
        opacity: 0.2,
        borderTopLeftRadius: 8,
      })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        width: 140,
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
    } finally {
      root.unmount()
    }
  })

  it("does not introduce hoverWithin painting on custom elements", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <div hoverGroup="custom-hover-within-group" testId="custom-hover-within-group">
          <code
            code="not part of this gap"
            testId="custom-hover-within-target"
            style={{
              width: 180,
              height: 60,
              pointerEvents: "none",
              opacity: 0.2,
              hoverWithin: { opacity: 0.8 },
              transition: { properties: ["opacity"], durationMs: 100, easing: "linear" },
            }}
          />
        </div>
      )
      const group = root.renderer.findByTestId("custom-hover-within-group")!
      const target = root.renderer.findByTestId("custom-hover-within-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(group.id)!

      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      root.renderer.advanceAsyncClock(100)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBe(0.2)
    } finally {
      root.unmount()
    }
  })

  it("interpolates a custom surface through React-driven updates with GPU midpoint evidence", () => {
    const root = createTestRoot()
    const beforePath = path.join(SHOTS_DIR, "transition-custom-update-before.png")
    const middlePath = path.join(SHOTS_DIR, "transition-custom-update-middle.png")
    const afterPath = path.join(SHOTS_DIR, "transition-custom-update-after.png")
    const card = (expanded: boolean) => (
      <markdown
        source="Custom surface"
        testId="custom-update-target"
        style={{
          width: expanded ? 200 : 120,
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
      const target = root.renderer.findByTestId("custom-update-target")!
      root.renderer.captureScreenshot(beforePath)

      root.render(card(true))
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 120, opacity: 0.2 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 160, opacity: 0.5 })
      root.renderer.captureScreenshot(middlePath)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 200, opacity: 0.8 })
      root.renderer.captureScreenshot(afterPath)
      expectScreenshotsDiffer(beforePath, middlePath)
      expectScreenshotsDiffer(middlePath, afterPath)
    } finally {
      root.unmount()
    }
  })

  it("interpolates a hover-driven custom surface with GPU midpoint evidence", () => {
    const root = createTestRoot()
    const beforePath = path.join(SHOTS_DIR, "transition-custom-hover-before.png")
    const middlePath = path.join(SHOTS_DIR, "transition-custom-hover-middle.png")
    const afterPath = path.join(SHOTS_DIR, "transition-custom-hover-after.png")

    try {
      root.renderer.clockPause()
      root.render(
        <code
          code="const hovered = true"
          testId="custom-hover-target"
          style={{
            width: 120,
            height: 80,
            opacity: 0.2,
            backgroundColor: "#000000",
            hover: { width: 200, opacity: 0.8, backgroundColor: "#ffffff" },
            active: { opacity: 1 },
            transition: {
              properties: ["width", "opacity", "backgroundColor"],
              durationMs: 100,
              easing: "linear",
            },
          }}
        />
      )
      const target = root.renderer.findByTestId("custom-hover-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!

      root.renderer.captureScreenshot(beforePath)
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 120, opacity: 0.2 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 160, opacity: 0.5 })
      root.renderer.captureScreenshot(middlePath)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 200, opacity: 0.8 })
      root.renderer.captureScreenshot(afterPath)
      expectScreenshotsDiffer(beforePath, middlePath)
      expectScreenshotsDiffer(middlePath, afterPath)

      root.renderer.nativeSimulateMouseDown(x + width / 2, y + height / 2)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBeCloseTo(0.9)
      root.renderer.nativeSimulateMouseUp(x + width / 2, y + height / 2)
    } finally {
      root.unmount()
    }
  })

  it("drives hover transitions on img custom dispatch roots", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <img
          testId="hovering-image"
          style={{
            width: 100,
            height: 60,
            opacity: 0.2,
            hover: { width: 180, opacity: 0.8 },
            transition: {
              properties: ["width", "opacity"],
              durationMs: 100,
              easing: "linear",
            },
          }}
        />
      )
      const target = root.renderer.findByTestId("hovering-image")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 100, opacity: 0.2 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 140, opacity: 0.5 })
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 180, opacity: 0.8 })
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

  it("snaps hoverWithin transitions without requesting intermediate frames", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.renderer.setReducedMotion(true)
      root.render(
        <div hoverGroup="reduced-group" testId="reduced-group" style={{ width: 260, height: 120 }}>
          <div
            testId="reduced-hover-within-target"
            style={{
              width: 100,
              height: 60,
              opacity: 0.2,
              hoverWithin: { width: 180, opacity: 0.8 },
              transition: { properties: ["width", "opacity"], durationMs: 1_000 },
            }}
          />
        </div>
      )
      const group = root.renderer.findByTestId("reduced-group")!
      const target = root.renderer.findByTestId("reduced-hover-within-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(group.id)!
      const requests = root.renderer.getStyleTransitionFrameRequestCount()

      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 180, opacity: 0.8 })
      expect(root.renderer.getStyleTransitionFrameRequestCount()).toBe(requests)
    } finally {
      root.unmount()
    }
  })

  it("snaps custom-element style updates without requesting intermediate frames", () => {
    const root = createTestRoot()
    const card = (expanded: boolean) => (
      <markdown
        source="Reduced motion"
        testId="reduced-custom-target"
        style={{
          width: expanded ? 180 : 100,
          height: 60,
          opacity: expanded ? 0.8 : 0.2,
          transition: { properties: ["width", "opacity"], durationMs: 1_000 },
        }}
      />
    )

    try {
      root.renderer.clockPause()
      root.renderer.setReducedMotion(true)
      root.render(card(false))
      const target = root.renderer.findByTestId("reduced-custom-target")!
      const requests = root.renderer.getStyleTransitionFrameRequestCount()

      root.render(card(true))
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 180, opacity: 0.8 })
      expect(root.renderer.getStyleTransitionFrameRequestCount()).toBe(requests)
    } finally {
      root.unmount()
    }
  })

  it("keeps hoverWithin and custom-element transition tracks idle without draws", async () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <div hoverGroup="idle-group" style={{ width: 300, height: 160 }}>
          <div
            style={{
              width: 80,
              height: 40,
              hoverWithin: { width: 120 },
              transition: { properties: ["width"], durationMs: 100 },
            }}
          />
          <diff
            patch=""
            style={{
              width: 80,
              height: 40,
              opacity: 0.5,
              transition: { properties: ["width", "opacity"], durationMs: 100 },
            }}
          />
        </div>
      )
      expect(root.renderer.getStyleTransitionCount()).toBe(2)
      const requests = root.renderer.getStyleTransitionFrameRequestCount()
      const frames = root.renderer.getDebugFrameOverlayStats().frames

      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(root.renderer.getStyleTransitionFrameRequestCount()).toBe(requests)
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(frames)
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

  it("drops retained tracks when a transitioning custom element unmounts", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div>
          <code
            code="leaving"
            testId="leaving-custom-target"
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
      expect(error.mock.calls.flat()).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(STYLE_TRANSITION_SUPPORT_MESSAGE),
        })
      )
    } finally {
      error.mockRestore()
      root.unmount()
    }
  })
})
