/**
 * LOCAL MACOS ONLY: push CI is Linux-only, and GPU screenshot capture is too
 * VM-hostile to make this browser-equivalence gate reliable in hosted CI.
 */

import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test, vi } from "vitest"

import {
  CanvasComparisonSkippedError,
  type CanvasComparisonOptions,
  canvasGoldenPath,
  canvasScenes,
  createTestRoot,
  expectCanvasMatchesBrowser,
  isNativeTestRendererAvailable,
  TestRenderer,
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
      expect(testRoot.renderer.compareImages(golden, perturbed, 255)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 250,
      })
    } finally {
      testRoot.unmount()
    }
  })

  test("rejects a small but gross perturbation through the public helper", () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "gpuix-canvas-equivalence-"))
    const actualPath = path.join(tempDirectory, "actual.png")
    const perturbed = path.join(fixturesDirectory, "fill-rect-grid-perturbed.png")
    const captureScreenshot = vi
      .spyOn(TestRenderer.prototype, "captureScreenshot")
      .mockImplementation((outputPath) => copyFileSync(perturbed, outputPath))

    try {
      expect(() =>
        expectCanvasMatchesBrowser("fill-rect-grid", {
          actualPath,
        })
      ).toThrowError(/max channel delta 250, ceiling 16/)
    } finally {
      captureScreenshot.mockRestore()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  test.each(
    [
      ["NaN tolerance", { tolerance: Number.NaN }, /tolerance.*NaN/],
      ["infinite tolerance", { tolerance: Number.POSITIVE_INFINITY }, /tolerance.*Infinity/],
      ["NaN differing-pixel budget", { differingPixelBudget: Number.NaN }, /budget.*NaN/],
      [
        "infinite differing-pixel budget",
        { differingPixelBudget: Number.POSITIVE_INFINITY },
        /budget.*Infinity/,
      ],
      ["NaN maximum channel delta", { maxChannelDelta: Number.NaN }, /delta.*NaN/],
    ] satisfies Array<[string, CanvasComparisonOptions, RegExp]>
  )(
    "rejects non-finite threshold: %s",
    (_name, options, message) => {
      expect(() => expectCanvasMatchesBrowser("fill-rect-grid", options)).toThrowError(message)
    }
  )

  test("throws loudly when an unavailable prerequisite has no skip callback", () => {
    expect(() =>
      expectCanvasMatchesBrowser("fill-rect-grid", {
        goldenPath: path.join(fixturesDirectory, "intentionally-absent.png"),
      })
    ).toThrowError(
      new CanvasComparisonSkippedError(
        "Canvas comparison skipped: browser golden is absent at " +
          `${path.join(fixturesDirectory, "intentionally-absent.png")}; ` +
          "regenerate it with `bun run canvas:goldens`"
      )
    )
  })

  for (const scene of Object.values(canvasScenes)) {
    test(`matches Chromium for ${scene.name}`, (context) => {
      expectCanvasMatchesBrowser(scene, {
        // GPUI and Chromium use different edge-coverage rasterizers for
        // tessellated paths. The geometry gate remains the 1% differing-pixel
        // budget; allow the observed coverage delta only for the B1 polygon.
        maxChannelDelta: scene.name === "translate-scale" ? 72 : undefined,
        skip: (message) => context.skip(message),
      })
    })
  }
})
