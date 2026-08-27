import { describe, expect, it, vi } from "vitest"

import {
  Canvas2DNotImplementedError,
  flushRecordingContext2D,
  getOrCreateRecordingContext2D,
  type CanvasRecorderTarget,
} from "../canvas/context-2d.js"
import {
  CANVAS_OPCODES,
  CANVAS_STREAM_MAGIC,
  CANVAS_STREAM_VERSION,
} from "../canvas/opcodes.js"

type AppliedCommands = {
  ops: Uint32Array
  operands: Float64Array
  strings: readonly string[]
}

function recording(strict = true): {
  context: CanvasRenderingContext2D
  applied: AppliedCommands[]
  owner: object
} {
  const applied: AppliedCommands[] = []
  const owner = {}
  const target: CanvasRecorderTarget = {
    strict,
    describeElement: () => '<canvas testId="unit-canvas" elementId=17>',
    applyCanvasCommands: (ops, operands, strings) => {
      applied.push({ ops, operands, strings })
    },
  }
  return {
    context: getOrCreateRecordingContext2D(owner, target),
    applied,
    owner,
  }
}

function opcodeHeaders(ops: Uint32Array): Array<[number, number]> {
  const headers: Array<[number, number]> = []
  for (let index = 2; index < ops.length; index += 2) {
    headers.push([ops[index]!, ops[index + 1]!])
  }
  return headers
}

