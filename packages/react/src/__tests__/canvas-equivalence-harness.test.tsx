/**
 * LOCAL MACOS ONLY: push CI is Linux-only, and GPU screenshot capture is too
 * VM-hostile to make this browser-equivalence gate reliable in hosted CI.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test, vi } from "vitest"

import {
  canvasGoldenPath,
  canvasScenes,
  createTestRoot,
  expectCanvasMatchesBrowser,
  isNativeTestRendererAvailable,
} from "../testing.js"

const isLocalMac = process.platform === "darwin" && !process.env.CI
const describeLocalMac =
  isLocalMac && isNativeTestRendererAvailable() ? describe : describe.skip
const fixturesDirectory = fileURLToPath(
  new URL("../../canvas-goldens/__fixtures__", import.meta.url)
)

describeLocalMac("canvas browser-equivalence harness", () => {
  test("reports zero diff for a golden compared with itself", () => {
    const testRoot = createTestRoot()
    try {
      const golden = canvasGoldenPath("fill-rect-grid")
      expect(testRoot.renderer.compareImages(golden, golden, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
      })
    } finally {
      testRoot.unmount()
    }
  })

  test("detects a deliberately perturbed copy", () => {
    const testRoot = createTestRoot()
    try {
      const golden = canvasGoldenPath("fill-rect-grid")
      const perturbed = path.join(fixturesDirectory, "fill-rect-grid-perturbed.png")
      const comparison = testRoot.renderer.compareImages(golden, perturbed, 0)
      expect(comparison.differingPixelRatio).toBeGreaterThan(0)
      expect(comparison.maxChannelDelta).toBeGreaterThan(0)
      expect(
        testRoot.renderer.compareImages(golden, perturbed, 255).differingPixelRatio
      ).toBe(0)
    } finally {
      testRoot.unmount()
    }
  })

  test("skips loudly when the committed golden is absent", () => {
    const skip = vi.fn()
    const result = expectCanvasMatchesBrowser("fill-rect-grid", {
      goldenPath: path.join(fixturesDirectory, "intentionally-absent.png"),
      skip,
    })

    expect(result).toBeUndefined()
    expect(skip).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /Canvas comparison skipped: browser golden is absent.*bun run canvas:goldens/
      )
    )
  })

  test("skips loudly until the native canvas element lands", () => {
    const skip = vi.fn()
    const result = expectCanvasMatchesBrowser(canvasScenes["fill-rect-grid"], { skip })

    expect(result).toBeUndefined()
    expect(skip).toHaveBeenCalledExactlyOnceWith(
      "Canvas comparison skipped: the GPUIX canvas element is unavailable " +
        "(phase A1/A2 has not supplied a painted canvas)"
    )
  })
})
