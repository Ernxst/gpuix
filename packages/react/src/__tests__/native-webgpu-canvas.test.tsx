import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng, type RgbaImage } from "../testing-png.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const RED = 0xff0000ff
const GREEN = 0x00ff00ff
const BLUE = 0x0000ffff
const YELLOW = 0xffff00ff
const BACKGROUND = [16, 16, 16, 255]

function CanvasScene({
  showBlue,
  redWidth = 80,
  redHeight = 50,
}: {
  showBlue: boolean
  redWidth?: number
  redHeight?: number
}): React.ReactElement {
  return (
    <div style={{ width: 160, height: 120, position: "relative", backgroundColor: "#101010" }}>
      <div
        data-testid="scrollport"
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          width: 100,
          height: 70,
          overflow: "scroll",
        }}
      >
        <div style={{ width: 180, height: 90, position: "relative" }}>
          <canvas
            data-testid="red-canvas"
            width={redWidth}
            height={redHeight}
            style={{ position: "absolute", left: 6, top: 6 }}
          />
          {showBlue ? (
            <canvas
              data-testid="blue-canvas"
              width={80}
              height={50}
              style={{ position: "absolute", left: 44, top: 25 }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ]
}

function capture(renderer: { captureScreenshot(file: string): void }, directory: string): RgbaImage {
  const file = path.join(directory, "native-webgpu-canvas.png")
  renderer.captureScreenshot(file)
  return decodePng(readFileSync(file), file)
}

describeNative("native WebGPU canvas presentation", () => {
  it("composites, clips, scrolls, replaces, and retires two retained GPU canvas textures", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-native-webgpu-"))
    const screen = createTestRoot({ width: 160, height: 120, scaleFactor: 1 })

    try {
      screen.render(<CanvasScene showBlue />)
      let red = screen.getByTestId("red-canvas")
      let blue = screen.getByTestId("blue-canvas")
      const scrollport = screen.getByTestId("scrollport")

      screen.renderer.installTestGpuCanvas(red.id, 80, 50, RED)
      screen.renderer.installTestGpuCanvas(blue.id, 80, 50, BLUE)
      screen.renderer.flush()
      expect(screen.renderer.getTestGpuCanvasState()).toEqual({
        installed: 2,
        presentations: 2,
        released: 0,
      })

      let frame = capture(screen.renderer, directory)
      expect(pixel(frame, 20, 20)).toEqual([255, 0, 0, 255])
      expect(pixel(frame, 60, 40)).toEqual([0, 0, 255, 255])
      expect(pixel(frame, 110, 40)).toEqual(BACKGROUND)
      expect(pixel(frame, 20, 85)).toEqual(BACKGROUND)

      screen.renderer.requestFrame(() => screen.renderer.advanceTestGpuCanvas(red.id, GREEN))
      screen.renderer.advanceAsyncClock(16)
      screen.renderer.flush()
      frame = capture(screen.renderer, directory)
      expect(pixel(frame, 20, 20)).toEqual([0, 255, 0, 255])
      expect(pixel(frame, 60, 40)).toEqual([0, 0, 255, 255])

      screen.renderer.scrollTo(scrollport.id, -20, -10)
      screen.renderer.flush()
      frame = capture(screen.renderer, directory)
      expect(screen.renderer.getScrollOffset(scrollport.id)).toEqual([-20, -10])
      expect(pixel(frame, 16, 16)).toEqual([0, 255, 0, 255])
      expect(pixel(frame, 80, 20)).toEqual(BACKGROUND)
      expect(pixel(frame, 60, 40)).toEqual([0, 0, 255, 255])

      screen.render(<CanvasScene showBlue redWidth={64} redHeight={40} />)
      red = screen.getByTestId("red-canvas")
      expect(red.getBoundingClientRect()).toMatchObject({ width: 64, height: 40 })
      const releasesBeforeReplacement = screen.renderer.getTestGpuCanvasState().released
      screen.renderer.installTestGpuCanvas(red.id, 64, 40, YELLOW)
      screen.renderer.flush()
      screen.renderer.flush()
      expect(screen.renderer.getTestGpuCanvasState()).toMatchObject({
        installed: 2,
        presentations: 2,
        released: releasesBeforeReplacement + 1,
      })

      screen.render(<CanvasScene showBlue={false} redWidth={64} redHeight={40} />)
      expect(screen.renderer.getTestGpuCanvasState()).toMatchObject({
        installed: 1,
        presentations: 1,
        released: releasesBeforeReplacement + 2,
      })

      screen.render(<CanvasScene showBlue redWidth={64} redHeight={40} />)
      blue = screen.getByTestId("blue-canvas")
      screen.renderer.installTestGpuCanvas(blue.id, 80, 50, BLUE)
      screen.renderer.flush()
      expect(screen.renderer.getTestGpuCanvasState()).toMatchObject({
        installed: 2,
        presentations: 2,
      })
    } finally {
      screen.unmount()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
