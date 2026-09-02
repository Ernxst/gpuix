import path from "node:path"

import ts from "typescript"
import { describe, expect, it, vi } from "vitest"

import {
  CANVAS_2D_IMPLEMENTED_MEMBERS,
  CANVAS_2D_UNSUPPORTED_MEMBERS,
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
import { Image } from "../canvas/image.js"
import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  canvasScenes,
} from "../canvas-scenes.js"

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
    describeElement: () => '<canvas data-testid="unit-canvas" elementId=17>',
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

function installedCanvas2DMemberNames(): string[] {
  const libDirectory = path.dirname(ts.getDefaultLibFilePath({}))
  const libDomPath = path.join(libDirectory, "lib.dom.d.ts")
  const program = ts.createProgram([libDomPath], {
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  })
  const source = program.getSourceFile(libDomPath)
  const declaration = source?.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "CanvasRenderingContext2D"
  )
  if (!declaration) throw new Error(`CanvasRenderingContext2D is absent from ${libDomPath}`)
  return program
    .getTypeChecker()
    .getTypeAtLocation(declaration.name)
    .getProperties()
    .map((property) => property.name)
    .sort()
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

  it("records every implemented opcode-table member with its declared framing", async () => {
    const { context, applied } = recording(false)
    const image = new Image()
    image.src = "./fixture.png"

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
      0, 0, 2, 2, 1, 6, 6, 0, 1, 1, 1, 1, 1, 1, 1, 2, 4, 4, 4, 0, 2, 2, 6,
      4, 6, 5, 8, 4, 0, 1, 0, 3, 5, 9,
    ]
    expect(opcodeHeaders(applied[0]!.ops)).toEqual(
      Object.values(CANVAS_OPCODES)
        .filter((opcode) => opcode !== CANVAS_OPCODES.lineDashOffset)
        .map((opcode, index) => [opcode, expectedArities[index]!])
    )
    expect(applied[0]!.strings.slice(-3)).toEqual([
      '{"kind":"path","path":"./fixture.png"}',
      '{"kind":"path","path":"./fixture.png"}',
      '{"kind":"path","path":"./fixture.png"}',
    ])
  })

  it("keeps transform and save/restore queries entirely in JS", () => {
    const { context } = recording()

    expect(context.fillStyle).toBe("#000000")
    expect(context.strokeStyle).toBe("#000000")
    expect(context.lineWidth).toBe(1)
    expect(context.globalAlpha).toBe(1)
    expect(context.globalCompositeOperation).toBe("source-over")
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

  it("does not record or flush restore on an empty state stack", async () => {
    const { context, applied } = recording()

    context.restore()
    await Promise.resolve()

    expect(applied).toEqual([])
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

type DiagnosticInvocation = (context: CanvasRenderingContext2D) => void

const diagnosticInvocations: Record<string, DiagnosticInvocation> = {
  clip: (context) => context.clip(),
  isPointInPath: (context) => void context.isPointInPath(0, 0),
  isPointInStroke: (context) => void context.isPointInStroke(0, 0),
  createConicGradient: (context) => void context.createConicGradient(0, 0, 0),
  createLinearGradient: (context) => void context.createLinearGradient(0, 0, 1, 1),
  createPattern: (context) =>
    void context.createPattern({} as CanvasImageSource, null),
  createRadialGradient: (context) =>
    void context.createRadialGradient(0, 0, 1, 1, 1, 2),
  createImageData: (context) => void context.createImageData(1, 1),
  getImageData: (context) => void context.getImageData(0, 0, 1, 1),
  putImageData: (context) => context.putImageData({} as ImageData, 0, 0),
  roundRect: (context) => context.roundRect(0, 0, 1, 1),
  getContextAttributes: (context) => void context.getContextAttributes(),
  isContextLost: (context) => void context.isContextLost(),
  reset: (context) => context.reset(),
  fillText: (context) => context.fillText("x", 0, 0),
  measureText: (context) => void context.measureText("x"),
  strokeText: (context) => context.strokeText("x", 0, 0),
  drawFocusIfNeeded: (context) => context.drawFocusIfNeeded({} as Element),
  canvas: (context) => void context.canvas,
  globalCompositeOperation: (context) => {
    context.globalCompositeOperation = "copy"
  },
  filter: (context) => {
    context.filter = "blur(1px)"
  },
  imageSmoothingEnabled: (context) => {
    context.imageSmoothingEnabled = false
  },
  imageSmoothingQuality: (context) => {
    context.imageSmoothingQuality = "high"
  },
  lineDashOffset: (context) => {
    context.lineDashOffset = 1
  },
  shadowBlur: (context) => {
    context.shadowBlur = 2
  },
  shadowColor: (context) => {
    context.shadowColor = "#000000"
  },
  shadowOffsetX: (context) => {
    context.shadowOffsetX = 2
  },
  shadowOffsetY: (context) => {
    context.shadowOffsetY = 2
  },
  direction: (context) => {
    context.direction = "rtl"
  },
  font: (context) => {
    context.font = "12px sans-serif"
  },
  fontKerning: (context) => {
    context.fontKerning = "none"
  },
  fontStretch: (context) => {
    context.fontStretch = "condensed"
  },
  fontVariantCaps: (context) => {
    context.fontVariantCaps = "small-caps"
  },
  letterSpacing: (context) => {
    context.letterSpacing = "1px"
  },
  textAlign: (context) => {
    context.textAlign = "center"
  },
  textBaseline: (context) => {
    context.textBaseline = "middle"
  },
  textRendering: (context) => {
    context.textRendering = "optimizeLegibility"
  },
  wordSpacing: (context) => {
    context.wordSpacing = "2px"
  },
}

describe("CanvasRenderingContext2D unimplemented-member contract", () => {
  it("partitions every installed DOM member into implemented or diagnosed", () => {
    const unsupported = CANVAS_2D_UNSUPPORTED_MEMBERS.map(({ member }) => member).sort()
    const implemented = [...CANVAS_2D_IMPLEMENTED_MEMBERS].sort()
    const partition = [...implemented, ...unsupported].sort()

    expect(new Set(unsupported).size).toBe(unsupported.length)
    expect(new Set(implemented).size).toBe(implemented.length)
    expect(new Set(partition).size).toBe(partition.length)
    expect(partition).toEqual(installedCanvas2DMemberNames())
    expect(Object.keys(diagnosticInvocations).sort()).toEqual(unsupported)
  })

  it.each(CANVAS_2D_UNSUPPORTED_MEMBERS)(
    "throws loudly for $member in strict mode",
    ({ member, reason, disposition }) => {
      const { context } = recording(true)
      const invoke = diagnosticInvocations[member]!
      const support = disposition === "not-implementable" ? "not implementable" : "not implemented"
      expect(() => invoke(context)).toThrowError(Canvas2DNotImplementedError)
      expect(() => invoke(context)).toThrowError(
        expect.objectContaining({
          message: expect.stringContaining(`CanvasRenderingContext2D.${member} is ${support}`),
        })
      )
      expect(() => invoke(context)).toThrowError(
        expect.objectContaining({ message: expect.stringContaining(reason) })
      )
    }
  )

  it("warns once per element and member in compatibility mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { context } = recording(false)

    for (const { member } of CANVAS_2D_UNSUPPORTED_MEMBERS) {
      diagnosticInvocations[member]!(context)
      diagnosticInvocations[member]!(context)
    }

    expect(warn).toHaveBeenCalledTimes(CANVAS_2D_UNSUPPORTED_MEMBERS.length)
    for (const { member, reason, disposition } of CANVAS_2D_UNSUPPORTED_MEMBERS) {
      const messages = warn.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes(`CanvasRenderingContext2D.${member} `))
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain('<canvas data-testid="unit-canvas" elementId=17>')
      expect(messages[0]).toContain(reason)
      expect(messages[0]).toContain(
        disposition === "not-implementable" ? "not implementable" : "not implemented"
      )
    }
    warn.mockRestore()
  })

  it("produces zero diagnostics across every equivalence scene", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      for (const scene of Object.values(canvasScenes)) {
        const { context } = recording(false)
        const images = (scene.imageFixtures ?? []).map((fixture) => {
          const image = new Image()
          image.src = fixture
          return image
        })
        context.scale(CANVAS_GOLDEN_DPR, CANVAS_GOLDEN_DPR)
        scene.draw(context, CANVAS_GOLDEN_WIDTH, CANVAS_GOLDEN_HEIGHT, images)
        flushRecordingContext2D(context)
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("rejects image objects that did not come from the exported shim", () => {
    const { context } = recording(true)
    expect(() => context.drawImage({} as CanvasImageSource, 0, 0)).toThrowError(
      /expects an Image or ImageBitmap imported from @gpuix\/react/
    )
  })
})
