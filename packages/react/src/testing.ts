/// GPUIX TestRenderer — thin wrapper over the native TestGpuixRenderer.
///
/// All state lives in Rust's RetainedTree. All mutations go directly to
/// the native renderer via napi. Inspection methods (findByType, getAllText,
/// toJSON, etc.) query the Rust tree via napi — no JS-side shadow copy.
///
/// All event simulation goes through the native GPUI pipeline (coordinate-based
/// hit testing, GPUI dispatch, emit_event_full). The nativeSimulate* methods
/// flush the tree, dispatch through GPUI, drain events, and feed them into
/// the React event registry via handleGpuixEvent.

import { createRequire } from "node:module"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createElement, createRef, type ReactNode } from "react"
import type { EventPayload, MenuSpec } from "@gpuix/native"
import {
  getDefaultNormalizer,
  matches as matchesMatcher,
  resolveTestId,
  type DefaultNormalizerOptions,
  type Matcher,
  type MatcherOptions as TestingMatcherOptions,
  type NormalizerFn,
} from "./testing-matchers.js"
import {
  normalizeScrollWheelOptions,
  selectAllKeystroke,
  toKeystrokes,
  type NativeScrollWheelOptions,
  type ScrollWheelInput,
} from "./automation/client.js"
import type {
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  CanvasPublicInstance,
  CanvasImageLoadState,
  HighlightMatch,
  NativeRenderer,
  PublicInstance,
  RendererCapabilities,
  StyleDesc,
  StyleDiagnostic,
} from "./types/host.js"
import {
  createRoot,
  flushSync,
  strictStylesDefault,
  type Root,
} from "./reconciler/reconciler.js"
import { handleGpuixEvent } from "./reconciler/event-registry.js"
import {
  disposeRecordingContext2D,
  flushRecordingContext2D,
  getOrCreateRecordingContext2D,
} from "./canvas/context-2d.js"
import { Image } from "./canvas/image.js"
import {
  attachAnimationFrameSource,
  detachAnimationFrameSource,
} from "./frame-clock.js"
import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  canvasScenes,
  type CanvasScene,
  type CanvasSceneName,
} from "./canvas-scenes.js"
export {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  canvasScenes,
} from "./canvas-scenes.js"
export type { CanvasScene, CanvasSceneDraw, CanvasSceneName } from "./canvas-scenes.js"
export {
  applyMacCpuThrottleFromEnv,
  MAC_CPU_THROTTLES,
  readMacCpuThrottle,
} from "./cpu-throttle.js"
export type { MacCpuThrottle } from "./cpu-throttle.js"

export interface ImageComparisonResult {
  differingPixelRatio: number
  maxChannelDelta: number
  /** Maximum delta outside the reference image's one-pixel-dilated color contour. */
  maxChannelDeltaOutsideGoldenContour: number
  /** Stable interior pixels absent from the opposite image after one-pixel erosion. */
  erodedGeometryMismatchRatio: number
}

export interface AccessKitNodeSnapshot {
  accesskit_id: string
  /** Retained GPUIX host identity. Omitted for the window and synthetic nodes. */
  host_id?: number
  children?: string[]
  aria: {
    role: string
    label?: string
    description?: string
    value?: string
    selected?: boolean
    current?: "False" | "True" | "Page" | "Step" | "Location" | "Date" | "Time"
    live?: "Off" | "Polite" | "Assertive"
    /** AccessKit models atomicity as a flag, so `false` is reported as absent. */
    live_atomic?: true
    expanded?: boolean
    toggled?: "False" | "True" | "Mixed"
    disabled?: true
    numeric_value?: number
    min_numeric_value?: number
    max_numeric_value?: number
    level?: number
    row_index?: number
    column_index?: number
    row_count?: number
    column_count?: number
    row_span?: number
    column_span?: number
    on_action?: string[]
  }
}

export interface AccessKitTreeSnapshot {
  root: string | null
  gpui_focus: string | null
  active_descendant_focus: string | null
  frame?: {
    rendered_at: string
    frame_number: number
    window_title?: string | null
    node_count: number
    tab_stop_count: number
    viewport_size: { width: number; height: number }
    scale_factor: number
  }
  nodes: Record<string, AccessKitNodeSnapshot>
}

interface NativeTestRendererApi extends NativeRenderer {
  dispose(): void
  capabilities(): RendererCapabilities
  commitMutations(): void
  applyCanvasCommands(
    id: number,
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void
  loadCanvasImage(observerId: number, sourceJson: string): void
  getCanvasImageLoadState(observerId: number): CanvasImageLoadState | null
  releaseCanvasImage(observerId: number): void
  flush(): void
  drawPendingFrame(): void
  advanceAsyncClock(deltaMs: number): void
  requestFrame(callback: (timestamp: number) => void): void
  setReducedMotion(enabled: boolean): void
  getStyleTransitionCount(): number
  getStyleTransitionFrameRequestCount(): number
  drainEvents(): EventPayload[]
  setMenus(menus: MenuSpec[]): void
  simulateMenuAction(id: string): void
  hasMainMenu(): boolean
  simulateKeystrokes(keystrokes: string): void
  focusElement(elementId: number, preventScroll?: boolean): void
  getActiveElement(): number | null
  blur(): void
  focusNext(): void
  focusPrevious(): void
  resolveTabKeyDown(defaultPrevented: boolean): void
  setPointerCapture(elementId: number): void
  releasePointerCapture(elementId: number): void
  simulateWindowActivation(active: boolean): void
  simulateWindowDeactivation(): void
  activateWindow(): void
  simulateKeyDown(keystroke: string, isHeld?: boolean): void
  simulateKeyUp(keystroke: string): void
  simulateClick(
    x: number,
    y: number,
    button?: number,
    modifiers?: string,
    clickCount?: number
  ): void
  simulateScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: NativeScrollWheelOptions
  ): void
  simulateMouseMove(
    x: number,
    y: number,
    pressedButton?: number,
    modifiers?: string
  ): void
  simulateMouseDown(
    x: number,
    y: number,
    button: number,
    modifiers?: string,
    clickCount?: number
  ): void
  simulateMouseUp(
    x: number,
    y: number,
    button: number,
    modifiers?: string,
    clickCount?: number
  ): void
  getTreeJson(): string
  getResolvedStyle(elementId: number): string | null
  getImageLoadState(elementId: number): string | null
  getCanvasState(elementId: number): string | null
  peekCanvasState(elementId: number): string | null
  getAutomationTree(): string
  getAccessibilityTree(): string
  simulateAccessibilityAction(
    accesskitId: string,
    action: "activate" | "increment" | "decrement" | "focus"
  ): void
  getRetainedElementCount(): number
  getElementBounds(elementId: number): number[] | null
  clockPause(): number
  clockSet(nowMs: number): number
  clockFastForward(deltaMs: number): number
  clockResume(): number
  advanceTime(milliseconds: number): void
  getRootId(): number | null
  getWindowSize(): { width: number; height: number; scaleFactor: number }
  getAllText(): string[]
  findByElementId(authorId: string): number | null
  findByDataTestId(dataTestId: string): number | null
  scrollTo(elementId: number, x: number, y: number): void
  scrollToItem(elementId: number, index: number, offsetInItem?: number): void
  getScrollOffset(elementId: number): number[] | null
  getListScrollTop(elementId: number): number[] | null
  getScrollMetrics(elementId: number): number[] | null
  scrollElementIntoView(elementId: number, alignToTop?: boolean): void
  setDebugFrameOverlay(mode: DebugFrameOverlayMode): string
  getDebugFrameOverlay(): string
  cycleDebugFrameOverlay(): string
  resetDebugFrameOverlayStats(): void
  getDebugFrameOverlayStats(): DebugFrameOverlayStats
  dragSelect(x1: number, y1: number, x2: number, y2: number): void
  getSelectedText(): string | null
  getPaintedText(): string[]
  getPaintedHighlights(): HighlightMatch[]
  getSyntaxCacheStats(): number[]
  clearSelection(): void
  getInputValue(elementId: number): string | null
  getInputSelection(elementId: number): number[] | null
  setInputValue(elementId: number, value: string): void
  setInputSelection(elementId: number, start: number, end: number, backward: boolean): void
  setStrictStyles(enabled: boolean): void
  setAllowPrivateNetworkImages(enabled: boolean): void
  drainStyleDiagnostics(): StyleDiagnostic[]
  takeStyleDiagnosticsForReporting(): StyleDiagnostic[]
  captureScreenshot(path: string): void
  compareImages(goldenPath: string, actualPath: string, tolerance: number): ImageComparisonResult
  simulateResize(width: number, height: number): void
}

interface NativeTestRendererConstructor {
  new (width?: number, height?: number, scaleFactor?: number): NativeTestRendererApi
}

/** Offscreen window geometry for a test root. Size defaults to 1280x800 in native. */
export interface TestWindowOptions {
  width?: number
  height?: number
  /** Virtual display scale factor. Unsupported or invalid requests throw. */
  scaleFactor?: number
}

// The native test renderer is exported by macOS and Windows builds.
//
// Loaded through `createRequire`, never a bare `require`. This file ships as
// ESM, and Node has no `require` there: in a workspace vitest inlines it and
// happens to provide one, but a real dependency is externalized and run by
// Node, where the bare call threw `require is not defined`. The `catch` then
// made `hasNativeTestRenderer` false, so every suite that guards on it
// silently skipped for anyone consuming the published package.
let NativeTestRenderer: NativeTestRendererConstructor | null = null
let probedNativeTestRenderer: NativeTestRendererApi | null = null
let nativeTestRendererInitialized = false
/** The native binding error when the test renderer cannot be loaded. */
export let nativeTestRendererLoadError: Error | null = null
const requireNative = createRequire(import.meta.url)

function initializeNativeTestRenderer(): NativeTestRendererConstructor | null {
  if (nativeTestRendererInitialized) {
    return NativeTestRenderer
  }

  nativeTestRendererInitialized = true
  try {
    const native = requireNative("@gpuix/native") as {
      TestGpuixRenderer?: NativeTestRendererConstructor
      hasTestGpuixRenderer?: () => boolean
    }
    const hasRealRenderer = native.hasTestGpuixRenderer?.()
    if (hasRealRenderer !== false && native.TestGpuixRenderer) {
      NativeTestRenderer = native.TestGpuixRenderer
      // Construct once here so availability includes native initialization, not
      // merely whether the binding exports its constructor. The first
      // TestRenderer reuses this instance.
      probedNativeTestRenderer = new native.TestGpuixRenderer()
    } else if (native.TestGpuixRenderer) {
      // hasTestGpuixRenderer() === false. Construct the stub anyway and let it
      // throw into the catch below, so the reason comes from the native build
      // itself. A copy of the message here could not tell "Linux has no
      // test-support" apart from "this build turned test-support off".
      const stub = new native.TestGpuixRenderer()
      throw new Error(
        `hasTestGpuixRenderer() is false but TestGpuixRenderer constructed (${typeof stub}).`
      )
    } else {
      nativeTestRendererLoadError = new Error(
        "@gpuix/native does not export TestGpuixRenderer. Build with test-support to run tests."
      )
    }
  } catch (error) {
    NativeTestRenderer = null
    probedNativeTestRenderer = null
    nativeTestRendererLoadError =
      error instanceof Error
        ? error
        : new Error(`Failed to load @gpuix/native: ${String(error)}`)
  }

  return NativeTestRenderer
}

/**
 * Whether the native TestGpuixRenderer loaded and initialized successfully.
 *
 * Calling this accessor is intentionally the first point that loads the
 * native binding. Importing `@gpuix/react/testing` alone stays side-effect
 * free so file:/link: consumers can resolve their React runtime first.
 */
export function isNativeTestRendererAvailable(): boolean {
  return initializeNativeTestRenderer() != null
}

// ── Test element tree ────────────────────────────────────────────────

/** Which renderer each `TestElement` was read from. See `rendererOf`. */
const elementRenderers = new WeakMap<TestElement, TestRenderer>()

