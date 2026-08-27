import React, { createRef } from "react"
import { describe, expect, it } from "vitest"

import { __applyCanvasCommands } from "../canvas/commands.js"
import {
  CANVAS_OPCODES,
  CANVAS_STREAM_MAGIC,
  CANVAS_STREAM_VERSION,
} from "../canvas/opcodes.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { CanvasPublicInstance, PublicInstance } from "../types/host.js"

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

  it("keeps the low-level hook for decoder diagnostics with element identity", () => {
    const testRoot = createTestRoot({ width: 120, height: 80 })
    const canvasRef = createRef<PublicInstance>()
    try {
      testRoot.render(
        <canvas ref={canvasRef} testId="diagnostic-canvas" width={120} height={80} />
      )
      __applyCanvasCommands(
        canvasRef,
        new Uint32Array([
          CANVAS_STREAM_MAGIC,
          CANVAS_STREAM_VERSION,
          CANVAS_OPCODES.translate,
          2,
        ]),
        new Float64Array([4, 8]),
        []
      )
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([
        expect.objectContaining({
          elementType: "canvas",
          testId: "diagnostic-canvas",
          property: "translate",
          value: "op[0]",
          message: expect.stringContaining("not implemented in canvas phase A1"),
        }),
      ])
    } finally {
      testRoot.unmount()
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
