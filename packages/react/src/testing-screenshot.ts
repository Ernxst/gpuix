/// `toMatchScreenshot`, mirroring vitest browser mode's matcher of the same
/// name so a golden assertion reads identically in a browser suite and a
/// desktop one:
///
/// ```ts
/// await expect(screen).toMatchScreenshot("built")
/// await expect(screen.getByTestId("tile")).toMatchScreenshot()
/// ```
///
/// The decisions — when a missing golden is written, when `--update`
/// overwrites, what a mismatch says — are vitest's, and the wording is copied
/// from it. What differs is only what the desktop makes different, and each of
/// those is called out where it happens.
///
/// The comparison itself is the native one `expectCanvasMatchesBrowser` uses
/// (`compareImages`), so the same three knobs — `tolerance`,
/// `differingPixelBudget`, `maxChannelDelta` — govern here.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  cropImage,
  decodePng,
  diffImage,
  encodePng,
  readPngSize,
  type PixelRect,
  type PngSize,
} from "./testing-png.js"
import {
  TestRenderer,
  rendererOf,
  type ImageComparisonResult,
  type TestElement,
} from "./testing.js"

/** The native comparator's knobs, as `expectCanvasMatchesBrowser` spells them. */
export interface ScreenshotComparatorOptions {
  /** Maximum allowed delta for each RGBA channel. Defaults to 0 — exact. */
  tolerance?: number
  /** Maximum fraction of pixels outside that tolerance. Defaults to 0. */
  differingPixelBudget?: number
  /** Ceiling on the worst channel delta, whatever the budget allows. Defaults to 255. */
  maxChannelDelta?: number
}

/** Everything `resolveScreenshotPath` is told about the assertion. */
export interface ScreenshotPathContext {
  /**
   * Path **without** extension, sanitized and relative to the test file: the
   * argument passed to `toMatchScreenshot`, or the auto-generated name.
   */
  arg: string
  /** Screenshot extension, with leading dot. Always `.png` here. */
  ext: string
  /** Absolute path to the project root. */
  root: string
  /** Path to the test file's directory, relative to the root. */
  testFileDirectory: string
  /** The test file's name. */
  testFileName: string
  /** The test's name, including parent describes, sanitized. */
  testName: string
  /** The directory goldens live in, relative to the test file. */
  screenshotDirectory: string
  /** The value of `process.platform`. */
  platform: NodeJS.Platform
}

export type ResolveScreenshotPath = (context: ScreenshotPathContext) => string

export interface ToMatchScreenshotOptions {
  comparatorOptions?: ScreenshotComparatorOptions
  /**
   * Overrides the golden's path, for this one assertion. Wins over a
   * `configureScreenshots` default, which wins over the built-in path.
   *
   * @default `${root}/${testFileDirectory}/__screenshots__/${testFileName}/${arg}${ext}`
   */
  resolveScreenshotPath?: ResolveScreenshotPath
}

/** The suite-wide defaults `configureScreenshots` accepts. */
export interface ConfigureScreenshotsOptions {
  /**
   * Default `resolveScreenshotPath` for every `toMatchScreenshot` call that
   * does not pass its own.
   */
  resolveScreenshotPath?: ResolveScreenshotPath
}

let screenshotDefaults: ConfigureScreenshotsOptions = {}

/**
 * Suite-wide defaults for `toMatchScreenshot`, set once from a vitest setup
 * file instead of repeating the same option at every call site:
 *
 * ```ts
 * // vitest setup file
 * configureScreenshots({
 *   resolveScreenshotPath: ({ root, testFileDirectory, testFileName, arg, ext, platform }) =>
 *     path.join(root, testFileDirectory, "__goldens__", testFileName, `${arg}-${platform}${ext}`),
 * })
 * ```
 *
 * This is the desktop seat of vitest browser mode's
 * `browser.expect.toMatchScreenshot` config, with the same precedence: a
 * per-call option wins over the configured default, which wins over the
 * built-in one. It is a function call rather than the vitest config key
 * because `resolveScreenshotPath` is a function, and vitest only delivers the
 * browser config's functions inside the browser runtime — a node worker,
 * where this renderer lives, never receives them. A setup file is the nearest
 * point that runs in the worker before every suite.
 *
 * Each call replaces the previous defaults wholesale, as a config object
 * would: `configureScreenshots({})` restores the built-in behaviour.
 */
export function configureScreenshots(options: ConfigureScreenshotsOptions): void {
  screenshotDefaults = { ...options }
}