/**
 * The queryable semantics of one element, as the native tree emits them at
 * both detail levels. Every field mirrors a prop the author declared.
 *
 * `role` is the authored `role` prop, not GPUI's computed accessibility role —
 * role queries read the accessibility snapshot, which resolves implicit roles
 * and name-from-contents. `value` is the retained `value` prop, so a controlled
 * input reports its current value and an uncontrolled one reports the last
 * value the author set rather than the live editing buffer. `disabled` is
 * present only when true, from `disabled` or `ariaDisabled`.
 */
export interface ElementSemantics {
  role?: string
  label?: string
  value?: string
  placeholder?: string
  disabled?: true
}

/**
 * A painted box in the DOM's `DOMRect` shape: window-relative logical pixels,
 * the `viewport`-relative analogue on the desktop. The derived fields are
 * computed exactly as a browser computes them — `right = x + width`,
 * `bottom = y + height`, `top = y`, `left = x`.
 */
export interface TestElementRect {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface TestElement {
  readonly id: number
  readonly type: string
  readonly style: Record<string, unknown>
  readonly text: string | null
  readonly events: Set<string>
  /** Direct retained children, re-resolved against the current renderer tree. */
  readonly children: readonly TestElement[]
  /** Current retained parent, or null for the root element. */
  readonly parentElement: TestElement | null
  /**
   * The element's painted box, in the DOM's `getBoundingClientRect()` shape.
   *
   * Re-resolved against the current tree on every call, so an element captured
   * before a rerender reports the bounds it paints now. Unlike a browser, which
   * always has a rect for a connected element, bounds here are recorded during
   * paint: an element that painted nothing in the last frame — scrolled out of
   * a virtual list, `visibility: "hidden"` (which a browser would still give a
   * rect), never committed — has no rect at all, and this throws rather than
   * reporting a box of zeros.
   */
  readonly getBoundingClientRect: () => TestElementRect
  /** The standard `data-testid` attribute: the one locator prop. */
  dataTestId?: string
  /** The author-defined `id` attribute, distinct from the numeric renderer ID. */
  authorId?: string
  customProps?: Record<string, unknown>
  /** Declared label, value, placeholder, role, and disabled state. */
  semantics?: ElementSemantics
}

export type MatcherOptions = TestingMatcherOptions
export type { DefaultNormalizerOptions, NormalizerFn }
export { getDefaultNormalizer }
export type TextMatcher = Matcher<TestElement>
export type TestIdMatcher = Matcher<TestElement>
export type AccessibleNameMatcher =
  | RegExp
  | string
  | ((accessibleName: string, element: TestElement) => boolean)

/** As in Testing Library, the matcher options apply to the accessible `name`. */
export interface ByRoleOptions extends MatcherOptions {
  name?: AccessibleNameMatcher
  level?: number
  /** Defaults to false. `true` awaits native hidden-node snapshot support. */
  hidden?: boolean
}

/** Text queries over the GPU-IX desktop test renderer. */
export interface TextQueries {
  getByText: (text: TextMatcher, options?: MatcherOptions) => TestElement
  queryByText: (text: TextMatcher, options?: MatcherOptions) => TestElement | null
  getAllByText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  queryAllByText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  findByText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

/** Test ID queries over the GPU-IX desktop test renderer. */
export interface TestIdQueries {
  getByTestId: (testId: TestIdMatcher, options?: MatcherOptions) => TestElement
  queryByTestId: (testId: TestIdMatcher, options?: MatcherOptions) => TestElement | null
  getAllByTestId: (testId: TestIdMatcher, options?: MatcherOptions) => TestElement[]
  queryAllByTestId: (testId: TestIdMatcher, options?: MatcherOptions) => TestElement[]
  findByTestId: (
    testId: TestIdMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByTestId: (
    testId: TestIdMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

/** Computed accessibility-tree queries over the GPU-IX desktop test renderer. */
export interface RoleQueries {
  getByRole: (role: string, options?: ByRoleOptions) => TestElement
  queryByRole: (role: string, options?: ByRoleOptions) => TestElement | null
  getAllByRole: (role: string, options?: ByRoleOptions) => TestElement[]
  queryAllByRole: (role: string, options?: ByRoleOptions) => TestElement[]
  findByRole: (
    role: string,
    options?: ByRoleOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByRole: (
    role: string,
    options?: ByRoleOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

/**
 * Label queries over the GPU-IX desktop test renderer.
 *
 * A desktop element has no `<label for>` and no `title`, so the label is the
 * declared `ariaLabel` and nothing else. Testing Library's `ByAltText` and
 * `ByTitle` have no desktop counterpart: label an `<img>` with `ariaLabel` and
 * find it with this family or with `getByRole('img', { name })`.
 */
export interface LabelTextQueries {
  getByLabelText: (text: TextMatcher, options?: MatcherOptions) => TestElement
  queryByLabelText: (text: TextMatcher, options?: MatcherOptions) => TestElement | null
  getAllByLabelText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  queryAllByLabelText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  findByLabelText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByLabelText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

/** Placeholder queries over `<input>` and `<textarea>` placeholder props. */
export interface PlaceholderTextQueries {
  getByPlaceholderText: (text: TextMatcher, options?: MatcherOptions) => TestElement
  queryByPlaceholderText: (text: TextMatcher, options?: MatcherOptions) => TestElement | null
  getAllByPlaceholderText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  queryAllByPlaceholderText: (text: TextMatcher, options?: MatcherOptions) => TestElement[]
  findByPlaceholderText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByPlaceholderText: (
    text: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

/** Current-value queries over `<input>` and `<textarea>` value props. */
export interface DisplayValueQueries {
  getByDisplayValue: (value: TextMatcher, options?: MatcherOptions) => TestElement
  queryByDisplayValue: (value: TextMatcher, options?: MatcherOptions) => TestElement | null
  getAllByDisplayValue: (value: TextMatcher, options?: MatcherOptions) => TestElement[]
  queryAllByDisplayValue: (value: TextMatcher, options?: MatcherOptions) => TestElement[]
  findByDisplayValue: (
    value: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement>
  findAllByDisplayValue: (
    value: TextMatcher,
    options?: MatcherOptions,
    waitForOptions?: WaitForOptions
  ) => Promise<TestElement[]>
}

export interface TestQueries
  extends TextQueries,
    TestIdQueries,
    RoleQueries,
    LabelTextQueries,
    PlaceholderTextQueries,
    DisplayValueQueries {}

/** Current async load state for a live native `<img>` test element. */
export interface ImageLoadState {
  status: "idle" | "loading" | "loaded" | "error"
  error?: string
}

/** Native path-preparation counters for a live `<canvas>` test element. */
export interface CanvasTestState {
  preparationCount: number
  tessellationCount: number
  pathPrimitiveCount: number
  pathVertexCount: number
  maxPathVertexCount: number
  pathBatchCount: number
  imagePrimitiveCount: number
  imageCount: number
  loadedImageCount: number
  paintedImageCount: number
  atlasTileCount: number
  releasedAtlasTileCount: number
}

export interface RecordedCanvasCommands {
  ops: Uint32Array
  operands: Float64Array
  strings: readonly string[]
}

/** Record one independent browser-shaped Canvas 2D frame for perf tests. */
export function recordCanvasCommands(
  draw: (context: CanvasRenderingContext2D) => void
): RecordedCanvasCommands {
  const owner = {}
  let recorded: RecordedCanvasCommands | undefined
  const context = getOrCreateRecordingContext2D(owner, {
    strict: true,
    describeElement: () => '<canvas data-testid="recorded-frame">',
    applyCanvasCommands: (ops, operands, strings) => {
      recorded = { ops, operands, strings }
    },
  })
  try {
    draw(context)
    flushRecordingContext2D(context)
    if (!recorded) throw new Error("Canvas frame recorded no commands")
    return recorded
  } finally {
    disposeRecordingContext2D(owner)
  }
}

// ── TestRenderer ─────────────────────────────────────────────────────

export class TestRenderer implements NativeRenderer {
  commitCount = 0
  private disposed = false
  private applicationEventHandler: ((event: EventPayload) => void) | null = null
  private windowEventHandler: ((event: EventPayload) => void) | null = null
  private animationFrameRequestCount = 0
  private elementMap: Map<number, TestElement> | null = null

  /** Native TestGpuixRenderer — all state lives here in Rust's RetainedTree. */
  private native: NativeTestRendererApi

  constructor(options: TestWindowOptions = {}) {
    const NativeTestRendererConstructor = initializeNativeTestRenderer()
    if (!NativeTestRendererConstructor) {
      throw new Error(
        `Native TestGpuixRenderer not available: ${
          nativeTestRendererLoadError?.message ?? "unknown native binding error"
        }`
      )
    }
    const customWindow =
      options.width !== undefined ||
      options.height !== undefined ||
      options.scaleFactor !== undefined
    if (probedNativeTestRenderer && customWindow) {
      probedNativeTestRenderer.dispose()
      probedNativeTestRenderer = null
    }
    this.native =
      probedNativeTestRenderer ??
      new NativeTestRendererConstructor(options.width, options.height, options.scaleFactor)
    probedNativeTestRenderer = null
  }

  /** Release this renderer's offscreen window and native GPUI context. */
  dispose(): void {
    if (this.disposed) return
    detachAnimationFrameSource(this)
    this.native.dispose()
    this.disposed = true
    // Native disposal clears the retained tree; a cached snapshot would keep
    // serving the dead tree from queries made after disposal.
    this.invalidateElementMap()
  }

  capabilities(): RendererCapabilities {
    return this.native.capabilities()
  }

  flushMutations(): void {
    this.native.commitMutations()
    this.commitCount++
    this.invalidateElementMap()
  }

  applyBatch(json: string): Array<number> {
    const destroyed = this.native.applyBatch(json)
    this.invalidateElementMap()
    return destroyed
  }

  applyCanvasCommands(
    id: number,
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void {
    this.native.applyCanvasCommands(id, ops, operands, strings)
  }

  loadCanvasImage(observerId: number, sourceJson: string): void {
    this.native.loadCanvasImage(observerId, sourceJson)
  }

  getCanvasImageLoadState(observerId: number): CanvasImageLoadState | null {
    return this.native.getCanvasImageLoadState(observerId)
  }

  releaseCanvasImage(observerId: number): void {
    this.native.releaseCanvasImage(observerId)
  }

  setMenus(menus: MenuSpec[]): void {
    this.native.setMenus(menus)
  }

  setApplicationEventHandler(handler: ((event: EventPayload) => void) | null): void {
    this.applicationEventHandler = handler
  }

  setPointerCapture(elementId: number): void {
    this.native.setPointerCapture(elementId)
  }

  releasePointerCapture(elementId: number): void {
    this.native.releasePointerCapture(elementId)
  }

  setWindowEventHandler(handler: ((event: EventPayload) => void) | null): void {
    this.windowEventHandler = handler
  }

  setStrictStyles(enabled: boolean): void {
    this.native.setStrictStyles(enabled)
  }

  setAllowPrivateNetworkImages(enabled: boolean): void {
    this.native.setAllowPrivateNetworkImages(enabled)
  }

  drainStyleDiagnostics(): StyleDiagnostic[] {
    return this.native.drainStyleDiagnostics()
  }

  takeStyleDiagnosticsForReporting(): StyleDiagnostic[] {
    return this.native.takeStyleDiagnosticsForReporting()
  }

  // ── GPUI pipeline methods ───────────────────────────────────────

  /** Trigger the real GPUI rendering pipeline (GpuixView::render() →
   *  build_element() → apply_styles() → layout). */
  flush(): void {
    this.native.flush()
  }

  /** Draw only work previously dirtied by native production code. */
  drawPendingFrame(): void {
    this.native.drawPendingFrame()
  }

  /** Advance GPUI timers and, when paused, the native animation frame clock. */
  advanceAsyncClock(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error("advanceAsyncClock delta must be a finite non-negative number")
    }
    this.native.advanceAsyncClock(deltaMs)
  }

  /** Queue one native next-frame callback without dirtying the offscreen window. */
  requestFrame(callback: (timestamp: number) => void): void {
    this.animationFrameRequestCount += 1
    this.native.requestFrame(callback)
  }

  /** Number of one-shot frame requests made through this test renderer. */
  getAnimationFrameRequestCount(): number {
    return this.animationFrameRequestCount
  }

  /** Override GPUI's reduced-motion policy for deterministic tests. */
  setReducedMotion(enabled: boolean): void {
    this.native.setReducedMotion(enabled)
  }

  /** Number of transition tracks retained by the offscreen native view. */
  getStyleTransitionCount(): number {
    return this.native.getStyleTransitionCount()
  }

  /** Number of GPUI frames requested by retained style transitions. */
  getStyleTransitionFrameRequestCount(): number {
    return this.native.getStyleTransitionFrameRequestCount()
  }

  /** Drain events collected by the native GPUI event handlers. */
  drainEvents(): EventPayload[] {
    return this.native.drainEvents()
  }

  // ── Native end-to-end simulation ────────────────────────────────
  // These methods go through the full GPUI pipeline:
  //   native simulate → GPUI dispatch → hit test → event handler →
  //   emit_event_full → drainEvents → handleGpuixEvent → React handler

  /** Drain events from the native GPUI pipeline and feed them into the
   *  React event registry, triggering state updates synchronously.
   *  Loops until no more events are produced — handles re-entrant events
   *  that may be generated during React state updates. */
  dispatchNativeEvents(): void {
    for (;;) {
      const events = this.native.drainEvents()
      if (events.length === 0) break
      for (const event of events) {
        if (event.eventType === "windowResize" || event.eventType === "windowActivation") {
          flushSync(() => {
            this.windowEventHandler?.(event)
          })
          continue
        }
        if (event.eventType === "menuAction" || event.eventType === "terminated") {
          this.applicationEventHandler?.(event)
          continue
        }
        flushSync(() => {
          handleGpuixEvent(event, this)
        })
      }
    }
  }

  /** End-to-end: focus element → simulate keystrokes through GPUI →
   *  dispatch resulting events to React.
   *  @param elementId - element to focus (must have onKeyDown/onKeyUp)
   *  @param keystrokes - space-separated keys, e.g. "a", "enter", "cmd-shift-p"
   */
  /** Send keystrokes to whatever currently holds focus.
   *
   *  Unlike `nativeSimulateKeystrokes`, this focuses nothing first, which is
   *  the only way to test that `autoFocus` (or a click) actually moved focus. */
  simulateKeystrokes(keystrokes: string): void {
    this.native.flush()
    for (const keystroke of keystrokes.split(/\s+/).filter(Boolean)) {
      this.native.simulateKeystrokes(keystroke)
      // A Tab keydown now resolves its focus default through React. Drain each
      // physical keypress before sending the next one so `tab a` delivers `a`
      // to the newly focused element, as a real platform event stream does.
      this.native.flush()
      this.dispatchNativeEvents()
      this.native.flush()
    }
  }

  /** Dispatch one key-down event to the element that already holds focus. */
  simulateKeyDown(keystroke: string, isHeld?: boolean): void {
    this.native.flush()
    this.native.simulateKeyDown(keystroke, isHeld)
    this.dispatchNativeEvents()
  }

  /** Dispatch one key-up event to the element that already holds focus. */
  simulateKeyUp(keystroke: string): void {
    this.native.flush()
    this.native.simulateKeyUp(keystroke)
    this.dispatchNativeEvents()
  }

  nativeSimulateKeystrokes(elementId: number, keystrokes: string): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeystrokes(keystrokes)
    this.dispatchNativeEvents()
  }

  /** End-to-end: focus element → simulate a single key down through GPUI →
   *  dispatch resulting events to React. Unlike nativeSimulateKeystrokes,
   *  this dispatches ONLY a KeyDownEvent — no automatic KeyUpEvent follows.
   *  @param elementId - element to focus (must have onKeyDown)
   *  @param keystroke - modifier-key string, e.g. "a", "enter", "cmd-s"
   *  @param isHeld - whether this is a key-repeat event (default: false)
   */
  nativeSimulateKeyDown(elementId: number, keystroke: string, isHeld?: boolean): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeyDown(keystroke, isHeld)
    this.dispatchNativeEvents()
  }

  /** End-to-end: focus element → simulate a single key up through GPUI →
   *  dispatch resulting events to React. Pairs with nativeSimulateKeyDown.
   *  @param elementId - element to focus (must have onKeyUp)
   *  @param keystroke - modifier-key string, e.g. "a", "enter", "cmd-s"
   */
  nativeSimulateKeyUp(elementId: number, keystroke: string): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeyUp(keystroke)
    this.dispatchNativeEvents()
  }

  /** End-to-end: simulate a click through GPUI hit testing →
   *  dispatch resulting events to React.
   *  `clickCount` is the platform's repeat count: pass 2 for the second
   *  click of a double click. */
  nativeSimulateClick(
    x: number,
    y: number,
    button?: number,
    modifiers?: string,
    clickCount?: number
  ): void {
    this.native.flush()
    this.native.simulateClick(x, y, button, modifiers, clickCount)
    // A click may move focus; draw before draining its focus event.
    this.native.flush()
    this.dispatchNativeEvents()
    // Flush again after React state updates so the Rust RetainedTree
    // is fully rebuilt and GPUI has re-laid-out before any screenshot.
    this.native.flush()
  }

  /** Dispatch an AccessKit request and deliver the resulting native event to React. */
  nativeSimulateAccessibilityAction(
    accesskitId: string,
    action: "activate" | "increment" | "decrement" | "focus"
  ): void {
    this.native.simulateAccessibilityAction(accesskitId, action)
    this.dispatchNativeEvents()
  }

  /** Dispatch an installed application-menu action through GPUI. */
  simulateMenuAction(id: string): void {
    this.native.simulateMenuAction(id)
    this.dispatchNativeEvents()
  }

  /** Simulate application termination without shutting down the test process. */
  simulateTermination(): void {
    this.applicationEventHandler?.({ elementId: 0, eventType: "terminated" })
  }

  /** Whether GPUI currently reports an installed main menu. */
  hasMainMenu(): boolean {
    return this.native.hasMainMenu()
  }

  /** End-to-end: simulate scroll wheel through GPUI →
   *  dispatch resulting events to React.
   *
   *  `deltaX` and `deltaY` are **platform deltas**, not DOM deltas: they enter
   *  GPUI where the trackpad driver does, so they say how far the content
   *  moves. Scrolling down is negative here. The `onWheel` payload the handler
   *  receives is the DOM negation, where scrolling down is positive. */
  nativeSimulateScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: ScrollWheelInput
  ): void {
    this.native.flush()
    this.native.simulateScrollWheel(
      x,
      y,
      deltaX,
      deltaY,
      normalizeScrollWheelOptions(options)
    )
    this.dispatchNativeEvents()
  }

  /** Dispatch a wheel without the surrounding flushes, for perf sampling.
   *  Call `flush()` yourself, or the sample is the React update only and
   *  none of the GPUI build, layout and paint that follows.
   *
   *  Takes platform deltas, like `nativeSimulateScrollWheel`: scrolling down is
   *  negative on the way in and positive in the `onWheel` payload. */
  dispatchScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: ScrollWheelInput
  ): void {
    this.native.simulateScrollWheel(
      x,
      y,
      deltaX,
      deltaY,
      normalizeScrollWheelOptions(options)
    )
    this.dispatchNativeEvents()
  }

  /** Dispatch a move without the surrounding flushes, for perf sampling.
   *  `nativeSimulateMouseMove` flushes before and after, so a drag timed with
   *  it contains two complete paints and cannot be compared to a wheel. */
  dispatchMouseMove(
    x: number,
    y: number,
    pressedButton?: number,
    modifiers?: string
  ): void {
    this.native.simulateMouseMove(x, y, pressedButton, modifiers)
    this.dispatchNativeEvents()
  }

  /** End-to-end: simulate mouse move through GPUI →
   *  dispatch resulting events to React.
   *  @param pressedButton - optional button held during move (0=left, 1=middle, 2=right) for drag simulation */
  nativeSimulateMouseMove(
    x: number,
    y: number,
    pressedButton?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseMove(x, y, pressedButton, modifiers)
    this.dispatchNativeEvents()
    // Flush again after React state updates so hover styles are applied
    // and the Rust tree is current before any screenshot.
    this.native.flush()
  }

  /** End-to-end: simulate mouse down through GPUI hit testing →
   *  dispatch resulting events to React.
   *  @param button - 0=left (default), 1=middle, 2=right
   *  @param clickCount - platform repeat count; 2 for a double click's second
   *  press. */
  nativeSimulateMouseDown(
    x: number,
    y: number,
    button?: number,
    modifiers?: string,
    clickCount?: number
  ): void {
    this.native.flush()
    this.native.simulateMouseDown(x, y, button ?? 0, modifiers, clickCount)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** End-to-end: simulate a native window activation change. */
  nativeSimulateWindowActivation(active: boolean): void {
    this.native.flush()
    this.native.simulateWindowActivation(active)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** End-to-end: simulate the platform deactivating the native window. */
  nativeSimulateWindowDeactivation(): void {
    this.nativeSimulateWindowActivation(false)
  }

  /** End-to-end: simulate mouse up through GPUI hit testing →
   *  dispatch resulting events to React.
   *  @param button - 0=left (default), 1=middle, 2=right
   *  @param clickCount - platform repeat count; 2 for a double click's second
   *  release. */
  nativeSimulateMouseUp(
    x: number,
    y: number,
    button?: number,
    modifiers?: string,
    clickCount?: number
  ): void {
    this.native.flush()
    this.native.simulateMouseUp(x, y, button ?? 0, modifiers, clickCount)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  // ── Tree inspection (queries Rust RetainedTree via napi) ────────

  /** Build a flat map of TestElements from the native tree JSON.
   *  One FFI call to get the full tree, then parse into TestElement objects. */
  private buildElementMap(): Map<number, TestElement> {
    if (this.elementMap) return this.elementMap

    const json = JSON.parse(this.native.getTreeJson())
    const map = new Map<number, TestElement>()
    const renderer = this
    const walk = (node: any, parentId: number | null) => {
      if (!node) return
      const childIds = (node.children ?? []).map((child: any) => child.id) as number[]
      const element = {
        id: node.id,
        type: node.type,
        style: node.style ?? {},
        text: node.text ?? null,
        events: new Set(node.events ?? []),
        ...(node.authorId ? { authorId: node.authorId } : {}),
        ...(node.dataTestId ? { dataTestId: node.dataTestId } : {}),
        ...(node.customProps ? { customProps: node.customProps } : {}),
        ...(node.semantics ? { semantics: node.semantics } : {}),
      } as TestElement
      Object.defineProperties(element, {
        children: {
          get(): readonly TestElement[] {
            const current = getElement(renderer, element.id, "element")
            if (current !== element) return current.children
            return Object.freeze(
              childIds.map((childId) =>
                getElement(renderer, childId, `child of <${element.type}>`)
              )
            )
          },
        },
        parentElement: {
          get(): TestElement | null {
            const current = getElement(renderer, element.id, "element")
            if (current !== element) return current.parentElement
            if (parentId === null) return null
            return getElement(renderer, parentId, `parent of ${describeElement(renderer, element)}`)
          },
        },
        getBoundingClientRect: {
          value(): TestElementRect {
            return boundingClientRectOf(renderer, element)
          },
        },
      })
      map.set(node.id, element)
      elementRenderers.set(element, renderer)
      for (const child of node.children ?? []) {
        walk(child, node.id)
      }
    }
    walk(json, null)
    // The snapshot is shared across queries until the next mutation, so freeze
    // it: a consumer test mutating a returned TestElement would otherwise
    // silently corrupt every later static-tree query instead of failing loudly.
    for (const element of map.values()) {
      Object.freeze(element.style)
      Object.freeze(element.events)
      if (element.customProps) Object.freeze(element.customProps)
      if (element.semantics) Object.freeze(element.semantics)
      Object.freeze(element)
    }
    this.elementMap = map
    return map
  }

  private invalidateElementMap(): void {
    this.elementMap = null
  }

  /** Get the root element. */
  getRoot(): TestElement | undefined {
    const rootId = this.native.getRootId()
    if (rootId == null) return undefined
    return this.buildElementMap().get(rootId)
  }

  /** Get an element by ID. */
  getElement(id: number): TestElement | undefined {
    return this.buildElementMap().get(id)
  }

  /** Read the style currently applied after hover, active, and focus resolution. */
  getResolvedStyle(id: number): StyleDesc | undefined {
    const json = this.native.getResolvedStyle(id)
    return json == null ? undefined : JSON.parse(json)
  }

  /** Read the current async image state without relying on a screenshot or fallback text. */
  getImageLoadState(id: number): ImageLoadState | undefined {
    const json = this.native.getImageLoadState(id)
    return json == null ? undefined : JSON.parse(json)
  }

  /** Read canvas preparation counters without relying on timing or screenshots. */
  getCanvasState(id: number): CanvasTestState | undefined {
    const json = this.native.getCanvasState(id)
    return json == null ? undefined : JSON.parse(json)
  }

  /** Read last-painted canvas counters without forcing an offscreen frame. */
  peekCanvasState(id: number): CanvasTestState | undefined {
    const json = this.native.peekCanvasState(id)
    return json == null ? undefined : JSON.parse(json)
  }

  /** Find elements by type (e.g. "div", "text"). */
  findByType(type: string): TestElement[] {
    return [...this.buildElementMap().values()].filter((el) => el.type === type)
  }

  /** Find the first element whose own text matches, on the shared matcher
   *  semantics: exact after trimming and collapsing whitespace unless the
   *  matcher or options say otherwise. */
  findByText(text: TextMatcher, options?: MatcherOptions): TestElement | undefined {
    return [...this.buildElementMap().values()].find(
      (el) => el.text != null && matchesMatcher(el.text, el, text, options)
    )
  }

  /** Find the first element whose `data-testid` matches, on the same rule as
   *  the bound `*ByTestId` queries: first match in tree order, matcher options
   *  applied. */
  findByTestId(testId: TestIdMatcher, options?: MatcherOptions): TestElement | undefined {
    return [...this.buildElementMap().values()].find((el) => {
      const resolved = resolveTestId(el)
      return resolved !== undefined && matchesMatcher(resolved, el, testId, options)
    })
  }

  /** Resolve an author-defined `id` attribute in the native retained tree. */
  findByElementId(authorId: string): TestElement | undefined {
    const id = this.native.findByElementId(authorId)
    return id == null ? undefined : this.getElement(id)
  }

  /** Get all text content in the tree (depth-first). */
  getAllText(): string[] {
    return this.native.getAllText()
  }

  /** Print the tree structure for debugging. Only includes non-empty fields. */
  toJSON(): unknown {
    return JSON.parse(this.native.getTreeJson())
  }

  getAutomationTree(): string {
    return this.native.getAutomationTree()
  }

  /** Read GPUI's last explicitly drawn AccessKit tree without drawing. */
  getAccessibilityTree(): AccessKitTreeSnapshot {
    return JSON.parse(this.native.getAccessibilityTree())
  }

  /** Every element the native tree holds, reachable or not. `toJSON()` walks
   *  from the root, so only this can see a node that was detached and leaked. */
  getRetainedElementCount(): number {
    return this.native.getRetainedElementCount()
  }

  getElementBounds(elementId: number): number[] | null {
    return this.native.getElementBounds(elementId)
  }

  clockPause(): number {
    return this.native.clockPause()
  }

  clockSet(nowMs: number): number {
    return this.native.clockSet(nowMs)
  }

  clockFastForward(deltaMs: number): number {
    return this.native.clockFastForward(deltaMs)
  }

  clockResume(): number {
    return this.native.clockResume()
  }

  /** Advance GPUI's test dispatcher and run due timers.
   *  This is not `clockFastForward`. That moves the motion clock only.
   *  Use this for caret blink, input drag autoscroll, and list edge scroll. */
  advanceTime(milliseconds: number): void {
    this.native.advanceTime(milliseconds)
    this.dispatchNativeEvents()
  }

  /** `preventScroll` mirrors `HTMLElement.focus({ preventScroll })`: take focus
   *  without revealing the element inside its scroll ancestors. */
  focusElement(elementId: number, preventScroll?: boolean): void {
    this.native.flush()
    this.native.focusElement(elementId, preventScroll)
    // Programmatic focus is reported when GPUI commits the next frame.
    this.native.flush()
    this.dispatchNativeEvents()
  }

  getActiveElement(): number | null {
    return this.native.getActiveElement()
  }

  blur(): void {
    this.native.blur()
    this.native.flush()
    this.dispatchNativeEvents()
  }

  focusNext(): void {
    this.native.flush()
    this.native.focusNext()
    this.native.flush()
    this.dispatchNativeEvents()
  }

  focusPrevious(): void {
    this.native.flush()
    this.native.focusPrevious()
    this.native.flush()
    this.dispatchNativeEvents()
  }

  resolveTabKeyDown(defaultPrevented: boolean): void {
    this.native.resolveTabKeyDown(defaultPrevented)
    // Production reports the resulting focus transition on a later frame.
    // Draw it now so the enclosing drain loop observes blur/focus in order.
    this.native.flush()
  }

  // ── Scroll API ──────────────────────────────────────────────────

  /** Set the scroll offset of a scrollable element (overflow: "scroll" or
   *  "auto"). x and y are negative pixel values (scroll down = more negative
   *  y). Call flush() internally to apply. */
  scrollTo(elementId: number, x: number, y: number): void {
    this.native.flush()
    this.native.scrollTo(elementId, x, y)
    // Flush again to re-render with the new offset
    this.native.flush()
  }

  /** Scroll a child into view by its index in the children list.
   *
   *  `offsetInItem` is in pixels. A negative value anchors the viewport top
   *  above the item, resolved against measured row heights at layout time, so
   *  a row stays pixel-stable while unmeasured rows are spliced in above it. */
  scrollToItem(elementId: number, index: number, offsetInItem?: number): void {
    this.native.flush()
    this.native.scrollToItem(elementId, index, offsetInItem)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** Get the current scroll offset [x, y] or null if element is not scrollable. */
  getScrollOffset(elementId: number): [number, number] | null {
    this.native.flush()
    const result = this.native.getScrollOffset(elementId)
    if (!result) return null
    return [result[0], result[1]]
  }

  /** The logical scroll anchor of a `<virtual-list>`:
   *  `[itemIndex, offsetInItemPx, viewportHeightPx]`, or null for anything
   *  else. `itemIndex == item count` is gpui's at-end sentinel. Exact even
   *  while row heights are still estimates, because it is the anchor gpui
   *  itself scrolls by. */
  getListScrollTop(elementId: number): [number, number, number] | null {
    this.native.flush()
    const result = this.native.getListScrollTop(elementId)
    if (!result) return null
    return [result[0], result[1], result[2]]
  }

  /** Web-shaped scroll geometry for a scrollable element:
   *  `[scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight]`,
   *  or null when the element is not a scroll container. The offsets use the
   *  DOM's positive convention, unlike `getScrollOffset`. */
  getScrollMetrics(elementId: number): number[] | null {
    // No flush here: the native read forces layout itself, exactly as the
    // production renderer does. Flushing in this wrapper would hide a missing
    // forced layout from every test that reads scroll geometry.
    return this.native.getScrollMetrics(elementId)
  }

  /** Reveal an element inside every scrollable ancestor, without moving focus.
   *  `alignToTop` is the DOM's `block: "start"` and defaults to it; `false` is
   *  `block: "nearest"`. */
  scrollElementIntoView(elementId: number, alignToTop?: boolean): void {
    this.native.scrollElementIntoView(elementId, alignToTop)
    // The reveal is applied during the next prepaint, like scrollToItem.
    this.native.flush()
  }

  // ── Selection API ───────────────────────────────────────────────

  /** Drag-select from (x1,y1) to (x2,y2) and return the selected text.
   *
   *  Selection listeners are registered during **paint**, so the native helper
   *  flushes between every step. Calling simulateMouseDown/Move/Up by hand
   *  without those flushes selects nothing. */
  dragSelect(x1: number, y1: number, x2: number, y2: number): string | null {
    this.native.dragSelect(x1, y1, x2, y2)
    return this.native.getSelectedText()
  }

  /** The current selection joined in document order, or null. */
  getSelectedText(): string | null {
    return this.native.getSelectedText()
  }

  /** Every string painted in the last frame, in paint order.
   *
   *  `getAllText()` only sees `<text>` nodes in the retained tree. Native
   *  elements like `<code>` and `<diff>` paint their text inside GPUI, so this
   *  is the only way to assert on what they rendered. */
  getPaintedText(): string[] {
    return this.native.getPaintedText()
  }

  /** Every highlight wash painted in the last frame, in paint order.
   *
   *  A quad never lands in `getPaintedText()`, and a soft-wrapped match must
   *  draw one box per visual row, so each entry carries its `rects`. */
  getPaintedHighlights(): HighlightMatch[] {
    return this.native.getPaintedHighlights()
  }

  /** Syntax-cache counters as `[hits, misses, documents]`. */
  getSyntaxCacheStats(): [number, number, number] {
    const [hits, misses, documents] = this.native.getSyntaxCacheStats()
    return [hits, misses, documents]
  }

  clearSelection(): void {
    this.native.clearSelection()
    this.native.flush()
  }

  // ── Text editing API ────────────────────────────────────────────
  // No flush in this wrapper: each native call draws the committed tree
  // itself, exactly as the production renderer does. Flushing here would hide
  // a missing forced draw from every test that touches the caret.

  /** One `<input>`/`<textarea>`'s value, or null for any other element. */
  getInputValue(elementId: number): string | null {
    return this.native.getInputValue(elementId)
  }

  /** `[selectionStart, selectionEnd, backward]` in UTF-16 code units, or null. */
  getInputSelection(elementId: number): number[] | null {
    return this.native.getInputSelection(elementId)
  }

  setInputValue(elementId: number, value: string): void {
    this.native.setInputValue(elementId, value)
  }

  setInputSelection(elementId: number, start: number, end: number, backward: boolean): void {
    this.native.setInputSelection(elementId, start, end, backward)
  }

  setDebugFrameOverlay(mode: DebugFrameOverlayMode): string {
    return this.native.setDebugFrameOverlay(mode)
  }

  getDebugFrameOverlay(): string {
    return this.native.getDebugFrameOverlay()
  }

  cycleDebugFrameOverlay(): string {
    return this.native.cycleDebugFrameOverlay()
  }

  resetDebugFrameOverlayStats(): void {
    this.native.resetDebugFrameOverlayStats()
  }

  getDebugFrameOverlayStats(): DebugFrameOverlayStats {
    return this.native.getDebugFrameOverlayStats()
  }

  /** Capture the current Metal or DirectX frame and save it as a PNG. */
  captureScreenshot(path: string): void {
    this.native.flush()
    this.native.captureScreenshot(path)
  }

  /** Decode two PNGs natively and compare their RGBA pixels. */
  compareImages(goldenPath: string, actualPath: string, tolerance: number): ImageComparisonResult {
    return this.native.compareImages(goldenPath, actualPath, tolerance)
  }

  getWindowSize(): { width: number; height: number; scaleFactor: number } {
    return this.native.getWindowSize!()
  }

  isActive(): boolean {
    return this.native.isActive!()
  }

  activateWindow(): void {
    this.native.activateWindow()
  }

  simulateResize(width: number, height: number): void {
    this.native.simulateResize(width, height)
  }

  /** Whether the native GPUI test renderer is available. Always true. */
  get hasNative(): boolean {
    return true
  }
}

// ── Test root helper ─────────────────────────────────────────────────

/** Returns an element's text, including the text rendered by every descendant. */
export function textContent(renderer: TestRenderer, element: TestElement): string {
  return `${element.text ?? ""}${element.children
    .map((child) => textContent(renderer, child))
    .join("")}`
}

/**
 * The renderer a `TestElement` was read from.
 *
 * A jest-dom-shaped matcher is handed the element alone, but almost every
 * question worth asking of one — is it still mounted, did it paint, does it
 * hold focus — is a question about the renderer. The map is weak and populated
 * where elements are built, so it costs nothing and cannot outlive the tree.
 */
export function rendererOf(element: TestElement): TestRenderer {
  const renderer = elementRenderers.get(element)
  if (renderer === undefined) {
    throw new Error(
      `Element #${element.id} did not come from a TestRenderer, so it has no tree to be read against`
    )
  }

  return renderer
}

/**
 * Backs `TestElement.getBoundingClientRect()`. Re-resolves the element first,
 * so a rect read from a pre-rerender reference is the current one, then reads
 * the same painted bounds `renderer.getElementBounds` reports.
 */
function boundingClientRectOf(renderer: TestRenderer, element: TestElement): TestElementRect {
  const current = getElement(renderer, element.id, "bounding client rect target")
  const bounds = renderer.getElementBounds(current.id)
  if (bounds === null) throw noPaintedBoundsError(renderer, current)

  const [x, y, width, height] = bounds
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
  }
}

// ── waitFor ──────────────────────────────────────────────────────────

const DEFAULT_WAIT_FOR_TIMEOUT_MS = 1_000
const DEFAULT_WAIT_FOR_INTERVAL_MS = 50
const MIN_WAIT_FOR_INTERVAL_MS = 1
const MICROTASK_DRAIN_TICKS = 3

export interface WaitForOptions {
  /** Wall-clock budget before the last callback error is rethrown. Defaults to 1000ms. */
  timeout?: number
  /**
   * Delay between attempts, and the amount each clock advances per attempt.
   * Defaults to 50ms. Testing Library accepts `0` to mean "poll as fast as
   * possible", so anything below 1ms is clamped to 1ms rather than rejected —
   * a zero advance would freeze the clocks this pump exists to turn.
   */
  interval?: number
  /** Maps the error thrown on timeout, as in Testing Library. */
  onTimeout?: (error: Error) => Error
}

/** Advances the clocks a `waitFor` loop owns, by one interval. Internal: the
 *  only pump a caller supplies is `waitForSync`'s, which stays private. */
type WaitForPump = (deltaMs: number) => void

/**
 * Retries `callback` until it stops throwing, pumping the frame and timer
 * clocks between attempts so timer-driven UI can make progress.
 */
export type TestWaitFor = <T>(
  callback: () => T | Promise<T>,
  options?: WaitForOptions
) => Promise<T>

/** Advance every clock the renderer owns and repaint, once. */
function pumpRenderer(renderer: TestRenderer, deltaMs: number): void {
  renderer.advanceAsyncClock(deltaMs)
  renderer.advanceTime(deltaMs)
  renderer.flush()
}

async function drainMicrotasks(): Promise<void> {
  for (let tick = 0; tick < MICROTASK_DRAIN_TICKS; tick += 1) {
    await Promise.resolve()
  }
}

function waitForTimeoutError(lastError: unknown): Error {
  if (lastError instanceof Error) return lastError
  if (lastError === undefined) return new Error("Timed out in waitFor.")
  return new Error(`Timed out in waitFor: ${String(lastError)}`)
}

function resolveWaitForOptions(options: WaitForOptions): {
  timeout: number
  interval: number
} {
  const timeout = options.timeout ?? DEFAULT_WAIT_FOR_TIMEOUT_MS
  const requestedInterval = options.interval ?? DEFAULT_WAIT_FOR_INTERVAL_MS

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new Error(`waitFor timeout must be a finite non-negative number, got ${timeout}`)
  }
  if (!Number.isFinite(requestedInterval)) {
    throw new Error(`waitFor interval must be a finite number, got ${requestedInterval}`)
  }

  return { timeout, interval: Math.max(requestedInterval, MIN_WAIT_FOR_INTERVAL_MS) }
}

function createWaitFor(renderer: TestRenderer): TestWaitFor {
  return async <T>(
    callback: () => T | Promise<T>,
    options: WaitForOptions = {}
  ): Promise<T> => {
    const { timeout, interval } = resolveWaitForOptions(options)
    const onTimeout = options.onTimeout ?? ((error: Error) => error)
    const deadline = Date.now() + timeout
    let lastError: unknown

    for (;;) {
      try {
        return await callback()
      } catch (error) {
        lastError = error
      }

      if (Date.now() >= deadline) throw onTimeout(waitForTimeoutError(lastError))

      // Wait first, then pump, then retry. Pumping before the sleep would make
      // the callback observe the clocks an entire interval after they moved.
      await new Promise((resolve) => setTimeout(resolve, interval))
      await drainMicrotasks()
      pumpRenderer(renderer, interval)
    }
  }
}

/**
 * The synchronous sibling of `waitFor`, for the few call sites that cannot
 * become async. It shares the timeout error and blocks the thread between
 * attempts instead of yielding to the event loop. The pump is the caller's:
 * only a call site that owns the clocks may advance them, and one that is
 * waiting on real async work outside them must pass a repaint-only pump.
 */
function waitForSync(
  predicate: () => boolean,
  pump: WaitForPump,
  describeFailure: () => string,
  options: WaitForOptions = {}
): void {
  const { timeout, interval } = resolveWaitForOptions(options)
  const deadline = Date.now() + timeout
  const pause = new Int32Array(new SharedArrayBuffer(4))

  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline) throw waitForTimeoutError(new Error(describeFailure()))

    Atomics.wait(pause, 0, 0, interval)
    pump(interval)
  }
}

function getQueries(
  renderer: TestRenderer,
  resolveScope: () => QueryScope,
  includeScope: boolean
): TestQueries {
  const waitFor = createWaitFor(renderer)

  const allBySemantics = (
    field: SemanticsField,
    matcher: TextMatcher,
    options?: MatcherOptions
  ): TestElement[] =>
    findAllBySemantics(renderer, resolveScope(), field, matcher, includeScope, options)

  const requireSemantics = (
    field: SemanticsField,
    matcher: TextMatcher,
    options: MatcherOptions | undefined,
    expectOne: boolean
  ): TestElement[] => {
    const scope = resolveScope()
    const matches = findAllBySemantics(renderer, scope, field, matcher, includeScope, options)

    if (matches.length === 0) {
      throw noSemanticsMatchError(renderer, scope, field, matcher, includeScope)
    }
    if (expectOne && matches.length > 1) {
      throw multipleSemanticsMatchesError(renderer, field, matcher, matches)
    }

    return matches
  }

  const oneBySemantics = (
    field: SemanticsField,
    matcher: TextMatcher,
    options?: MatcherOptions
  ): TestElement => {
    const [match] = requireSemantics(field, matcher, options, true)
    if (match === undefined) {
      throw noSemanticsMatchError(renderer, resolveScope(), field, matcher, includeScope)
    }
    return match
  }

  const maybeBySemantics = (
    field: SemanticsField,
    matcher: TextMatcher,
    options?: MatcherOptions
  ): TestElement | null => {
    const matches = allBySemantics(field, matcher, options)
    if (matches.length > 1) {
      throw multipleSemanticsMatchesError(renderer, field, matcher, matches)
    }
    return matches[0] ?? null
  }

  const queries: TestQueries = {
    getByText: (text, options) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope, options)

      if (matches.length === 0) throw noTextMatchError(renderer, scope, text, includeScope)
      if (matches.length > 1) throw multipleTextMatchesError(renderer, text, matches)

      const [match] = matches
      if (match === undefined) throw noTextMatchError(renderer, scope, text, includeScope)

      return match
    },
    queryByText: (text, options) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope, options)

      if (matches.length > 1) throw multipleTextMatchesError(renderer, text, matches)

      return matches[0] ?? null
    },
    getAllByText: (text, options) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope, options)

      if (matches.length === 0) throw noTextMatchError(renderer, scope, text, includeScope)

      return matches
    },
    queryAllByText: (text, options) =>
      findAllByText(renderer, resolveScope(), text, includeScope, options),
    getByTestId: (testId, options) => {
      const scope = resolveScope()
      const matches = findAllByTestId(renderer, scope, testId, includeScope, options)

      if (matches.length === 0) throw noTestIdMatchError(renderer, scope, testId)
      if (matches.length > 1) throw multipleTestIdMatchesError(renderer, testId, matches)

      const [match] = matches
      if (match === undefined) throw noTestIdMatchError(renderer, scope, testId)

      return match
    },
    queryByTestId: (testId, options) => {
      const matches = findAllByTestId(renderer, resolveScope(), testId, includeScope, options)

      if (matches.length > 1) throw multipleTestIdMatchesError(renderer, testId, matches)

      return matches[0] ?? null
    },
    getAllByTestId: (testId, options) => {
      const scope = resolveScope()
      const matches = findAllByTestId(renderer, scope, testId, includeScope, options)

      if (matches.length === 0) throw noTestIdMatchError(renderer, scope, testId)

      return matches
    },
    queryAllByTestId: (testId, options) =>
      findAllByTestId(renderer, resolveScope(), testId, includeScope, options),
    getByRole: (role, options = {}) => {
      const scope = resolveScope()
      const matches = findAllByRole(renderer, scope, role, options, includeScope)

      if (matches.length === 0) {
        throw noRoleMatchError(renderer, scope, role, options, includeScope)
      }
      if (matches.length > 1) throw multipleRoleMatchesError(renderer, role, options, matches)

      const [match] = matches
      if (match === undefined) {
        throw noRoleMatchError(renderer, scope, role, options, includeScope)
      }

      return match
    },
    queryByRole: (role, options = {}) => {
      const matches = findAllByRole(renderer, resolveScope(), role, options, includeScope)

      if (matches.length > 1) throw multipleRoleMatchesError(renderer, role, options, matches)

      return matches[0] ?? null
    },
    getAllByRole: (role, options = {}) => {
      const scope = resolveScope()
      const matches = findAllByRole(renderer, scope, role, options, includeScope)

      if (matches.length === 0) {
        throw noRoleMatchError(renderer, scope, role, options, includeScope)
      }

      return matches
    },
    queryAllByRole: (role, options = {}) =>
      findAllByRole(renderer, resolveScope(), role, options, includeScope),
    getByLabelText: (text, options) => oneBySemantics("label", text, options),
    queryByLabelText: (text, options) => maybeBySemantics("label", text, options),
    getAllByLabelText: (text, options) => requireSemantics("label", text, options, false),
    queryAllByLabelText: (text, options) => allBySemantics("label", text, options),
    getByPlaceholderText: (text, options) => oneBySemantics("placeholder", text, options),
    queryByPlaceholderText: (text, options) => maybeBySemantics("placeholder", text, options),
    getAllByPlaceholderText: (text, options) =>
      requireSemantics("placeholder", text, options, false),
    queryAllByPlaceholderText: (text, options) => allBySemantics("placeholder", text, options),
    getByDisplayValue: (value, options) => oneBySemantics("value", value, options),
    queryByDisplayValue: (value, options) => maybeBySemantics("value", value, options),
    getAllByDisplayValue: (value, options) => requireSemantics("value", value, options, false),
    queryAllByDisplayValue: (value, options) => allBySemantics("value", value, options),
    findByText: (text, options, waitForOptions) =>
      waitFor(() => queries.getByText(text, options), waitForOptions),
    findAllByText: (text, options, waitForOptions) =>
      waitFor(() => queries.getAllByText(text, options), waitForOptions),
    findByTestId: (testId, options, waitForOptions) =>
      waitFor(() => queries.getByTestId(testId, options), waitForOptions),
    findAllByTestId: (testId, options, waitForOptions) =>
      waitFor(() => queries.getAllByTestId(testId, options), waitForOptions),
    findByRole: (role, options, waitForOptions) =>
      waitFor(() => queries.getByRole(role, options), waitForOptions),
    findAllByRole: (role, options, waitForOptions) =>
      waitFor(() => queries.getAllByRole(role, options), waitForOptions),
    findByLabelText: (text, options, waitForOptions) =>
      waitFor(() => queries.getByLabelText(text, options), waitForOptions),
    findAllByLabelText: (text, options, waitForOptions) =>
      waitFor(() => queries.getAllByLabelText(text, options), waitForOptions),
    findByPlaceholderText: (text, options, waitForOptions) =>
      waitFor(() => queries.getByPlaceholderText(text, options), waitForOptions),
    findAllByPlaceholderText: (text, options, waitForOptions) =>
      waitFor(() => queries.getAllByPlaceholderText(text, options), waitForOptions),
    findByDisplayValue: (value, options, waitForOptions) =>
      waitFor(() => queries.getByDisplayValue(value, options), waitForOptions),
    findAllByDisplayValue: (value, options, waitForOptions) =>
      waitFor(() => queries.getAllByDisplayValue(value, options), waitForOptions),
  }

