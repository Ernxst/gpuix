import {
  CANVAS_OPCODES,
  CANVAS_STREAM_MAGIC,
  CANVAS_STREAM_VERSION,
} from "./opcodes.js"

export interface CanvasRecorderTarget {
  /** Re-read on every diagnostic so prop updates keep the element identity current. */
  describeElement(): string
  strict: boolean
  applyCanvasCommands(
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void
}

type Matrix2D = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

type DrawingState = {
  transform: Matrix2D
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  miterLimit: number
  lineDash: number[]
  lineDashOffset: number
}

const IDENTITY_MATRIX: Readonly<Matrix2D> = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
}

function cloneMatrix(matrix: Matrix2D): Matrix2D {
  return { ...matrix }
}

function initialDrawingState(): DrawingState {
  return {
    transform: cloneMatrix(IDENTITY_MATRIX),
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDash: [],
    lineDashOffset: 0,
  }
}

function cloneDrawingState(state: DrawingState): DrawingState {
  return {
    ...state,
    transform: cloneMatrix(state.transform),
    lineDash: [...state.lineDash],
  }
}

function multiply(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

class LocalDOMMatrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number

  constructor(matrix: Matrix2D) {
    this.a = matrix.a
    this.b = matrix.b
    this.c = matrix.c
    this.d = matrix.d
    this.e = matrix.e
    this.f = matrix.f
  }

  get m11(): number {
    return this.a
  }
  set m11(value: number) {
    this.a = value
  }
  get m12(): number {
    return this.b
  }
  set m12(value: number) {
    this.b = value
  }
  get m13(): number {
    return 0
  }
  set m13(_value: number) {}
  get m14(): number {
    return 0
  }
  set m14(_value: number) {}
  get m21(): number {
    return this.c
  }
  set m21(value: number) {
    this.c = value
  }
  get m22(): number {
    return this.d
  }
  set m22(value: number) {
    this.d = value
  }
  get m23(): number {
    return 0
  }
  set m23(_value: number) {}
  get m24(): number {
    return 0
  }
  set m24(_value: number) {}
  get m31(): number {
    return 0
  }
  set m31(_value: number) {}
  get m32(): number {
    return 0
  }
  set m32(_value: number) {}
  get m33(): number {
    return 1
  }
  set m33(_value: number) {}
  get m34(): number {
    return 0
  }
  set m34(_value: number) {}
  get m41(): number {
    return this.e
  }
  set m41(value: number) {
    this.e = value
  }
  get m42(): number {
    return this.f
  }
  set m42(value: number) {
    this.f = value
  }
  get m43(): number {
    return 0
  }
  set m43(_value: number) {}
  get m44(): number {
    return 1
  }
  set m44(_value: number) {}

  get is2D(): boolean {
    return true
  }

  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    )
  }

  multiply(other: DOMMatrix2DInit = {}): DOMMatrix {
    return matrixSnapshot(
      multiply(this.asMatrix(), matrixFromInit(other) ?? cloneMatrix(IDENTITY_MATRIX))
    )
  }

  inverse(): DOMMatrix {
    const determinant = this.a * this.d - this.b * this.c
    if (determinant === 0 || !Number.isFinite(determinant)) {
      return matrixSnapshot({ a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN })
    }
    return matrixSnapshot({
      a: this.d / determinant,
      b: -this.b / determinant,
      c: -this.c / determinant,
      d: this.a / determinant,
      e: (this.c * this.f - this.d * this.e) / determinant,
      f: (this.b * this.e - this.a * this.f) / determinant,
    })
  }

  transformPoint(point: DOMPointInit = {}): DOMPoint {
    const x = Number(point.x ?? 0)
    const y = Number(point.y ?? 0)
    const z = Number(point.z ?? 0)
    const w = Number(point.w ?? 1)
    const transformed = {
      x: this.a * x + this.c * y + this.e * w,
      y: this.b * x + this.d * y + this.f * w,
      z,
      w,
    }
    const DOMPointConstructor = Reflect.get(globalThis, "DOMPoint") as
      | (new (x?: number, y?: number, z?: number, w?: number) => DOMPoint)
      | undefined
    return DOMPointConstructor
      ? new DOMPointConstructor(transformed.x, transformed.y, transformed.z, transformed.w)
      : (transformed as DOMPoint)
  }

  toFloat32Array(): Float32Array {
    return new Float32Array(this.values4x4())
  }

  toFloat64Array(): Float64Array {
    return new Float64Array(this.values4x4())
  }

  toJSON(): Record<string, number | boolean> {
    return {
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      f: this.f,
      m11: this.m11,
      m12: this.m12,
      m13: this.m13,
      m14: this.m14,
      m21: this.m21,
      m22: this.m22,
      m23: this.m23,
      m24: this.m24,
      m31: this.m31,
      m32: this.m32,
      m33: this.m33,
      m34: this.m34,
      m41: this.m41,
      m42: this.m42,
      m43: this.m43,
      m44: this.m44,
      is2D: this.is2D,
      isIdentity: this.isIdentity,
    }
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
  }

  private asMatrix(): Matrix2D {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f }
  }

  private values4x4(): number[] {
    return [
      this.m11,
      this.m12,
      this.m13,
      this.m14,
      this.m21,
      this.m22,
      this.m23,
      this.m24,
      this.m31,
      this.m32,
      this.m33,
      this.m34,
      this.m41,
      this.m42,
      this.m43,
      this.m44,
    ]
  }
}

