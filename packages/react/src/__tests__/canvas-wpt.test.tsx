/**
 * W3C canvas conformance, through the public recording context and the native
 * retained-canvas test renderer. A WPT pixel assertion is checked from the
 * captured native PNG, not from a JS raster buffer, so this covers
 * getContext("2d") -> opcode stream -> native decode -> GPUI paint.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"

import React, { createRef } from "react"
import { describe, expect, it } from "vitest"

import { flushRecordingContext2D } from "../canvas/context-2d.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { CanvasPublicInstance } from "../types/host.js"

interface WptCase {
  id: string
  name: string
  suite: string
  desc: string
  code: string
  expected: string | null
  size: [number, number] | null
  /** Statically known gaps; the case still runs, these are its expected outcome. */
  gaps: string[]
  /** False when the harness cannot execute the WPT source at all. */
  runnable: boolean
}

/**
 * `skip` is a capability GPUIX does not claim (or a fixture this harness does
 * not provide); `fail` is a spec violation in something it does claim. Keeping
 * them apart is what makes "no unexplained failures" falsifiable.
 */
interface LedgerEntry {
  id: string
  status: "pass" | "fail" | "skip"
  gaps?: string[]
  diagnosis?: string
}

const here = path.dirname(fileURLToPath(import.meta.url))
const wptDirectory = path.resolve(here, "../../wpt")
const cases = (JSON.parse(readFileSync(path.join(wptDirectory, "generated/canvas-wpt.json"), "utf8")) as {
  cases: WptCase[]
}).cases
const ledgerPath = path.join(wptDirectory, "ledger.json")
const updateLedger = process.env.CANVAS_WPT_UPDATE_LEDGER === "1"
const reportPath = process.env.WPT_REPORT
const expectedLedger = existsSync(ledgerPath)
  ? (JSON.parse(readFileSync(ledgerPath, "utf8")) as { cases: LedgerEntry[] }).cases
  : []
const expectedById = new Map(expectedLedger.map((entry) => [entry.id, entry]))
const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

type Pixel = readonly [number, number, number, number]