  return queries
}

function findAllByText(
  renderer: TestRenderer,
  scope: QueryScope,
  text: TextMatcher,
  includeScope: boolean,
  options?: MatcherOptions
): TestElement[] {
  return getElements(renderer, scope, includeScope).filter(
    (element) =>
      matchesMatcher(nodeText(renderer, element), element, text, options) &&
      !hasMatchingTextChild(renderer, element, text, options)
  )
}

function findAllByTestId(
  renderer: TestRenderer,
  scope: QueryScope,
  testId: TestIdMatcher,
  includeScope: boolean,
  options?: MatcherOptions
): TestElement[] {
  return getElements(renderer, scope, includeScope).filter((element) => {
    const resolved = resolveTestId(element)
    return resolved !== undefined && matchesMatcher(resolved, element, testId, options)
  })
}

/** The `semantics` fields the label, placeholder, and value queries read. */
type SemanticsField = "label" | "placeholder" | "value"

/** How each field is named in a failure message, in Testing Library's words. */
const SEMANTICS_FIELD_NOUNS: Readonly<Record<SemanticsField, string>> = {
  label: "label text",
  placeholder: "placeholder text",
  value: "display value",
}

/** The declaration each field comes from, for the "here is what exists" list. */
const SEMANTICS_FIELD_PROPS: Readonly<Record<SemanticsField, string>> = {
  label: "ariaLabel",
  placeholder: "placeholder",
  value: "value",
}

function findAllBySemantics(
  renderer: TestRenderer,
  scope: QueryScope,
  field: SemanticsField,
  matcher: TextMatcher,
  includeScope: boolean,
  options?: MatcherOptions
): TestElement[] {
  return getElements(renderer, scope, includeScope).filter((element) => {
    const declared = element.semantics?.[field]
    return declared !== undefined && matchesMatcher(declared, element, matcher, options)
  })
}

function noSemanticsMatchError(
  renderer: TestRenderer,
  scope: QueryScope,
  field: SemanticsField,
  matcher: TextMatcher,
  includeScope: boolean
): Error {
  const declared = getElements(renderer, scope, includeScope).filter(
    (element) => element.semantics?.[field] !== undefined
  )
  const available =
    declared.length === 0
      ? `  No element in this scope declares ${SEMANTICS_FIELD_PROPS[field]}.`
      : declared
          .slice(0, 5)
          .map(
            (element) =>
              `  ${JSON.stringify(element.semantics?.[field])}\n    ${describeElement(renderer, element)}`
          )
          .join("\n")

  return new Error(
    `Unable to find an element with ${SEMANTICS_FIELD_NOUNS[field]} ${describeMatcher(matcher)} within ${describeScope(renderer, scope)}.\n\nHere is the ${SEMANTICS_FIELD_NOUNS[field]} that was declared:\n\n${available}`
  )
}

function multipleSemanticsMatchesError(
  renderer: TestRenderer,
  field: SemanticsField,
  matcher: TextMatcher,
  matches: TestElement[]
): Error {
  return new Error(
    `Found multiple elements with ${SEMANTICS_FIELD_NOUNS[field]} ${describeMatcher(matcher)}:\n${matches
      .map((element) => `  ${describeElement(renderer, element)}`)
      .join("\n")}`
  )
}

interface AccessibleHost {
  element: TestElement
  node: AccessKitNodeSnapshot
  role: string
  name: string
}

const ACCESSKIT_ROLE_ALIASES: Readonly<Record<string, string>> = {
  contentdeletion: "deletion",
  contentinsertion: "insertion",
  image: "img",
  listboxoption: "option",
  progressindicator: "progressbar",
  radiobutton: "radio",
  searchinput: "searchbox",
  splitter: "separator",
  textinput: "textbox",
}

const HIDDEN_ROLE_ERROR =
  "hidden: true requires native hidden-node snapshot support, not yet implemented; see issue #209"

function findAllByRole(
  renderer: TestRenderer,
  scope: QueryScope,
  role: string,
  options: ByRoleOptions,
  includeScope: boolean
): TestElement[] {
  if (options.hidden === true) throw new Error(HIDDEN_ROLE_ERROR)

  return accessibleHosts(renderer, scope, includeScope)
    .filter((candidate) => matchesRole(candidate.node.aria.role, role))
    .filter((candidate) => options.level === undefined || candidate.node.aria.level === options.level)
    .filter(
      (candidate) =>
        options.name === undefined ||
        matchesAccessibleName(candidate.name, options.name, candidate.element, options)
    )
    .map((candidate) => candidate.element)
}

function accessibleHosts(
  renderer: TestRenderer,
  scope: QueryScope,
  includeScope: boolean
): AccessibleHost[] {
  const scopedIds = new Set(
    getElements(renderer, scope, includeScope).map((element) => element.id)
  )
  const tree = renderer.getAccessibilityTree()

  return accessibilityNodesInOrder(tree).flatMap((node): AccessibleHost[] => {
    if (node.host_id === undefined || !scopedIds.has(node.host_id)) return []
    const element = renderer.getElement(node.host_id)
    if (element === undefined) return []

    return [
      {
        element,
        node,
        role: describeComputedRole(node.aria.role),
        name: node.aria.label ?? "",
      },
    ]
  })
}

function accessibilityNodesInOrder(tree: AccessKitTreeSnapshot): AccessKitNodeSnapshot[] {
  if (tree.root === null) return []
  const visited = new Set<string>()
  const nodes: AccessKitNodeSnapshot[] = []

  const visit = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)
    const node = tree.nodes[id]
    if (node === undefined) return
    nodes.push(node)
    for (const child of node.children ?? []) visit(child)
  }

  visit(tree.root)
  return nodes
}

