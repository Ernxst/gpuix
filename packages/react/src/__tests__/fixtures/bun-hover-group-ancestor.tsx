import assert from "node:assert/strict"
import React from "react"
import { createTestRoot } from "../../testing.js"
import styles from "./hover-group-ancestor.module.css"

const mounted = createTestRoot({ width: 240, height: 120, strictStyles: true })
mounted.render(
  <span className={styles.tileBase} data-testid="tile-base">
    <span className={styles.iconSlot}>
      <img className={styles.iconImage} data-testid="icon-image" alt="" />
    </span>
  </span>,
)

assert.deepEqual(mounted.renderer.drainStyleDiagnostics(), [])
const tile = mounted.renderer.findByTestId("tile-base")!
const image = mounted.renderer.findByTestId("icon-image")!
const tileBounds = mounted.renderer.getElementBounds(tile.id)!
const imageBounds = mounted.renderer.getElementBounds(image.id)!
assert.equal(imageBounds.width, 18)
mounted.renderer.nativeSimulateMouseMove(
  tileBounds.x + tileBounds.width / 2,
  tileBounds.y + tileBounds.height / 2,
)
mounted.renderer.flush()
assert.equal(mounted.renderer.getElementBounds(image.id)?.width, 22)
mounted.unmount()

const missing = createTestRoot({ width: 240, height: 120, strictStyles: true })
missing.render(
  <div>
    <img
      data-testid="missing-group-image"
      alt=""
      style={{ hoverWithinGroup: "missing", hoverWithin: { width: 22 } }}
    />
  </div>,
)
const diagnostics = missing.renderer.drainStyleDiagnostics()
assert.equal(diagnostics.length, 1)
assert.equal(diagnostics[0]?.property, "hoverWithinGroup")
assert.match(diagnostics[0]?.message ?? "", /no ancestor hoverGroup named "missing" was found/)
missing.unmount()

console.log("BUN_PRELOAD_HOVER_GROUP_MOUNT_OK")
