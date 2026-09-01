import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import React, { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { __applyCanvasCommands } from "../canvas/commands.js"
import {
  CANVAS_ELEMENT_UNSUPPORTED_MEMBERS,
  flushRecordingContext2D,
} from "../canvas/context-2d.js"
import { createImageBitmap, Image } from "../canvas/image.js"
import {
  CANVAS_OPCODES,
  CANVAS_STREAM_MAGIC,
  CANVAS_STREAM_VERSION,
} from "../canvas/opcodes.js"
import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  canvasScenes,
} from "../canvas-scenes.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { CanvasPublicInstance, PublicInstance } from "../types/host.js"
import { SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip
const canvasImageFixture = fileURLToPath(
  new URL("../../canvas-goldens/__fixtures__/canvas-image-source.png", import.meta.url)
)
const corruptCanvasImageFixture = fileURLToPath(
  new URL("../../canvas-goldens/__fixtures__/canvas-image-corrupt.png", import.meta.url)
)
const canvasImageDataUrl = `data:image/png;base64,${readFileSync(canvasImageFixture).toString("base64")}`

function distinctCanvasImagePath(index: number): string {
  const separator = canvasImageFixture.lastIndexOf("/")
  return (
    canvasImageFixture.slice(0, separator + 1) +
    "./".repeat(index + 1) +
    canvasImageFixture.slice(separator + 1)
  )
}

async function waitForCanvasImages(
  renderer: TestRenderer,
  elementId: number,
  expected: number
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    renderer.flush()
    const state = renderer.getCanvasState(elementId)
    if (
      state?.loadedImageCount === expected &&
      state.paintedImageCount === expected &&
      state.atlasTileCount === expected
    ) {
      return state
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(
    `Canvas ${elementId} did not paint ${expected} images: ` +
      JSON.stringify(renderer.getCanvasState(elementId))
  )
}

async function waitForCanvasState(
  renderer: TestRenderer,
  elementId: number,
  predicate: (
    state: NonNullable<ReturnType<TestRenderer["getCanvasState"]>>
  ) => boolean,
  description: string
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    renderer.flush()
    const state = renderer.getCanvasState(elementId)
    if (state && predicate(state)) return state
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(
    `Canvas ${elementId} did not ${description}: ` +
      JSON.stringify(renderer.getCanvasState(elementId))
  )
}

function fillRectStream(color: string, x = 0, y = 0, width = 80, height = 60) {
  return {
    ops: new Uint32Array([
      CANVAS_STREAM_MAGIC,
      CANVAS_STREAM_VERSION,
      CANVAS_OPCODES.fillStyle,
      1,
      CANVAS_OPCODES.fillRect,
      4,
    ]),
    operands: new Float64Array([0, x, y, width, height]),
    strings: [color],
  }
}

describeNative("retained canvas element", { timeout: 14_000 }, () => {
  it("replaces its display list without a React commit or sibling mutation", () => {
    const testRoot = createTestRoot({ width: 240, height: 140 })
    const canvasRef = createRef<PublicInstance>()
    try {
      testRoot.render(
        <div style={{ width: 240, height: 140, display: "flex" }}>
          <canvas ref={canvasRef} width={120} height={100} style={{ width: 120, height: 100 }} />
          <text testId="canvas-sibling" style={{ color: "#ffffff" }}>
            stable sibling
          </text>
        </div>
      )
      const sibling = testRoot.renderer.findByTestId("canvas-sibling")
      expect(sibling).toBeDefined()
      const commitCount = testRoot.renderer.commitCount

      const first = fillRectStream("#ef4444")
      __applyCanvasCommands(canvasRef, first.ops, first.operands, first.strings)
      testRoot.renderer.flush()
      const second = fillRectStream("#2563eb", 12, 8, 64, 44)
      __applyCanvasCommands(canvasRef, second.ops, second.operands, second.strings)
      testRoot.renderer.flush()

      expect(testRoot.renderer.commitCount).toBe(commitCount)
      expect(testRoot.renderer.findByTestId("canvas-sibling")?.id).toBe(sibling?.id)
      expect(testRoot.renderer.getAllText()).toContain("stable sibling")
    } finally {
      testRoot.unmount()
    }
  })

  it("memoises getContext(\"2d\") per canvas and rejects other context ids", () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="context-canvas" width={120} height={80} />
      )
      const first = canvasRef.current?.getContext("2d")
      expect(first).toBeDefined()
      expect(canvasRef.current?.getContext("2d")).toBe(first)
      expect(canvasRef.current?.getContext("webgl")).toBeNull()
    } finally {
      testRoot.unmount()
    }
  })

  it("diagnoses toDataURL once per element with the readback reason", () => {
    const strict = createTestRoot({ width: 80, height: 60, strictStyles: true })
    const compatibility = createTestRoot({ width: 80, height: 60, strictStyles: false })
    const strictRef = createRef<CanvasPublicInstance>()
    const compatibilityRef = createRef<CanvasPublicInstance>()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const spec = CANVAS_ELEMENT_UNSUPPORTED_MEMBERS[0]
    try {
      strict.render(<canvas ref={strictRef} testId="strict-data-url" width={80} height={60} />)
      compatibility.render(
        <canvas ref={compatibilityRef} testId="compat-data-url" width={80} height={60} />
      )

      expect(() => strictRef.current!.toDataURL()).toThrow(
        new RegExp(`strict-data-url.*HTMLCanvasElement\\.toDataURL.*${spec.reason}`)
      )
      compatibilityRef.current!.toDataURL()
      compatibilityRef.current!.toDataURL()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`compat-data-url.*HTMLCanvasElement\\.toDataURL.*${spec.reason}`)
        )
      )
    } finally {
      warn.mockRestore()
      strict.unmount()
      compatibility.unmount()
    }
  })

  it("exports Image and createImageBitmap without installing globals", async () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<CanvasPublicInstance>()
    const previousImage = Reflect.get(globalThis, "Image")
    const onload = vi.fn()
    try {
      testRoot.render(<canvas ref={canvasRef} width={120} height={80} />)
      const image = new Image(999, 777)
      image.onload = onload
      image.src = canvasImageFixture
      const context = canvasRef.current!.getContext("2d")!
      context.drawImage(image, 0, 0)
      flushRecordingContext2D(context)

      await image.decode()
      const bitmap = await createImageBitmap(image)
      expect(image.complete).toBe(true)
      expect(image.naturalWidth).toBe(64)
      expect(image.naturalHeight).toBe(48)
      expect(onload).toHaveBeenCalledTimes(1)
      expect(bitmap.width).toBe(64)
      expect(bitmap.height).toBe(48)
      expect(Reflect.get(globalThis, "Image")).toBe(previousImage)
      bitmap.close()
    } finally {
      testRoot.unmount()
    }
  })

  it("decodes data URL Images and reports malformed data URLs through DOM image errors", async () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<CanvasPublicInstance>()
    const onload = vi.fn()
    const onerror = vi.fn()
    try {
      testRoot.render(<canvas ref={canvasRef} width={120} height={80} />)

      const image = new Image()
      image.onload = onload
      image.src = canvasImageDataUrl
      await image.decode()
      expect(image.complete).toBe(true)
      expect(image.naturalWidth).toBe(64)
      expect(image.naturalHeight).toBe(48)
      expect(onload).toHaveBeenCalledTimes(1)
      const context = canvasRef.current!.getContext("2d")!
      context.drawImage(image, 0, 0)
      flushRecordingContext2D(context)
      await expect(
        waitForCanvasImages(testRoot.renderer, canvasRef.current!.id, 1)
      ).resolves.toMatchObject({
        imageCount: 1,
        loadedImageCount: 1,
        paintedImageCount: 1,
        atlasTileCount: 1,
      })

      const malformed = new Image()
      malformed.onerror = onerror
      malformed.src = "data:image/png;base64,%%%"
      await expect(malformed.decode()).rejects.toMatchObject({ name: "EncodingError" })
      expect(malformed.complete).toBe(true)
      expect(malformed.naturalWidth).toBe(0)
      expect(malformed.naturalHeight).toBe(0)
      expect(onerror).toHaveBeenCalledTimes(1)
    } finally {
      testRoot.unmount()
    }
  })

  it("rejects decode and drawImage after the native loader marks an image broken", async () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<CanvasPublicInstance>()
    const onload = vi.fn()
    const onerror = vi.fn()
    try {
      testRoot.render(<canvas ref={canvasRef} width={120} height={80} />)
      const image = new Image()
      image.onload = onload
      image.onerror = onerror
      image.src = corruptCanvasImageFixture
      const context = canvasRef.current!.getContext("2d")!
      context.drawImage(image, 0, 0)
      flushRecordingContext2D(context)

      await expect(image.decode()).rejects.toMatchObject({ name: "EncodingError" })
      expect(image.complete).toBe(true)
      expect(image.naturalWidth).toBe(0)
      expect(image.naturalHeight).toBe(0)
      expect(onload).not.toHaveBeenCalled()
      expect(onerror).toHaveBeenCalledTimes(1)
      expect(() => context.drawImage(image, 0, 0)).toThrow(
        expect.objectContaining({ name: "InvalidStateError" })
      )
    } finally {
      testRoot.unmount()
    }
  })

  it("no-ops the cold frame and repaints from native load completion alone", async () => {
    const fixture = readFileSync(canvasImageFixture)
    let releaseResponse = (): void => {}
    let markRequested = (): void => {}
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    const server = createServer(async (_request, response) => {
      markRequested()
      await responseGate
      response.writeHead(200, { "content-type": "image/png" }).end(fixture)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test server address")

    const testRoot = createTestRoot({
      width: 120,
      height: 80,
      allowPrivateNetworkImages: true,
    })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(<canvas ref={canvasRef} width={120} height={80} />)
      const image = new Image()
      image.src = `http://127.0.0.1:${address.port}/delayed.png`
      const context = canvasRef.current!.getContext("2d")!
      context.drawImage(image, 0, 0)
      flushRecordingContext2D(context)
      testRoot.renderer.flush()
      await requested

      const id = canvasRef.current!.id
      expect(testRoot.renderer.peekCanvasState(id)).toMatchObject({
        imageCount: 1,
        loadedImageCount: 0,
        paintedImageCount: 0,
        atlasTileCount: 0,
      })

      releaseResponse()
      await image.decode()
      testRoot.renderer.drawPendingFrame()
      const repainted = testRoot.renderer.peekCanvasState(id)
      expect(repainted).toMatchObject({
        loadedImageCount: 1,
        paintedImageCount: 1,
        atlasTileCount: 1,
      })
    } finally {
      releaseResponse()
      testRoot.unmount()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("raises R1 for drawImage under a rotated CTM", () => {
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: true })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="rotated-image-canvas" width={120} height={80} />
      )
      const image = new Image()
      image.src = canvasImageFixture
      const context = canvasRef.current!.getContext("2d")
      context.rotate(0.2)
      context.drawImage(image, 0, 0)
      expect(() => flushRecordingContext2D(context)).toThrow(
        /rotated-image-canvas.*drawImage.*R1.*rotated or skewed CTM/
      )
    } finally {
      testRoot.unmount()
    }
  })

  it("raises R1 instead of silently unmirroring drawImage under negative scale", () => {
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: true })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="reflected-image-canvas" width={120} height={80} />
      )
      const image = new Image()
      image.src = canvasImageFixture
      const context = canvasRef.current!.getContext("2d")!
      context.scale(-1, 1)
      context.drawImage(image, -64, 0)
      expect(() => flushRecordingContext2D(context)).toThrow(
        /reflected-image-canvas.*drawImage.*R1.*negative axis scales/
      )
    } finally {
      testRoot.unmount()
    }
  })

  it("replays drawImage globalAlpha through a translucent cached image", async () => {
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: true })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="alpha-image-canvas" width={120} height={80} />
      )
      const image = new Image()
      image.src = canvasImageFixture
      await image.decode()
      const context = canvasRef.current!.getContext("2d")!
      context.globalAlpha = 0.375
      context.drawImage(image, 0, 0)
      expect(() => flushRecordingContext2D(context)).not.toThrow()
      testRoot.renderer.flush()

      expect(testRoot.renderer.getCanvasState(canvasRef.current!.id)).toMatchObject({
        loadedImageCount: 1,
        paintedImageCount: 1,
        atlasTileCount: 1,
      })
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      testRoot.unmount()
    }
  })

  it("paints 64 distinct image sources and drops every atlas tile on unmount", async () => {
    const width = 256
    const height = 192
    const actualRenderer = new TestRenderer({ width, height })
    const expectedRenderer = new TestRenderer({ width, height })
    const actualRoot = createRoot(actualRenderer)
    const expectedRoot = createRoot(expectedRenderer)
    const actualRef = createRef<CanvasPublicInstance>()
    const expectedRef = createRef<CanvasPublicInstance>()
    const actualPath = path.join(SHOTS_DIR, "canvas-image-grid-64-actual.png")
    const expectedPath = path.join(SHOTS_DIR, "canvas-image-grid-64-expected.png")

    try {
      flushSync(() =>
        actualRoot.render(<canvas ref={actualRef} width={width} height={height} />)
      )
      flushSync(() =>
        expectedRoot.render(<canvas ref={expectedRef} width={width} height={height} />)
      )
      actualRenderer.flush()
      expectedRenderer.flush()

      const actualContext = actualRef.current!.getContext("2d")
      const expectedContext = expectedRef.current!.getContext("2d")
      const shared = new Image()
      shared.src = canvasImageFixture
      for (let index = 0; index < 64; index += 1) {
        const image = new Image()
        image.src = distinctCanvasImagePath(index)
        const x = (index % 8) * 32
        const y = Math.floor(index / 8) * 24
        actualContext.drawImage(image, x, y, 32, 24)
        expectedContext.drawImage(shared, x, y, 32, 24)
      }
      flushRecordingContext2D(actualContext)
      flushRecordingContext2D(expectedContext)

      const actualId = actualRef.current!.id
      const expectedId = expectedRef.current!.id
      const loaded = await waitForCanvasImages(actualRenderer, actualId, 64)
      await waitForCanvasImages(expectedRenderer, expectedId, 1)
      expect(loaded).toMatchObject({
        imageCount: 64,
        loadedImageCount: 64,
        paintedImageCount: 64,
        atlasTileCount: 64,
        releasedAtlasTileCount: 0,
      })

      actualRenderer.captureScreenshot(actualPath)
      expectedRenderer.captureScreenshot(expectedPath)
      expect(actualRenderer.compareImages(expectedPath, actualPath, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })

      flushSync(() => actualRoot.unmount())
      actualRenderer.flush()
      expect(actualRenderer.getCanvasState(actualId)).toMatchObject({
        imageCount: 0,
        loadedImageCount: 0,
        atlasTileCount: 0,
        releasedAtlasTileCount: 64,
      })
    } finally {
      actualRoot.unmount()
      expectedRoot.unmount()
      actualRenderer.dispose()
      expectedRenderer.dispose()
    }
  }, 20_000)

  it("bounds atlas occupancy across canvas image churn", async () => {
    const testRoot = createTestRoot({ width: 64, height: 48 })
    const canvasRef = createRef<CanvasPublicInstance>()
    const images: HTMLImageElement[] = []
    const actualPath = path.join(SHOTS_DIR, "canvas-atlas-revisit-actual.png")
    const expectedPath = path.join(SHOTS_DIR, "canvas-atlas-before-eviction.png")
    try {
      testRoot.render(<canvas ref={canvasRef} width={64} height={48} />)
      const context = canvasRef.current!.getContext("2d")!
      const id = canvasRef.current!.id

      for (let index = 0; index < 80; index += 1) {
        const image = new Image()
        image.src = distinctCanvasImagePath(index)
        images.push(image)
        await image.decode()
        context.clearRect(0, 0, 64, 48)
        context.drawImage(image, 0, 0)
        flushRecordingContext2D(context)
        testRoot.renderer.flush()
        if (index === 0) {
          await waitForCanvasImages(testRoot.renderer, id, 1)
          testRoot.renderer.captureScreenshot(expectedPath)
        }
      }

      const state = await waitForCanvasState(
        testRoot.renderer,
        id,
        (candidate) => candidate.paintedImageCount === 80,
        "paint 80 distinct images"
      )
      expect(state).toMatchObject({
        imageCount: 1,
        loadedImageCount: 1,
        paintedImageCount: 80,
        atlasTileCount: 64,
        releasedAtlasTileCount: 16,
      })

      context.clearRect(0, 0, 64, 48)
      context.drawImage(images[0], 0, 0)
      flushRecordingContext2D(context)
      const revisited = await waitForCanvasState(
        testRoot.renderer,
        id,
        (candidate) => candidate.releasedAtlasTileCount === 17,
        "re-upload the least-recently-used image"
      )
      expect(revisited).toMatchObject({
        imageCount: 1,
        loadedImageCount: 1,
        paintedImageCount: 80,
        atlasTileCount: 64,
        releasedAtlasTileCount: 17,
      })

      testRoot.renderer.flush()
      testRoot.renderer.captureScreenshot(actualPath)
      const comparison = testRoot.renderer.compareImages(expectedPath, actualPath, 0)
      expect(comparison.differingPixelRatio).toBeLessThanOrEqual(0.03)
      expect(comparison.maxChannelDelta).toBeLessThanOrEqual(16)
      expect(comparison.maxChannelDeltaOutsideGoldenContour).toBe(0)
      expect(comparison.erodedGeometryMismatchRatio).toBe(0)
    } finally {
      testRoot.unmount()
    }
  }, 20_000)

  it("bounds atlas occupancy across opacity churn of a live image", async () => {
    const width = 64
    const height = 48
    const testRoot = createTestRoot({ width, height })
    const expectedRoot = createTestRoot({ width, height })
    const canvasRef = createRef<CanvasPublicInstance>()
    const expectedRef = createRef<CanvasPublicInstance>()
    const actualPath = path.join(SHOTS_DIR, "canvas-atlas-opacity-actual.png")
    const expectedPath = path.join(SHOTS_DIR, "canvas-atlas-opacity-expected.png")
    try {
      testRoot.render(<canvas ref={canvasRef} width={width} height={height} />)
      expectedRoot.render(<canvas ref={expectedRef} width={width} height={height} />)
      const context = canvasRef.current!.getContext("2d")!
      const expectedContext = expectedRef.current!.getContext("2d")!
      const image = new Image()
      image.src = canvasImageFixture
      await image.decode()
      const id = canvasRef.current!.id

      for (let index = 0; index < 80; index += 1) {
        context.clearRect(0, 0, width, height)
        context.globalAlpha = (index + 1) / 100
        context.drawImage(image, 0, 0)
        flushRecordingContext2D(context)
        testRoot.renderer.flush()
      }

      const state = await waitForCanvasState(
        testRoot.renderer,
        id,
        (candidate) => candidate.paintedImageCount === 80,
        "paint 80 opacity variants of one live image"
      )
      expect(state).toMatchObject({
        imageCount: 1,
        loadedImageCount: 1,
        paintedImageCount: 80,
        atlasTileCount: 64,
        releasedAtlasTileCount: 16,
      })

      expectedContext.globalAlpha = 0.8
      expectedContext.drawImage(image, 0, 0)
      flushRecordingContext2D(expectedContext)
      await waitForCanvasImages(expectedRoot.renderer, expectedRef.current!.id, 1)

      testRoot.renderer.requestFrame(() => {})
      testRoot.renderer.flush()
      expect(testRoot.renderer.getCanvasState(id)).toMatchObject({
        atlasTileCount: 64,
        releasedAtlasTileCount: 16,
      })

      testRoot.renderer.captureScreenshot(actualPath)
      expectedRoot.renderer.captureScreenshot(expectedPath)
      const comparison = testRoot.renderer.compareImages(expectedPath, actualPath, 0)
      expect(comparison.differingPixelRatio).toBeLessThanOrEqual(0.03)
      expect(comparison.maxChannelDelta).toBeLessThanOrEqual(16)
      expect(comparison.maxChannelDeltaOutsideGoldenContour).toBe(0)
      expect(comparison.erodedGeometryMismatchRatio).toBe(0)
    } finally {
      testRoot.unmount()
      expectedRoot.unmount()
    }
  }, 20_000)

  it("keeps every in-use atlas tile when live images exceed the budget", async () => {
    const width = 260
    const height = 80
    const testRoot = createTestRoot({ width, height })
    const expectedRoot = createTestRoot({ width, height })
    const canvasRef = createRef<CanvasPublicInstance>()
    const expectedRef = createRef<CanvasPublicInstance>()
    const images: HTMLImageElement[] = []
    const actualPath = path.join(SHOTS_DIR, "canvas-atlas-live-set-actual.png")
    const expectedPath = path.join(SHOTS_DIR, "canvas-atlas-live-set-expected.png")
    try {
      testRoot.render(<canvas ref={canvasRef} width={width} height={height} />)
      expectedRoot.render(<canvas ref={expectedRef} width={width} height={height} />)
      const context = canvasRef.current!.getContext("2d")!
      const expectedContext = expectedRef.current!.getContext("2d")!
      const id = canvasRef.current!.id

      const inactive = new Image()
      inactive.src = distinctCanvasImagePath(0)
      images.push(inactive)
      await inactive.decode()
      context.drawImage(inactive, 0, 0, 20, 16)
      flushRecordingContext2D(context)
      await waitForCanvasImages(testRoot.renderer, id, 1)

      context.clearRect(0, 0, width, height)
      const expectedImage = new Image()
      expectedImage.src = canvasImageFixture
      for (let index = 1; index <= 65; index += 1) {
        const image = new Image()
        image.src = distinctCanvasImagePath(index)
        images.push(image)
        const x = ((index - 1) % 13) * 20
        const y = Math.floor((index - 1) / 13) * 16
        context.drawImage(image, x, y, 20, 16)
        expectedContext.drawImage(expectedImage, x, y, 20, 16)
      }
      flushRecordingContext2D(context)
      flushRecordingContext2D(expectedContext)

      const state = await waitForCanvasState(
        testRoot.renderer,
        id,
        (candidate) =>
          candidate.loadedImageCount === 65 && candidate.paintedImageCount === 66,
        "paint 65 simultaneously live images"
      )
      expect(state).toMatchObject({
        imageCount: 65,
        loadedImageCount: 65,
        paintedImageCount: 66,
        atlasTileCount: 65,
        releasedAtlasTileCount: 1,
      })
      await waitForCanvasImages(expectedRoot.renderer, expectedRef.current!.id, 1)
      testRoot.renderer.captureScreenshot(actualPath)
      expectedRoot.renderer.captureScreenshot(expectedPath)
      expect(testRoot.renderer.compareImages(expectedPath, actualPath, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })
    } finally {
      testRoot.unmount()
      expectedRoot.unmount()
    }
  }, 20_000)

  it("does not retessellate an unchanged display list on a requested frame", () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="cached-canvas" width={120} height={80} />
      )
      const context = canvasRef.current!.getContext("2d")!
      context.beginPath()
      context.moveTo(8, 8)
      context.bezierCurveTo(28, 70, 82, 10, 112, 68)
      context.stroke()
      flushRecordingContext2D(context)
      testRoot.renderer.flush()

      const canvas = testRoot.renderer.findByTestId("cached-canvas")!
      const prepared = testRoot.renderer.getCanvasState(canvas.id)!
      expect(prepared.tessellationCount).toBeGreaterThan(0)

      testRoot.renderer.requestFrame(() => {})
      testRoot.renderer.flush()
      expect(testRoot.renderer.getCanvasState(canvas.id)).toEqual(prepared)

      context.lineTo(116, 72)
      context.stroke()
      flushRecordingContext2D(context)
      testRoot.renderer.flush()
      const changed = testRoot.renderer.getCanvasState(canvas.id)!
      expect(changed.preparationCount).toBeGreaterThan(prepared.preparationCount)
      expect(changed.tessellationCount).toBeGreaterThan(prepared.tessellationCount)
    } finally {
      testRoot.unmount()
    }
  })

  it("throws native decoder diagnostics synchronously in strict mode", () => {
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: true })
    const canvasRef = createRef<PublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="diagnostic-canvas" width={120} height={80} />
      )
      expect(() =>
        __applyCanvasCommands(
          canvasRef,
          new Uint32Array([
            CANVAS_STREAM_MAGIC,
            CANVAS_STREAM_VERSION,
            CANVAS_OPCODES.lineDashOffset,
            1,
          ]),
          new Float64Array([2]),
          []
        )
      ).toThrow(/lineDashOffset.*cannot be replayed faithfully/)
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      testRoot.unmount()
    }
  })

  it("warns native decoder diagnostics immediately once per canvas member", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: false })
    const canvasRef = createRef<PublicInstance>()
    const secondCanvasRef = createRef<PublicInstance>()
    const unsupported = {
      ops: new Uint32Array([
        CANVAS_STREAM_MAGIC,
        CANVAS_STREAM_VERSION,
        CANVAS_OPCODES.lineDashOffset,
        1,
      ]),
      operands: new Float64Array([2]),
    }
    try {
      testRoot.render(
        <div>
          <canvas ref={canvasRef} testId="warning-canvas" width={60} height={80} />
          <canvas
            ref={secondCanvasRef}
            testId="second-warning-canvas"
            width={60}
            height={80}
          />
        </div>
      )

      __applyCanvasCommands(canvasRef, unsupported.ops, unsupported.operands, [])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/warning-canvas.*lineDashOffset/))

      __applyCanvasCommands(canvasRef, unsupported.ops, unsupported.operands, [])
      __applyCanvasCommands(
        secondCanvasRef,
        unsupported.ops,
        unsupported.operands,
        []
      )
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringMatching(/second-warning-canvas.*lineDashOffset/)
      )
      testRoot.render(
        <div>
          <canvas ref={canvasRef} testId="warning-canvas" width={60} height={80} />
          <canvas
            ref={secondCanvasRef}
            testId="second-warning-canvas"
            width={60}
            height={80}
          />
        </div>
      )
      expect(warn).toHaveBeenCalledTimes(2)
      expect(
        testRoot.renderer
          .drainStyleDiagnostics()
          .map(({ property, testId, value }) => ({ property, testId, value }))
      ).toEqual([
        { property: "lineDashOffset", testId: "warning-canvas", value: "op[0]" },
        {
          property: "lineDashOffset",
          testId: "second-warning-canvas",
          value: "op[0]",
        },
      ])
    } finally {
      warn.mockRestore()
      testRoot.unmount()
    }
  })

  it("accepts composed transforms and minimum nonzero paths in strict mode", () => {
    const testRoot = createTestRoot({ width: 180, height: 120, strictStyles: true })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(<canvas ref={canvasRef} width={180} height={120} />)
      const context = canvasRef.current!.getContext("2d")
      context.save()
      context.translate(18, 12)
      context.scale(1.5, 1.25)
      context.rotate(0.2)
      context.transform(1, 0.1, 0.2, 1, 3, 4)
      context.fillRect(0, 0, 40, 28)
      context.beginPath()
      context.moveTo(8, 62)
      context.lineTo(42, 34)
      context.lineTo(76, 62)
      context.closePath()
      context.fill()
      context.restore()
      context.setTransform(1, 0, 0, 1, 4, 6)
      context.resetTransform()

      expect(() => flushRecordingContext2D(context)).not.toThrow()
      testRoot.renderer.flush()
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      testRoot.unmount()
    }
  })

  it("throws transformed fillRect preparation diagnostics at the strict command boundary", () => {
    const testRoot = createTestRoot({ width: 120, height: 80, strictStyles: true })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="overflow-canvas" width={120} height={80} />
      )
      const context = canvasRef.current!.getContext("2d")!
      context.transform(Number.MAX_VALUE, 0, 0, 1, 0, 0)
      context.fillRect(2, 0, 1, 1)

      expect(() => flushRecordingContext2D(context)).toThrow(
        /overflow-canvas.*fillRect.*finite/
      )
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      testRoot.unmount()
    }
  })

  it("prepares paths larger than the former B1 cap without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ width: 180, height: 120, strictStyles: false })
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="complex-path-canvas" width={180} height={120} />
      )
      const context = canvasRef.current!.getContext("2d")!
      context.beginPath()
      context.moveTo(0, 0)
      for (let index = 0; index < 129; index++) {
        context.lineTo(index, index % 2)
      }
      context.fill()
      flushRecordingContext2D(context)

      testRoot.renderer.flush()
      expect(warn).not.toHaveBeenCalled()

      context.fill()
      flushRecordingContext2D(context)
      testRoot.renderer.flush()
      expect(warn).not.toHaveBeenCalled()
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      warn.mockRestore()
      testRoot.unmount()
    }
  })

  it("routes partial clearRect punch-through through strict and deduplicated diagnostics", () => {
    const strict = createTestRoot({ width: 100, height: 80, strictStyles: true })
    const strictRef = createRef<CanvasPublicInstance>()
    try {
      strict.render(
        <canvas ref={strictRef} testId="strict-clear-canvas" width={100} height={80} />
      )
      const context = strictRef.current!.getContext("2d")!
      context.clearRect(10, 10, 20, 20)
      expect(() => flushRecordingContext2D(context)).toThrow(
        /strict-clear-canvas.*clearRect.*punch through/
      )
    } finally {
      strict.unmount()
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const nonStrict = createTestRoot({ width: 100, height: 80, strictStyles: false })
    const nonStrictRef = createRef<CanvasPublicInstance>()
    try {
      nonStrict.render(
        <canvas
          ref={nonStrictRef}
          testId="warning-clear-canvas"
          width={100}
          height={80}
        />
      )
      const context = nonStrictRef.current!.getContext("2d")!
      context.clearRect(10, 10, 20, 20)
      flushRecordingContext2D(context)
      context.clearRect(40, 10, 20, 20)
      flushRecordingContext2D(context)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/warning-clear-canvas.*clearRect.*punch through/)
      )
      expect(nonStrict.renderer.drainStyleDiagnostics()).toEqual([
        expect.objectContaining({
          property: "clearRect",
          testId: "warning-clear-canvas",
          value: "op[0]",
        }),
      ])
    } finally {
      warn.mockRestore()
      nonStrict.unmount()
    }
  })

  it("makes full clear exact and partial clear surgery preserve later painter order", () => {
    const render = (
      name: string,
      draw: (context: CanvasRenderingContext2D) => void
    ) => {
      const root = createTestRoot({ width: 100, height: 80, strictStyles: true })
      const ref = createRef<CanvasPublicInstance>()
      const output = path.join(SHOTS_DIR, `canvas-b2-${name}.png`)
      try {
        root.render(<canvas ref={ref} width={100} height={80} />)
        const context = ref.current!.getContext("2d")!
        draw(context)
        flushRecordingContext2D(context)
        root.renderer.flush()
        root.renderer.captureScreenshot(output)
      } finally {
        root.unmount()
      }
      return output
    }

    const fullActual = render("full-clear-actual", (context) => {
      context.fillStyle = "#ef4444"
      context.fillRect(0, 0, 100, 80)
      context.save()
      context.scale(2, 2)
      context.clearRect(50, 40, -50, -40)
      context.restore()
      context.fillStyle = "#2563eb"
      context.fillRect(42, 32, 16, 16)
    })
    const fullExpected = render("full-clear-expected", (context) => {
      context.fillStyle = "#2563eb"
      context.fillRect(42, 32, 16, 16)
    })
    const partialActual = render("partial-clear-actual", (context) => {
      context.fillStyle = "#ef4444"
      context.fillRect(0, 0, 100, 80)
      context.clearRect(36, 28, 28, 24)
      context.fillStyle = "#2563eb"
      context.globalAlpha = 0.65
      context.fillRect(42, 32, 16, 16)
    })
    const partialExpected = render("partial-clear-expected", (context) => {
      context.fillStyle = "#ef4444"
      context.fillRect(0, 0, 100, 28)
      context.fillRect(0, 52, 100, 28)
      context.fillRect(0, 28, 36, 24)
      context.fillRect(64, 28, 36, 24)
      context.fillStyle = "#2563eb"
      context.globalAlpha = 0.65
      context.fillRect(42, 32, 16, 16)
    })
    const comparer = createTestRoot({ width: 1, height: 1 })
    try {
      expect(comparer.renderer.compareImages(fullActual, fullExpected, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })
      expect(comparer.renderer.compareImages(partialActual, partialExpected, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })
    } finally {
      comparer.unmount()
    }
  })

  it("makes the standard DPR backing-store scale visually identical to logical sizing", () => {
    const logical = createTestRoot({
      width: CANVAS_GOLDEN_WIDTH,
      height: CANVAS_GOLDEN_HEIGHT,
    })
    const scaled = createTestRoot({
      width: CANVAS_GOLDEN_WIDTH,
      height: CANVAS_GOLDEN_HEIGHT,
    })
    const logicalRef = createRef<CanvasPublicInstance>()
    const scaledRef = createRef<CanvasPublicInstance>()
    const logicalPath = path.join(SHOTS_DIR, "canvas-b1-logical.png")
    const scaledPath = path.join(SHOTS_DIR, "canvas-b1-standard-dpr.png")

    try {
      logical.render(
        <canvas
          ref={logicalRef}
          width={CANVAS_GOLDEN_WIDTH}
          height={CANVAS_GOLDEN_HEIGHT}
        />
      )
      scaled.render(
        <canvas
          ref={scaledRef}
          width={CANVAS_GOLDEN_WIDTH * CANVAS_GOLDEN_DPR}
          height={CANVAS_GOLDEN_HEIGHT * CANVAS_GOLDEN_DPR}
          style={{ width: CANVAS_GOLDEN_WIDTH, height: CANVAS_GOLDEN_HEIGHT }}
        />
      )

      const logicalContext = logicalRef.current!.getContext("2d")
      canvasScenes["translate-scale"].draw(
        logicalContext,
        CANVAS_GOLDEN_WIDTH,
        CANVAS_GOLDEN_HEIGHT
      )
      flushRecordingContext2D(logicalContext)

      const scaledContext = scaledRef.current!.getContext("2d")
      scaledContext.scale(CANVAS_GOLDEN_DPR, CANVAS_GOLDEN_DPR)
      canvasScenes["translate-scale"].draw(
        scaledContext,
        CANVAS_GOLDEN_WIDTH,
        CANVAS_GOLDEN_HEIGHT
      )
      flushRecordingContext2D(scaledContext)

      logical.renderer.flush()
      scaled.renderer.flush()
      logical.renderer.captureScreenshot(logicalPath)
      scaled.renderer.captureScreenshot(scaledPath)

      expect(scaled.renderer.compareImages(logicalPath, scaledPath, 0)).toEqual({
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        maxChannelDeltaOutsideGoldenContour: 0,
        erodedGeometryMismatchRatio: 0,
      })
    } finally {
      logical.unmount()
      scaled.unmount()
    }
  })

  it("captures the pointer through the canvas hitbox", () => {
    const testRoot = createTestRoot({ width: 260, height: 160 })
    const trace: string[] = []
    try {
      testRoot.render(
        <div style={{ width: 260, height: 160 }}>
          <canvas
            testId="capture-canvas"
            width={80}
            height={80}
            style={{ width: 80, height: 80 }}
            onMouseDown={(event) => {
              trace.push("down")
              event.setPointerCapture()
            }}
            onMouseMove={() => trace.push("move")}
            onMouseUp={() => trace.push("up")}
          />
        </div>
      )
      const bounds = testRoot.renderer.getElementBounds(
        testRoot.renderer.findByTestId("capture-canvas")!.id
      )!

      testRoot.renderer.nativeSimulateMouseDown(bounds[0]! + 20, bounds[1]! + 20, 0)
      testRoot.renderer.nativeSimulateMouseMove(bounds[0]! + 180, bounds[1]! + 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(bounds[0]! + 180, bounds[1]! + 20, 0)

      expect(trace).toEqual(["down", "move", "up"])
    } finally {
      testRoot.unmount()
    }
  })

  it("cancels a queued canvas flush before destroying its native target", async () => {
    const renderer = new TestRenderer({ width: 160, height: 100 })
    const apply = vi.spyOn(renderer, "applyCanvasCommands")
    const root = createRoot(renderer)
    const canvasRef = createRef<CanvasPublicInstance>()
    try {
      flushSync(() => root.render(<canvas ref={canvasRef} width={80} height={80} />))
      renderer.flush()
      const destroyedId = canvasRef.current!.id
      canvasRef.current!.getContext("2d")!.fillRect(0, 0, 10, 10)
      root.unmount()
      await Promise.resolve()

      expect(apply).not.toHaveBeenCalled()
      const stream = fillRectStream("#ef4444")
      expect(() =>
        renderer.applyCanvasCommands(destroyedId, stream.ops, stream.operands, stream.strings)
      ).toThrow(new RegExp(`missing element ${destroyedId}`))
    } finally {
      root.unmount()
      renderer.dispose()
    }
  })

  it("does not replay a stale queued list across a --hot-style remount", async () => {
    const renderer = new TestRenderer({ width: 160, height: 100 })
    const apply = vi.spyOn(renderer, "applyCanvasCommands")
    const first = createRoot(renderer)
    const firstRef = createRef<CanvasPublicInstance>()

    flushSync(() => first.render(<canvas ref={firstRef} width={80} height={80} />))
    renderer.flush()
    firstRef.current!.getContext("2d")!.fillRect(0, 0, 10, 10)
    first.unmount()

    const second = createRoot(renderer)
    const secondRef = createRef<CanvasPublicInstance>()
    try {
      flushSync(() => second.render(<canvas ref={secondRef} width={80} height={80} />))
      renderer.flush()
      secondRef.current!.getContext("2d")!.fillRect(0, 0, 20, 20)
      await Promise.resolve()

      expect(apply).toHaveBeenCalledTimes(1)
      expect(apply.mock.calls[0]![0]).toBe(secondRef.current!.id)
    } finally {
      second.unmount()
      renderer.dispose()
    }
  })

  it("rejects canvas commands for missing and non-canvas native targets", () => {
    const renderer = new TestRenderer({ width: 120, height: 80 })
    const stream = fillRectStream("#ef4444")
    try {
      expect(() =>
        renderer.applyCanvasCommands(404, stream.ops, stream.operands, stream.strings)
      ).toThrow(/missing element 404/)
      renderer.createElement(7, "div")
      expect(() =>
        renderer.applyCanvasCommands(7, stream.ops, stream.operands, stream.strings)
      ).toThrow(/element 7.*<div>.*not a <canvas>/)
    } finally {
      renderer.dispose()
    }
  })

  it("maps mouse coordinates from the layout box into canvas space", () => {
    const testRoot = createTestRoot({ width: 260, height: 160 })
    let click: GpuixSyntheticEvent | undefined
    try {
      testRoot.render(
        <canvas
          testId="local-coordinates"
          width={400}
          height={200}
          style={{ width: 200, height: 100 }}
          onClick={(event) => {
            click = event
          }}
        />
      )
      const canvas = testRoot.renderer.findByTestId("local-coordinates")
      expect(canvas).toBeDefined()
      const bounds = testRoot.renderer.getElementBounds(canvas!.id)
      expect(bounds).not.toBeNull()

      testRoot.renderer.nativeSimulateClick(
        bounds![0]! + bounds![2]! * 0.25,
        bounds![1]! + bounds![3]! * 0.5
      )
      expect(click?.x).toBeCloseTo(100, 4)
      expect(click?.y).toBeCloseTo(100, 4)
    } finally {
      testRoot.unmount()
    }
  })
})