function normalizeRole(role: string): string {
  return role.replace(/[^a-z0-9]/gi, "").toLowerCase()
}

function matchesRole(computedRole: string, requestedRole: string): boolean {
  const computed = normalizeRole(computedRole)
  return (ACCESSKIT_ROLE_ALIASES[computed] ?? computed) === normalizeRole(requestedRole)
}

function describeComputedRole(role: string): string {
  const normalized = normalizeRole(role)
  const alias = ACCESSKIT_ROLE_ALIASES[normalized]
  if (alias !== undefined) return alias
  if (normalized.startsWith("doc") && normalized.length > 3) {
    const suffix = normalized.slice(3)
    return `doc-${suffix === "acknowledgements" ? "acknowledgments" : suffix}`
  }
  if (normalized.startsWith("graphics") && normalized.length > 8) {
    return `graphics-${normalized.slice(8)}`
  }
  return normalized
}

/** The accessible name goes through the same matcher as text and test IDs, so
 *  `{ exact: false }`, a `normalizer`, and predicates read the normalized name. */
function matchesAccessibleName(
  accessibleName: string,
  matcher: AccessibleNameMatcher,
  element: TestElement,
  options?: MatcherOptions
): boolean {
  return matchesMatcher(accessibleName, element, matcher, options)
}

