import path from "path"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("clipPath", () => {
  it("clips inset(50%) without removing layout, focus, or accessibility", () => {
    const clipped = createTestRoot({ width: 100, height: 100, strictStyles: true })
    const baseline = createTestRoot({ width: 100, height: 100, strictStyles: true })

    try {
      clipped.render(
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            width: 100,
            height: 100,
            backgroundColor: "white",
          }}
        >
          <div
            data-testid="clipped-button"
            role="button"
            ariaLabel="Clipped action"
            tabIndex={0}
            style={{ width: 40, height: 40, backgroundColor: "red", clipPath: "inset(50%)" }}
          />
          <div
            data-testid="following-box"
            style={{ width: 10, height: 10, backgroundColor: "blue" }}
          />
        </div>
      )
      baseline.render(
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            width: 100,
            height: 100,
            backgroundColor: "white",
          }}
        >
          <div style={{ width: 40, height: 40 }} />
          <div style={{ width: 10, height: 10, backgroundColor: "blue" }} />
        </div>
      )

      expect(clipped.renderer.drainStyleDiagnostics()).toEqual([])
      const button = clipped.renderer.findByTestId("clipped-button")!
      const followingBox = clipped.renderer.findByTestId("following-box")!
      expect(clipped.renderer.getElementBounds(followingBox.id)).toMatchObject({
        x: 40,
        width: 10,
        height: 10,
      })

      clipped.renderer.focusElement(button.id)
      expect(clipped.renderer.getActiveElement()).toBe(button.id)
      expect(
        Object.values(clipped.renderer.getAccessibilityTree().nodes).find(
          (node) => node.aria.role === "Button"
        )?.aria.label
      ).toBe("Clipped action")

      const clippedPath = path.join(SHOTS_DIR, "clip-path-inset-50.png")
      const baselinePath = path.join(SHOTS_DIR, "clip-path-inset-baseline.png")
      clipped.renderer.captureScreenshot(clippedPath)
      baseline.renderer.captureScreenshot(baselinePath)
      expect(clipped.renderer.compareImages(clippedPath, baselinePath, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })
    } finally {
      clipped.unmount()
      baseline.unmount()
    }
  })
})
