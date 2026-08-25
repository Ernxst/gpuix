import fs from "fs"
import path from "path"
import React from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { BackgroundValue } from "../types/host.js"
import {
  expectScreenshotsDiffer,
  expectScreenshotsEqual,
  SHOTS_DIR,
} from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const absoluteCases = [
  ["hex4", "#f00f", "#ff0000"],
  ["hex-no-hash", "ff0000ff", "#ff0000"],
  ["named", "rebeccapurple", "#663399"],
  ["named-red", "red", "#ff0000"],
  ["rgb", "rgb(255 0 0)", "#ff0000"],
  ["rgba", "rgba(255, 0, 0, 1)", "#ff0000"],
  ["hsl", "hsl(0 100% 50%)", "#ff0000"],
  ["hsla", "hsla(0, 100%, 50%, 1)", "#ff0000"],
  ["hwb", "hwb(0 0% 0%)", "#ff0000"],
  ["hwba", "hwba(0, 0%, 0%, 1)", "#ff0000"],
  ["hsv", "hsv(0 100% 100%)", "#ff0000"],
  ["hsva", "hsva(0, 100%, 100%, 1)", "#ff0000"],
  ["lab", "lab(100% 0 0)", "#ffffff"],
  ["lch", "lch(100% 0 0)", "#ffffff"],
  ["oklab", "oklab(0 0 0)", "#000000"],
  ["oklch", "oklch(0 0 0)", "#000000"],
] as const

const alphaCases = [
  ["rgb", "rgb(0 0 0 / 50%)"],
  ["rgba", "rgba(0, 0, 0, 0.5)"],
  ["hsl", "hsl(0 0% 0% / 50%)"],
  ["hsla", "hsla(0, 0%, 0%, 0.5)"],
  ["hwb", "hwb(0 0% 100% / 50%)"],
  ["hwba", "hwba(0, 0%, 100%, 0.5)"],
  ["hsv", "hsv(0 0% 0% / 50%)"],
  ["hsva", "hsva(0, 0%, 0%, 0.5)"],
  ["lab", "lab(0% 0 0 / 50%)"],
  ["lch", "lch(0% 0 0 / 50%)"],
  ["oklab", "oklab(0 0 0 / 50%)"],
  ["oklch", "oklch(0 0 0 / 50%)"],
] as const

const relativeCases = [
  ["rgb", "rgb(from #bad455 b r g / alpha)", "#55bad4"],
  ["hsl", "hsl(from #bad455 h s l / alpha)", "#bad455"],
  ["hwb", "hwb(from #bad455 h w b / alpha)", "#bad455"],
  ["hsv", "hsv(from #bad455 h s v / alpha)", "#bad455"],
  ["lab", "lab(from #bad455 l a b / alpha)", "#bad455"],
  ["lch", "lch(from #bad455 l c h / alpha)", "#bad455"],
  ["oklab", "oklab(from #bad455 calc(l * 0.7) a b)", "#708500"],
  ["oklch", "oklch(from #bad455 calc(l - 0.15) calc(c * 0.7) h)", "#8fa150"],
] as const

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function captureColor(name: string, color?: string) {
  const screenshotPath = path.join(SHOTS_DIR, `${name}.png`)
  const testRoot = createTestRoot()
  testRoot.render(
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: color,
      }}
    />
  )
  testRoot.renderer.captureScreenshot(screenshotPath)
  return screenshotPath
}

function expectColorsEqual(name: string, input: string, expected: string) {
  const actualPath = captureColor(`${name}-actual`, input)
  const expectedPath = captureColor(`${name}-expected`, expected)
  expectScreenshotsEqual(actualPath, expectedPath)
}

function captureBackground(name: string, background: BackgroundValue) {
  const screenshotPath = path.join(SHOTS_DIR, `${name}.png`)
  const testRoot = createTestRoot()
  testRoot.render(<div style={{ width: "100%", height: "100%", background }} />)
  testRoot.renderer.captureScreenshot(screenshotPath)
  return screenshotPath
}

