import path from "node:path"

import React from "react"
import { describe, expect, it, vi } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { motion } from "../index.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip
const STYLE_TRANSITION_SUPPORT_MESSAGE =
  "Style transitions are available on <div> and <text>. <img>, <canvas>, <code>, " +
  "<diff>, <input>, <textarea>, <markdown>, and <anchored> support outer-container " +
  "properties only."

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

const customSurfaceFixtures = [
  {
    name: "canvas",
    render: (expanded: boolean) => (
      <canvas data-testid="custom-family-target" style={customTransitionStyle(expanded)} />
    ),
  },
  {
    name: "code",
    render: (expanded: boolean) => (
      <code
        code="const covered = true"
        data-testid="custom-family-target"
        style={customTransitionStyle(expanded)}
      />
    ),
  },
  {
    name: "diff",
    render: (expanded: boolean) => (
      <diff patch="" data-testid="custom-family-target" style={customTransitionStyle(expanded)} />
    ),
  },
  {
    name: "input",
    render: (expanded: boolean) => (
      <input
        value="covered"
        data-testid="custom-family-target"
        style={customTransitionStyle(expanded)}
      />
    ),
  },
  {
    name: "textarea",
    render: (expanded: boolean) => (
      <textarea
        value="covered"
        data-testid="custom-family-target"
        style={customTransitionStyle(expanded)}
      />
    ),
  },
  {
    name: "markdown",
    render: (expanded: boolean) => (
      <markdown
        source="covered"
        data-testid="custom-family-target"
        style={customTransitionStyle(expanded)}
      />
    ),
  },
  {
    name: "anchored",
    render: (expanded: boolean) => (
      <anchored
        position={{ x: 20, y: 20 }}
        data-testid="custom-family-target"
        style={customTransitionStyle(expanded)}
      >
        <text style={{ color: "#ffffff" }}>covered</text>
      </anchored>
    ),
  },
]

describeNative("native style transitions", () => {
  it("ignores an extreme duration for spring easing through state styles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: true })
    try {
      root.renderer.clockPause()
      root.render(
        <div style={{ width: 300, height: 120, padding: 10 }}>
          <div
            data-testid="spring-hover-target"
            style={{
              width: 100,
              height: 80,
              opacity: 0.2,
              hover: { width: 200, opacity: 0.8 },
              transition: {
                properties: ["width", "opacity"],
                durationMs: 1e300,
                easing: { type: "spring" },
              },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("spring-hover-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)

      root.renderer.advanceAsyncClock(100)
      expect(root.renderer.getResolvedStyle(target.id)?.width).toBeCloseTo(134.03, 1)
      root.renderer.advanceAsyncClock(200)
      expect(root.renderer.getResolvedStyle(target.id)?.width).toBeGreaterThan(200)
      root.renderer.advanceAsyncClock(4_000)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 200, opacity: 0.8 })
      expect(warn).not.toHaveBeenCalled()
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
      warn.mockRestore()
    }
  })

  it("interpolates React-driven style updates from the visible value", () => {
    const root = createTestRoot()
    const card = (expanded: boolean) => (
      <div
        data-testid="updated-target"
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

  it("clears a descendant transition when its ancestor is hidden", () => {
    const root = createTestRoot()
    const view = (hidden: boolean, expanded: boolean) => (
      <div
        data-testid="transition-parent"
        style={{ display: hidden ? "none" : "flex", width: 300, height: 80 }}
      >
        <div
          data-testid="transition-child"
          style={{
            width: expanded ? 200 : 100,
            height: 20,
            transition: { properties: ["width"], durationMs: 100, easing: "linear" },
          }}
        />
      </div>
    )

    try {
      root.renderer.clockPause()
      root.render(view(false, false))
      const child = root.renderer.findByTestId("transition-child")!

      root.render(view(false, true))
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(child.id)).toMatchObject({ width: 150 })

      root.render(view(true, true))
      root.render(view(false, true))
      expect(root.renderer.getResolvedStyle(child.id)).toMatchObject({ width: 200 })
      expect(root.renderer.getElementBounds(child.id)).toEqual([0, 0, 200, 20])
    } finally {
      root.unmount()
    }
  })

  it("interpolates img width and opacity on the paused frame clock", () => {
    const root = createTestRoot()
    const image = (expanded: boolean) => (
      <img
        data-testid="transitioning-image"
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

  it.each(customSurfaceFixtures)(
    "interpolates React-driven container styles on the <$name> custom surface",
    ({ render }) => {
      const root = createTestRoot()
      try {
        root.renderer.clockPause()
        root.render(render(false))
        const target = root.renderer.findByTestId("custom-family-target")!

        root.render(render(true))
        expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
          width: 100,
          opacity: 0.2,
        })
        root.renderer.advanceAsyncClock(50)
        expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
          width: 120,
          opacity: 0.5,
        })
        root.renderer.advanceAsyncClock(50)
        expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
          width: 140,
          opacity: 0.8,
        })
      } finally {
        root.unmount()
      }
    }
  )

  it("interpolates input focus refinements through the retained custom-surface track", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <input
          value="focus"
          data-testid="focus-transition-input"
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

  it("warns once per unsupported transition declaration in non-strict roots", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: false })
    const customRoot = createTestRoot({ strictStyles: false })

    try {
      root.render(
        <virtual-list
          itemCount={0}
          data-testid="inert-transition"
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
          data-testid="inert-transition"
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

      const markdown = (property: "opacity" | "color") => (
        <markdown
          source="internal colour"
          data-testid="internal-colour-transition"
          style={{
            opacity: 0.5,
            color: "#ffffff",
            transition: {
              properties: [property],
              durationMs: 100,
              delayMs: 0,
              easing: "ease",
            },
          }}
        />
      )
      customRoot.render(markdown("opacity"))
      customRoot.render(markdown("color"))

      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('<virtual-list data-testid="inert-transition">')
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(STYLE_TRANSITION_SUPPORT_MESSAGE))
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('does not support style.transition property "color"')
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("outer-container properties only"))
    } finally {
      warn.mockRestore()
      root.unmount()
      customRoot.unmount()
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
            data-testid="transition-group"
            style={{
              hoverGroup: "transition-group",
              width: 240,
              height: 180,
              padding: 30,
              backgroundColor: "#242438",
            }}
          >
            <div
              data-testid="hover-within-target"
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

  it("interpolates hoverWithin refinements on custom elements", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <div
          data-testid="custom-hover-within-group"
          style={{ hoverGroup: "custom-hover-within-group" }}
        >
          <code
            code="not part of this gap"
            data-testid="custom-hover-within-target"
            style={{
              width: 180,
              height: 60,
              pointerEvents: "none",
              opacity: 0.2,
              hoverWithin: { opacity: 0.8 },
              transition: {
                properties: ["opacity"],
                durationMs: 100,
                delayMs: 0,
                easing: "linear",
              },
            }}
          />
        </div>
      )
      const group = root.renderer.findByTestId("custom-hover-within-group")!
      const target = root.renderer.findByTestId("custom-hover-within-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(group.id)!

      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBe(0.2)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBe(0.5)
      root.renderer.advanceAsyncClock(50)
      expect(root.renderer.getResolvedStyle(target.id)?.opacity).toBe(0.8)
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
        data-testid="custom-update-target"
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
          data-testid="custom-hover-target"
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
          data-testid="hovering-image"
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
            data-testid="transition-target"
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
            data-testid="reduced-target"
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
        <div
          data-testid="reduced-group"
          style={{ hoverGroup: "reduced-group", width: 260, height: 120 }}
        >
          <div
            data-testid="reduced-hover-within-target"
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
        data-testid="reduced-custom-target"
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
        <div style={{ hoverGroup: "idle-group", width: 300, height: 160 }}>
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
            data-testid="leaving-target"
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
            data-testid="leaving-custom-target"
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
    const internalColourRoot = createTestRoot({ strictStyles: true })

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

      internalColourRoot.render(
        <markdown
          source="unsupported internal colour"
          style={{
            color: "#ffffff",
            transition: {
              properties: ["color"],
              durationMs: 100,
              delayMs: 0,
              easing: "ease",
            },
          }}
        />
      )
      expect(error.mock.calls.flat()).toContainEqual(
        expect.objectContaining({
          name: "UnsupportedStyleTransitionError",
          message: expect.stringContaining(
            'does not support style.transition property "color"'
          ),
        })
      )
    } finally {
      error.mockRestore()
      root.unmount()
      internalColourRoot.unmount()
    }
  })
})

