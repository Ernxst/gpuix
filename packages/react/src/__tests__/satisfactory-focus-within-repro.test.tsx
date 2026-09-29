import path from "node:path"
import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot } from "../testing.js"
import { SHOTS_DIR } from "./test-utils.js"

describe("satisfactory dock hover sweep repro", () => {
  it("clears hover after route clicks rerender the tile states", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.nav { display: flex; flex-direction: row; width: 320px; height: 48px; }
       .navLink { position: relative; display: flex; flex-shrink: 0; width: 64px; height: 48px; }
       .tileFrame { position: relative; display: flex; flex-shrink: 0; width: 64px; height: 48px; }
       .tileBase, .tileCurrent { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; }
       .tileBase:hover .iconImage { color: #ff00ff; }
       .iconImage { color: #0011ff; }
       .iconCurrent { color: #0011ff; }`,
      "/fixture/satisfactory-dock.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }
    const names = ["overview", "recipes", "blueprints", "planner", "map"]
    function Dock() {
      const [active, setActive] = useState("overview")
      return (
        <div className={styles.nav} data-testid="dock" style={{ position: "absolute", left: 40, top: 40 }}>
          {names.map((name) => (
            <button
              className={styles.navLink}
              data-testid={name}
              key={name}
              onClick={() => setActive(name)}
              type="button"
            >
              <span className={styles.tileFrame}>
                <span className={name === active ? styles.tileCurrent : styles.tileBase} data-testid={`tile-${name}`}>
                  <text className={name === active ? styles.iconCurrent : styles.iconImage} data-testid={`icon-${name}`}>{name}</text>
                </span>
              </span>
            </button>
          ))}
        </div>
      )
    }
    const root = createTestRoot()
    try {
      root.render(<Dock />)
      const dockBounds = root.renderer.getElementBounds(root.renderer.findByTestId("dock")!.id)!
      expect(dockBounds.x).toBeGreaterThanOrEqual(40)
      expect(dockBounds.y).toBeGreaterThanOrEqual(40)
      const initialPath = path.join(SHOTS_DIR, "satisfactory-dock-repro-before.png")
      const finalPath = path.join(SHOTS_DIR, "satisfactory-dock-repro-after.png")
      root.renderer.captureScreenshot(initialPath)
      const moveTo = (name: string) => {
        const bounds = root.renderer.getElementBounds(root.renderer.findByTestId(name)!.id)!
        root.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      }
      const click = (name: string) => {
        const bounds = root.renderer.getElementBounds(root.renderer.findByTestId(name)!.id)!
        root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      }
      const hovered = () =>
        names.filter((name) =>
          root.renderer.getElementInteractionState(root.renderer.findByTestId(`tile-${name}`)!.id)
            .hovered,
        )
      for (const name of ["map", "recipes", "blueprints", "planner", "map"]) moveTo(name)
      click("blueprints")
      moveTo("recipes")
      click("map")
      click("overview")
      root.renderer.nativeSimulateMouseMove(0, 0)
      expect(hovered()).toEqual([])
      for (const name of names) {
        const icon = root.renderer.findByTestId(`icon-${name}`)!
        expect(root.renderer.getResolvedStyle(icon.id)?.color).toBe("#0011ff")
      }
      root.renderer.captureScreenshot(finalPath)
      expect(root.renderer.compareImages(initialPath, finalPath, 0).differingPixelRatio).toBe(0)
    } finally {
      root.unmount()
    }
  })
})
