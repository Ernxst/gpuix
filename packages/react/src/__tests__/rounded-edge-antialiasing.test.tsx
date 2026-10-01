import { describe, expect, it } from "vitest"
import React from "react"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNativeOnMac =
  isNativeTestRendererAvailable() && process.platform === "darwin"
    ? describe
    : describe.skip

describeNativeOnMac("rounded edge antialiasing", () => {
  it("matches Chromium on the dock pill's changed outer contour pixels", () => {
    const root = createTestRoot({ width: 1280, height: 800, scaleFactor: 2 })
    root.render(
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          backgroundColor: "#11171b",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 16,
            height: 0,
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "flex-end",
          }}
        >
          <aside
            data-testid="pill"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              minHeight: 48,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "#445059",
              backgroundColor: "#445059",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "stretch",
                flexShrink: 0,
              }}
            >
              <nav
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                  paddingTop: 5,
                  paddingRight: 12,
                  paddingBottom: 5,
                  paddingLeft: 12,
                  backgroundColor: "#2e383f",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 5,
                    left: 12,
                    width: 42,
                    height: 36,
                    borderRadius: 12,
                    backgroundColor: "#53616b",
                  }}
                />
                {Array.from({ length: 6 }, (_, index) => (
                  <a
                    key={index}
                    style={{
                      position: "relative",
                      display: "flex",
                      width: 42,
                      height: 36,
                      borderRadius: 12,
                    }}
                  />
                ))}
              </nav>
              <section
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  minWidth: 0,
                  flexShrink: 1,
                  overflow: "hidden",
                  backgroundColor: "#2e383f",
                  width: 0,
                }}
              />
            </span>
          </aside>
        </div>
      </div>
    )

    const bounds = root.renderer.getElementBounds(
      root.renderer.findByTestId("pill")!.id
    )!
    const { pixels, width, height } = root.renderer.captureScreenshotClipRaw(
      bounds.x * 2,
      bounds.y * 2,
      bounds.width * 2,
      bounds.height * 2
    )
    const changedPixels = [
      [39, 2, [63, 75, 83]],
      [27, 6, [63, 75, 83]],
      [25, 7, [64, 76, 85]],
      [19, 11, [64, 75, 84]],
      [11, 19, [64, 75, 84]],
      [7, 25, [64, 76, 85]],
      [6, 27, [63, 75, 83]],
      [2, 39, [63, 75, 83]],
    ] as const

    for (const [x, y, expected] of changedPixels) {
      const offset = (y * width + x) * 4
      expect(
        Array.from(pixels.subarray(offset, offset + 3)),
        `pixel (${x}, ${y})`
      ).toEqual(expected)
    }
    root.unmount()
  })
})
