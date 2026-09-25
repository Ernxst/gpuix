import assert from "node:assert/strict"
import React from "react"
import { createTestRoot } from "../../testing.js"
import styles from "./hover-group-ancestor.module.css"

const mounted = createTestRoot({ width: 240, height: 160, strictStyles: true })
mounted.render(
  <>
    <span className={styles.tileBase} data-testid="tile-base">
      <span className={styles.iconSlot}>
        <img className={styles.iconImage} data-testid="base-image" alt="" />
      </span>
    </span>
    <span className={styles.tileCurrent} data-testid="tile-current">
      <span className={styles.iconSlot}>
        <img className={styles.iconImage} data-testid="current-image" alt="" />
      </span>
    </span>
    <span>
      <span>
        <img
          data-testid="handwritten-missing-group"
          alt=""
          style={{ hoverWithinGroup: "missing", hoverWithin: { width: 22 } }}
        />
      </span>
    </span>
  </>,
)

const diagnostics = mounted.renderer.drainStyleDiagnostics()
assert.equal(diagnostics.length, 1)
assert.equal(diagnostics[0]?.dataTestId, "handwritten-missing-group")
assert.equal(diagnostics[0]?.property, "hoverWithinGroup")
assert.match(diagnostics[0]?.message ?? "", /no ancestor hoverGroup named "missing" was found/)

const tile = mounted.renderer.findByTestId("tile-base")!
const baseImage = mounted.renderer.findByTestId("base-image")!
const currentImage = mounted.renderer.findByTestId("current-image")!
const tileBounds = mounted.renderer.getElementBounds(tile.id)!
assert.equal(mounted.renderer.getElementBounds(baseImage.id)?.width, 18)
assert.equal(mounted.renderer.getElementBounds(currentImage.id)?.width, 18)
mounted.renderer.nativeSimulateMouseMove(
  tileBounds.x + tileBounds.width / 2,
  tileBounds.y + tileBounds.height / 2,
)
mounted.renderer.flush()
assert.equal(mounted.renderer.getElementBounds(baseImage.id)?.width, 22)
assert.equal(mounted.renderer.getElementBounds(currentImage.id)?.width, 18)
mounted.unmount()

console.log("BUN_PRELOAD_HOVER_GROUP_MOUNT_OK")