function matrixSnapshot(matrix: Matrix2D): DOMMatrix {
  const DOMMatrixConstructor = Reflect.get(globalThis, "DOMMatrix") as
    | (new (init?: string | number[]) => DOMMatrix)
    | undefined
  return DOMMatrixConstructor
    ? new DOMMatrixConstructor([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
    : (new LocalDOMMatrix2D(matrix) as unknown as DOMMatrix)
}

function aliasedMatrixValue(
  init: DOMMatrix2DInit,
  primary: keyof DOMMatrix2DInit,
  alias: keyof DOMMatrix2DInit,
  fallback: number
): number {
  const primaryValue = init[primary]
  const aliasValue = init[alias]
  if (
    primaryValue !== undefined &&
    aliasValue !== undefined &&
    Number(primaryValue) !== Number(aliasValue)
  ) {
    throw new TypeError(`${String(primary)} and ${String(alias)} must describe the same matrix value`)
  }
  return Number(primaryValue ?? aliasValue ?? fallback)
}

function matrixFromInit(init: DOMMatrix2DInit): Matrix2D | null {
  const matrix = {
    a: aliasedMatrixValue(init, "a", "m11", 1),
    b: aliasedMatrixValue(init, "b", "m12", 0),
    c: aliasedMatrixValue(init, "c", "m21", 0),
    d: aliasedMatrixValue(init, "d", "m22", 1),
    e: aliasedMatrixValue(init, "e", "m41", 0),
    f: aliasedMatrixValue(init, "f", "m42", 0),
  }
  return Object.values(matrix).every(Number.isFinite) ? matrix : null
}

class Uint32CommandStream {
  private values = new Uint32Array(32)
  private length = 0

  push(...incoming: number[]): void {
    this.ensureCapacity(this.length + incoming.length)
    this.values.set(incoming, this.length)
    this.length += incoming.length
  }

  snapshot(): Uint32Array {
    return this.values.slice(0, this.length)
  }

  private ensureCapacity(required: number): void {
    if (required <= this.values.length) return
    let capacity = this.values.length
    while (capacity < required) capacity *= 2
    const next = new Uint32Array(capacity)
    next.set(this.values)
    this.values = next
  }
}

class Float64OperandStream {
  private values = new Float64Array(64)
  private length = 0

  push(values: readonly number[]): void {
    this.ensureCapacity(this.length + values.length)
    this.values.set(values, this.length)
    this.length += values.length
  }

  snapshot(): Float64Array {
    return this.values.slice(0, this.length)
  }

  private ensureCapacity(required: number): void {
    if (required <= this.values.length) return
    let capacity = this.values.length
    while (capacity < required) capacity *= 2
    const next = new Float64Array(capacity)
    next.set(this.values)
    this.values = next
  }
}

const UNIMPLEMENTED_METHODS: Readonly<Record<string, string>> = {
  clip: "arbitrary-path clipping is not in canvas stream version 1",
  isPointInPath: "picking uses geometry-space hit testing; canvas readback is not available",
  isPointInStroke: "picking uses geometry-space hit testing; canvas readback is not available",
  createConicGradient: "conic gradients have no GPUI background primitive",
  createLinearGradient: "gradient objects are not encoded by canvas stream version 1",
  createPattern: "patterns have no GPUI background primitive",
  createRadialGradient: "radial gradients have no GPUI background primitive",
  createImageData: "the native canvas has no CPU pixel buffer",
  getImageData: "the native canvas has no per-element readback",
  putImageData: "the native canvas has no CPU pixel buffer",
  roundRect: "roundRect is not in canvas stream version 1",
  getContextAttributes: "context creation attributes are not exposed by the native renderer",
  isContextLost: "context-loss reporting is not exposed by the native renderer",
  reset: "reset is not in canvas stream version 1; redraw with the recorded clearRect path",
  fillText: "canvas text arrives in phase D through GPUIX's text funnel",
  measureText: "canvas text measurement arrives in phase D through GPUIX's text funnel",
  strokeText: "strokeText is outside the accepted canvas campaign subset",
  drawFocusIfNeeded: "DOM focus-ring painting has no native element equivalent",
}

const UNIMPLEMENTED_PROPERTIES: Readonly<Record<string, string>> = {
  canvas: "the GPUIX host instance is not an HTMLCanvasElement",
  globalCompositeOperation: "only source-over compositing is supported",
  filter: "canvas filters have no GPUI primitive",
  imageSmoothingEnabled: "image sampling controls arrive with native image replay in phase C1",
  imageSmoothingQuality: "image sampling controls arrive with native image replay in phase C1",
  shadowBlur: "canvas shadows are not in canvas stream version 1",
  shadowColor: "canvas shadows are not in canvas stream version 1",
  shadowOffsetX: "canvas shadows are not in canvas stream version 1",
  shadowOffsetY: "canvas shadows are not in canvas stream version 1",
  direction: "canvas text state arrives in phase D",
  font: "canvas text state arrives in phase D",
  fontKerning: "canvas text state arrives in phase D",
  fontStretch: "canvas text state arrives in phase D",
  fontVariantCaps: "canvas text state arrives in phase D",
  letterSpacing: "canvas text state arrives in phase D",
  textAlign: "canvas text state arrives in phase D",
  textBaseline: "canvas text state arrives in phase D",
  textRendering: "canvas text state arrives in phase D",
  wordSpacing: "canvas text state arrives in phase D",
}

export class Canvas2DNotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "Canvas2DNotImplementedError"
  }
}

