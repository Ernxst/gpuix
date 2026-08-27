/**
 * LOCAL MACOS ONLY: push CI is Linux-only, and GPU screenshot capture is too
 * VM-hostile to make this browser-equivalence gate reliable in hosted CI.
 */

import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createElement, createRef } from "react"
import { describe, expect, test, vi } from "vitest"

import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  CanvasComparisonSkippedError,
  type CanvasComparisonOptions,
  type CanvasScene,
  canvasGoldenPath,
  canvasScenes,
  createTestRoot,
  expectCanvasMatchesBrowser,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing.js"
import { flushRecordingContext2D } from "../canvas/context-2d.js"
import type { CanvasPublicInstance } from "../types/host.js"

const isLocalMac = process.platform === "darwin" && !process.env.CI
const describeLocalMac =
  isLocalMac && isNativeTestRendererAvailable() ? describe : describe.skip
const fixturesDirectory = fileURLToPath(
  new URL("../../canvas-goldens/__fixtures__", import.meta.url)
)

function captureCanvasScene(scene: CanvasScene, outputPath: string): void {
  const testRoot = createTestRoot({
    width: CANVAS_GOLDEN_WIDTH,
    height: CANVAS_GOLDEN_HEIGHT,
  })
  const canvasRef = createRef<CanvasPublicInstance>()
  try {
    testRoot.render(
      createElement("canvas", {
        ref: canvasRef,
        width: CANVAS_GOLDEN_WIDTH * CANVAS_GOLDEN_DPR,
        height: CANVAS_GOLDEN_HEIGHT * CANVAS_GOLDEN_DPR,
        style: { width: CANVAS_GOLDEN_WIDTH, height: CANVAS_GOLDEN_HEIGHT },
      })
    )
    const context = canvasRef.current!.getContext("2d")
    context.scale(CANVAS_GOLDEN_DPR, CANVAS_GOLDEN_DPR)
    scene.draw(context, CANVAS_GOLDEN_WIDTH, CANVAS_GOLDEN_HEIGHT)
    flushRecordingContext2D(context)
    testRoot.renderer.flush()
    testRoot.renderer.captureScreenshot(outputPath)
  } finally {
    testRoot.unmount()
  }
}

function expectHardenedRuleRejects(
  name: string,
  goldenDraw: CanvasScene["draw"],
  actualDraw: CanvasScene["draw"]
): void {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "gpuix-canvas-negative-"))
  const goldenPath = path.join(tempDirectory, "golden.png")
  const actualPath = path.join(tempDirectory, "actual.png")
  const goldenScene = { name, draw: goldenDraw }
  const actualScene = { name, draw: actualDraw }

  try {
    captureCanvasScene(goldenScene, goldenPath)
    expect(() =>
      expectCanvasMatchesBrowser(actualScene, {
        goldenPath,
        actualPath,
        maxChannelDelta: 96,
      })
    ).toThrowError(/Eroded geometry mismatch (?!0\.000%)/)

    const comparer = createTestRoot({ width: 1, height: 1 })
    try {
      const comparison = comparer.renderer.compareImages(goldenPath, actualPath, 2)
      expect(comparison.differingPixelRatio).toBeLessThanOrEqual(0.01)
      expect(comparison.maxChannelDelta).toBeLessThanOrEqual(96)
      expect(comparison.erodedGeometryMismatchRatio).toBeGreaterThan(0)
    } finally {
      comparer.unmount()
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

describeLocalMac("canvas browser-equivalence harness", () => {
  test("reports zero diff for a golden compared with itself", () => {
    const testRoot = createTestRoot()
    try {
      const golden = canvasGoldenPath("fill-rect-grid")
      expect(testRoot.renderer.compareImages(golden, golden, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
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
        maxChannelDeltaOutsideGoldenContour: 250,
        erodedGeometryMismatchRatio: 0,
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

  test("rejects a one-logical-pixel displacement at DPR 2", () => {
    const draw = (x: number): CanvasScene["draw"] =>
      function displacedRect(context, width, height) {
        context.fillStyle = "#f8fafc"
        context.fillRect(0, 0, width, height)
        context.fillStyle = "#b8bac0"
        context.fillRect(x, 60, 4, 80)
      }

    expectHardenedRuleRejects("shift-negative", draw(100), draw(101))
  })

  test("rejects a wrong even-odd hole fill", () => {
    const draw = (fillRule: CanvasFillRule): CanvasScene["draw"] =>
      function holeFill(context, width, height) {
        context.fillStyle = "#f8fafc"
        context.fillRect(0, 0, width, height)
        context.beginPath()
        context.rect(120, 80, 40, 40)
        context.rect(136, 96, 8, 8)
        context.fillStyle = "#b8bac0"
        context.fill(fillRule)
      }

    expectHardenedRuleRejects("hole-negative", draw("evenodd"), draw("nonzero"))
  })

  test("rejects a missing dash", () => {
    const draw = (dash: number[]): CanvasScene["draw"] =>
      function dashStroke(context, width, height) {
        context.fillStyle = "#f8fafc"
        context.fillRect(0, 0, width, height)
        context.beginPath()
        context.moveTo(100, 120)
        context.lineTo(180, 120)
        context.setLineDash(dash)
        context.lineWidth = 4
        context.strokeStyle = "#b8bac0"
        context.stroke()
      }

    expectHardenedRuleRejects("dash-negative", draw([8, 8]), draw([]))
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
      let maxChannelDelta: number | undefined
      let differingPixelBudget: number | undefined
      if (scene.name === "translate-scale") maxChannelDelta = 72
      if (scene.name === "dashed-polyline" || scene.name === "even-odd-polygon") {
        maxChannelDelta = 96
      }
      if (scene.name === "zoomed-curve-stroke") maxChannelDelta = 120
      // GPUI and Chromium interpolate a large scaled bitmap differently at
      // low channel deltas. Geometry stays exact: the outside-contour delta is
      // 9 and the eroded mismatch is zero.
      if (scene.name === "image-scaled") differingPixelBudget = 0.014

      expectCanvasMatchesBrowser(scene, {
        // GPUI and Chromium use different edge-coverage rasterizers for
        // tessellated paths. The 1% differing-pixel budget remains the geometry
        // gate; the channel ceiling only admits observed edge coverage.
        maxChannelDelta,
        differingPixelBudget,
        skip: (message) => context.skip(message),
      })
    })
  }
})