/** vitest's snapshot update mode: `--update` is `"all"`, CI is `"none"`. */
export type SnapshotUpdateState = "all" | "new" | "none"

export type ScreenshotOutcome =
  | {
      type: "missing-reference"
      pass: false
      /** Where the new golden goes: `"none"` (CI) refuses to write the real one. */
      location: "reference" | "diffs"
      message: string
    }
  | { type: "update-reference"; pass: true; message: null }
  | { type: "matched"; pass: true; message: null }
  | { type: "dimension-mismatch"; pass: false; message: string }
  | { type: "mismatch"; pass: false; message: string }

export interface ResolvedComparatorOptions {
  tolerance: number
  differingPixelBudget: number
  maxChannelDelta: number
}

export interface ScreenshotDecisionInput {
  /** The stored golden's size, or `null` when there is no golden yet. */
  reference: PngSize | null
  /** The size of the screenshot just captured. */
  actual: PngSize
  updateSnapshot: SnapshotUpdateState
  comparator: ResolvedComparatorOptions
  /** Runs the native comparison. Called only when the sizes agree. */
  compare: () => ImageComparisonResult
}

const DEFAULT_SCREENSHOT_DIRECTORY = "__screenshots__"
/** Where a mismatch's artifacts go, since a runner-owned attachments directory
 *  is not reachable from the matcher state. See the note in the README. */
const DIFF_DIRECTORY = "__diff_output__"

function resolveComparatorOptions(
  options: ScreenshotComparatorOptions = {}
): ResolvedComparatorOptions {
  const tolerance = options.tolerance ?? 0
  const differingPixelBudget = options.differingPixelBudget ?? 0
  const maxChannelDelta = options.maxChannelDelta ?? 255

  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new RangeError(
      `Screenshot comparison tolerance must be an integer from 0 through 255, got ${tolerance}`
    )
  }
  if (!Number.isInteger(maxChannelDelta) || maxChannelDelta < 0 || maxChannelDelta > 255) {
    throw new RangeError(
      `Screenshot maximum channel delta must be an integer from 0 through 255, got ${maxChannelDelta}`
    )
  }
  if (
    !Number.isFinite(differingPixelBudget) ||
    differingPixelBudget < 0 ||
    differingPixelBudget > 1
  ) {
    throw new RangeError(
      `Screenshot differing-pixel budget must be between 0 and 1, got ${differingPixelBudget}`
    )
  }

  return { tolerance, differingPixelBudget, maxChannelDelta }
}

/**
 * Every branch `toMatchScreenshot` can take, with no file system and no GPU in
 * sight, so the `--update` path is testable without a second vitest run.
 *
 * The order is vitest's: a missing golden is answered before anything is
 * compared, `--update` (`"all"`) wins over any comparison result — including a
 * size change, which vitest also lets `--update` overwrite — and a size
 * disagreement is a failure in its own right rather than a skip.
 */
export function decideScreenshotOutcome({
  reference,
  actual,
  updateSnapshot,
  comparator,
  compare,
}: ScreenshotDecisionInput): ScreenshotOutcome {
  if (reference === null) {
    if (updateSnapshot === "all") return { type: "update-reference", pass: true, message: null }
    const location = updateSnapshot === "none" ? "diffs" : "reference"
    return {
      type: "missing-reference",
      pass: false,
      location,
      message:
        location === "reference"
          ? "No existing reference screenshot found; a new one was created. Review it before running tests again."
          : "No existing reference screenshot found.",
    }
  }

  if (reference.width !== actual.width || reference.height !== actual.height) {
    if (updateSnapshot === "all") return { type: "update-reference", pass: true, message: null }
    return {
      type: "dimension-mismatch",
      pass: false,
      message:
        "Screenshot does not match the stored reference.\n" +
        `Expected image dimensions to be ${reference.width}×${reference.height}px, ` +
        `but received ${actual.width}×${actual.height}px.`,
    }
  }

  const comparison = compare()
  const withinBudget = comparison.differingPixelRatio <= comparator.differingPixelBudget
  const withinCeiling = comparison.maxChannelDelta <= comparator.maxChannelDelta
  if (withinBudget && withinCeiling) return { type: "matched", pass: true, message: null }

  if (updateSnapshot === "all") return { type: "update-reference", pass: true, message: null }

  const area = reference.width * reference.height
  const differingPixels = Math.round(comparison.differingPixelRatio * area)
  const ratio = (Math.ceil(comparison.differingPixelRatio * 100) / 100).toFixed(2)
  return {
    type: "mismatch",
    pass: false,
    message:
      "Screenshot does not match the stored reference.\n" +
      `${differingPixels} pixels (ratio ${ratio}) differ.` +
      (withinCeiling
        ? ""
        : ` Maximum channel delta ${comparison.maxChannelDelta} exceeds the ceiling ${comparator.maxChannelDelta}.`),
  }
}