function readPngPixel(file: string, x: number, y: number): Pixel {
  const png = readFileSync(file)
  const signature = "89504e470d0a1a0a"
  if (png.subarray(0, 8).toString("hex") !== signature) throw new Error(`${file} is not a PNG`)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const kind = png.subarray(offset + 4, offset + 8).toString("ascii")
    const data = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (kind === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error(`Unsupported PNG bit depth ${data[8]}`)
      colorType = data[9]!
    } else if (kind === "IDAT") {
      idat.push(data)
    } else if (kind === "IEND") {
      break
    }
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!width || !height || !bytesPerPixel) throw new Error(`Unsupported native screenshot PNG color type ${colorType}`)
  if (x < 0 || y < 0 || x >= width || y >= height) throw new RangeError(`Pixel (${x}, ${y}) outside ${width}x${height}`)
  const stride = width * bytesPerPixel
  const data = inflateSync(Buffer.concat(idat))
  const rows: Buffer[] = []
  let source = 0
  let previous = Buffer.alloc(stride)
  for (let row = 0; row < height; row += 1) {
    const filter = data[source++]!
    const current = Buffer.from(data.subarray(source, source + stride))
    source += stride
    for (let ix = 0; ix < stride; ix += 1) {
      const left = ix >= bytesPerPixel ? current[ix - bytesPerPixel]! : 0
      const up = previous[ix]!
      const upLeft = ix >= bytesPerPixel ? previous[ix - bytesPerPixel]! : 0
      if (filter === 1) current[ix] = (current[ix]! + left) & 0xff
      if (filter === 2) current[ix] = (current[ix]! + up) & 0xff
      if (filter === 3) current[ix] = (current[ix]! + Math.floor((left + up) / 2)) & 0xff
      if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        current[ix] = (current[ix]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff
      }
      if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}`)
    }
    rows.push(current)
    previous = current
  }
  // `rows[y]` is already the scanline, so the offset within it is x-relative.
  // Indexing it by the absolute pixel number ran off the end of every row below
  // the first and handed back undefined channels.
  const row = rows[y]!
  const start = x * bytesPerPixel
  return colorType === 6
    ? [row[start]!, row[start + 1]!, row[start + 2]!, row[start + 3]!]
    : [row[start]!, row[start + 1]!, row[start + 2]!, 255]
}

function assertPixel(actual: Pixel, expected: Pixel, tolerance: number, point: string): void {
  for (let channel = 0; channel < 4; channel += 1) {
    // Without this, an undecoded channel compares as `NaN > tolerance`, which is
    // false, so the assertion passes having checked nothing.
    if (!Number.isFinite(actual[channel]!)) {
      throw new Error(`${point} channel ${channel}: native screenshot decoded to ${actual.join(",")}`)
    }
    if (Math.abs(actual[channel]! - expected[channel]!) > tolerance) {
      throw new Error(`${point} channel ${channel}: got ${actual.join(",")}, expected ${expected.join(",")} ±${tolerance}`)
    }
  }
}

const HARNESS_ERROR_GAP = "Harness error before any spec assertion ran, so this case produced no conformance result"
const TOP_LEVEL_AWAIT_GAP = "WPT case uses top-level await, which this harness cannot run inside a function body"

/**
 * Names the gap a runtime failure actually exposes, and says whether it is a
 * missing capability or a spec violation. The recording context, the native
 * command validator and the WPT fixture each fail in a recognisable shape, so
 * an entry records the real defect class rather than "something went wrong
 * while painting". Anything the implementation *accepted* and then got wrong -
 * a failed assertion, a rejected spec-valid value, a missing exception - is a
 * `fail`; anything it declined to claim is a `skip`.
 */
function classify(test: WptCase, message: string): { status: "fail" | "skip"; gap: string } {
  const declined = message.match(/CanvasRenderingContext2D\.(\w+) is not implement(?:ed|able): (.+)$/)
  if (declined) return { status: "skip", gap: `Recording context declines ${declined[1]}: ${declined[2]!.trim()}` }
  if (/^\w+ is not defined$/.test(message)) {
    return { status: "skip", gap: `WPT fixture lacks global ${message.split(" ")[0]}` }
  }
  if (/WPT DOM fixture/.test(message)) {
    return { status: "skip", gap: "WPT fixture has no external image or element sources" }
  }
  if (/expects an Image or ImageBitmap/.test(message)) {
    return { status: "skip", gap: "drawImage needs a GPUIX-imported image source" }
  }
  const absent = message.match(/^GPUIX canvas host has no (\w+) member$/)
  if (absent) return { status: "skip", gap: `GPUIX canvas host has no ${absent[1]} member` }
  const rejected = message.match(/Invalid canvas command .*property "(\w+)" rejected value/)
  if (rejected) {
    // An unparsable colour is not a spec-valid value: the spec says the
    // assignment is *ignored* and the previous style stands. Rejecting the
    // whole command stream is a different defect from refusing a value the
    // spec permits, and naming it "spec-valid" misdescribes the fix.
    return /unsupported Canvas 2D color/.test(message)
      ? { status: "fail", gap: `Native canvas stream rejects an unparsable ${rejected[1]} instead of ignoring the assignment` }
      : { status: "fail", gap: `Native canvas stream rejects a spec-valid ${rejected[1]} value` }
  }
  if (/^Pixel \(|^pixel \(\d+, \d+\) channel /.test(message)) {
    const operations = [...new Set([...test.code.matchAll(/ctx\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!))]
    return {
      status: "fail",
      gap: `Native retained-canvas paint divergence (${operations.slice(0, 4).join(", ") || test.suite})`,
    }
  }
  if (/but no exception was thrown/.test(message)) {
    return { status: "fail", gap: "Spec-required exception not raised by the recording context" }
  }
  if (/^Expected \S+, got /.test(message)) {
    return { status: "fail", gap: "Spec-required exception raised with the wrong type" }
  }
  // The GPUIX canvas host is a JS object with the canvas API on it, not a DOM
  // element, so `Object.prototype.toString` can never read HTMLCanvasElement.
  // Filing that as a spec violation puts a case on the backlog that no canvas
  // fix could ever close.
  if (/\[object HTMLCanvasElement\]/.test(message)) {
    return {
      status: "skip",
      gap: "GPUIX canvas host is a JS object rather than an HTMLCanvasElement, so its DOM class name cannot match",
    }
  }
  // A fired assertion is a real conformance result: the implementation ran and
  // disagreed with the spec.
  if (/^expected /.test(message)) {
    return { status: "fail", gap: "Recording context state or serialization differs from the WPT expectation" }
  }
  // Anything else is this harness failing, not GPUIX. Defaulting it to `fail`
  // would file a harness bug as a conformance defect and quietly inflate the
  // spec-violation count.
  return { status: "skip", gap: HARNESS_ERROR_GAP }
}

const NO_ASSERTION_GAP = "WPT reference-image comparison is not implemented by this harness"
const OPAQUE_READBACK_GAP =
  "Native screenshot composites the canvas over an opaque window, so alpha below 255 cannot be read back"

function execute(test: WptCase, screenshot: string): LedgerEntry {
  if (!test.runnable) {
    return { id: test.id, status: "skip", gaps: test.gaps, diagnosis: test.desc }
  }
  const width = test.size?.[0] ?? 100
  const height = test.size?.[1] ?? 50
  const root = createTestRoot({ width, height, scaleFactor: 1, strictStyles: true })
  const ref = createRef<CanvasPublicInstance>()
  const pixelChecks: Array<{ x: number; y: number; expected: Pixel; tolerance: number }> = []
  let assertions = 0
  try {
    root.render(<canvas ref={ref} width={width} height={height} style={{ width, height }} />)
    const instance = ref.current!
    const ctx = instance.getContext("2d")!
    // WPT reads DOM properties the GPUIX canvas instance does not have. Handing
    // the bare instance to the case makes `canvas.width = 50` an ordinary JS
    // property write, so a backing-store test "passes" with no backing store.
    // Unknown members are refused by name instead.
    const canvas = new Proxy(instance as object, {
      get(target, property) {
        if (typeof property !== "symbol" && !(property in target)) {
          throw new Error(`GPUIX canvas host has no ${String(property)} member`)
        }
        // Bind to the real instance: methods and accessors must not run with the
        // proxy as their receiver.
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set(target, property, value) {
        if (typeof property !== "symbol" && !(property in target)) {
          throw new Error(`GPUIX canvas host has no ${String(property)} member`)
        }
        return Reflect.set(target, property, value, target)
      },
    }) as CanvasPublicInstance
    const document = {
      getElementById(id: string) {
        if (id !== "c") throw new Error(`WPT DOM fixture only exposes #c, requested #${id}`)
        return canvas
      },
      createElement(tag: string) {
        if (tag !== "canvas") throw new Error(`WPT DOM fixture cannot create <${tag}>`)
        return canvas
      },
    }
    const assertTrue = (value: unknown) => {
      assertions += 1
      expect(value).toBeTruthy()
    }
    const assertStrictEqual = (actual: unknown, expected: unknown) => {
      assertions += 1
      expect(actual).toBe(expected)
    }
    const assertNotStrictEqual = (actual: unknown, expected: unknown) => {
      assertions += 1
      expect(actual).not.toBe(expected)
    }
    const assertMatches = (actual: string, pattern: RegExp) => {
      assertions += 1
      expect(actual).toMatch(pattern)
    }
    // WPT names the exception exactly; a substring match over the message would
    // accept any error that merely mentions "TypeError".
    const assertThrows = (expected: string, body: () => unknown) => {
      assertions += 1
      let thrown: unknown
      try {
        body()
      } catch (error) {
        thrown = error
      }
      if (!thrown) throw new Error(`Expected ${expected}, but no exception was thrown`)
      const names: Record<string, string> = {
        INDEX_SIZE_ERR: "IndexSizeError",
        INVALID_STATE_ERR: "InvalidStateError",
        SYNTAX_ERR: "SyntaxError",
        TYPE_MISMATCH_ERR: "TypeMismatchError",
      }
      const wanted = names[expected] ?? expected
      const actual = thrown instanceof Error ? thrown.name : String(thrown)
      if (actual !== wanted) {
        throw new Error(`Expected ${wanted}, got ${actual}: ${thrown instanceof Error ? thrown.message : String(thrown)}`)
      }
    }
    new Function(
      "canvas", "ctx", "window", "document", "assertPixel", "assertTrue", "assertStrictEqual", "assertNotStrictEqual", "assertMatches", "assertThrows",
      test.code
    )(
      canvas, ctx, { CanvasRenderingContext2D: Object.getPrototypeOf(ctx).constructor }, document,
      (x: number, y: number, r: number, g: number, b: number, a: number, tolerance: number) => {
        assertions += 1
        pixelChecks.push({ x, y, expected: [r, g, b, a], tolerance })
      },
      assertTrue, assertStrictEqual, assertNotStrictEqual, assertMatches, assertThrows
    )
    flushRecordingContext2D(ctx)
    root.renderer.flush()
    // The screenshot is a window capture, so the canvas is already composited
    // over an opaque background and a WPT expectation of transparent (or
    // partly transparent) black cannot be distinguished from it. Check every
    // opaque expectation first - a real divergence still reports as a failure -
    // and only then admit the unreadable ones.
    const unreadable = pixelChecks.filter((check) => check.expected[3] < 255)
    if (pixelChecks.length > 0) {
      root.renderer.captureScreenshot(screenshot)
      for (const check of pixelChecks) {
        if (check.expected[3] < 255) continue
        assertPixel(readPngPixel(screenshot, check.x, check.y), check.expected, check.tolerance, `pixel (${check.x}, ${check.y})`)
      }
    }
    if (unreadable.length > 0) {
      return {
        id: test.id,
        status: "skip",
        gaps: [OPAQUE_READBACK_GAP, ...test.gaps],
        diagnosis: `${unreadable.length} of ${pixelChecks.length} pixel expectations need alpha < 255`,
      }
    }
    // A case whose only expectation is a WPT reference image (`expected:` with
    // no @assert) checks nothing here, so it must not be counted as a pass.
    if (assertions === 0) {
      return {
        id: test.id,
        status: "skip",
        gaps: [NO_ASSERTION_GAP, ...test.gaps],
        diagnosis: test.expected ? `Reference expectation: ${test.expected.slice(0, 120)}` : test.desc,
      }
    }
    return { id: test.id, status: "pass" }
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()
    // `new Function` builds a plain function body, so a WPT case written with
    // top-level await never starts. Its API gaps happen to apply too, but
    // landing every one of them would still leave the case unrunnable here, so
    // the limitation that actually blocks it is named first.
    if (/await is only valid in async functions/.test(message)) {
      return { id: test.id, status: "skip", gaps: [TOP_LEVEL_AWAIT_GAP, ...test.gaps], diagnosis: message.slice(0, 240) }
    }
    // A statically gapped case keeps its named gap as the expected outcome, so
    // the day the capability lands the case starts passing and surfaces as an
    // unexplained deviation instead of staying silently skipped.
    if (test.gaps.length > 0) {
      return { id: test.id, status: "skip", gaps: test.gaps, diagnosis: message.slice(0, 240) }
    }
    const { status, gap } = classify(test, message)
    return { id: test.id, status, gaps: [gap], diagnosis: message.slice(0, 240) }
  } finally {
    root.unmount()
    root.renderer.dispose()
  }
}

