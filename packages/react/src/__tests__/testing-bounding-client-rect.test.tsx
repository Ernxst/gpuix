import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("TestElement.getBoundingClientRect", () => {
  it("returns the painted bounds in the DOMRect shape", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", padding: 10, width: 200, height: 100 }}>
          <text data-testid="label" style={{ width: 100, height: 20 }}>
            Coal
          </text>
        </div>
      )

      const label = screen.getByTestId("label")
      const rect = label.getBoundingClientRect()
      const [x, y, width, height] = screen.renderer.getElementBounds(label.id)!

      // Same source, same space: whatever getElementBounds reports today.
      expect(rect.x).toBe(x)
      expect(rect.y).toBe(y)
      expect(rect.width).toBe(width)
      expect(rect.height).toBe(height)
      // Derived fields, exactly as a browser computes them.
      expect(rect.left).toBe(rect.x)
      expect(rect.top).toBe(rect.y)
      expect(rect.right).toBe(rect.x + rect.width)
      expect(rect.bottom).toBe(rect.y + rect.height)
      // The padded parent puts it off the window origin, so the assertions
      // above are not all trivially zero.
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.left).toBeGreaterThan(0)
      expect(rect.top).toBeGreaterThan(0)
    } finally {
      screen.unmount()
    }
  })

  it("reports the border box, as the DOM does", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", padding: 20, width: 200, height: 100 }}>
          <div
            data-testid="mark"
            style={{
              width: 12,
              height: 12,
              padding: 3,
              borderWidth: 2,
              borderColor: "#00ff00",
              backgroundColor: "#ff0000",
            }}
          />
        </div>
      )

      // Sizes are border-box here, so the mark's painted border box is exactly
      // its declared 12×12, at the parent's content origin. The recorded box
      // used to be the padding-box size at the content-box origin, so a border
      // or padding shrank and shifted the rect (#298).
      const rect = screen.getByTestId("mark").getBoundingClientRect()
      expect(rect).toEqual({
        x: 20,
        y: 20,
        width: 12,
        height: 12,
        top: 20,
        right: 32,
        bottom: 32,
        left: 20,
      })
    } finally {
      screen.unmount()
    }
  })

  it("throws instead of reporting zeros for an element that painted nothing", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <text data-testid="sr-only" visuallyHidden role="status">
            Copper
          </text>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // In the tree, but projected as an unpainted accessibility node.
      const hidden = screen.getByTestId("sr-only")
      expect(screen.renderer.getElementBounds(hidden.id)).toBeNull()
      expect(() => hidden.getBoundingClientRect()).toThrowError(
        /Unable to read the bounding client rect of <text data-testid="sr-only" text="Copper">: it painted no bounds in the last frame/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reports the new bounds after a layout change, from the same element reference", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <text data-testid="box" style={{ width: 100, height: 20 }}>
            Iron
          </text>
        </div>
      )

      const box = screen.getByTestId("box")
      const before = box.getBoundingClientRect()

      screen.render(
        <div style={{ display: "flex", paddingLeft: 40, width: 200, height: 100 }}>
          <text data-testid="box" style={{ width: 160, height: 40 }}>
            Iron
          </text>
        </div>
      )

      // The pre-rerender reference re-resolves, as children and parentElement do.
      const after = box.getBoundingClientRect()
      const [x, y, width, height] = screen.renderer.getElementBounds(
        screen.getByTestId("box").id
      )!

      expect(after).toEqual({
        x,
        y,
        width,
        height,
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
      })
      expect(after.width).toBeGreaterThan(before.width)
      expect(after.height).toBeGreaterThan(before.height)
      expect(after.left).toBeGreaterThan(before.left)
    } finally {
      screen.unmount()
    }
  })
})