describeNative("motion spring easing", () => {
  it("samples overshoot natively and ignores a fixed duration", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <motion.div
          data-testid="motion-spring-target"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 100, opacity: 1 }}
          transition={{
            duration: 0,
            ease: { type: "spring", stiffness: 100, damping: 10, mass: 1 },
          }}
          style={{ height: 80 }}
        />
      )

      const target = root.renderer.findByTestId("motion-spring-target")!
      root.renderer.advanceAsyncClock(100)
      expect(root.renderer.getResolvedStyle(target.id)?.width).toBeCloseTo(34.03, 1)
      root.renderer.advanceAsyncClock(200)
      expect(root.renderer.getResolvedStyle(target.id)?.width).toBeGreaterThan(100)
      root.renderer.advanceAsyncClock(4_000)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ width: 100, opacity: 1 })
    } finally {
      root.unmount()
    }
  })
})

describeNative("intrinsic size transitions", { timeout: 20_000 }, () => {
  const LANE_TEXT = "Lane contents"
  const laneBase = {
    display: "flex" as const,
    minWidth: 0,
    overflow: "hidden" as const,
    height: 40,
  }
  const laneTransition = {
    properties: ["width"] as Array<"width">,
    durationMs: 120,
    easing: "linear" as const,
  }

  /** The lane, plus an untransitioned reference carrying the same content at
   *  `width: "auto"`. The reference's painted width is the number the
   *  transition must travel to, so a wrong measurement basis fails. */
  const lanes = (
    open: boolean,
    options: {
      interpolateSize?: "numeric-only" | "allow-keywords"
      laneInterpolateSize?: "numeric-only" | "allow-keywords"
      content?: string
    } = {}
  ) => (
    <div
      style={{
        display: "flex",
        width: 600,
        height: 120,
        interpolateSize: options.interpolateSize,
      }}
    >
      <div
        data-testid="lane"
        style={{
          ...laneBase,
          interpolateSize: options.laneInterpolateSize,
          width: open ? "auto" : 0,
          transition: laneTransition,
        }}
      >
        <text style={{ whiteSpace: "nowrap" }}>{options.content ?? LANE_TEXT}</text>
      </div>
      <div data-testid="reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
        <text style={{ whiteSpace: "nowrap" }}>{options.content ?? LANE_TEXT}</text>
      </div>
    </div>
  )

  const widths = (root: ReturnType<typeof createTestRoot>) => {
    const lane = root.renderer.findByTestId("lane")!
    const reference = root.renderer.findByTestId("reference")!
    return {
      lane: root.renderer.getElementBounds(lane.id)![2],
      reference: root.renderer.getElementBounds(reference.id)![2],
    }
  }

  it("opens a width transition to the laid-out intrinsic size and settles content-sized", () => {
    const root = createTestRoot({ strictStyles: true })
    try {
      root.renderer.clockPause()
      root.render(lanes(false, { interpolateSize: "allow-keywords" }))
      expect(widths(root).lane).toBeCloseTo(0, 1)
      const content = widths(root).reference
      expect(content).toBeGreaterThan(20)

      root.render(lanes(true, { interpolateSize: "allow-keywords" }))
      expect(widths(root).lane).toBeCloseTo(0, 1)

      const samples: number[] = []
      for (let elapsed = 30; elapsed <= 90; elapsed += 30) {
        root.renderer.advanceAsyncClock(30)
        samples.push(widths(root).lane)
      }
      for (const [index, sample] of samples.entries()) {
        expect(sample).toBeGreaterThan(index === 0 ? 0 : samples[index - 1]!)
        expect(sample).toBeLessThan(content)
      }
      // Halfway through a linear 120ms run.
      // Edges snap to whole pixels, so a half-pixel midpoint lands one pixel either side.
      expect(Math.abs(samples[1]! - content / 2)).toBeLessThanOrEqual(0.5)

      root.renderer.advanceAsyncClock(30)
      expect(widths(root).lane).toBeCloseTo(content, 1)

      // Settled means `width: auto` again, not a pinned pixel width: new
      // content resizes the lane on the next frame with no second transition.
      root.render(lanes(true, { interpolateSize: "allow-keywords", content: `${LANE_TEXT} widened` }))
      const grown = widths(root)
      expect(grown.reference).toBeGreaterThan(content)
      expect(grown.lane).toBeCloseTo(grown.reference, 1)
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
    }
  })

  it("closes a width transition from the laid-out intrinsic size", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(lanes(true, { interpolateSize: "allow-keywords" }))
      const content = widths(root).reference
      expect(widths(root).lane).toBeCloseTo(content, 1)

      root.render(lanes(false, { interpolateSize: "allow-keywords" }))
      expect(widths(root).lane).toBeCloseTo(content, 1)

      root.renderer.advanceAsyncClock(60)
      const middle = widths(root).lane
      expect(middle).toBeLessThan(content)
      expect(middle).toBeGreaterThan(0)
      // Edges snap to whole pixels, so a half-pixel midpoint lands one pixel either side.
      expect(Math.abs(middle - content / 2)).toBeLessThanOrEqual(0.5)

      root.renderer.advanceAsyncClock(60)
      expect(widths(root).lane).toBeCloseTo(0, 1)
    } finally {
      root.unmount()
    }
  })

  it("keeps the declared duration when the content changes mid-run", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(lanes(false, { interpolateSize: "allow-keywords" }))
      root.render(lanes(true, { interpolateSize: "allow-keywords" }))
      const latched = widths(root).reference

      // Content grows on every frame, the way streaming text does. The
      // endpoint the run latched holds, so the clock is never pushed out.
      let content = LANE_TEXT
      for (let frame = 0; frame < 6; frame += 1) {
        content += " x"
        root.render(lanes(true, { interpolateSize: "allow-keywords", content }))
        const running = widths(root)
        expect(running.lane).toBeLessThanOrEqual(latched + 0.5)
        root.renderer.advanceAsyncClock(20)
      }

      // 120ms of clock has elapsed, so the run is over and the lane is
      // content-sized again: it paints the content it has now, not the size it
      // was aiming at when it started.
      const settled = widths(root)
      expect(settled.reference).toBeGreaterThan(latched)
      expect(settled.lane).toBeCloseTo(settled.reference, 1)
      root.renderer.advanceAsyncClock(20)
      expect(widths(root).lane).toBeCloseTo(settled.reference, 1)
    } finally {
      root.unmount()
    }
  })

  it("finishes on time when a nested transition resizes the content", () => {
    const root = createTestRoot()
    const view = (open: boolean, inner: number) => (
      <div style={{ display: "flex", width: 600, height: 120, interpolateSize: "allow-keywords" }}>
        <div
          data-testid="lane"
          style={{ ...laneBase, width: open ? "auto" : 0, transition: laneTransition }}
        >
          <div
            data-testid="inner"
            style={{
              width: inner,
              height: 20,
              flexShrink: 0,
              transition: { properties: ["width"], durationMs: 480, easing: "linear" },
            }}
          />
        </div>
      </div>
    )
    const width = (testId: string) =>
      root.renderer.getElementBounds(root.renderer.findByTestId(testId)!.id)![2]

    try {
      root.renderer.clockPause()
      root.render(view(false, 40))
      root.render(view(true, 40))
      // The inner element starts its own, four times longer run.
      root.render(view(true, 200))

      root.renderer.advanceAsyncClock(60)
      expect(width("lane")).toBeLessThan(width("inner"))

      // 120ms: the outer run is over on its own clock, so the lane is
      // content-sized around whatever the inner element is now.
      root.renderer.advanceAsyncClock(60)
      expect(width("lane")).toBeCloseTo(width("inner"), 1)
      root.renderer.advanceAsyncClock(60)
      expect(width("lane")).toBeCloseTo(width("inner"), 1)
    } finally {
      root.unmount()
    }
  })

  it("keeps a settled intrinsic width while another property animates", () => {
    const root = createTestRoot()
    const view = (content: string, opacity: number) => (
      <div style={{ display: "flex", width: 600, height: 120, interpolateSize: "allow-keywords" }}>
        <div
          data-testid="lane"
          style={{
            ...laneBase,
            width: "auto",
            opacity,
            transition: {
              properties: ["width", "opacity"],
              durationMs: 120,
              easing: "linear",
            },
          }}
        >
          <text style={{ whiteSpace: "nowrap" }}>{content}</text>
        </div>
        <div data-testid="reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
          <text style={{ whiteSpace: "nowrap" }}>{content}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      root.render(view(LANE_TEXT, 1))
      root.renderer.advanceAsyncClock(200)
      const initial = widths(root)
      expect(initial.lane).toBeCloseTo(initial.reference, 1)

      // Settled at `auto` means content-sized, so growing the content moves
      // the lane with no transition involved.
      const grown = `${LANE_TEXT} and then some more`
      root.render(view(grown, 1))
      const wide = widths(root)
      expect(wide.reference).toBeGreaterThan(initial.reference)
      expect(wide.lane).toBeCloseTo(wide.reference, 1)

      // An opacity-only run must not pin the width to the number that was
      // latched when the endpoint was last measured.
      root.render(view(grown, 0.2))
      for (let frame = 0; frame < 4; frame += 1) {
        root.renderer.advanceAsyncClock(30)
        expect(widths(root).lane).toBeCloseTo(wide.reference, 1)
      }
      expect(root.renderer.getResolvedStyle(root.renderer.findByTestId("lane")!.id)?.opacity)
        .toBeCloseTo(0.2)
    } finally {
      root.unmount()
    }
  })

  it("reads a scrollport parent the way the renderer lays it out", () => {
    const root = createTestRoot()
    const view = (open: boolean, overflow: "scroll-x" | "scroll-both") => (
      <div
        style={{
          width: 500,
          height: 200,
          interpolateSize: "allow-keywords",
          ...(overflow === "scroll-x" ? { overflowX: "scroll" as const } : { overflow: "scroll" as const }),
        }}
      >
        <div
          data-testid="lane"
          style={{ ...laneBase, width: open ? "auto" : 0, transition: laneTransition }}
        >
          <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
        </div>
      </div>
    )
    const laneWidth = () =>
      root.renderer.getElementBounds(root.renderer.findByTestId("lane")!.id)![2]

    try {
      root.renderer.clockPause()
      // Two-axis `overflow: "scroll"` keeps block display, so the child's
      // width is stretched to the scrollport and the endpoint steps.
      root.render(view(false, "scroll-both"))
      expect(laneWidth()).toBeCloseTo(0, 1)
      root.render(view(true, "scroll-both"))
      expect(laneWidth()).toBeCloseTo(500, 1)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth()).toBeCloseTo(500, 1)
    } finally {
      root.unmount()
    }

    const xOnly = createTestRoot()
    try {
      xOnly.renderer.clockPause()
      // `overflowX: "scroll"` alone is laid out as a flex row, so the same
      // child's width is content-sized and interpolates.
      xOnly.render(view(false, "scroll-x"))
      const width = () =>
        xOnly.renderer.getElementBounds(xOnly.renderer.findByTestId("lane")!.id)![2]
      expect(width()).toBeCloseTo(0, 1)
      xOnly.render(view(true, "scroll-x"))
      xOnly.renderer.advanceAsyncClock(60)
      const middle = width()
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(200)
      xOnly.renderer.advanceAsyncClock(60)
      expect(width()).toBeGreaterThan(middle)
      expect(width()).toBeLessThan(500)
    } finally {
      xOnly.unmount()
    }
  })

  it("keeps the step on an axis the parent stretches", () => {
    const root = createTestRoot()
    const column = (open: boolean, alignItems?: "start") => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems,
          width: 400,
          height: 200,
          interpolateSize: "allow-keywords",
        }}
      >
        <div
          data-testid="lane"
          style={{ ...laneBase, width: open ? "auto" : 0, transition: laneTransition }}
        >
          <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
        </div>
      </div>
    )
    const laneWidth = () =>
      root.renderer.getElementBounds(root.renderer.findByTestId("lane")!.id)![2]

    try {
      root.renderer.clockPause()
      // Cross axis of a column, default `stretch`: `auto` is the parent's
      // width, which no content measurement describes. Stepping is honest;
      // crawling from 0 toward the content width and then jumping to 400
      // would not be.
      root.render(column(false))
      expect(laneWidth()).toBeCloseTo(0, 1)
      root.render(column(true))
      expect(laneWidth()).toBeCloseTo(400, 1)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth()).toBeCloseTo(400, 1)

      // `alignItems: "start"` makes the same axis content-sized, so the same
      // declaration interpolates — and to a number far from the stretched one.
      // Closing under the new alignment is itself a transition, so let it land
      // before opening again.
      root.render(column(false, "start"))
      root.renderer.advanceAsyncClock(200)
      expect(laneWidth()).toBeCloseTo(0, 1)
      root.render(column(true, "start"))
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth()
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(200)
      root.renderer.advanceAsyncClock(60)
      const settled = laneWidth()
      expect(settled).toBeGreaterThan(middle)
      expect(settled).toBeLessThan(400)
    } finally {
      root.unmount()
    }
  })

  it("interpolates an intrinsic height on <text>", () => {
    const root = createTestRoot()
    const paragraph =
      "A paragraph long enough to wrap over several lines inside a narrow column."
    const view = (open: boolean) => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 220,
          height: 400,
          interpolateSize: "allow-keywords",
        }}
      >
        <text
          data-testid="lane"
          style={{
            overflow: "hidden",
            height: open ? "auto" : 0,
            transition: { properties: ["height"], durationMs: 120, easing: "linear" },
          }}
        >
          {paragraph}
        </text>
        <text data-testid="reference" style={{ flexShrink: 0, height: "auto" }}>
          {paragraph}
        </text>
      </div>
    )
    const height = (testId: string) =>
      root.renderer.getElementBounds(root.renderer.findByTestId(testId)!.id)![3]

    try {
      root.renderer.clockPause()
      root.render(view(false))
      expect(height("lane")).toBeCloseTo(0, 1)
      const content = height("reference")
      // Several wrapped lines: the endpoint is measured at the width the
      // element paints at, not at max-content on one line.
      expect(content).toBeGreaterThan(40)

      root.render(view(true))
      expect(height("lane")).toBeCloseTo(0, 1)
      root.renderer.advanceAsyncClock(60)
      const middle = height("lane")
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(content)
      expect(middle).toBeCloseTo(content / 2, 0)
      root.renderer.advanceAsyncClock(60)
      expect(height("lane")).toBeCloseTo(content, 1)
    } finally {
      root.unmount()
    }
  })

  it("steps an intrinsic endpoint by default and under numeric-only", () => {
    const root = createTestRoot({ strictStyles: true })
    try {
      root.renderer.clockPause()
      // No declaration anywhere in the ancestor chain.
      root.render(lanes(false))
      const content = widths(root).reference
      root.render(lanes(true))
      expect(widths(root).lane).toBeCloseTo(content, 1)
      root.renderer.advanceAsyncClock(60)
      expect(widths(root).lane).toBeCloseTo(content, 1)

      // An own `numeric-only` turns the inherited opt-in back off.
      root.render(
        lanes(false, { interpolateSize: "allow-keywords", laneInterpolateSize: "numeric-only" })
      )
      expect(widths(root).lane).toBeCloseTo(0, 1)
      root.render(
        lanes(true, { interpolateSize: "allow-keywords", laneInterpolateSize: "numeric-only" })
      )
      expect(widths(root).lane).toBeCloseTo(content, 1)
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
    }
  })

  it("snaps an intrinsic endpoint with reduced motion and requests no extra frames", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.renderer.setReducedMotion(true)
      root.render(lanes(false, { interpolateSize: "allow-keywords" }))
      const content = widths(root).reference
      const requests = root.renderer.getStyleTransitionFrameRequestCount()

      root.render(lanes(true, { interpolateSize: "allow-keywords" }))
      expect(widths(root).lane).toBeCloseTo(content, 1)
      expect(root.renderer.getStyleTransitionFrameRequestCount()).toBe(requests)
    } finally {
      root.renderer.setReducedMotion(false)
      root.unmount()
    }
  })

  it("interpolates a hover refinement that targets an intrinsic width", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <div style={{ display: "flex", width: 600, height: 120, interpolateSize: "allow-keywords" }}>
          <div
            data-testid="hover-lane"
            style={{
              ...laneBase,
              width: 40,
              hover: { width: "auto" },
              transition: laneTransition,
            }}
          >
            <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
          </div>
          <div data-testid="reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
            <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
          </div>
        </div>
      )
      const lane = root.renderer.findByTestId("hover-lane")!
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("reference")!.id
      )![2]
      const [x, y, width, height] = root.renderer.getElementBounds(lane.id)!
      expect(width).toBeCloseTo(40, 1)

      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      root.renderer.advanceAsyncClock(60)
      const middle = root.renderer.getElementBounds(lane.id)![2]
      expect(middle).toBeGreaterThan(40)
      expect(middle).toBeLessThan(content)

      root.renderer.advanceAsyncClock(60)
      expect(root.renderer.getElementBounds(lane.id)![2]).toBeCloseTo(content, 1)
    } finally {
      root.unmount()
    }
  })

  /** `lanes`, parametrized by the declared width instead of just open/closed,
   *  for the keyword endpoints. */
  const laneAt = (
    width: number | string,
    options: {
      interpolateSize?: "numeric-only" | "allow-keywords"
      laneInterpolateSize?: "numeric-only" | "allow-keywords"
      content?: string
    } = {}
  ) => (
    <div
      style={{
        display: "flex",
        width: 600,
        height: 120,
        interpolateSize: options.interpolateSize,
      }}
    >
      <div
        data-testid="lane"
        style={{
          ...laneBase,
          width,
          interpolateSize: options.laneInterpolateSize,
          transition: laneTransition,
        }}
      >
        {/* No `whiteSpace: "nowrap"` here: the lane's min-content and
            max-content need to differ, so its own content must be free to
            wrap at the query that asks for the narrower one. */}
        <text>{options.content ?? LANE_TEXT}</text>
      </div>
      <div data-testid="max-content-reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
        <text style={{ whiteSpace: "nowrap" }}>{options.content ?? LANE_TEXT}</text>
      </div>
      {/* min-content is the longest word in `LANE_TEXT` ("Lane contents"):
          measuring just that word, unwrapped, gives the same number
          `grid-layout.test.tsx` uses for a min-content grid track. */}
      <div data-testid="min-content-reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
        <text style={{ whiteSpace: "nowrap" }}>contents</text>
      </div>
    </div>
  )

  const laneWidth = (root: ReturnType<typeof createTestRoot>) =>
    root.renderer.getElementBounds(root.renderer.findByTestId("lane")!.id)![2]

  it("opens a width transition to max-content and settles as the keyword", () => {
    const root = createTestRoot({ strictStyles: true })
    try {
      root.renderer.clockPause()
      root.render(laneAt(0, { interpolateSize: "allow-keywords" }))
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]

      root.render(laneAt("max-content", { interpolateSize: "allow-keywords" }))
      expect(laneWidth(root)).toBeCloseTo(0, 1)
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth(root)
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(content)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(content, 1)

      // Settled means the declared keyword again: a later content growth
      // resizes the lane with no second run.
      root.render(
        laneAt("max-content", {
          interpolateSize: "allow-keywords",
          content: `${LANE_TEXT} widened`,
        })
      )
      const grown = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]
      expect(grown).toBeGreaterThan(content)
      expect(laneWidth(root)).toBeCloseTo(grown, 1)
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
    }
  })

  it("closes a width transition to max-content from the measured width", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(laneAt("max-content", { interpolateSize: "allow-keywords" }))
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]
      expect(laneWidth(root)).toBeCloseTo(content, 1)

      root.render(laneAt(0, { interpolateSize: "allow-keywords" }))
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth(root)
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(content)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(0, 1)
    } finally {
      root.unmount()
    }
  })

  it("opens a width transition to min-content in a fixture where min and max differ", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(laneAt(0, { interpolateSize: "allow-keywords" }))
      const minContent = root.renderer.getElementBounds(
        root.renderer.findByTestId("min-content-reference")!.id
      )![2]
      const maxContent = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]
      expect(minContent).toBeLessThan(maxContent)

      root.render(laneAt("min-content", { interpolateSize: "allow-keywords" }))
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth(root)
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(minContent)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(minContent, 1)
    } finally {
      root.unmount()
    }
  })

  it("interpolates a width transition from min-content to max-content", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(laneAt("min-content", { interpolateSize: "allow-keywords" }))
      const minContent = laneWidth(root)
      const maxContent = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]
      expect(minContent).toBeLessThan(maxContent)

      root.render(laneAt("max-content", { interpolateSize: "allow-keywords" }))
      expect(laneWidth(root)).toBeCloseTo(minContent, 1)
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth(root)
      expect(middle).toBeGreaterThan(minContent)
      expect(middle).toBeLessThan(maxContent)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(maxContent, 1)
    } finally {
      root.unmount()
    }
  })

  it("clamps a fit-content endpoint to the parent basis and a fit-content() limit", () => {
    // A basis and a limit strictly between this content's min-content and
    // max-content, so the clamp lands on them rather than floor/ceiling to a
    // bound.
    const measuring = createTestRoot()
    measuring.renderer.clockPause()
    measuring.render(laneAt(0, { interpolateSize: "allow-keywords" }))
    const minContent = measuring.renderer.getElementBounds(
      measuring.renderer.findByTestId("min-content-reference")!.id
    )![2]
    const maxContent = measuring.renderer.getElementBounds(
      measuring.renderer.findByTestId("max-content-reference")!.id
    )![2]
    measuring.unmount()
    // A whole pixel: layout edges snap to whole pixels, and a half-pixel
    // basis would land the clamp one pixel either side of it.
    const between = Math.round((minContent + maxContent) / 2)

    const root = createTestRoot()
    const view = (width: number | string, parentWidth: number) => (
      <div
        style={{
          display: "flex",
          width: parentWidth,
          height: 120,
          interpolateSize: "allow-keywords",
        }}
      >
        <div data-testid="lane" style={{ ...laneBase, width, transition: laneTransition }}>
          {/* No `whiteSpace: "nowrap"`: it would make min-content and
              max-content equal, and this fixture needs them to differ. */}
          <text>{LANE_TEXT}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      // A parent narrower than the content's max-content clamps the bare
      // keyword to the containing block's content-box width.
      root.render(view(0, between))
      root.render(view("fit-content", between))
      root.renderer.advanceAsyncClock(120)
      expect(laneWidth(root)).toBeCloseTo(between, 1)

      // `fit-content(<limit>)` clamps to the limit instead.
      root.render(view(0, 600))
      root.renderer.advanceAsyncClock(120)
      root.render(view(`fit-content(${between}px)`, 600))
      root.renderer.advanceAsyncClock(120)
      expect(laneWidth(root)).toBeCloseTo(between, 1)
    } finally {
      root.unmount()
    }
  })

  it("interpolates a height transition to max-content", () => {
    const root = createTestRoot()
    const view = (height: number | string) => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 220,
          height: 400,
          interpolateSize: "allow-keywords",
        }}
      >
        <text
          data-testid="lane"
          style={{
            overflow: "hidden",
            height,
            transition: { properties: ["height"], durationMs: 120, easing: "linear" },
          }}
        >
          {LANE_TEXT}
        </text>
        <text data-testid="reference" style={{ flexShrink: 0, height: "auto" }}>
          {LANE_TEXT}
        </text>
      </div>
    )
    const height = () =>
      root.renderer.getElementBounds(root.renderer.findByTestId("lane")!.id)![3]

    try {
      root.renderer.clockPause()
      root.render(view(0))
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("reference")!.id
      )![3]

      root.render(view("max-content"))
      root.renderer.advanceAsyncClock(60)
      const middle = height()
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(content)
      root.renderer.advanceAsyncClock(60)
      expect(height()).toBeCloseTo(content, 1)
    } finally {
      root.unmount()
    }
  })

  it("ends at the unwrapped height when both width and height travel to auto together", () => {
    const root = createTestRoot()
    const paragraph =
      "A paragraph long enough to wrap over several lines if it were measured at a narrow width."
    // A flex row with `alignItems: "flex-start"` content-sizes both the main
    // axis (width) and the cross axis (height) of an unstretched item. The
    // lane's own text can wrap; the reference's cannot, so its height is the
    // single-line number both axes traveling to `auto` at once must land on
    // too — the folded probe offers both axes unbounded space, the way one
    // `(MaxContent, MaxContent)` layout always has.
    const view = (open: boolean) => (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          width: 900,
          height: 400,
          interpolateSize: "allow-keywords",
        }}
      >
        <div
          data-testid="lane"
          style={{
            flexShrink: 0,
            overflow: "hidden",
            minWidth: 0,
            minHeight: 0,
            width: open ? "auto" : 0,
            height: open ? "auto" : 0,
            transition: {
              properties: ["width", "height"],
              durationMs: 120,
              easing: "linear",
            },
          }}
        >
          <text>{paragraph}</text>
        </div>
        <div
          data-testid="reference"
          style={{ flexShrink: 0, width: "auto", height: "auto" }}
        >
          <text style={{ whiteSpace: "nowrap" }}>{paragraph}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      root.render(view(false))
      const unwrapped = root.renderer.getElementBounds(
        root.renderer.findByTestId("reference")!.id
      )![3]

      root.render(view(true))
      root.renderer.advanceAsyncClock(120)
      const bounds = root.renderer.getElementBounds(root.renderer.findByTestId("lane")!.id)!
      expect(bounds[3]).toBeCloseTo(unwrapped, 1)
    } finally {
      root.unmount()
    }
  })

  it("clamps fit-content to the parent's content-box width, not its border box", () => {
    const measuring = createTestRoot()
    measuring.renderer.clockPause()
    measuring.render(laneAt(0, { interpolateSize: "allow-keywords" }))
    const minContent = measuring.renderer.getElementBounds(
      measuring.renderer.findByTestId("min-content-reference")!.id
    )![2]
    const maxContent = measuring.renderer.getElementBounds(
      measuring.renderer.findByTestId("max-content-reference")!.id
    )![2]
    measuring.unmount()
    const between = Math.round((minContent + maxContent) / 2)

    const root = createTestRoot()
    // The parent's border box is 34px wider than its content box (16px
    // padding and 1px border on each side). A basis that ignored the
    // shorthands would clamp to the border-box width and overshoot `between`.
    const parentWidth = between + 2 * 16 + 2 * 1
    const view = (width: number | string) => (
      <div
        style={{
          display: "flex",
          width: parentWidth,
          height: 120,
          padding: 16,
          borderWidth: 1,
          interpolateSize: "allow-keywords",
        }}
      >
        <div data-testid="lane" style={{ ...laneBase, width, transition: laneTransition }}>
          <text>{LANE_TEXT}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      root.render(view(0))
      root.render(view("fit-content"))
      root.renderer.advanceAsyncClock(120)
      expect(laneWidth(root)).toBeCloseTo(between, 1)
    } finally {
      root.unmount()
    }
  })

  it("steps a keyword endpoint under numeric-only and snaps it with reduced motion", () => {
    const root = createTestRoot({ strictStyles: true })
    try {
      root.renderer.clockPause()
      root.render(laneAt(0, { interpolateSize: "allow-keywords" }))
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("max-content-reference")!.id
      )![2]

      // `"numeric-only"` on the lane itself turns the inherited opt-in back
      // off, so the keyword steps rather than interpolating.
      root.render(
        laneAt(0, { interpolateSize: "allow-keywords", laneInterpolateSize: "numeric-only" })
      )
      root.render(
        laneAt("max-content", {
          interpolateSize: "allow-keywords",
          laneInterpolateSize: "numeric-only",
        })
      )
      expect(laneWidth(root)).toBeCloseTo(content, 1)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(content, 1)

      // Reduced motion snaps a keyword endpoint the same way it snaps `auto`.
      root.renderer.setReducedMotion(true)
      root.render(laneAt(0, { interpolateSize: "allow-keywords" }))
      const requests = root.renderer.getStyleTransitionFrameRequestCount()
      root.render(laneAt("max-content", { interpolateSize: "allow-keywords" }))
      expect(laneWidth(root)).toBeCloseTo(content, 1)
      expect(root.renderer.getStyleTransitionFrameRequestCount()).toBe(requests)
      root.renderer.setReducedMotion(false)
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
    }
  })

  it("interpolates a hover refinement that targets max-content", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      root.render(
        <div style={{ display: "flex", width: 600, height: 120, interpolateSize: "allow-keywords" }}>
          <div
            data-testid="hover-lane"
            style={{
              ...laneBase,
              width: 40,
              hover: { width: "max-content" },
              transition: laneTransition,
            }}
          >
            <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
          </div>
          <div data-testid="reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
            <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
          </div>
        </div>
      )
      const lane = root.renderer.findByTestId("hover-lane")!
      const content = root.renderer.getElementBounds(
        root.renderer.findByTestId("reference")!.id
      )![2]
      const [x, y, width, height] = root.renderer.getElementBounds(lane.id)!
      expect(width).toBeCloseTo(40, 1)

      root.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      root.renderer.advanceAsyncClock(60)
      const middle = root.renderer.getElementBounds(lane.id)![2]
      expect(middle).toBeGreaterThan(40)
      expect(middle).toBeLessThan(content)

      root.renderer.advanceAsyncClock(60)
      expect(root.renderer.getElementBounds(lane.id)![2]).toBeCloseTo(content, 1)
    } finally {
      root.unmount()
    }
  })

  it("animates an explicit keyword endpoint on an axis the parent stretches", () => {
    const root = createTestRoot()
    const column = (width: number | string) => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 400,
          height: 200,
          interpolateSize: "allow-keywords",
        }}
      >
        <div data-testid="lane" style={{ ...laneBase, width, transition: laneTransition }}>
          <text style={{ whiteSpace: "nowrap" }}>{LANE_TEXT}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      // `auto` on the cross axis, default `stretch`, still steps straight to
      // the parent's width.
      root.render(column(0))
      root.render(column("auto"))
      expect(laneWidth(root)).toBeCloseTo(400, 1)
      root.renderer.advanceAsyncClock(60)
      expect(laneWidth(root)).toBeCloseTo(400, 1)

      // `max-content` on the same stretched axis is not gated by the parent
      // layout: it resolves to its own definition and animates, rather than
      // stepping straight to the measured number the way `auto` did above.
      root.render(column(0))
      root.renderer.advanceAsyncClock(120)
      expect(laneWidth(root)).toBeCloseTo(0, 1)
      root.render(column("max-content"))
      root.renderer.advanceAsyncClock(120)
      const settled = laneWidth(root)
      expect(settled).toBeGreaterThan(0)
      expect(settled).toBeLessThan(400)

      root.render(column(0))
      root.renderer.advanceAsyncClock(120)
      expect(laneWidth(root)).toBeCloseTo(0, 1)
      root.render(column("max-content"))
      root.renderer.advanceAsyncClock(60)
      const middle = laneWidth(root)
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(settled)
    } finally {
      root.unmount()
    }
  })

  it("keeps a settled keyword width while another property animates", () => {
    const root = createTestRoot()
    const view = (content: string, opacity: number) => (
      <div style={{ display: "flex", width: 600, height: 120, interpolateSize: "allow-keywords" }}>
        <div
          data-testid="lane"
          style={{
            ...laneBase,
            width: "max-content",
            opacity,
            transition: {
              properties: ["width", "opacity"],
              durationMs: 120,
              easing: "linear",
            },
          }}
        >
          <text style={{ whiteSpace: "nowrap" }}>{content}</text>
        </div>
        <div data-testid="reference" style={{ ...laneBase, flexShrink: 0, width: "auto" }}>
          <text style={{ whiteSpace: "nowrap" }}>{content}</text>
        </div>
      </div>
    )

    try {
      root.renderer.clockPause()
      root.render(view(LANE_TEXT, 1))
      root.renderer.advanceAsyncClock(200)
      const initial = widths(root)
      expect(initial.lane).toBeCloseTo(initial.reference, 1)

      const grown = `${LANE_TEXT} and then some more`
      root.render(view(grown, 1))
      const wide = widths(root)
      expect(wide.reference).toBeGreaterThan(initial.reference)
      expect(wide.lane).toBeCloseTo(wide.reference, 1)

      root.render(view(grown, 0.2))
      for (let frame = 0; frame < 4; frame += 1) {
        root.renderer.advanceAsyncClock(30)
        expect(widths(root).lane).toBeCloseTo(wide.reference, 1)
      }
    } finally {
      root.unmount()
    }
  })

  it("rejects an unknown interpolateSize value through the strict style channel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: true })
    try {
      root.render(
        <div
          data-testid="bad-interpolate-size"
          style={{
            width: 40,
            height: 40,
            interpolateSize: "allow-keywords-please" as "allow-keywords",
          }}
        />
      )
      const diagnostics = root.renderer.drainStyleDiagnostics()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        dataTestId: "bad-interpolate-size",
        property: "interpolateSize",
        value: '"allow-keywords-please"',
      })
      expect(diagnostics[0]!.message).toContain(
        "expected one of numeric-only, allow-keywords"
      )
    } finally {
      root.unmount()
      warn.mockRestore()
    }
  })
})
