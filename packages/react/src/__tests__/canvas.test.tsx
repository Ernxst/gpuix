import path from "node:path"

import React, { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { __applyCanvasCommands } from "../canvas/commands.js"
import { flushRecordingContext2D } from "../canvas/context-2d.js"
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

describeNative("retained canvas element", () => {
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
            CANVAS_OPCODES.strokeRect,
            4,
          ]),
          new Float64Array([0, 0, 4, 8]),
          []
        )
      ).toThrow(/strokeRect.*not implemented in canvas phase B1/)
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
        CANVAS_OPCODES.strokeRect,
        4,
      ]),
      operands: new Float64Array([0, 0, 4, 8]),
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
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/warning-canvas.*strokeRect/))

      __applyCanvasCommands(canvasRef, unsupported.ops, unsupported.operands, [])
      __applyCanvasCommands(
        secondCanvasRef,
        unsupported.ops,
        unsupported.operands,
        []
      )
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringMatching(/second-warning-canvas.*strokeRect/)
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
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
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
