import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

describe.skipIf(!isNativeTestRendererAvailable())("focused link underline", () => {
  it("paints the revealed underline with the focused link colour", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.siteLink { position: relative; display: flex; align-items: center; gap: 8px; }
       .siteLink:focus-visible { outline-color: #ffb02e; outline-width: 2px; outline-offset: 0; }
       .underline { position: absolute; left: 0; right: 0; bottom: -2px; height: 1px; background: #afbab9; opacity: 0; pointer-events: none; }
       .siteLink:hover .underline,
       .siteLink:focus-visible .underline { opacity: 1; }`,
      "/fixture/site-link.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 240, height: 100 })
    try {
      root.render(
        <>
          <button data-testid="start" type="button" />
          <div data-testid="frame" style={{ width: "max-content", paddingBottom: 2 }}>
            <a className={styles.siteLink} data-testid="link" href="/example" style={{ width: "max-content" }}>
              <text>Black Powder Works</text>
              <span aria-hidden={true} className={styles.underline} data-testid="underline" />
            </a>
          </div>
        </>,
      )

      await root.userEvent.tab()
      await root.userEvent.tab()

      const renderer = root.renderer
      const underline = renderer.findByTestId("underline")!
      expect(renderer.getResolvedStyle(underline.id)).toMatchObject({ opacity: 1 })
      const bounds = renderer.getElementBounds(underline.id)!
      const screenshot = `${SHOTS_DIR}/link-underline-focus.png`
      renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      const scale = image.width / 240
      const left = Math.max(0, Math.floor(bounds.x * scale))
      const right = Math.min(image.width, Math.ceil((bounds.x + bounds.width) * scale))
      const top = Math.max(0, Math.floor(bounds.y * scale))
      const bottom = Math.min(image.height, Math.ceil((bounds.y + bounds.height) * scale))
      let focusColourPixels = 0
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const offset = (y * image.width + x) * 4
          if (
            image.data[offset] === 0xff &&
            image.data[offset + 1] === 0xb0 &&
            image.data[offset + 2] === 0x2e &&
            image.data[offset + 3] === 255
          ) focusColourPixels++
        }
      }
      expect(focusColourPixels).toBeGreaterThan(0)
    } finally {
      root.unmount()
    }
  })
})