function nodeText(renderer: TestRenderer, element: TestElement): string {
  return `${element.text ?? ""}${element.children
    .map((child) => child.text ?? "")
    .join("")}`
}

function hasMatchingTextChild(
  renderer: TestRenderer,
  element: TestElement,
  text: TextMatcher,
  options?: MatcherOptions
): boolean {
  return element.children.some((child) =>
    matchesMatcher(nodeText(renderer, child), child, text, options)
  )
}

/**
 * What a query searches within: an element, or nothing at all when the
 * component rendered `null` and the renderer has no root. An absent scope
 * searches an empty tree — the web's equivalent of an empty `<body>` — so every
 * query family reports "no match" rather than failing to search.
 */
type QueryScope = TestElement | undefined

function getElements(renderer: TestRenderer, scope: QueryScope, includeScope = true): TestElement[] {
  if (scope === undefined) return []

  return [
    ...(includeScope ? [scope] : []),
    ...scope.children.flatMap((child) => getElements(renderer, child)),
  ]
}

function getElement(renderer: TestRenderer, id: number, relationship: string): TestElement {
  const element = renderer.getElement(id)
  if (element === undefined) throw missingElementError(id, relationship)

  return element
}

function noTextMatchError(
  renderer: TestRenderer,
  scope: QueryScope,
  text: TextMatcher,
  includeScope: boolean
): Error {
  const nearMisses = getElements(renderer, scope, includeScope)
    .filter((element) => element.text !== null && element.text.length > 0)
    .slice(0, 5)
    .map((element) => `  ${describeElement(renderer, element)}`)
  const nearby =
    nearMisses.length === 0 ? "No text was rendered in this scope." : nearMisses.join("\n")

  return new Error(
    `Unable to find an element with text ${describeMatcher(text)} within ${describeScope(renderer, scope)}. Near misses:\n${nearby}`
  )
}

