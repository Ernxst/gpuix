import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import { TestRenderer } from "../packages/react/dist/testing.js"
import { cropImage, decodePng, encodePng } from "../packages/react/dist/testing-png.js"

const renderer = new TestRenderer(1280, 800, 2)
const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-element-screenshot-bench-"))
const fullWindowPath = path.join(directory, "window.png")
const oldCropPath = path.join(directory, "old-crop.png")
const nativeCropPath = path.join(directory, "native-crop.png")
const expectedPath = path.join(directory, "expected.png")
const rect = { x: 400, y: 320, width: 1280, height: 960 }

function elapsed(start: number): number {
  return performance.now() - start
}

function report(pathway: string, iteration: number, values: Record<string, number>): void {
  const fields = Object.entries(values)
    .map(([label, value]) => `${label}=${value.toFixed(1)}ms`)
    .join(" ")
  console.log(`${pathway} ${iteration}: ${fields}`)
}

if (process.platform !== "darwin") {
  throw new Error("This timing script is for macOS native renderer runs")
}

try {
  renderer.flush()

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    let start = performance.now()
    renderer.captureScreenshot(fullWindowPath)
    const oldCaptureMs = elapsed(start)

    start = performance.now()
    const fullImage = decodePng(readFileSync(fullWindowPath), "window screenshot")
    const oldCrop = cropImage(fullImage, rect)
    writeFileSync(oldCropPath, encodePng(oldCrop))
    const oldCropMs = elapsed(start)
    writeFileSync(expectedPath, encodePng(oldCrop))

    start = performance.now()
    const oldComparison = renderer.compareImages(expectedPath, oldCropPath, 0)
    const oldCompareMs = elapsed(start)
    report("before", iteration, {
      capture: oldCaptureMs,
      "JS decode+crop+encode": oldCropMs,
      compare: oldCompareMs,
    })

    start = performance.now()
    renderer.prepareScreenshotCapture()
    const prepareMs = elapsed(start)

    start = performance.now()
    const nativeTimings = renderer.captureScreenshotClip(
      nativeCropPath,
      rect.x,
      rect.y,
      rect.width,
      rect.height
    )
    const nativeWallMs = elapsed(start)

    start = performance.now()
    const newComparison = renderer.compareImages(expectedPath, nativeCropPath, 0)
    const newCompareMs = elapsed(start)
    report("after", iteration, {
      prepare: prepareMs,
      capture: nativeTimings.captureMs,
      "Rust crop": nativeTimings.cropMs,
      encode: nativeTimings.encodeMs,
      "capture call": nativeWallMs,
      compare: newCompareMs,
    })

    if (oldComparison.differingPixelRatio !== 0 || newComparison.differingPixelRatio !== 0) {
      throw new Error("The before and after screenshot crops did not match pixel-for-pixel")
    }
  }
} finally {
  renderer.dispose()
  rmSync(directory, { recursive: true, force: true })
}
