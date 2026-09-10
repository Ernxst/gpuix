/// Pixel-comparison test for `boxShadow` layering and inset geometry, against
/// Chromium reference PNGs committed at `packages/react/shadow-goldens/`
/// (regenerate with `bun run shadow:goldens`). This intentionally compares
/// actual rendered pixels, not a formula-derived expected image: the goal is
/// browser parity, not agreement with our own geometry math.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng, type RgbaImage } from "../testing-png.js"
import { shadowCases } from "./fixtures/shadow-cases.js"
import { SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const goldenDirectory = fileURLToPath(new URL("../../shadow-goldens", import.meta.url))

const HARD_EDGE_CHANNEL_JUMP = 24
// A crisp rectangle edge (no blur) rasterizes slightly differently between
// GPUI's shader and Chromium's, so both the hard-edge cases exclude a 1
// logical px band around every detected edge in the golden, matching the
// hatch goldens' tolerance.
const HARD_EDGE_TOLERANCE = 2

/** Marks every pixel whose channel differs from a right or bottom neighbor by
 *  more than `threshold` — the boundary of an opaque, unblurred shape. */
function detectEdges(image: RgbaImage, threshold: number): Uint8Array {
  const { width, height, data } = image
  const edges = new Uint8Array(width * height)
  const differs = (indexA: number, indexB: number) => {
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(data[indexA + channel]! - data[indexB + channel]!) > threshold) return true
    }
    return false
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      if (x + 1 < width) {
        const right = (y * width + x + 1) * 4
        if (differs(index, right)) {
          edges[y * width + x] = 1
          edges[y * width + x + 1] = 1
        }
      }
      if (y + 1 < height) {
        const bottom = ((y + 1) * width + x) * 4
        if (differs(index, bottom)) {
          edges[y * width + x] = 1
          edges[(y + 1) * width + x] = 1
        }
      }
    }
  }
  return edges
}

/** Grows a boolean pixel mask outward by `radius` pixels in every direction. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const grown = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          grown[ny * width + nx] = 1
        }
      }
    }
  }
  return grown
}

function compareExcludingEdges(
  actual: RgbaImage,
  expected: RgbaImage,
  excluded: Uint8Array,
  tolerance: number
): { mismatchCount: number; firstMismatch: { x: number; y: number } | null } {
  let mismatchCount = 0
  let firstMismatch: { x: number; y: number } | null = null
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      if (excluded[y * expected.width + x]) continue
      const a = (y * actual.width + x) * 4
      const e = (y * expected.width + x) * 4
      let mismatched = false
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(actual.data[a + channel]! - expected.data[e + channel]!) > tolerance) {
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

function maxChannelDelta(actual: RgbaImage, expected: RgbaImage): number {
  let max = 0
  for (let i = 0; i < expected.data.length; i += 1) {
    max = Math.max(max, Math.abs(actual.data[i]! - expected.data[i]!))
  }
  return max
}

function renderCase(testCase: (typeof shadowCases)[number], dpr: number) {
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
            borderColor: testCase.borderColor,
            borderWidth: testCase.borderWidth,
            boxShadow: testCase.layers,
          }}
        />
      </div>
    )

    const actualPath = path.join(SHOTS_DIR, `box-shadow-${testCase.name}-dpr${dpr}.png`)
    testRoot.renderer.captureScreenshot(actualPath)
    return decodePng(fs.readFileSync(actualPath), `${testCase.name} actual`)
  } finally {
    testRoot.unmount()
  }
}

function readGolden(testCase: (typeof shadowCases)[number], dpr: number): RgbaImage {
  const goldenPath = path.join(goldenDirectory, `${testCase.name}-dpr${dpr}.png`)
  expect(
    fs.existsSync(goldenPath),
    `Missing golden ${goldenPath}; regenerate with \`bun run shadow:goldens\``
  ).toBe(true)
  return decodePng(fs.readFileSync(goldenPath), `${testCase.name} golden`)
}

describeNative("boxShadow layering and inset geometry match Chromium", { timeout: 20_000 }, () => {
  const hardEdgeCases = shadowCases.filter((testCase) => testCase.name !== "blurred-elevation")
  const blurredCase = shadowCases.find((testCase) => testCase.name === "blurred-elevation")!

  for (const testCase of hardEdgeCases) {
    for (const dpr of [1, 2] as const) {
      it(`matches Chromium for ${testCase.name} at ${dpr}x`, () => {
        const expected = readGolden(testCase, dpr)
        const actual = renderCase(testCase, dpr)

        expect(
          { width: actual.width, height: actual.height },
          "actual and golden screenshot dimensions must match"
        ).toEqual({ width: expected.width, height: expected.height })

        const edges = dilate(
          detectEdges(expected, HARD_EDGE_CHANNEL_JUMP),
          expected.width,
          expected.height,
          dpr
        )
        const { mismatchCount, firstMismatch } = compareExcludingEdges(
          actual,
          expected,
          edges,
          HARD_EDGE_TOLERANCE
        )
        expect(
          mismatchCount,
          `${mismatchCount} pixel(s) exceeded a channel delta of ${HARD_EDGE_TOLERANCE}` +
            (firstMismatch ? `; first at (${firstMismatch.x}, ${firstMismatch.y})` : "")
        ).toBe(0)
      })
    }
  }

  // The blurred elevation's tolerance is measured rather than fixed: GPUI's
  // blur shader and Chromium's Gaussian blur are different implementations of
  // the same spec text, and can legitimately disagree by a few levels per
  // channel across the blur's soft edge. Measured max channel delta was 11 at
  // 1x and 12 at 2x; the tolerance below is that measured max (12) plus one.
  // This is not the hatch goldens' delta-2 contract.
  const BLURRED_ELEVATION_TOLERANCE = 13

  for (const dpr of [1, 2] as const) {
    it(`matches Chromium for ${blurredCase.name} at ${dpr}x within measured tolerance`, () => {
      const expected = readGolden(blurredCase, dpr)
      const actual = renderCase(blurredCase, dpr)

      expect(
        { width: actual.width, height: actual.height },
        "actual and golden screenshot dimensions must match"
      ).toEqual({ width: expected.width, height: expected.height })

      const delta = maxChannelDelta(actual, expected)
      expect(delta, `max channel delta ${delta} exceeded ${BLURRED_ELEVATION_TOLERANCE}`).toBeLessThanOrEqual(
        BLURRED_ELEVATION_TOLERANCE
      )
    })
  }
})
