import { describe, it, beforeEach, afterEach } from "vitest"
import React from "react"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing"
import { expectScreenshotsEqual, SHOTS_DIR } from "./test-utils"

describe.skipIf(!isNativeTestRendererAvailable())("ancestor :hover", () => {
  let testRoot: ReturnType<typeof createTestRoot>
  beforeEach(() => {
    testRoot = createTestRoot()
  })
  afterEach(() => testRoot.unmount())

  it("keeps a row's hover style while the pointer is over a descendant link", () => {
    testRoot.render(
      <div style={{ width: "100%", height: "100%", backgroundColor: "#101010" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: 400,
            height: 60,
            paddingLeft: 200,
            backgroundColor: "#253047",
            hover: { backgroundColor: "#d97706" },
          }}
        >
          <a data-testid="link" href="#site" style={{ color: "#ffffff" }}>
            Site
          </a>
        </div>
      </div>
    )

    const link = testRoot.renderer.findByTestId("link")!
    const { x, y, width, height } = testRoot.renderer.getElementBounds(link.id)!
    const overRow = `${SHOTS_DIR}/gpuix-ancestor-hover-over-row.png`
    const overLink = `${SHOTS_DIR}/gpuix-ancestor-hover-over-link.png`

    testRoot.renderer.nativeSimulateMouseMove(20, y + height / 2)
    testRoot.renderer.captureScreenshot(overRow)
    testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    testRoot.renderer.captureScreenshot(overLink)

    expectScreenshotsEqual(overRow, overLink)
  })
})