class RecordingContext2D {
  private readonly ops = new Uint32CommandStream()
  private readonly operands = new Float64OperandStream()
  private readonly strings: string[] = []
  private readonly stack: DrawingState[] = []
  private readonly warnedMembers = new Set<string>()
  private readonly unsupportedMethods = new Map<string, (...args: unknown[]) => undefined>()
  private readonly boundMethods = new Map<PropertyKey, (...args: never[]) => unknown>()
  private readonly imageHandles = new WeakMap<object, string>()
  private nextImageHandle = 1
  private state = initialDrawingState()
  private dirty = false
  private flushScheduled = false

  constructor(private readonly target: CanvasRecorderTarget) {
    this.ops.push(CANVAS_STREAM_MAGIC, CANVAS_STREAM_VERSION)
  }

  unsupportedMethod(member: string, reason: string): (...args: unknown[]) => undefined {
    let method = this.unsupportedMethods.get(member)
    if (!method) {
      method = () => {
        this.diagnose(member, reason)
        return undefined
      }
      this.unsupportedMethods.set(member, method)
    }
    return method
  }

  boundMethod(property: PropertyKey, method: (...args: never[]) => unknown): unknown {
    let bound = this.boundMethods.get(property)
    if (!bound) {
      bound = method.bind(this)
      this.boundMethods.set(property, bound)
    }
    return bound
  }

  diagnose(member: string, reason: string): void {
    const message =
      `${this.target.describeElement()} CanvasRenderingContext2D.${member} is not implemented ` +
      `in canvas phase A2: ${reason}`
    if (this.target.strict) throw new Canvas2DNotImplementedError(message)
    if (this.warnedMembers.has(member)) return
    this.warnedMembers.add(member)
    console.warn(message)
  }