// ── Paths ────────────────────────────────────────────────────────────

/** vitest's filename sanitizer, segment by segment when `keepPaths`. */
function sanitize(input: string, keepPaths: boolean): string {
  if (!keepPaths) {
    return input
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .replace(/-{2,}/g, "-")
  }
  return input
    .split("/")
    .map((segment) => sanitize(segment, false))
    .join("/")
}

/** Keeps a name inside the screenshot directory: no traversal, no odd characters. */
function sanitizeArg(input: string): string {
  return sanitize(path.relative("/", path.join("/", input)), true)
}

function defaultResolveScreenshotPath({
  root,
  testFileDirectory,
  screenshotDirectory,
  testFileName,
  arg,
  ext,
}: ScreenshotPathContext): string {
  return path.resolve(root, testFileDirectory, screenshotDirectory, testFileName, `${arg}${ext}`)
}

/**
 * The project root, for a custom `resolveScreenshotPath` that wants to build
 * from it. The default resolver joins it with a path relative to it, so the two
 * cancel and an inexact root cannot move a golden.
 */
function projectRoot(): string {
  const worker = (globalThis as Record<string, unknown>)["__vitest_worker__"] as
    | { config?: { root?: unknown } }
    | undefined
  const root = worker?.config?.root
  return typeof root === "string" && root.length > 0 ? root : process.cwd()
}

export interface ScreenshotPathInput {
  /** The name passed to the matcher, or the generated one. */
  name: string
  /** Absolute path to the test file. */
  testPath: string
  /** The test's name, including parent describes. */
  testName: string
}

/** The context a `resolveScreenshotPath` override is handed. */
export function screenshotPathContext({
  name,
  testPath,
  testName,
}: ScreenshotPathInput): ScreenshotPathContext {
  const root = projectRoot()
  // PNG is the only format the native capture writes, and vitest falls back to
  // it silently rather than failing, so `toMatchScreenshot('shot.jpeg')` keeps
  // `shot.jpeg` as the name and adds `.png` to it.
  const extensionFromName = path.extname(name)
  const withoutExtension =
    extensionFromName === ".png" ? path.basename(name, extensionFromName) : name

  return {
    arg: sanitizeArg(withoutExtension),
    ext: ".png",
    root,
    testFileDirectory: path.relative(root, path.dirname(testPath)),
    testFileName: path.basename(testPath),
    testName: sanitize(testName, false),
    screenshotDirectory: DEFAULT_SCREENSHOT_DIRECTORY,
    platform: process.platform,
  }
}

/** Where a mismatch's artifacts land, beside the golden they are about. */
export function screenshotDiffPaths(referencePath: string): {
  reference: string
  actual: string
  diff: string
} {
  const ext = path.extname(referencePath)
  const base = path.basename(referencePath, ext)
  const directory = path.join(path.dirname(referencePath), DIFF_DIRECTORY)
  return {
    reference: path.join(directory, `${base}-reference${ext}`),
    actual: path.join(directory, `${base}-actual${ext}`),
    diff: path.join(directory, `${base}-diff${ext}`),
  }
}

// ── Capture ──────────────────────────────────────────────────────────

/**
 * What a received value means to this matcher.
 *
 * A renderer — or anything holding one, which is every `render()` result — is
 * the whole offscreen window. A `TestElement` is the window clipped to the box
 * that element painted.
 */
interface CaptureTarget {
  renderer: TestRenderer
  element: TestElement | null
}

function resolveCaptureTarget(received: unknown): CaptureTarget {
  if (received instanceof TestRenderer) return { renderer: received, element: null }

  if (received !== null && typeof received === "object") {
    const holder = received as { renderer?: unknown; id?: unknown; type?: unknown }
    if (holder.renderer instanceof TestRenderer) {
      return { renderer: holder.renderer, element: null }
    }
    if (typeof holder.id === "number" && typeof holder.type === "string") {
      const element = received as TestElement
      return { renderer: rendererOf(element), element }
    }
  }

  throw new TypeError(
    "toMatchScreenshot expects a render result, a TestRenderer, or a TestElement from a " +
      `GPUIX test renderer, received ${received === null ? "null" : typeof received}`
  )
}