describe("recording CanvasRenderingContext2D", () => {
  it("emits the canonical typed-array byte stream", async () => {
    const { context, applied } = recording()

    context.save()
    context.translate(10, 20)
    context.scale(2, 3)
    context.fillStyle = "#2563eb"
    context.lineWidth = 4
    context.setLineDash([5, 3, 2])
    context.fillRect(1, 2, 30, 40)
    context.beginPath()
    context.moveTo(4, 6)
    context.lineTo(8, 10)
    context.closePath()
    context.fill("evenodd")
    context.restore()

    expect(applied).toHaveLength(0)
    await Promise.resolve()

    expect(applied).toHaveLength(1)
    expect(applied[0]!.ops).toBeInstanceOf(Uint32Array)
    expect(Array.from(applied[0]!.ops)).toEqual([
      CANVAS_STREAM_MAGIC,
      CANVAS_STREAM_VERSION,
      CANVAS_OPCODES.save,
      0,
      CANVAS_OPCODES.translate,
      2,
      CANVAS_OPCODES.scale,
      2,
      CANVAS_OPCODES.fillStyle,
      1,
      CANVAS_OPCODES.lineWidth,
      1,
      CANVAS_OPCODES.setLineDash,
      6,
      CANVAS_OPCODES.fillRect,
      4,
      CANVAS_OPCODES.beginPath,
      0,
      CANVAS_OPCODES.moveTo,
      2,
      CANVAS_OPCODES.lineTo,
      2,
      CANVAS_OPCODES.closePath,
      0,
      CANVAS_OPCODES.fill,
      1,
      CANVAS_OPCODES.restore,
      0,
    ])
    expect(applied[0]!.operands).toBeInstanceOf(Float64Array)
    expect(Array.from(applied[0]!.operands)).toEqual([
      10,
      20,
      2,
      3,
      0,
      4,
      5,
      3,
      2,
      5,
      3,
      2,
      1,
      2,
      30,
      40,
      4,
      6,
      8,
      10,
      1,
    ])
    expect(applied[0]!.strings).toEqual(["#2563eb"])
  })

  it("records every opcode-table member with its declared framing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { context, applied } = recording(false)
    const image = {} as CanvasImageSource

    context.save()
    context.restore()
    context.translate(1, 2)
    context.scale(2, 3)
    context.rotate(0.25)
    context.transform(1, 2, 3, 4, 5, 6)
    context.setTransform(2, 0, 0, 2, 8, 9)
    context.resetTransform()
    context.fillStyle = "#111827"
    context.strokeStyle = "#f97316"
    context.lineWidth = 2
    context.globalAlpha = 0.5
    context.lineCap = "round"
    context.lineJoin = "bevel"
    context.miterLimit = 7
    context.setLineDash([3, 2])
    context.lineDashOffset = 1
    context.fillRect(1, 2, 3, 4)
    context.strokeRect(5, 6, 7, 8)
    context.clearRect(9, 10, 11, 12)
    context.beginPath()
    context.moveTo(1, 2)
    context.lineTo(3, 4)
    context.bezierCurveTo(1, 2, 3, 4, 5, 6)
    context.quadraticCurveTo(1, 2, 3, 4)
    context.arc(5, 6, 7, 0, Math.PI, true)
    context.arcTo(1, 2, 3, 4, 5)
    context.ellipse(1, 2, 3, 4, 0.5, 0, Math.PI, false)
    context.rect(1, 2, 3, 4)
    context.closePath()
    context.fill()
    context.stroke()
    context.drawImage(image, 1, 2)
    context.drawImage(image, 1, 2, 3, 4)
    context.drawImage(image, 1, 2, 3, 4, 5, 6, 7, 8)

    await Promise.resolve()
    const expectedArities = [
      0, 0, 2, 2, 1, 6, 6, 0, 1, 1, 1, 1, 1, 1, 1, 2, 1, 4, 4, 4, 0, 2, 2, 6,
      4, 6, 5, 8, 4, 0, 1, 0, 3, 5, 9,
    ]
    expect(opcodeHeaders(applied[0]!.ops)).toEqual(
      Object.values(CANVAS_OPCODES).map((opcode, index) => [opcode, expectedArities[index]!])
    )
    expect(applied[0]!.strings.slice(-1)[0]).toBe("phase-a2-image-1")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("phase C1"))
    warn.mockRestore()
  })

  it("keeps transform and save/restore queries entirely in JS", () => {
    const { context } = recording()

    expect(context.fillStyle).toBe("#000000")
    expect(context.strokeStyle).toBe("#000000")
    expect(context.lineWidth).toBe(1)
    expect(context.globalAlpha).toBe(1)
    expect(context.lineCap).toBe("butt")
    expect(context.lineJoin).toBe("miter")
    expect(context.miterLimit).toBe(10)
    expect(context.getLineDash()).toEqual([])
    expect(context.lineDashOffset).toBe(0)

    context.translate(10, 20)
    context.scale(2, 3)
    const transform = context.getTransform()
    expect(transform).toMatchObject({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 })
    transform.a = 99
    expect(context.getTransform().a).toBe(2)

    context.fillStyle = "#2563eb"
    context.lineWidth = 4
    context.setLineDash([5, 2, 1])
    const returnedDash = context.getLineDash()
    expect(returnedDash).toEqual([5, 2, 1, 5, 2, 1])
    returnedDash[0] = 100
    context.setLineDash([-1, 2])
    context.setLineDash([Number.NaN, 2])
    expect(context.getLineDash()).toEqual([5, 2, 1, 5, 2, 1])

    context.save()
    context.translate(7, 8)
    context.fillStyle = "#ef4444"
    context.lineWidth = 9
    context.setLineDash([4, 3])
    context.restore()

    expect(context.getTransform()).toMatchObject({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 })
    expect(context.fillStyle).toBe("#2563eb")
    expect(context.lineWidth).toBe(4)
    expect(context.getLineDash()).toEqual([5, 2, 1, 5, 2, 1])

    context.setTransform({ a: 3, d: 4, e: 11, f: 12 })
    expect(context.getTransform()).toMatchObject({ a: 3, b: 0, c: 0, d: 4, e: 11, f: 12 })
    context.resetTransform()
    expect(context.getTransform().isIdentity).toBe(true)
  })

  it("memoises by canvas and batches each synchronous redraw into one revision", async () => {
    const first = recording()
    const same = getOrCreateRecordingContext2D(first.owner, {
      strict: true,
      describeElement: () => "different label",
      applyCanvasCommands: () => {
        throw new Error("memoisation replaced the original target")
      },
    })
    expect(same).toBe(first.context)

    first.context.fillStyle = "#0f172a"
    first.context.fillRect(0, 0, 20, 20)
    first.context.fillRect(20, 0, 20, 20)
    expect(first.applied).toHaveLength(0)
    await Promise.resolve()
    expect(first.applied).toHaveLength(1)

    first.context.clearRect(0, 0, 40, 20)
    first.context.fillRect(0, 0, 40, 20)
    await Promise.resolve()
    expect(first.applied).toHaveLength(2)
    expect(first.applied[1]!.ops.length).toBeGreaterThan(first.applied[0]!.ops.length)

    first.context.fillRect(4, 4, 8, 8)
    flushRecordingContext2D(first.context)
    expect(first.applied).toHaveLength(3)
    await Promise.resolve()
    expect(first.applied).toHaveLength(3)
  })
})

type DiagnosticCase = {
  member: string
  invoke(context: CanvasRenderingContext2D): void
}

