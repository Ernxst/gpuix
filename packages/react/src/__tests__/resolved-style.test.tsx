import React from "react"
import type { CSSProperties } from "react"
import { describe, expect, it } from "vitest"
import type { NativeStateStyleKey, StyleDesc } from "../index.js"
import { createTestRoot } from "../testing.js"

type SharedStyle = {
  [Property in keyof CSSProperties & keyof StyleDesc]?: Exclude<
    CSSProperties[Property],
    undefined
  > &
    Exclude<StyleDesc[Property], undefined>
}

type WidenedShared = SharedStyle & Pick<StyleDesc, NativeStateStyleKey>

describe("resolved test-renderer styles", () => {
  it("reads the hoverWithin style applied by the issue #52 repro", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 120, backgroundColor: "#222222" }}>
          <div
            style={{
              hoverGroup: "row",
              display: "flex",
              flexDirection: "row",
              width: 400,
              height: 40,
            }}
          >
            <span style={{ width: 200, height: 40, backgroundColor: "#333333" }} />
            <span
              style={{
                width: 200,
                height: 40,
                background: "rgba(0, 0, 0, 0)",
                hoverWithin: { background: "#7d8b8c" },
              }}
            />
          </div>
        </div>
      )
      const r = root.renderer
      r.flush()
      const before = JSON.stringify(r.getElement(2)?.style)
      r.nativeSimulateMouseMove(100, 20) // into the LEFT sibling
      r.dispatchNativeEvents()
      r.flush()
      const after = JSON.stringify(r.getElement(2)?.style)
      // before === after → true   (captureScreenshot at this point shows #7d8b8c painted)
      expect(before).toBe(after)
      expect(r.getResolvedStyle(2)).toMatchObject({ background: "#7d8b8c" })
    } finally {
      root.unmount()
    }
  })

  it("resolves hover and active styles at read time", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          style={{
            width: 400,
            height: 120,
            padding: 40,
            backgroundColor: "#111111",
          }}
        >
          <div
            data-testid="state-target"
            style={{
              width: 160,
              height: 40,
              backgroundColor: "#333333",
              hover: { backgroundColor: "#667788" },
              active: { backgroundColor: "#aabbcc" },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("state-target")!
      const [x, y, width, height] = root.renderer.getElementBounds(target.id)!
      const centerX = x + width / 2
      const centerY = y + height / 2

      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })

      root.renderer.nativeSimulateMouseMove(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#667788",
      })

      root.renderer.nativeSimulateMouseDown(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#aabbcc",
      })

      root.renderer.nativeSimulateMouseMove(300, 100, 0)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#aabbcc",
      })

      root.renderer.nativeSimulateMouseUp(300, 100)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves focus styles at read time", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 120, padding: 40 }}>
          <div
            data-testid="focus-target"
            tabIndex={0}
            style={{
              width: 160,
              height: 40,
              backgroundColor: "#333333",
              focus: { backgroundColor: "#c2415d" },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("focus-target")!
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })

      root.renderer.focusElement(target.id)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#c2415d",
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves a widened shared focusVisible style after keyboard focus", () => {
    const root = createTestRoot()
    const style: WidenedShared = {
      width: 160,
      height: 40,
      backgroundColor: "#333333",
      focusVisible: { outlineColor: "#67e8f9", outlineWidth: 4, outlineOffset: 5 },
    }

    try {
      root.render(
        <div style={{ width: 400, height: 120, padding: 40 }}>
          <div autoFocus tabIndex={0} style={{ width: 1, height: 1 }} />
          <div data-testid="focus-visible-target" tabIndex={0} style={style} />
        </div>
      )

      const target = root.renderer.findByTestId("focus-visible-target")!
      root.renderer.simulateKeystrokes("tab")
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        outlineColor: "#67e8f9",
        outlineWidth: 4,
        outlineOffset: 5,
      })
    } finally {
      root.unmount()
    }
  })
})