/**
 * The element's painted box in device pixels.
 *
 * `getBoundingClientRect()` is logical, the screenshot is physical, so the rect
 * is scaled by the window's `scaleFactor` and snapped to whole device pixels
 * with the edges rounded independently — rounding the size instead would move
 * an element's right edge by a pixel depending on where it starts.
 */
function deviceRect(
  renderer: TestRenderer,
  element: TestElement,
  image: PngSize
): PixelRect {
  const rect = element.getBoundingClientRect()
  const scale = renderer.getWindowSize().scaleFactor
  const left = Math.max(0, Math.round(rect.left * scale))
  const top = Math.max(0, Math.round(rect.top * scale))
  const right = Math.min(image.width, Math.round(rect.right * scale))
  const bottom = Math.min(image.height, Math.round(rect.bottom * scale))

  if (right <= left || bottom <= top) {
    throw new RangeError(
      `Element #${element.id} <${element.type}> painted [x=${rect.x}, y=${rect.y}, ` +
        `width=${rect.width}, height=${rect.height}], which is outside the ` +
        `${image.width}x${image.height} screenshot`
    )
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Capture the target as PNG bytes: the window, or the element clipped out of
 * it.
 *
 * The bytes are also left on disk in `directory`, because the native
 * comparator reads files rather than buffers. Nothing durable is written until
 * the outcome says something failed.
 */
function capture(target: CaptureTarget, directory: string): { bytes: Buffer; file: string } {
  const file = path.join(directory, "actual.png")
  target.renderer.captureScreenshot(file)
  if (target.element === null) return { bytes: readFileSync(file), file }

  const image = decodePng(readFileSync(file), "screenshot")
  const bytes = encodePng(cropImage(image, deviceRect(target.renderer, target.element, image)))
  writeFileSync(file, bytes)
  return { bytes, file }
}

function write(file: string, bytes: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, bytes)
}

// ── Matcher ──────────────────────────────────────────────────────────

/** The parts of a runner's matcher state this matcher reads. */
export interface ScreenshotMatcherContext {
  isNot?: boolean
  testPath?: string
  currentTestName?: string
  task?: { result?: { repeatCount?: number } }
  /**
   * vitest's `SnapshotState`, which the runner puts on the expect state before
   * every test. Typed as `unknown` because the field `--update` arrives in —
   * `_updateSnapshot` — is `private` in vitest's declaration, so naming it in a
   * structural type would make this matcher unassignable to `MatchersObject`.
   */
  snapshotState?: unknown
  utils?: {
    matcherHint?: (matcher: string, received?: string, expected?: string) => string
    EXPECTED_COLOR?: (text: string) => string
    RECEIVED_COLOR?: (text: string) => string
    DIM_COLOR?: (text: string) => string
  }
}

export interface ScreenshotMatcherResult {
  pass: boolean
  message: () => string
}

/**
 * One counter per test run, so repeated unnamed assertions in the same test get
 * `<test name> 1`, `<test name> 2`, … exactly as they do in vitest. Keyed the
 * way vitest keys it, including the repeat count, so `--retry` does not keep
 * counting up across attempts.
 */
const counters = new Map<string, { current: number }>()

function nextAutomaticName(context: ScreenshotMatcherContext): string {
  const key = `${context.task?.result?.repeatCount ?? 0}${context.testPath}${context.currentTestName}`
  let counter = counters.get(key)
  if (counter === undefined) {
    counter = { current: 0 }
    counters.set(key, counter)
  }
  counter.current += 1
  return `${context.currentTestName} ${counter.current}`
}

function updateMode(context: ScreenshotMatcherContext): SnapshotUpdateState {
  const mode = (context.snapshotState as { _updateSnapshot?: unknown } | undefined)
    ?._updateSnapshot
  // Anything else — no runner, or a runner that keeps no snapshot state — is
  // the default mode: write a golden that is missing, never overwrite one.
  return mode === "all" || mode === "none" ? mode : "new"
}

/** vitest's failure layout, with its colours when the runner provides them. */
function failureMessage(
  context: ScreenshotMatcherContext,
  message: string,
  paths: { reference?: string; actual?: string; diff?: string }
): string {
  const utils = context.utils
  const identity = <T,>(text: T): T => text
  const expected = utils?.EXPECTED_COLOR ?? identity
  const received = utils?.RECEIVED_COLOR ?? identity
  const dim = utils?.DIM_COLOR ?? identity
  const hint = utils?.matcherHint?.("toMatchScreenshot", "element", "") ?? "toMatchScreenshot"

  return [
    hint,
    "",
    message,
    paths.reference === undefined
      ? null
      : `\nReference screenshot:\n  ${expected(paths.reference)}`,
    paths.actual === undefined ? null : `\nActual screenshot:\n  ${received(paths.actual)}`,
    paths.diff === undefined ? null : dim(`\nDiff image:\n  ${paths.diff}`),
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
}

/**
 * Compare the received window or element against its stored golden.
 *
 * Async because vitest's matcher is — `await expect(...)` reads the same in
 * both suites — even though every step here is synchronous.
 */
export async function toMatchScreenshot(
  this: ScreenshotMatcherContext,
  received: unknown,
  nameOrOptions?: string | ToMatchScreenshotOptions,
  maybeOptions?: ToMatchScreenshotOptions
): Promise<ScreenshotMatcherResult> {
  // Both refusals are vitest's, wording included.
  if (this.isNot === true) {
    throw new Error(`'toMatchScreenshot' cannot be used with "not"`)
  }
  if (this.task === undefined || this.currentTestName === undefined || this.testPath === undefined) {
    throw new Error(`'toMatchScreenshot' cannot be used without test context`)
  }

  const options: ToMatchScreenshotOptions =
    (typeof nameOrOptions === "object" ? nameOrOptions : maybeOptions) ?? {}
  const comparator = resolveComparatorOptions(options.comparatorOptions)
  // vitest bumps the per-test counter on every call, named or not, so an
  // unnamed call after two named ones is "<test> 3" there — mirrored here by
  // computing the automatic name unconditionally and discarding it when a
  // string name was given.
  const automaticName = nextAutomaticName(this)
  const name = typeof nameOrOptions === "string" ? nameOrOptions : automaticName
  const pathContext = screenshotPathContext({
    name,
    testPath: this.testPath,
    testName: this.currentTestName,
  })
  const referencePath = (options.resolveScreenshotPath ??
    screenshotDefaults.resolveScreenshotPath ??
    defaultResolveScreenshotPath)(pathContext)

  const target = resolveCaptureTarget(received)
  const scratch = mkdtempSync(path.join(os.tmpdir(), "gpuix-screenshot-"))
  const diffPaths = screenshotDiffPaths(referencePath)

  try {
    const { bytes: actualBytes, file: actualFile } = capture(target, scratch)
    const actualSize = readPngSize(actualBytes, "screenshot")
    const referenceBytes = existsSync(referencePath) ? readFileSync(referencePath) : null
    const referenceSize = referenceBytes === null ? null : readPngSize(referenceBytes, referencePath)

    const outcome = decideScreenshotOutcome({
      reference: referenceSize,
      actual: actualSize,
      updateSnapshot: updateMode(this),
      comparator,
      // The native comparator decodes files, not buffers, which is why the
      // capture is on disk before this runs.
      compare: () =>
        target.renderer.compareImages(referencePath, actualFile, comparator.tolerance),
    })

    switch (outcome.type) {
      case "matched":
        return { pass: true, message: () => "" }
      case "update-reference": {
        write(referencePath, actualBytes)
        return { pass: true, message: () => "" }
      }
      case "missing-reference": {
        const written = outcome.location === "reference" ? referencePath : diffPaths.reference
        write(written, actualBytes)
        return {
          pass: false,
          message: () => failureMessage(this, outcome.message, { reference: written }),
        }
      }
      case "dimension-mismatch": {
        // No diff image: two sizes have no per-pixel difference to paint.
        write(diffPaths.actual, actualBytes)
        return {
          pass: false,
          message: () =>
            failureMessage(this, outcome.message, {
              reference: referencePath,
              actual: diffPaths.actual,
            }),
        }
      }
      default: {
        write(diffPaths.actual, actualBytes)
        write(
          diffPaths.diff,
          encodePng(
            diffImage(
              decodePng(referenceBytes!, referencePath),
              decodePng(actualBytes, "screenshot"),
              comparator.tolerance
            )
          )
        )
        return {
          pass: false,
          message: () =>
            failureMessage(this, outcome.message, {
              reference: referencePath,
              actual: diffPaths.actual,
              diff: diffPaths.diff,
            }),
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