const unimplementedCases: DiagnosticCase[] = [
  { member: "clip", invoke: (context) => context.clip() },
  { member: "isPointInPath", invoke: (context) => void context.isPointInPath(0, 0) },
  { member: "isPointInStroke", invoke: (context) => void context.isPointInStroke(0, 0) },
  { member: "createConicGradient", invoke: (context) => void context.createConicGradient(0, 0, 0) },
  { member: "createLinearGradient", invoke: (context) => void context.createLinearGradient(0, 0, 1, 1) },
  { member: "createPattern", invoke: (context) => void context.createPattern({} as CanvasImageSource, null) },
  { member: "createRadialGradient", invoke: (context) => void context.createRadialGradient(0, 0, 1, 1, 1, 2) },
  { member: "createImageData", invoke: (context) => void context.createImageData(1, 1) },
  { member: "getImageData", invoke: (context) => void context.getImageData(0, 0, 1, 1) },
  { member: "putImageData", invoke: (context) => context.putImageData({} as ImageData, 0, 0) },
  { member: "roundRect", invoke: (context) => context.roundRect(0, 0, 1, 1) },
  { member: "getContextAttributes", invoke: (context) => void context.getContextAttributes() },
  { member: "isContextLost", invoke: (context) => void context.isContextLost() },
  { member: "reset", invoke: (context) => context.reset() },
  { member: "fillText", invoke: (context) => context.fillText("x", 0, 0) },
  { member: "measureText", invoke: (context) => void context.measureText("x") },
  { member: "strokeText", invoke: (context) => context.strokeText("x", 0, 0) },
  { member: "drawFocusIfNeeded", invoke: (context) => context.drawFocusIfNeeded({} as Element) },
  { member: "canvas", invoke: (context) => void context.canvas },
  { member: "globalCompositeOperation", invoke: (context) => { context.globalCompositeOperation = "copy" } },
  { member: "filter", invoke: (context) => { context.filter = "blur(1px)" } },
  { member: "imageSmoothingEnabled", invoke: (context) => { context.imageSmoothingEnabled = false } },
  { member: "imageSmoothingQuality", invoke: (context) => { context.imageSmoothingQuality = "high" } },
  { member: "shadowBlur", invoke: (context) => { context.shadowBlur = 2 } },
  { member: "shadowColor", invoke: (context) => { context.shadowColor = "#000000" } },
  { member: "shadowOffsetX", invoke: (context) => { context.shadowOffsetX = 2 } },
  { member: "shadowOffsetY", invoke: (context) => { context.shadowOffsetY = 2 } },
  { member: "direction", invoke: (context) => { context.direction = "rtl" } },
  { member: "font", invoke: (context) => { context.font = "12px sans-serif" } },
  { member: "fontKerning", invoke: (context) => { context.fontKerning = "none" } },
  { member: "fontStretch", invoke: (context) => { context.fontStretch = "condensed" } },
  { member: "fontVariantCaps", invoke: (context) => { context.fontVariantCaps = "small-caps" } },
  { member: "letterSpacing", invoke: (context) => { context.letterSpacing = "1px" } },
  { member: "textAlign", invoke: (context) => { context.textAlign = "center" } },
  { member: "textBaseline", invoke: (context) => { context.textBaseline = "middle" } },
  { member: "textRendering", invoke: (context) => { context.textRendering = "optimizeLegibility" } },
  { member: "wordSpacing", invoke: (context) => { context.wordSpacing = "2px" } },
]

describe("CanvasRenderingContext2D unimplemented-member contract", () => {
  it.each(unimplementedCases)("throws loudly for $member in strict mode", ({ member, invoke }) => {
    const { context } = recording(true)
    expect(() => invoke(context)).toThrowError(Canvas2DNotImplementedError)
    expect(() => invoke(context)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(`CanvasRenderingContext2D.${member}`),
      })
    )
  })

  it("warns once per element and member in compatibility mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { context } = recording(false)

    for (const diagnostic of unimplementedCases) {
      diagnostic.invoke(context)
      diagnostic.invoke(context)
    }

    expect(warn).toHaveBeenCalledTimes(unimplementedCases.length)
    for (const diagnostic of unimplementedCases) {
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`unit-canvas.*CanvasRenderingContext2D\\.${diagnostic.member}.*canvas phase A2`)
        )
      )
    }
    warn.mockRestore()
  })

  it("throws the phase-C1 drawImage diagnostic before recording in strict mode", () => {
    const { context } = recording(true)
    expect(() => context.drawImage({} as CanvasImageSource, 0, 0)).toThrowError(/phase C1/)
  })
})
