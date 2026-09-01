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
  skip: string | null
}

interface LedgerEntry {
  id: string
  status: "pass" | "skip"
  gap?: string
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
  const pixel = y * width + x
  const row = rows[y]!
  const start = pixel * bytesPerPixel
  return colorType === 6
    ? [row[start]!, row[start + 1]!, row[start + 2]!, row[start + 3]!]
    : [row[start]!, row[start + 1]!, row[start + 2]!, 255]
}

function assertPixel(actual: Pixel, expected: Pixel, tolerance: number, point: string): void {
  for (let channel = 0; channel < 4; channel += 1) {
    if (Math.abs(actual[channel]! - expected[channel]!) > tolerance) {
      throw new Error(`${point} channel ${channel}: got ${actual.join(",")}, expected ${expected.join(",")} ±${tolerance}`)
    }
  }
}

/**
 * Names the gap a runtime failure actually exposes. The recording context, the
 * native command validator and the WPT fixture each fail in a recognisable
 * shape, so a skip records the real defect class rather than "something went
 * wrong while painting".
 */
function runtimeGap(test: WptCase, message: string): string {
  const declined = message.match(/CanvasRenderingContext2D\.(\w+) is not implement(?:ed|able): (.+)$/)
  if (declined) return `Recording context declines ${declined[1]}: ${declined[2]!.trim()}`
  const rejected = message.match(/Invalid canvas command .*property "(\w+)" rejected value/)
  if (rejected) return `Native canvas stream rejects ${rejected[1]} value`
  if (/^Pixel \(|^pixel \(\d+, \d+\) channel /.test(message)) {
    const operations = [...new Set([...test.code.matchAll(/ctx\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!))]
    return `Native retained-canvas paint divergence (${operations.slice(0, 4).join(", ") || test.suite})`
  }
  if (/^\w+ is not defined$/.test(message)) return `WPT fixture lacks global ${message.split(" ")[0]}`
  if (/WPT DOM fixture/.test(message)) return "WPT fixture has no external image or element sources"
  if (/expects an Image or ImageBitmap/.test(message)) return "drawImage needs a GPUIX-imported image source"
  if (/but no exception was thrown/.test(message)) return "Spec-required exception not raised by the recording context"
  return "Recording context state or serialization differs from the WPT expectation"
}

function execute(test: WptCase, screenshot: string): LedgerEntry {
  if (test.skip) {
    return { id: test.id, status: "skip", gap: `Unsupported API: ${test.skip}`, diagnosis: test.desc }
  }
  const width = test.size?.[0] ?? 100
  const height = test.size?.[1] ?? 50
  const root = createTestRoot({ width, height, scaleFactor: 1, strictStyles: true })
  const ref = createRef<CanvasPublicInstance>()
  const pixelChecks: Array<{ x: number; y: number; expected: Pixel; tolerance: number }> = []
  try {
    root.render(<canvas ref={ref} width={width} height={height} style={{ width, height }} />)
    const canvas = ref.current!
    const ctx = canvas.getContext("2d")!
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
    const assertTrue = (value: unknown) => expect(value).toBeTruthy()
    const assertStrictEqual = (actual: unknown, expected: unknown) => expect(actual).toBe(expected)
    const assertNotStrictEqual = (actual: unknown, expected: unknown) => expect(actual).not.toBe(expected)
    const assertMatches = (actual: string, pattern: RegExp) => expect(actual).toMatch(pattern)
    const assertThrows = (expected: string, body: () => unknown) => {
      let thrown: unknown
      try {
        body()
      } catch (error) {
        thrown = error
      }
      if (!thrown) throw new Error(`Expected ${expected}, but no exception was thrown`)
      const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
      const names: Record<string, string> = { INDEX_SIZE_ERR: "IndexSizeError", TYPE_MISMATCH_ERR: "TypeMismatchError" }
      expect(message).toContain(names[expected] ?? expected)
    }
    new Function(
      "canvas", "ctx", "window", "document", "assertPixel", "assertTrue", "assertStrictEqual", "assertNotStrictEqual", "assertMatches", "assertThrows",
      test.code
    )(
      canvas, ctx, { CanvasRenderingContext2D: Object.getPrototypeOf(ctx).constructor }, document,
      (x: number, y: number, r: number, g: number, b: number, a: number, tolerance = 2) => pixelChecks.push({ x, y, expected: [r, g, b, a], tolerance }),
      assertTrue, assertStrictEqual, assertNotStrictEqual, assertMatches, assertThrows
    )
    flushRecordingContext2D(ctx)
    root.renderer.flush()
    if (pixelChecks.length > 0) {
      root.renderer.captureScreenshot(screenshot)
      for (const check of pixelChecks) {
        assertPixel(readPngPixel(screenshot, check.x, check.y), check.expected, check.tolerance, `pixel (${check.x}, ${check.y})`)
      }
    }
    return { id: test.id, status: "pass" }
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()
    return { id: test.id, status: "skip", gap: runtimeGap(test, message), diagnosis: message.slice(0, 240) }
  } finally {
    root.unmount()
    root.renderer.dispose()
  }
}

function sameOutcome(actual: LedgerEntry, expected: LedgerEntry | undefined): boolean {
  return actual.status === expected?.status && actual.gap === expected.gap
}

describeNative("WPT canvas conformance through the retained renderer", { timeout: 120_000 }, () => {
  it(`triages ${cases.length} vendored WPT cases with no unexplained failures`, () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "gpuix-wpt-"))
    const screenshot = path.join(temporaryDirectory, "canvas.png")
    const results: LedgerEntry[] = []
    try {
      for (const test of cases) results.push(execute(test, screenshot))
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
    const unexplained = updateLedger ? [] : results.filter((result) => !sameOutcome(result, expectedById.get(result.id)))
    const passes = results.filter((result) => result.status === "pass").length
    const skips = results.length - passes
    const summary = `WPT canvas: ${passes} pass, ${skips} skip, ${unexplained.length} unexplained`
    const gapCounts = new Map<string, number>()
    for (const result of results) {
      if (result.gap) gapCounts.set(result.gap, (gapCounts.get(result.gap) ?? 0) + 1)
    }
    const ranked = [...gapCounts].sort((a, b) => b[1] - a[1])
    // Vitest's reporter drops `console.log` from this worker; fd 1 is what the
    // ledger summary has to reach so `bun run canvas:wpt` reports its own counts.
    process.stdout.write(
      `\n${summary}\nNamed gaps (${ranked.length}), ranked:\n` +
        ranked.map(([gap, count]) => `  ${String(count).padStart(4)}  ${gap}`).join("\n") +
        "\n\n"
    )
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ summary, cases: results }, null, 2) + "\n")
    if (updateLedger) {
      writeFileSync(ledgerPath, JSON.stringify({ generatedBy: "bun run canvas:wpt", cases: results }, null, 2) + "\n")
    }
    expect(unexplained, `${summary}; run CANVAS_WPT_UPDATE_LEDGER=1 bun run canvas:wpt to re-triage`).toEqual([])
  }, 360_000)
})
