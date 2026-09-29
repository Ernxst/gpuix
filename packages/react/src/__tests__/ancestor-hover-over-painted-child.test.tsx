import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils"

describe.skipIf(!isNativeTestRendererAvailable())("ancestor :hover over painted children", () => {
  it.each(["fill", "hover fill"])("keeps the row painted over a child's %s", (kind) => {
    const testRoot = createTestRoot()
    const events: string[] = []
    try {
      testRoot.render(
        <div style={{ width: "100%", height: "100%", backgroundColor: "#101010" }}>
          <div
            data-testid="row"
            onMouseEnter={() => events.push("enter")}
            onMouseLeave={() => events.push("leave")}
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
            <div
              data-testid="child"
              style={{
                width: 100,
                height: 40,
                backgroundColor: kind === "fill" ? "#284f37" : undefined,
                hover: kind === "hover fill" ? { backgroundColor: "#284f37" } : undefined,
              }}
            />
          </div>
        </div>
      )

      const child = testRoot.renderer.findByTestId("child")!
      const row = testRoot.renderer.findByTestId("row")!
      const { x, y, width, height } = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(20, y + height / 2)
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      const screenshot = `${SHOTS_DIR}/gpuix-ancestor-hover-over-child-${kind.replace(" ", "-")}.png`
      testRoot.renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      const offset = ((y + height / 2) * image.width + 20) * 4

      expect([...image.data.subarray(offset, offset + 4)]).toEqual([217, 119, 6, 255])
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#d97706",
      })
      expect(events).toEqual(["enter"])

      testRoot.renderer.nativeSimulateMouseMove(500, y + height / 2)
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#253047",
      })
      expect(events).toEqual(["enter", "leave"])
    } finally {
      testRoot.unmount()
    }
  })

  it("does not keep a covered sibling hovered", () => {
    const testRoot = createTestRoot()
    try {
      testRoot.render(
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div
            data-testid="row"
            style={{
              width: 400,
              height: 60,
              backgroundColor: "#253047",
              hover: { backgroundColor: "#d97706" },
            }}
          />
          <div
            data-testid="overlay"
            style={{
              position: "absolute",
              left: 200,
              top: 0,
              width: 100,
              height: 60,
              backgroundColor: "#284f37",
            }}
          />
        </div>
      )

      const row = testRoot.renderer.findByTestId("row")!
      const overlay = testRoot.renderer.findByTestId("overlay")!
      const { x, y, width, height } = testRoot.renderer.getElementBounds(overlay.id)!
      testRoot.renderer.nativeSimulateMouseMove(20, y + height / 2)
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#d97706",
      })
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      const screenshot = `${SHOTS_DIR}/gpuix-hover-covered-sibling.png`
      testRoot.renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      const offset = ((y + height / 2) * image.width + 20) * 4

      expect([...image.data.subarray(offset, offset + 4)]).toEqual([37, 48, 71, 255])
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#253047",
      })
    } finally {
      testRoot.unmount()
    }
  })

  it("keeps a parent hovered over an absolute child outside its bounds", () => {
    const testRoot = createTestRoot()
    const events: string[] = []
    try {
      testRoot.render(
        <div style={{ width: 300, height: 100, backgroundColor: "#101010" }}>
          <div
            data-testid="row"
            onMouseEnter={() => events.push("enter")}
            onMouseLeave={() => events.push("leave")}
            style={{
              position: "relative",
              width: 100,
              height: 50,
              backgroundColor: "#253047",
              hover: { backgroundColor: "#d97706" },
            }}
          >
            <div
              data-testid="child"
              style={{
                position: "absolute",
                left: 120,
                top: 0,
                width: 50,
                height: 40,
                backgroundColor: "#284f37",
              }}
            />
          </div>
        </div>
      )

      const row = testRoot.renderer.findByTestId("row")!
      const child = testRoot.renderer.findByTestId("child")!
      const { x, y, width, height } = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      const screenshot = `${SHOTS_DIR}/gpuix-hover-over-outside-child.png`
      testRoot.renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      const offset = (20 * image.width + 20) * 4

      expect([...image.data.subarray(offset, offset + 4)]).toEqual([217, 119, 6, 255])
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#d97706",
      })
      expect(events).toEqual(["enter"])
    } finally {
      testRoot.unmount()
    }
  })

  it("clears hover for a retained element with no painted bounds", () => {
    const testRoot = createTestRoot()
    const renderRow = (hidden: boolean) =>
      testRoot.render(
        <div style={{ width: 300, height: 100 }}>
          <div
            data-testid="row"
            style={{
              display: hidden ? "none" : "flex",
              hoverGroup: "row",
              width: 100,
              height: 50,
              backgroundColor: "#253047",
              hover: { backgroundColor: "#d97706" },
            }}
          />
        </div>,
      )
    try {
      renderRow(false)
      const row = testRoot.renderer.findByTestId("row")!
      const bounds = testRoot.renderer.getElementBounds(row.id)!
      testRoot.renderer.nativeSimulateMouseMove(bounds.x + 20, bounds.y + 20)
      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#d97706",
      })

      renderRow(true)
      expect(testRoot.renderer.getElementBounds(row.id)).toMatchObject({
        width: 0,
        height: 0,
      })
      expect(testRoot.renderer.getElementInteractionState(row.id).hovered).toBe(true)
      testRoot.renderer.nativeSimulateMouseMove(0, 0)
      renderRow(false)

      expect(testRoot.renderer.getResolvedStyle(row.id)).toMatchObject({
        backgroundColor: "#253047",
      })
      expect(testRoot.renderer.getElementInteractionState(row.id).hovered).toBe(false)
    } finally {
      testRoot.unmount()
    }
  })
})
