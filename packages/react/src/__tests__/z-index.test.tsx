import React from "react"
import { describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("zIndex stacking", () => {
  it("routes pointer input through a root-sized overlay to its child or the page", () => {
    const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
    const pageClick = vi.fn()
    const overlayClick = vi.fn()

    render(
      <div style={{ position: "relative", width: 160, height: 120 }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 160, height: 120, zIndex: 1, pointerEvents: "none" }}>
          <button
            data-testid="overlay-child"
            onClick={overlayClick}
            style={{ position: "absolute", left: 20, top: 20, width: 40, height: 40, backgroundColor: "#ff0000", pointerEvents: "auto" }}
          />
        </div>
        <main data-testid="page" onClick={pageClick} style={{ position: "relative", width: 160, height: 120, backgroundColor: "#00ff00" }} />
      </div>
    )

    renderer.nativeSimulateClick(30, 30)
    renderer.nativeSimulateClick(100, 80)

    expect(overlayClick).toHaveBeenCalledOnce()
    expect(pageClick).toHaveBeenCalledOnce()
  })

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
    const negativeClick = vi.fn()
    const contentClick = vi.fn()
    render(
      <div style={{ position: "relative", width: 120, height: 100 }}>
        <div onClick={negativeClick} style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: -1, backgroundColor: "#00ff00" }} />
        <div onClick={contentClick} style={{ width: 80, height: 60, backgroundColor: "#ff0000" }} />
      </div>
    )

    const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
    expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
    renderer.nativeSimulateClick(40, 40)
    expect(contentClick).toHaveBeenCalledOnce()
    expect(negativeClick).not.toHaveBeenCalled()
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("keeps nested stacking contexts below later higher-z siblings", () => {
    const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
    const nestedClick = vi.fn()
    const siblingClick = vi.fn()

    render(
      <div style={{ position: "relative", width: 160, height: 120 }}>
        <div style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 1 }}>
          <button
            onClick={nestedClick}
            style={{ position: "absolute", left: 0, top: 0, width: 80, height: 60, zIndex: 100, backgroundColor: "#00ff00" }}
          />
        </div>
        <button
          onClick={siblingClick}
          style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 2, backgroundColor: "#ff0000" }}
        />
      </div>
    )

    const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
    expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
    renderer.nativeSimulateClick(40, 40)
    expect(siblingClick).toHaveBeenCalledOnce()
    expect(nestedClick).not.toHaveBeenCalled()
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("routes equal-z overlapping siblings to the later painted element", () => {
    const { render, renderer } = createTestRoot({ width: 160, height: 120, strictStyles: true })
    const earlierClick = vi.fn()
    const laterClick = vi.fn()

    render(
      <div style={{ position: "relative", width: 160, height: 120 }}>
        <button
          onClick={earlierClick}
          style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 1, backgroundColor: "#00ff00" }}
        />
        <button
          onClick={laterClick}
          style={{ position: "absolute", left: 20, top: 20, width: 80, height: 60, zIndex: 1, backgroundColor: "#ff0000" }}
        />
      </div>
    )

    const pixel = renderer.captureScreenshotClipRaw(40, 40, 1, 1).pixels
    expect(pixel[0]).toBeGreaterThan(pixel[1] * 2)
    renderer.nativeSimulateClick(40, 40)
    expect(laterClick).toHaveBeenCalledOnce()
    expect(earlierClick).not.toHaveBeenCalled()
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