function sameOutcome(actual: LedgerEntry, expected: LedgerEntry | undefined): boolean {
  return actual.status === expected?.status && (actual.gaps ?? []).join(" | ") === (expected.gaps ?? []).join(" | ")
}

describeNative("WPT canvas conformance through the retained renderer", { timeout: 900_000 }, () => {
  it(`triages ${cases.length} vendored WPT cases with no unexplained failures`, () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "gpuix-wpt-"))
    const results: LedgerEntry[] = []
    try {
      // One screenshot per case: a shared path lets a case that captures nothing
      // read the previous case's pixels.
      for (const [index, test] of cases.entries()) {
        results.push(execute(test, path.join(temporaryDirectory, `${index}-${test.name.replace(/[^\w.-]/g, "_")}.png`)))
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
    const unexplained = updateLedger ? [] : results.filter((result) => !sameOutcome(result, expectedById.get(result.id)))
    const passes = results.filter((result) => result.status === "pass").length
    const fails = results.filter((result) => result.status === "fail").length
    const skips = results.filter((result) => result.status === "skip").length
    const summary = `WPT canvas: ${passes} pass, ${fails} fail, ${skips} skip, ${unexplained.length} unexplained (of ${results.length})`
    // A case blocked by several gaps counts against each of them, so landing one
    // capability is not misread as unblocking cases that need two. `sole` is
    // what a gap unblocks on its own.
    const gapCounts = new Map<string, { cases: number; sole: number }>()
    for (const result of results) {
      for (const gap of result.gaps ?? []) {
        const counts = gapCounts.get(gap) ?? { cases: 0, sole: 0 }
        counts.cases += 1
        if (result.gaps!.length === 1) counts.sole += 1
        gapCounts.set(gap, counts)
      }
    }
    const ranked = [...gapCounts].sort((a, b) => b[1].cases - a[1].cases)
    const failures = results.filter((result) => result.status === "fail")
    // Vitest's reporter drops `console.log` from this worker; fd 1 is what the
    // ledger summary has to reach so `bun run canvas:wpt` reports its own counts.
    process.stdout.write(
      `\n${summary}\nSpec violations (${failures.length}):\n` +
        failures.map((result) => `  ${result.id}: ${result.diagnosis ?? ""}`).join("\n") +
        `\nNamed gaps (${ranked.length}), ranked by blocked cases (sole = blocked by this gap alone):\n` +
        ranked
          .map(([gap, counts]) => `  ${String(counts.cases).padStart(4)}  (${String(counts.sole).padStart(4)} sole)  ${gap}`)
          .join("\n") +
        "\n\n"
    )
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ summary, cases: results }, null, 2) + "\n")
    if (updateLedger) {
      writeFileSync(ledgerPath, JSON.stringify({ generatedBy: "bun run canvas:wpt", cases: results }, null, 2) + "\n")
    }
    expect(unexplained, `${summary}; run CANVAS_WPT_UPDATE_LEDGER=1 bun run canvas:wpt to re-triage`).toEqual([])
  }, 900_000)
})