function multipleTextMatchesError(
  renderer: TestRenderer,
  text: TextMatcher,
  matches: TestElement[]
): Error {
  return new Error(
    `Found multiple elements with text ${describeMatcher(text)}:\n${matches
      .map((element) => `  ${describeElement(renderer, element)}`)
      .join("\n")}`
  )
}

function noTestIdMatchError(
  renderer: TestRenderer,
  scope: QueryScope,
  testId: TestIdMatcher
): Error {
  return new Error(
    `Unable to find an element with test ID ${describeMatcher(testId)} within ${describeScope(renderer, scope)}`
  )
}

function multipleTestIdMatchesError(
  renderer: TestRenderer,
  testId: TestIdMatcher,
  matches: TestElement[]
): Error {
  return new Error(
    `Found multiple elements with test ID ${describeMatcher(testId)}:\n${matches
      .map((element) => `  ${describeElement(renderer, element)}`)
      .join("\n")}`
  )
}

function noRoleMatchError(
  renderer: TestRenderer,
  scope: QueryScope,
  role: string,
  options: ByRoleOptions,
  includeScope: boolean
): Error {
  if (options.hidden === true) return new Error(HIDDEN_ROLE_ERROR)

  const present = accessibleHosts(renderer, scope, includeScope)
  const available =
    present.length === 0
      ? "  No accessible roles were found in this scope."
      : present
          .map(
            ({ element, role: presentRole, name }) =>
              `  ${presentRole}:\n    Name ${JSON.stringify(name)}\n    ${describeElement(renderer, element)}`
          )
          .join("\n\n")

  return new Error(
    `Unable to find an accessible element with the role ${JSON.stringify(role)}${describeRoleOptions(options)} within ${describeScope(renderer, scope)}.\n\nHere are the accessible roles:\n\n${available}`
  )
}

function multipleRoleMatchesError(
  renderer: TestRenderer,
  role: string,
  options: ByRoleOptions,
  matches: TestElement[]
): Error {
  return new Error(
    `Found multiple elements with the role ${JSON.stringify(role)}${describeRoleOptions(options)}:\n${matches
      .map((element) => `  ${describeElement(renderer, element)}`)
      .join("\n")}`
  )
}

