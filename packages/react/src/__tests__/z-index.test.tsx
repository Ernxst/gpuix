import React from "react"
import { describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("zIndex stacking", () => {
  it.each(["overlay-first", "page-first"] as const)(
    "paints the higher zIndex red overlay and routes pointer input to it (%s)",
    (order) => {
      const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
      const pageClick = vi.fn()
      const overlayClick = vi.fn()
      const page = (
        <div
          data-testid="page"
          onClick={pageClick}
          style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 1, backgroundColor: "#00ff00" }}
        />
      )
      const overlay = (
        <div
          data-testid="overlay"
          onClick={overlayClick}
          style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 2, backgroundColor: "#ff0000" }}
        />
      )

      render(<div style={{ position: "relative", width: 120, height: 100 }}>{order === "overlay-first" ? [overlay, page] : [page, overlay]}</div>)

      expect(renderer.drainStyleDiagnostics()).toEqual([])
      const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
      expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
      expect(pixel[0]).toBeGreaterThan(pixel[2] * 2)

      renderer.nativeSimulateClick(40, 40)
      expect(overlayClick).toHaveBeenCalledOnce()
      expect(pageClick).not.toHaveBeenCalled()
    }
  )

  it("paints negative zIndex below in-flow content", () => {
    const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
    render(
      <div style={{ position: "relative", width: 120, height: 100 }}>
        <div style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: -1, backgroundColor: "#00ff00" }} />
        <div style={{ width: 80, height: 60, backgroundColor: "#ff0000" }} />
      </div>
    )

    const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
    expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("ignores zIndex on an in-flow block that is not a flex or grid item", () => {
    const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
    render(
      <div style={{ position: "relative", width: 120, height: 100 }}>
        <div style={{ width: 80, height: 60, zIndex: 10, backgroundColor: "#00ff00" }} />
        <div style={{ position: "relative", left: 0, top: -60, width: 80, height: 60, zIndex: 1, backgroundColor: "#ff0000" }} />
      </div>
    )

    const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
    expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })
})
