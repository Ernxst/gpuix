import fs from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

describe.skipIf(!isNativeTestRendererAvailable())("unfocused :focus-within groups", () => {
  it("does not paint focus-within on any group while focus is empty", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `:root { --surface-2: #252e34; --surface-3: #38464d; }
       .balanceItemGroup {
         display: flex; flex-direction: column; width: 140px; height: 50px;
         background: var(--surface-2);
       }
       .balanceItemGroup:hover,
       .balanceItemGroup:focus-within { background: var(--surface-3); }`,
      "/fixture/balance-item-group.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 800, height: 600, backgroundColor: "#141414" }}>
          <div role="rowgroup" aria-label="Items">
            {[
              "Limestone",
              "Water",
              "Crude Oil",
              "Coal",
              "Rotor",
            ].map((name) => (
              <div className={styles.balanceItemGroup} data-testid={name} key={name}>
                <button tabIndex={0}>{name}</button>
              </div>
            ))}
          </div>
        </div>,
      )

      expect(root.renderer.getActiveElement()).toBeNull()
      const groups = ["Limestone", "Water", "Crude Oil", "Coal", "Rotor"].map((name) =>
        root.renderer.findByTestId(name)!,
      )
      for (const group of groups) {
        expect(root.renderer.getElementInteractionState(group.id)).toMatchObject({
          hovered: false,
          focused: false,
        })
        expect(root.renderer.getResolvedStyle(group.id)?.backgroundColor).toBe("#252e34")
      }

      fs.mkdirSync(SHOTS_DIR, { recursive: true })
      const screenshot = `${SHOTS_DIR}/focus-within-unfocused-groups.png`
      root.renderer.captureScreenshot(screenshot)
      const image = decodePng(fs.readFileSync(screenshot), screenshot)
      const paintedColors = groups.map((group) => {
        const bounds = root.renderer.getElementBounds(group.id)!
        const offset = ((bounds.y + bounds.height - 3) * image.width + bounds.x + bounds.width - 3) * 4
        return [...image.data.subarray(offset, offset + 4)]
      })
      expect(paintedColors).toEqual(groups.map(() => [37, 46, 52, 255]))
    } finally {
      root.unmount()
    }
  })
})