  flush(): void {
    this.flushScheduled = false
    if (!this.dirty) return
    this.dirty = false
    this.target.applyCanvasCommands(
      this.ops.snapshot(),
      this.operands.snapshot(),
      this.strings.slice()
    )
  }

  save(): void {
    this.stack.push(cloneDrawingState(this.state))
    this.append(CANVAS_OPCODES.save)
  }

  restore(): void {
    const restored = this.stack.pop()
    if (restored) this.state = restored
    this.append(CANVAS_OPCODES.restore)
  }

  translate(x: number, y: number): void {
    const values = [Number(x), Number(y)]
    if (!values.every(Number.isFinite)) return
    this.state.transform = multiply(this.state.transform, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: values[0]!,
      f: values[1]!,
    })
    this.append(CANVAS_OPCODES.translate, values)
  }

  scale(x: number, y: number): void {
    const values = [Number(x), Number(y)]
    if (!values.every(Number.isFinite)) return
    this.state.transform = multiply(this.state.transform, {
      a: values[0]!,
      b: 0,
      c: 0,
      d: values[1]!,
      e: 0,
      f: 0,
    })
    this.append(CANVAS_OPCODES.scale, values)
  }

  rotate(angle: number): void {
    const value = Number(angle)
    if (!Number.isFinite(value)) return
    const cosine = Math.cos(value)
    const sine = Math.sin(value)
    this.state.transform = multiply(this.state.transform, {
      a: cosine,
      b: sine,
      c: -sine,
      d: cosine,
      e: 0,
      f: 0,
    })
    this.append(CANVAS_OPCODES.rotate, [value])
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const matrix = { a: Number(a), b: Number(b), c: Number(c), d: Number(d), e: Number(e), f: Number(f) }
    if (!Object.values(matrix).every(Number.isFinite)) return
    this.state.transform = multiply(this.state.transform, matrix)
    this.append(CANVAS_OPCODES.transform, Object.values(matrix))
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  setTransform(transform?: DOMMatrix2DInit): void
  setTransform(
    aOrTransform?: number | DOMMatrix2DInit,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number
  ): void {
    let matrix: Matrix2D | null
    if (aOrTransform === undefined || typeof aOrTransform === "object") {
      matrix = matrixFromInit(aOrTransform ?? {})
    } else {
      matrix = {
        a: Number(aOrTransform),
        b: Number(b),
        c: Number(c),
        d: Number(d),
        e: Number(e),
        f: Number(f),
      }
      if (!Object.values(matrix).every(Number.isFinite)) matrix = null
    }
    if (!matrix) return
    this.state.transform = matrix
    this.append(CANVAS_OPCODES.setTransform, Object.values(matrix))
  }

  resetTransform(): void {
    this.state.transform = cloneMatrix(IDENTITY_MATRIX)
    this.append(CANVAS_OPCODES.resetTransform)
  }

  getTransform(): DOMMatrix {
    return matrixSnapshot(this.state.transform)
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.state.fillStyle
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    if (typeof value !== "string") {
      this.diagnose("fillStyle", "gradient and pattern objects are not encoded by stream version 1")
      return
    }
    this.state.fillStyle = value
    this.appendString(CANVAS_OPCODES.fillStyle, value)
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.state.strokeStyle
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    if (typeof value !== "string") {
      this.diagnose("strokeStyle", "gradient and pattern objects are not encoded by stream version 1")
      return
    }
    this.state.strokeStyle = value
    this.appendString(CANVAS_OPCODES.strokeStyle, value)
  }

  get lineWidth(): number {
    return this.state.lineWidth
  }

  set lineWidth(value: number) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return
    this.state.lineWidth = number
    this.append(CANVAS_OPCODES.lineWidth, [number])
  }

  get globalAlpha(): number {
    return this.state.globalAlpha
  }

  set globalAlpha(value: number) {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0 || number > 1) return
    this.state.globalAlpha = number
    this.append(CANVAS_OPCODES.globalAlpha, [number])
  }

  get lineCap(): CanvasLineCap {
    return this.state.lineCap
  }

  set lineCap(value: CanvasLineCap) {
    if (value !== "butt" && value !== "round" && value !== "square") return
    this.state.lineCap = value
    this.appendString(CANVAS_OPCODES.lineCap, value)
  }

  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin
  }

  set lineJoin(value: CanvasLineJoin) {
    if (value !== "bevel" && value !== "round" && value !== "miter") return
    this.state.lineJoin = value
    this.appendString(CANVAS_OPCODES.lineJoin, value)
  }

  get miterLimit(): number {
    return this.state.miterLimit
  }

  set miterLimit(value: number) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return
    this.state.miterLimit = number
    this.append(CANVAS_OPCODES.miterLimit, [number])
  }

  setLineDash(segments: number[]): void {
    const normalized = Array.from(segments, Number)
    if (normalized.some((value) => !Number.isFinite(value) || value < 0)) return
    if (normalized.length % 2 === 1) normalized.push(...normalized)
    this.state.lineDash = normalized
    this.append(CANVAS_OPCODES.setLineDash, normalized)
  }

  getLineDash(): number[] {
    return [...this.state.lineDash]
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset
  }

  set lineDashOffset(value: number) {
    const number = Number(value)
    if (!Number.isFinite(number)) return
    this.state.lineDashOffset = number
    this.append(CANVAS_OPCODES.lineDashOffset, [number])
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.appendFinite(CANVAS_OPCODES.fillRect, [x, y, width, height])
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.appendFinite(CANVAS_OPCODES.strokeRect, [x, y, width, height])
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.appendFinite(CANVAS_OPCODES.clearRect, [x, y, width, height])
  }

  beginPath(): void {
    this.append(CANVAS_OPCODES.beginPath)
  }

  moveTo(x: number, y: number): void {
    this.appendFinite(CANVAS_OPCODES.moveTo, [x, y])
  }

  lineTo(x: number, y: number): void {
    this.appendFinite(CANVAS_OPCODES.lineTo, [x, y])
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ): void {
    this.appendFinite(CANVAS_OPCODES.bezierCurveTo, [cp1x, cp1y, cp2x, cp2y, x, y])
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.appendFinite(CANVAS_OPCODES.quadraticCurveTo, [cpx, cpy, x, y])
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    const numericRadius = Number(radius)
    if (Number.isFinite(numericRadius) && numericRadius < 0) {
      throw new DOMException("Canvas arc radius must not be negative", "IndexSizeError")
    }
    this.appendFinite(CANVAS_OPCODES.arc, [
      x,
      y,
      numericRadius,
      startAngle,
      endAngle,
      counterclockwise ? 1 : 0,
    ])
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const numericRadius = Number(radius)
    if (Number.isFinite(numericRadius) && numericRadius < 0) {
      throw new DOMException("Canvas arcTo radius must not be negative", "IndexSizeError")
    }
    this.appendFinite(CANVAS_OPCODES.arcTo, [x1, y1, x2, y2, numericRadius])
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    const numericRadiusX = Number(radiusX)
    const numericRadiusY = Number(radiusY)
    if (
      (Number.isFinite(numericRadiusX) && numericRadiusX < 0) ||
      (Number.isFinite(numericRadiusY) && numericRadiusY < 0)
    ) {
      throw new DOMException("Canvas ellipse radii must not be negative", "IndexSizeError")
    }
    this.appendFinite(CANVAS_OPCODES.ellipse, [
      x,
      y,
      numericRadiusX,
      numericRadiusY,
      rotation,
      startAngle,
      endAngle,
      counterclockwise ? 1 : 0,
    ])
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.appendFinite(CANVAS_OPCODES.rect, [x, y, width, height])
  }

  closePath(): void {
    this.append(CANVAS_OPCODES.closePath)
  }

  fill(fillRule?: CanvasFillRule): void
  fill(path: Path2D, fillRule?: CanvasFillRule): void
  fill(pathOrRule?: Path2D | CanvasFillRule, _fillRule?: CanvasFillRule): void {
    if (typeof pathOrRule === "object" && pathOrRule !== null) {
      this.diagnose("fill(Path2D)", "Path2D objects are not encoded by canvas stream version 1")
      return
    }
    const rule = pathOrRule ?? "nonzero"
    if (rule !== "nonzero" && rule !== "evenodd") {
      throw new TypeError(`Unsupported Canvas fill rule ${JSON.stringify(rule)}`)
    }
    this.append(CANVAS_OPCODES.fill, [rule === "evenodd" ? 1 : 0])
  }

  stroke(): void
  stroke(path: Path2D): void
  stroke(path?: Path2D): void {
    if (path !== undefined) {
      this.diagnose("stroke(Path2D)", "Path2D objects are not encoded by canvas stream version 1")
      return
    }
    this.append(CANVAS_OPCODES.stroke)
  }

  drawImage(image: CanvasImageSource, dx: number, dy: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void
  drawImage(image: CanvasImageSource, ...values: number[]): void {
    this.diagnose(
      "drawImage",
      "the v1 opcode can be recorded, but resolvable native image handles arrive in phase C1"
    )
    if ((typeof image !== "object" && typeof image !== "function") || image === null) {
      throw new TypeError("Canvas drawImage requires an image source object")
    }
    const numbers = values.map(Number)
    if (!numbers.every(Number.isFinite)) return
    const handle = this.imageHandle(image)
    const handleSlot = this.strings.push(handle) - 1
    if (numbers.length === 2) {
      this.append(CANVAS_OPCODES.drawImage3, [handleSlot, ...numbers])
      return
    }
    if (numbers.length === 4) {
      this.append(CANVAS_OPCODES.drawImage5, [handleSlot, ...numbers])
      return
    }
    if (numbers.length === 8) {
      this.append(CANVAS_OPCODES.drawImage9, [handleSlot, ...numbers])
      return
    }
    throw new TypeError(`Canvas drawImage expected 3, 5, or 9 arguments; received ${values.length + 1}`)
  }

  private imageHandle(image: object): string {
    let handle = this.imageHandles.get(image)
    if (!handle) {
      handle = `phase-a2-image-${this.nextImageHandle++}`
      this.imageHandles.set(image, handle)
    }
    return handle
  }

  private appendString(opcode: number, value: string): void {
    const slot = this.strings.push(value) - 1
    this.append(opcode, [slot])
  }

  private appendFinite(opcode: number, values: readonly number[]): void {
    const numbers = values.map(Number)
    if (!numbers.every(Number.isFinite)) return
    this.append(opcode, numbers)
  }

  private append(opcode: number, values: readonly number[] = []): void {
    this.ops.push(opcode, values.length)
    this.operands.push(values)
    this.dirty = true
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => this.flush())
  }
}