describeNative("native color functions", () => {
  it.each(absoluteCases)(
    "paints absolute %s exactly like its canonical hex",
    (name, input, expected) => {
      expectColorsEqual(`color-absolute-${name}`, input, expected)
    }
  )

  it.each(alphaCases)("paints %s alpha exactly like 50% black", (name, input) => {
    expectColorsEqual(`color-alpha-${name}`, input, "rgba(0 0 0 / 50%)")
  })

  it.each(relativeCases)(
    "paints relative %s exactly like its expected hex",
    (name, input, expected) => {
      expectColorsEqual(`color-relative-${name}`, input, expected)
    }
  )

  it("rejects an invalid paint loudly and paints a valid OKLCH value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const invalidPath = captureColor("color-invalid", "not-a-color")
    const unsetPath = captureColor("color-unset")
    expectScreenshotsEqual(invalidPath, unsetPath)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("backgroundColor"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"not-a-color"'))

    const validPath = captureColor("color-valid-oklch", "oklch(67.3% 0.182 276.935)")
    expectScreenshotsDiffer(validPath, unsetPath)
  })

  it("uses the same parser for compound consumers and pseudo-states", () => {
    const basePath = path.join(SHOTS_DIR, "color-consumers-base.png")
    const hoverPath = path.join(SHOTS_DIR, "color-consumers-hover.png")
    const activePath = path.join(SHOTS_DIR, "color-consumers-active.png")
    const testRoot = createTestRoot()

    testRoot.render(
      <div
        style={{
          width: 360,
          height: 180,
          backgroundColor: "oklch(67.3% 0.182 276.935)",
          borderWidth: 8,
          borderColor: "hwb(0 0% 0%)",
          color: "hsl(0 0% 100%)",
          selectionColor: "lab(70% 40 30 / 35%)",
          boxShadow: {
            offsetX: 18,
            offsetY: 18,
            blurRadius: 10,
            spreadRadius: 4,
            color: "oklab(45% 0.1 0.05 / 45%)",
          },
          hover: { backgroundColor: "hsv(210 80% 70%)" },
          active: { backgroundColor: "lch(60% 80 40)" },
        }}
      >
        <text>Full color path</text>
      </div>
    )

    testRoot.renderer.nativeSimulateMouseMove(500, 500)
    testRoot.renderer.captureScreenshot(basePath)
    testRoot.renderer.nativeSimulateMouseMove(180, 90)
    testRoot.renderer.captureScreenshot(hoverPath)
    testRoot.renderer.nativeSimulateMouseDown(180, 90)
    testRoot.renderer.captureScreenshot(activePath)

    expectScreenshotsDiffer(basePath, hoverPath)
    expectScreenshotsDiffer(hoverPath, activePath)
    expectScreenshotsDiffer(basePath, activePath)
  })

  it("renders a two-stop CSS linear gradient through the native background", () => {
    const gradient = captureBackground(
      "linear-gradient-two-stop",
      "linear-gradient(90deg in oklab, #ff0000 0%, #0000ff 100%)"
    )
    const solid = captureColor("linear-gradient-two-stop-solid", "#ff0000")
    expectScreenshotsDiffer(gradient, solid)
  })

  it("renders every stop in a structured multi-stop linear gradient", () => {
    const twoStop = captureBackground("linear-gradient-endpoints", {
      type: "linearGradient",
      angle: 90,
      stops: [
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ],
      colorSpace: "srgb",
    })
    const multiStop = captureBackground("linear-gradient-multi-stop", {
      type: "linearGradient",
      angle: 90,
      stops: [
        { color: "#ff0000", position: 0 },
        { color: "#00ff00", position: 0.5 },
        { color: "#0000ff", position: 1 },
      ],
      colorSpace: "srgb",
    })
    expectScreenshotsDiffer(twoStop, multiStop)
  })
})
