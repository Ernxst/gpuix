import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

describe.skipIf(!isNativeTestRendererAvailable())("focus styles on virtual-list", () => {
  it("paints keyboard and pointer focus styles on virtual-list and its ancestor", async () => {
    const root = createTestRoot({ width: 200, height: 160 })

    try {
      root.render(
        <div style={{ width: 200, height: 160, padding: 16, backgroundColor: "#101010" }}>
          <div
            data-testid="focus-ancestor"
            style={{
              width: 160,
              height: 120,
              padding: 8,
              backgroundColor: "#253047",
              focusWithin: { outlineColor: "#ffb02e", outlineWidth: 2, outlineOffset: 0 },
            }}
          >
            <div
              data-testid="ordinary-target"
              tabIndex={0}
              style={{
                width: 120,
                height: 40,
                focus: { outlineColor: "#34d399" },
                focusVisible: { outlineColor: "#ffb02e", outlineWidth: 2, outlineOffset: 0 },
                focusWithin: { outlineWidth: 4, outlineOffset: 2 },
              }}
            />
            <virtual-list
              data-testid="virtual-list-target"
              tabIndex={0}
              itemCount={1}
              estimatedItemHeight={40}
              style={{
                width: 120,
                height: 40,
                focus: { outlineColor: "#34d399" },
                focusVisible: { outlineColor: "#ffb02e", outlineWidth: 2, outlineOffset: 0 },
                focusWithin: { outlineWidth: 4, outlineOffset: 2 },
              }}
            >
              <div style={{ width: 120, height: 40, flexShrink: 0 }} />
            </virtual-list>
          </div>
        </div>,
      )

      const renderer = root.renderer
      const ancestor = renderer.findByTestId("focus-ancestor")!
      const ordinaryTarget = renderer.findByTestId("ordinary-target")!
      const list = renderer.findByTestId("virtual-list-target")!
      const countColorPixels = (targetId: number, color: string) => {
        const screenshot = `${SHOTS_DIR}/virtual-list-focus-styles.png`
        renderer.captureScreenshot(screenshot)
        const image = decodePng(readFileSync(screenshot), screenshot)
        const bounds = renderer.getElementBounds(targetId)!
        const scale = image.width / 200
        const left = Math.floor((bounds.x - 4) * scale)
        const right = Math.ceil((bounds.x + bounds.width + 4) * scale)
        const top = Math.floor((bounds.y - 4) * scale)
        const bottom = Math.ceil((bounds.y + bounds.height + 4) * scale)
        const expected = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
        let matchingPixels = 0
        for (let y = Math.max(top, 0); y < Math.min(bottom, image.height); y++) {
          for (let x = Math.max(left, 0); x < Math.min(right, image.width); x++) {
            const offset = (y * image.width + x) * 4
            if (
              image.data[offset] === expected[0] &&
              image.data[offset + 1] === expected[1] &&
              image.data[offset + 2] === expected[2] &&
              image.data[offset + 3] === 255
            ) matchingPixels++
          }
        }
        return matchingPixels
      }

      const expectColorPixels = (targetId: number, color: string) =>
        expect(countColorPixels(targetId, color)).toBeGreaterThan(0)
      const expectNoColorPixels = (targetId: number, color: string) =>
        expect(countColorPixels(targetId, color)).toBe(0)

      // The virtual-list's focus, focus-visible and focus-within styles are
      // inactive before the list or anything inside its ancestor has focus.
      expectNoColorPixels(list.id, "#ffb02e")
      expectNoColorPixels(list.id, "#34d399")

      // Pointer focus applies the list's direct focus color and its own
      // focus-within width before any keyboard input changes the modality.
      const listBounds = renderer.getElementBounds(list.id)!
      renderer.nativeSimulateClick(
        listBounds.x + listBounds.width / 2,
        listBounds.y + listBounds.height / 2,
      )
      expect(renderer.getActiveElement()).toBe(list.id)
      expect(renderer.getResolvedStyle(list.id)).toMatchObject({
        outlineColor: "#34d399",
        outlineWidth: 4,
        outlineOffset: 2,
      })
      expect(renderer.getResolvedStyle(ancestor.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expectColorPixels(list.id, "#34d399")
      expectColorPixels(ancestor.id, "#ffb02e")

      await root.userEvent.tab({ shift: true })
      expect(renderer.getActiveElement()).toBe(ordinaryTarget.id)
      expect(renderer.getResolvedStyle(ordinaryTarget.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expect(renderer.getResolvedStyle(ancestor.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expectColorPixels(ordinaryTarget.id, "#ffb02e")
      expectColorPixels(ancestor.id, "#ffb02e")

      await root.userEvent.tab()
      expect(renderer.getActiveElement()).toBe(list.id)
      expect(renderer.getResolvedStyle(list.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
        outlineOffset: 0,
      })
      expect(renderer.getResolvedStyle(ancestor.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expectColorPixels(list.id, "#ffb02e")
      expectColorPixels(ancestor.id, "#ffb02e")
    } finally {
      root.unmount()
    }
  })
})