const contextsByOwner = new WeakMap<object, CanvasRenderingContext2D>()
const recordersByContext = new WeakMap<object, RecordingContext2D>()

/** Create the browser-shaped context once for a host canvas instance. */
export function getOrCreateRecordingContext2D(
  owner: object,
  target: CanvasRecorderTarget
): CanvasRenderingContext2D {
  const existing = contextsByOwner.get(owner)
  if (existing) return existing

  const recorder = new RecordingContext2D(target)
  const context = new Proxy(recorder, {
    get(target, property) {
      if (typeof property === "string") {
        const methodReason = UNIMPLEMENTED_METHODS[property]
        if (methodReason) return target.unsupportedMethod(property, methodReason)
        const propertyReason = UNIMPLEMENTED_PROPERTIES[property]
        if (propertyReason) {
          target.diagnose(property, propertyReason)
          return undefined
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function"
        ? target.boundMethod(property, value as (...args: never[]) => unknown)
        : value
    },
    set(target, property, value) {
      if (typeof property === "string") {
        const reason = UNIMPLEMENTED_PROPERTIES[property]
        if (reason) {
          target.diagnose(property, reason)
          return true
        }
      }
      return Reflect.set(target, property, value, target)
    },
    has(target, property) {
      return (
        Reflect.has(target, property) ||
        (typeof property === "string" &&
          (property in UNIMPLEMENTED_METHODS || property in UNIMPLEMENTED_PROPERTIES))
      )
    },
  }) as unknown as CanvasRenderingContext2D

  contextsByOwner.set(owner, context)
  recordersByContext.set(context, recorder)
  return context
}

/** Test/equivalence seam: synchronously drain the already-recorded microtask batch. */
export function flushRecordingContext2D(context: CanvasRenderingContext2D): void {
  const recorder = recordersByContext.get(context)
  if (!recorder) throw new TypeError("Expected a GPUIX recording CanvasRenderingContext2D")
  recorder.flush()
}
