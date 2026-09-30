import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

describe.skipIf(!isNativeTestRendererAvailable())("focus styles on virtual-list", () => {
  it("paints focus-visible rings on ordinary and virtual-list Tab targets", async () => {
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
                focusVisible: { outlineColor: "#ffb02e", outlineWidth: 2, outlineOffset: 0 },
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
                focusVisible: { outlineColor: "#ffb02e", outlineWidth: 2, outlineOffset: 0 },
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
      const expectOrangeOutline = (targetId: number) => {
        const screenshot = `${SHOTS_DIR}/virtual-list-focus-styles.png`
        renderer.captureScreenshot(screenshot)
        const image = decodePng(readFileSync(screenshot), screenshot)
        const bounds = renderer.getElementBounds(targetId)!
        const scale = image.width / 200
        const left = Math.floor((bounds.x - 4) * scale)
        const right = Math.ceil((bounds.x + bounds.width + 4) * scale)
        const top = Math.floor((bounds.y - 4) * scale)
        const bottom = Math.ceil((bounds.y + bounds.height + 4) * scale)
        let orangePixels = 0
        for (let y = Math.max(top, 0); y < Math.min(bottom, image.height); y++) {
          for (let x = Math.max(left, 0); x < Math.min(right, image.width); x++) {
            const offset = (y * image.width + x) * 4
            if (
              image.data[offset] === 255 &&
              image.data[offset + 1] === 176 &&
              image.data[offset + 2] === 46 &&
              image.data[offset + 3] === 255
            ) orangePixels++
          }
        }
        expect(orangePixels).toBeGreaterThan(0)
      }

      await root.userEvent.tab()
      expect(renderer.getActiveElement()).toBe(ordinaryTarget.id)
      expect(renderer.getResolvedStyle(ordinaryTarget.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expect(renderer.getResolvedStyle(ancestor.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expectOrangeOutline(ordinaryTarget.id)
      expectOrangeOutline(ancestor.id)

      await root.userEvent.tab()
      expect(renderer.getActiveElement()).toBe(list.id)
      expect(renderer.getResolvedStyle(list.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expect(renderer.getResolvedStyle(ancestor.id)).toMatchObject({
        outlineColor: "#ffb02e",
        outlineWidth: 2,
      })
      expectOrangeOutline(list.id)
      expectOrangeOutline(ancestor.id)
    } finally {
      root.unmount()
    }
  })
})