function describeRoleOptions(options: ByRoleOptions): string {
  const name =
    options.name === undefined ? "" : ` and name ${describeAccessibleNameMatcher(options.name)}`
  const level = options.level === undefined ? "" : ` and level ${options.level}`
  return `${name}${level}`
}

function describeAccessibleNameMatcher(matcher: AccessibleNameMatcher): string {
  if (typeof matcher === "function") return `[function ${matcher.name || "anonymous"}]`
  return describeMatcher(matcher)
}

/** One-line `<type identity text>` rendering of an element, for failure messages. */
export function describeElement(renderer: TestRenderer, element: TestElement): string {
  const identity = [
    element.dataTestId === undefined ? undefined : `data-testid=${JSON.stringify(element.dataTestId)}`,
    element.authorId === undefined ? undefined : `id=${JSON.stringify(element.authorId)}`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ")
  const attributes = [identity, `text=${JSON.stringify(textContent(renderer, element))}`]
    .filter((attribute) => attribute.length > 0)
    .join(" ")

  return `<${element.type} ${attributes}>`
}

/** The searched scope, or a stand-in when the tree is empty, for failure messages. */
function describeScope(renderer: TestRenderer, scope: QueryScope): string {
  if (scope === undefined) return "the empty render tree"

  return describeElement(renderer, scope)
}

function describeMatcher(text: TextMatcher): string {
  if (typeof text === "function") return `[function ${text.name || "anonymous"}]`
  return text instanceof RegExp ? text.toString() : JSON.stringify(text)
}

function missingElementError(id: number, relationship: string): Error {
  return new Error(`Unable to find ${relationship}: element #${id} is absent`)
}

function noPaintedBoundsError(renderer: TestRenderer, element: TestElement): Error {
  return new Error(
    `Unable to read the bounding client rect of ${describeElement(renderer, element)}: it painted no bounds in the last frame`
  )
}

export interface TestRoot extends TestQueries {
  root: Root
  renderer: TestRenderer
  render: (node: ReactNode) => void
  within: (element: TestElement) => TestQueries
  userEvent: TestUserEvent
  /** Retries a callback while pumping the frame and timer clocks. */
  waitFor: TestWaitFor
  unmount: () => void
}

export interface UserEventTabOptions {
  shift?: boolean
}

/** Vitest browser-mode-shaped interactions over retained TestElements. */
export interface TestUserEvent {
  click: (element: TestElement) => Promise<void>
  dblClick: (element: TestElement) => Promise<void>
  hover: (element: TestElement) => Promise<void>
  /** Moves the pointer off the element. An element that fills the window can
   *  only be left by leaving the window, so the pointer goes to (-1, -1). */
  unhover: (element: TestElement) => Promise<void>
  type: (element: TestElement, text: string) => Promise<void>
  clear: (element: TestElement) => Promise<void>
  tab: (options?: UserEventTabOptions) => Promise<void>
  /**
   * Focuses the element, then sends GPUI's space-separated keystroke syntax
   * (`"cmd-enter"`, `"a b"`, `"shift-tab"`) one physical keypress at a time.
   *
   * This is not user-event's `keyboard()`: it takes the target element, and it
   * does not read user-event's `{Shift>}A{/Shift}` bracket syntax. GPUI's own
   * keystroke strings are what the native dispatcher speaks.
   */
  keyboard: (element: TestElement, keystrokes: string) => Promise<void>
}

interface TestElementBounds {
  element: TestElement
  x: number
  y: number
  width: number
  height: number
}

function resolveElementBounds(renderer: TestRenderer, element: TestElement): TestElementBounds {
  const current = getElement(renderer, element.id, "userEvent target")
  const bounds = renderer.getElementBounds(current.id)
  if (bounds === null) {
    throw new Error(`${describeElement(renderer, current)} has no painted bounds`)
  }
  const [x, y, width, height] = bounds
  return { element: current, x, y, width, height }
}

function centerOf({ x, y, width, height }: TestElementBounds): { x: number; y: number } {
  return { x: x + width / 2, y: y + height / 2 }
}

/** The nearest point off the element. An element that covers the whole window
 *  has no such point inside it, so the pointer leaves the window instead —
 *  which is what a real pointer would have to do to stop hovering. */
function pointOutside(
  renderer: TestRenderer,
  { x, y, width, height }: TestElementBounds
): { x: number; y: number } {
  const window = renderer.getWindowSize()
  if (x > 0) return { x: x - 1, y: y + height / 2 }
  if (x + width < window.width) return { x: x + width + 1, y: y + height / 2 }
  if (y > 0) return { x: x + width / 2, y: y - 1 }
  if (y + height < window.height) return { x: x + width / 2, y: y + height + 1 }
  return { x: -1, y: -1 }
}

function createTestUserEvent(renderer: TestRenderer): TestUserEvent {
  const keyboard = async (element: TestElement, keystrokes: string): Promise<void> => {
    const current = getElement(renderer, element.id, "userEvent keyboard target")
    // Focus first, then let simulateKeystrokes drain each physical keypress:
    // a keystroke that moves focus, such as `tab`, must be committed through
    // React before the next key is sent, or the rest of the string lands on
    // the element that was focused when the call started.
    renderer.focusElement(current.id)
    renderer.simulateKeystrokes(keystrokes)
  }

  return {
    click: async (element) => {
      const point = centerOf(resolveElementBounds(renderer, element))
      renderer.nativeSimulateClick(point.x, point.y)
    },
    dblClick: async (element) => {
      const point = centerOf(resolveElementBounds(renderer, element))
      // Two real clicks, the second carrying the platform's repeat count — the
      // DOM order, where `dblclick` follows the second `click` rather than
      // replacing it.
      renderer.nativeSimulateClick(point.x, point.y)
      renderer.nativeSimulateClick(point.x, point.y, 0, undefined, 2)
    },
    hover: async (element) => {
      const point = centerOf(resolveElementBounds(renderer, element))
      renderer.nativeSimulateMouseMove(point.x, point.y)
    },
    unhover: async (element) => {
      const point = pointOutside(renderer, resolveElementBounds(renderer, element))
      renderer.nativeSimulateMouseMove(point.x, point.y)
    },
    type: async (element, text) => keyboard(element, toKeystrokes(text)),
    clear: async (element) => keyboard(element, `${selectAllKeystroke()} backspace`),
    tab: async (options = {}) => {
      renderer.simulateKeystrokes(options.shift === true ? "shift-tab" : "tab")
    },
    keyboard,
  }
}

export interface TestRootOptions extends TestWindowOptions {
  /** Opt in to loopback/private URL images for local fixture servers. */
  allowPrivateNetworkImages?: boolean
  /** Match render()'s strict diagnostic mode. Defaults to the active runtime policy. */
  strictStyles?: boolean
}

/**
 * Create a test root for rendering React components.
 * All mutations go to the real GPUI pipeline via native TestGpuixRenderer.
 * Returns the Root (for rendering), the TestRenderer (for inspection/events),
 * and convenience methods.
 *
 * Pass `width` / `height` to size the offscreen window, and `scaleFactor` to
 * override its virtual display scale. The 1280x800 default is
 * wide enough to keep a centered max-width column capped, so a layout test that
 * needs to observe re-wrapping must ask for a narrower window.
 */
export function createTestRoot(options: TestRootOptions = {}): TestRoot {
  const renderer = new TestRenderer(options)
  attachAnimationFrameSource({
    owner: renderer,
    request: (callback) => renderer.requestFrame(callback),
  })
  renderer.setAllowPrivateNetworkImages(options.allowPrivateNetworkImages ?? false)
  const root = createRoot(renderer, { strictStyles: options.strictStyles })
  const queries = getQueries(renderer, () => renderer.getRoot(), true)
  let unmounted = false

  const render = (node: ReactNode): void => {
    flushSync(() => root.render(node))
    // Trigger GPUI rendering pipeline after the synchronous React commit.
    renderer.flush()
  }

  const unmount = (): void => {
    if (unmounted) return
    unmounted = true
    try {
      root.unmount()
    } finally {
      renderer.dispose()
    }
  }

  return {
    root,
    renderer,
    render,
    ...queries,
    within: (element) => getQueries(renderer, () => getElement(renderer, element.id, "scoped element"), false),
    userEvent: createTestUserEvent(renderer),
    waitFor: createWaitFor(renderer),
    unmount,
  }
}

// ── render() ─────────────────────────────────────────────────────────

/**
 * What `render()` returns: everything `createTestRoot()` gives, plus
 * `rerender`.
 *
 * `unmount` here is vitest-browser-react's `unmount`, not `createTestRoot`'s:
 * it unmounts the rendered tree and **keeps the offscreen window**, which is
 * the whole point of sharing one window across a test file. Call
 * `createTestRoot()` directly when you want to own the window's lifetime.
 */
export interface RenderResult extends TestRoot {
  /** Re-render into the same root, keeping the window and the renderer. */
  rerender: (node: ReactNode) => void
}

interface ActiveRenderRoot {
  root: TestRoot
  options: TestRootOptions
  /** Window size at creation, restored after a test calls `simulateResize`. */
  windowSize: { width: number; height: number }
  result: RenderResult
}

/** The one offscreen window `render()` shares, per module instance — which
 *  vitest gives each test file its own copy of. */
let activeRenderRoot: ActiveRenderRoot | null = null

/** Every field of `TestRootOptions` is fixed when the window is constructed,
 *  so a request that differs in any of them cannot reuse the live window. */
function sameTestRootOptions(a: TestRootOptions, b: TestRootOptions): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.scaleFactor === b.scaleFactor &&
    a.allowPrivateNetworkImages === b.allowPrivateNetworkImages &&
    a.strictStyles === b.strictStyles
  )
}

/** Return the shared window to the state a freshly created one is in, for the
 *  knobs a test can move without going through the React tree. Everything else
 *  set through `renderer` — menus, the debug frame overlay, CPU throttling —
 *  persists for the rest of the file. */
function resetSharedWindow(active: ActiveRenderRoot): void {
  const { renderer } = active.root
  const size = renderer.getWindowSize()
  if (size.width !== active.windowSize.width || size.height !== active.windowSize.height) {
    renderer.simulateResize(active.windowSize.width, active.windowSize.height)
  }
  // The pointer is a window-level position, not tree state: leaving it over
  // the old tree's coordinates would mount the next one already hovered.
  renderer.nativeSimulateMouseMove(-1, -1)
  renderer.blur()
  // A test that activated the window leaves it active; a fresh one is not.
  renderer.nativeSimulateWindowActivation(false)
  renderer.clearSelection()
  // `clockResume` alone preserves the elapsed time, so a `clockSet` or
  // `clockFastForward` offset from the previous test would still be the next
  // one's baseline. Re-anchor at zero first, then hand the clock back to
  // wall time.
  renderer.clockSet(0)
  renderer.clockResume()
  renderer.setReducedMotion(false)
  renderer.setAllowPrivateNetworkImages(active.options.allowPrivateNetworkImages ?? false)
  renderer.setStrictStyles(active.options.strictStyles ?? strictStylesDefault())
  // Anything the old tree queued and nobody drained would land on the new one.
  renderer.drainEvents()
  renderer.flush()
}

/** Drop the shared window entirely. The next `render()` opens a new one. */
function disposeSharedRoot(active: ActiveRenderRoot): void {
  if (activeRenderRoot === active) activeRenderRoot = null
  active.root.unmount()
}

/**
 * Unmount the tree `render()` mounted, keeping the offscreen window for the
 * next `render()` in this file.
 *
 * `@gpuix/react/testing/vitest` calls this in an `afterEach`. Call it yourself
 * — or from your own runner's teardown — when you import `@gpuix/react/testing`
 * directly.
 */
