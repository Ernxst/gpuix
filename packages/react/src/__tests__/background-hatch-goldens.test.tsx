/// Pixel-comparison test for the CSS 135deg repeating-hatch geometry, against
/// Chromium reference PNGs committed at `packages/react/hatch-goldens/`
/// (regenerate with `bun run hatch:goldens`). This intentionally compares
/// actual rendered pixels, not a formula-derived expected image: the goal is
/// browser parity, not agreement with our own geometry math.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng, type RgbaImage } from "../testing-png.js"
import { hatchCases } from "./fixtures/hatch-cases.js"
import { SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const goldenDirectory = fileURLToPath(new URL("../../hatch-goldens", import.meta.url))

const MAX_CHANNEL_DELTA = 2
// Excludes the outermost logical pixel, where GPUI's and Chromium's edge
// rasterization/clipping can legitimately disagree; the interior (including
// transparent-border interiors) must match closely.
const LOGICAL_INSET = 1

interface InsetRect {
  x: number
  y: number
  width: number
  height: number
}

function insetDevicePixelRect(
  testCase: (typeof hatchCases)[number],
  dpr: number
): InsetRect {
  const left = (testCase.left + LOGICAL_INSET) * dpr
  const top = (testCase.top + LOGICAL_INSET) * dpr
  const right = (testCase.left + testCase.width - LOGICAL_INSET) * dpr
  const bottom = (testCase.top + testCase.height - LOGICAL_INSET) * dpr

  const x = Math.ceil(left)
  const y = Math.ceil(top)
  const width = Math.max(0, Math.floor(right) - x)
  const height = Math.max(0, Math.floor(bottom) - y)
  return { x, y, width, height }
}

function compareRegion(
  actual: RgbaImage,
  expected: RgbaImage,
  region: InsetRect
): { mismatchCount: number; firstMismatch: { x: number; y: number } | null } {
  let mismatchCount = 0
  let firstMismatch: { x: number; y: number } | null = null

  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const a = (y * actual.width + x) * 4
      const e = (y * expected.width + x) * 4
      let mismatched = false
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(actual.data[a + channel]! - expected.data[e + channel]!) > MAX_CHANNEL_DELTA) {
          mismatched = true
          break
        }
      }
      if (mismatched) {
        mismatchCount += 1
        firstMismatch ??= { x, y }
      }
    }
  }

  return { mismatchCount, firstMismatch }
}

describeNative("background 135deg repeating-hatch matches Chromium", { timeout: 20_000 }, () => {
  for (const testCase of hatchCases) {
    for (const dpr of [1, 2] as const) {
      it(`matches Chromium for ${testCase.name} at ${dpr}x`, () => {
        const goldenPath = path.join(goldenDirectory, `${testCase.name}-dpr${dpr}.png`)
        expect(
          fs.existsSync(goldenPath),
          `Missing golden ${goldenPath}; regenerate with \`bun run hatch:goldens\``
        ).toBe(true)

        const testRoot = createTestRoot({
          width: testCase.viewportWidth,
          height: testCase.viewportHeight,
          scaleFactor: dpr,
        })
        try {
          testRoot.render(
            <div style={{ width: "100%", height: "100%", backgroundColor: "white" }}>
              <div
                style={{
                  position: "absolute",
                  left: testCase.left,
                  top: testCase.top,
                  width: testCase.width,
                  height: testCase.height,
                  background: testCase.background,
                  borderStyle: "solid",
                  borderColor: "transparent",
                  borderTopWidth: testCase.borderTopWidth,
                  borderRightWidth: testCase.borderRightWidth,
                  borderBottomWidth: testCase.borderBottomWidth,
                  borderLeftWidth: testCase.borderLeftWidth,
                }}
              />
            </div>
          )

          const actualPath = path.join(SHOTS_DIR, `hatch-${testCase.name}-dpr${dpr}.png`)
          testRoot.renderer.captureScreenshot(actualPath)

          const actual = decodePng(fs.readFileSync(actualPath), `${testCase.name} actual`)
          const expected = decodePng(fs.readFileSync(goldenPath), `${testCase.name} golden`)

          expect(
            { width: actual.width, height: actual.height },
            "actual and golden screenshot dimensions must match"
          ).toEqual({ width: expected.width, height: expected.height })

          const region = insetDevicePixelRect(testCase, dpr)
          const { mismatchCount, firstMismatch } = compareRegion(actual, expected, region)
          expect(
            mismatchCount,
            `${mismatchCount} pixel(s) exceeded a channel delta of ${MAX_CHANNEL_DELTA}` +
              (firstMismatch ? `; first at (${firstMismatch.x}, ${firstMismatch.y})` : "")
          ).toBe(0)
        } finally {
          testRoot.unmount()
        }
      })
    }
  }
})