export function cleanup(): void {
  const active = activeRenderRoot
  if (active === null) return

  // A root that died on an uncaught render error can never be rendered into
  // again, so the window goes with it rather than poisoning the next test.
  if (active.root.root.getStatus().status !== "active") {
    disposeSharedRoot(active)
    return
  }

  try {
    active.root.render(null)
  } catch (error) {
    // An unmount effect threw. The tree's state is now unknown, so the window
    // cannot be handed to the next test; the error still belongs to this one.
    disposeSharedRoot(active)
    throw error
  }
  resetSharedWindow(active)
}

/**
 * Render `node` into a test root and return it, the way
 * `render()` from vitest-browser-react does.
 *
 * ```tsx
 * const screen = render(<Panel />)
 * await screen.userEvent.click(screen.getByRole("button", { name: "Save" }))
 * expect(screen.getByText("Saved")).toBeInTheDocument()
 * ```
 *
 * **One window per test file.** Opening an offscreen GPUI window costs about a
 * second, so the window created by the first `render()` is reused by every
 * later one in the same file — vitest isolates module state per file, so
 * nothing is shared between files. Each `render()` unmounts the previous tree
 * and starts from a reset window (see `cleanup`), so a reused window is never a
 * reused tree; it **replaces** the previous tree rather than mounting a second
 * one beside it, since a desktop window has one root, not a `document.body`
 * that can hold many containers.
 *
 * **Options decide reuse.** `options` are the `createTestRoot()` options, all
 * of which are fixed when the window is constructed. A call whose options match
 * the live window's reuses it; a call whose options differ — compared field by
 * field, so an omitted option differs from one passed at its default value —
 * tears that window down and opens a fresh one. So does a root that died on an
 * uncaught render error.
 */
export function render(node: ReactNode, options: TestRootOptions = {}): RenderResult {
  const live = activeRenderRoot
  if (
    live !== null &&
    // A root that died on an uncaught render error can be rendered into and
    // will even paint, but `getStatus()` reads `failed` forever. `cleanup()`
    // refuses to hand such a root to the next test; a second `render()` in
    // the same test must refuse it too.
    (!sameTestRootOptions(live.options, options) ||
      live.root.root.getStatus().status !== "active")
  ) {
    disposeSharedRoot(live)
  }

  if (activeRenderRoot !== null) {
    // Unmount before resetting — rendering the new node straight into the
    // live root would reconcile against the old tree, and an unmount effect
    // running after the reset could re-dirty the window that was just
    // cleaned. `cleanup()` also guards the unmount: an unmount effect that
    // throws poisons the window, which is then disposed rather than handed
    // back, exactly as between tests.
    cleanup()
  }

  let active = activeRenderRoot
  if (active === null) {
    const root = createTestRoot(options)
    const size = root.renderer.getWindowSize()
    const rerender = (next: ReactNode): void => root.render(next)
    active = {
      root,
      // Copied, so a caller reusing and mutating one options object cannot
      // change what this window is recorded as having been built with.
      options: {
        width: options.width,
        height: options.height,
        scaleFactor: options.scaleFactor,
        allowPrivateNetworkImages: options.allowPrivateNetworkImages,
        strictStyles: options.strictStyles,
      },
      windowSize: { width: size.width, height: size.height },
      result: {
        ...root,
        rerender,
        // Tree-only unmount: vitest-browser-react's `unmount` removes the
        // component, not the page it rendered into.
        unmount: () => {
          if (activeRenderRoot === active) cleanup()
        },
      },
    }
    activeRenderRoot = active
  }

  active.root.render(node)
  return active.result
}

export interface CanvasComparisonOptions {
  /** Maximum allowed delta for each RGBA channel. Defaults to 2. */
  tolerance?: number
  /** Maximum fraction of pixels outside the channel tolerance. Defaults to 1%. */
  differingPixelBudget?: number
  /** Maximum delta allowed in any channel, regardless of affected area. Defaults to 16. */
  maxChannelDelta?: number
  /** Override the committed browser golden path. */
  goldenPath?: string
  /** Override where the native screenshot is written for inspection. */
  actualPath?: string
  /**
   * Adapts an unavailable prerequisite to the active test runner. With Vitest,
   * pass `(message) => context.skip(message)`. Without one, the helper throws
   * CanvasComparisonSkippedError so an unavailable gate is never silent.
   */
  skip?: (message: string) => void
}

/** Loud fallback when a caller did not provide its test runner's skip hook. */
export class CanvasComparisonSkippedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CanvasComparisonSkippedError"
  }
}

const canvasGoldenDirectory = fileURLToPath(new URL("../canvas-goldens", import.meta.url))
const canvasFixtureDirectory = path.join(canvasGoldenDirectory, "__fixtures__")
const canvasScreenshotDirectory = fileURLToPath(new URL("../screenshots", import.meta.url))
const DEFAULT_CANVAS_MAX_CHANNEL_DELTA = 16

function resolveCanvasScene(scene: CanvasScene | CanvasSceneName): CanvasScene {
  return typeof scene === "string" ? canvasScenes[scene] : scene
}

/** Absolute path to a scene's committed Chromium golden. */
export function canvasGoldenPath(scene: CanvasScene | CanvasSceneName): string {
  const resolved = resolveCanvasScene(scene)
  if (!/^[a-z0-9-]+$/.test(resolved.name)) {
    throw new Error(
      `Canvas scene name must contain only lowercase letters, digits, and dashes: ${resolved.name}`
    )
  }
  return path.join(canvasGoldenDirectory, `${resolved.name}.png`)
}

function skipCanvasComparison(
  reason: string,
  skip: CanvasComparisonOptions["skip"]
): undefined {
  const message = `Canvas comparison skipped: ${reason}`
  if (skip) {
    skip(message)
    return undefined
  }
  throw new CanvasComparisonSkippedError(message)
}

/**
 * Render one standard Canvas 2D scene through GPUIX and compare it with the
 * committed Chromium PNG. This gate intentionally requires a local macOS GPU.
 */
export function expectCanvasMatchesBrowser(
  scene: CanvasScene | CanvasSceneName,
  options: CanvasComparisonOptions = {}
): ImageComparisonResult | undefined {
  const resolved = resolveCanvasScene(scene)
  const tolerance = options.tolerance ?? 2
  const differingPixelBudget = options.differingPixelBudget ?? 0.01
  const maxChannelDelta = options.maxChannelDelta ?? DEFAULT_CANVAS_MAX_CHANNEL_DELTA

  if (
    !Number.isFinite(tolerance) ||
    !Number.isInteger(tolerance) ||
    tolerance < 0 ||
    tolerance > 255
  ) {
    throw new RangeError(
      `Canvas comparison tolerance must be an integer from 0 through 255, got ${tolerance}`
    )
  }
  if (
    !Number.isFinite(maxChannelDelta) ||
    !Number.isInteger(maxChannelDelta) ||
    maxChannelDelta < 0 ||
    maxChannelDelta > 255
  ) {
    throw new RangeError(
      `Canvas maximum channel delta must be an integer from 0 through 255, got ${maxChannelDelta}`
    )
  }
  if (
    !Number.isFinite(differingPixelBudget) ||
    differingPixelBudget < 0 ||
    differingPixelBudget > 1
  ) {
    throw new RangeError(
      `Canvas differing-pixel budget must be between 0 and 1, got ${differingPixelBudget}`
    )
  }

  if (process.platform !== "darwin" || process.env.CI) {
    return skipCanvasComparison(
      "the browser-equivalence gate runs only on a local macOS host because GPU capture is VM-hostile",
      options.skip
    )
  }

  const goldenPath = options.goldenPath ?? canvasGoldenPath(resolved)
  if (!existsSync(goldenPath)) {
    return skipCanvasComparison(
      `browser golden is absent at ${goldenPath}; regenerate it with \`bun run canvas:goldens\``,
      options.skip
    )
  }

  if (!isNativeTestRendererAvailable()) {
    return skipCanvasComparison(
      `the native test renderer is unavailable: ${nativeTestRendererLoadError?.message ?? "unknown error"}`,
      options.skip
    )
  }

  const testRoot = createTestRoot({
    width: CANVAS_GOLDEN_WIDTH,
    height: CANVAS_GOLDEN_HEIGHT,
    // The Chromium goldens are 2x device-pixel images. Keep their renderer
    // independent of whichever display happens to be primary.
    scaleFactor: CANVAS_GOLDEN_DPR,
    strictStyles: true,
  })
  const canvasRef = createRef<CanvasPublicInstance>()

  try {
    testRoot.render(
      createElement("canvas", {
        ref: canvasRef,
        width: CANVAS_GOLDEN_WIDTH * CANVAS_GOLDEN_DPR,
        height: CANVAS_GOLDEN_HEIGHT * CANVAS_GOLDEN_DPR,
        style: {
          width: CANVAS_GOLDEN_WIDTH,
          height: CANVAS_GOLDEN_HEIGHT,
        },
      })
    )

    const canvas = canvasRef.current
    if (!canvas) throw new Error("The GPUIX <canvas> ref was not mounted")
    const context = canvas.getContext("2d")
    context.scale(CANVAS_GOLDEN_DPR, CANVAS_GOLDEN_DPR)
    const images = (resolved.imageFixtures ?? []).map((fixture) => {
      const image = new Image()
      image.src = path.join(canvasFixtureDirectory, fixture)
      return image
    })
    resolved.draw(context, CANVAS_GOLDEN_WIDTH, CANVAS_GOLDEN_HEIGHT, images)
    flushRecordingContext2D(context)
    testRoot.renderer.flush()

    if (images.length > 0) {
      const element = testRoot.renderer.findByType("canvas")[0]!
      const loadedImageCount = (): number =>
        testRoot.renderer.getCanvasState(element.id)?.loadedImageCount ?? 0
      waitForSync(
        () => loadedImageCount() === images.length,
        // Image decoding happens off the renderer's clocks, so this poll only
        // repaints. Advancing them here would silently run a golden scene's
        // animations and timers forward by however long the disk took.
        () => testRoot.renderer.flush(),
        () =>
          `Canvas scene ${JSON.stringify(resolved.name)} loaded ` +
          `${loadedImageCount()}/${images.length} image fixtures`,
        { timeout: 2_000, interval: 4 }
      )
    }

    const windowSize = testRoot.renderer.getWindowSize()
    if (windowSize.scaleFactor !== CANVAS_GOLDEN_DPR) {
      throw new Error(
        `Canvas golden DPR mismatch: expected ${CANVAS_GOLDEN_DPR}, native test renderer reported ${windowSize.scaleFactor}`
      )
    }

    const actualPath =
      options.actualPath ?? path.join(canvasScreenshotDirectory, `canvas-${resolved.name}.png`)
    mkdirSync(path.dirname(actualPath), { recursive: true })
    testRoot.renderer.captureScreenshot(actualPath)

    const comparison = testRoot.renderer.compareImages(goldenPath, actualPath, tolerance)
    if (
      comparison.differingPixelRatio > differingPixelBudget ||
      comparison.maxChannelDelta > maxChannelDelta ||
      comparison.maxChannelDeltaOutsideGoldenContour > DEFAULT_CANVAS_MAX_CHANNEL_DELTA ||
      comparison.erodedGeometryMismatchRatio > 0
    ) {
      throw new Error(
        `Canvas scene ${JSON.stringify(resolved.name)} differs from Chromium: ` +
          `${(comparison.differingPixelRatio * 100).toFixed(3)}% pixels exceed the ` +
          `per-channel tolerance ${tolerance} (budget ${(differingPixelBudget * 100).toFixed(3)}%, ` +
          `max channel delta ${comparison.maxChannelDelta}, ceiling ${maxChannelDelta}). ` +
          `Outside the one-device-pixel golden contour band, max channel delta ` +
          `${comparison.maxChannelDeltaOutsideGoldenContour}, ceiling ` +
          `${DEFAULT_CANVAS_MAX_CHANNEL_DELTA}. ` +
          `Eroded geometry mismatch ` +
          `${(comparison.erodedGeometryMismatchRatio * 100).toFixed(3)}% (required 0.000%). ` +
          `Expected ${goldenPath}; actual ${actualPath}.`
      )
    }

    return comparison
  } finally {
    testRoot.unmount()
  }
}
