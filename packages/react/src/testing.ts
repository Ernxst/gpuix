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
  normalizeScrollWheelOptions,
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
import { createRoot, flushSync, type Root } from "./reconciler/reconciler.js"
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
  children?: string[]
  aria: {
    role: string
    label?: string
    description?: string
    value?: string
    selected?: boolean
    expanded?: boolean
    toggled?: "False" | "True" | "Mixed"
    disabled?: true
    numeric_value?: number
    min_numeric_value?: number
    max_numeric_value?: number
    level?: number
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
  applyBatch(json: string): number[]
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
  focusElement(elementId: number): void
  setPointerCapture(elementId: number): void
  releasePointerCapture(elementId: number): void
  simulateWindowActivation(active: boolean): void
  simulateWindowDeactivation(): void
  activateWindow(): void
  simulateKeyDown(keystroke: string, isHeld?: boolean): void
  simulateKeyUp(keystroke: string): void
  simulateClick(x: number, y: number, button?: number, modifiers?: string): void
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
  simulateMouseDown(x: number, y: number, button: number, modifiers?: string): void
  simulateMouseUp(x: number, y: number, button: number, modifiers?: string): void
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
  getRootId(): number | null
  getWindowSize(): { width: number; height: number; scaleFactor: number }
  getAllText(): string[]
  findByElementId(authorId: string): number | null
  findByDataTestId(dataTestId: string): number | null
  scrollTo(elementId: number, x: number, y: number): void
  scrollToItem(elementId: number, index: number, offsetInItem?: number): void
  getScrollOffset(elementId: number): number[] | null
  getListScrollTop(elementId: number): number[] | null
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
  setStrictStyles(enabled: boolean): void
  setAllowPrivateNetworkImages(enabled: boolean): void
  drainStyleDiagnostics(): StyleDiagnostic[]
  captureScreenshot(path: string): void
  compareImages(goldenPath: string, actualPath: string, tolerance: number): ImageComparisonResult
  simulateResize(width: number, height: number): void
}

interface NativeTestRendererConstructor {
  new (width?: number, height?: number): NativeTestRendererApi
}

/** Offscreen window size for a test root. Defaults to 1280x800 in native. */
export interface TestWindowOptions {
  width?: number
  height?: number
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
/** Backward-compatible alias for nativeTestRendererLoadError. */
export { nativeTestRendererLoadError as nativeTestRendererError }
const requireNative = createRequire(import.meta.url)

function initializeNativeTestRenderer(): NativeTestRendererConstructor | null {
  if (nativeTestRendererInitialized) {
    return NativeTestRenderer
  }

  nativeTestRendererInitialized = true
  try {
    const native = requireNative("@gpuix/native") as {
      TestGpuixRenderer?: NativeTestRendererConstructor
    }
    if (native.TestGpuixRenderer) {
      NativeTestRenderer = native.TestGpuixRenderer
      // Construct once here so availability includes native initialization, not
      // merely whether the binding exports its constructor. The first
      // TestRenderer reuses this instance.
      probedNativeTestRenderer = new native.TestGpuixRenderer()
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

export interface TestElement {
  id: number
  type: string
  style: Record<string, unknown>
  text: string | null
  events: Set<string>
  children: number[]
  parentId: number | null
  testId?: string
  /** The standard `data-testid` attribute used by the test renderer lookup. */
  dataTestId?: string
  /** The author-defined `id` attribute, distinct from the numeric renderer ID. */
  authorId?: string
  customProps?: Record<string, unknown>
}

export type TextMatcher = RegExp | string

/** Text queries over the GPU-IX desktop test renderer. */
export interface TextQueries {
  getByText: (text: TextMatcher) => TestElement
  queryByText: (text: TextMatcher) => TestElement | undefined
  getAllByText: (text: TextMatcher) => TestElement[]
}

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
    describeElement: () => '<canvas testId="recorded-frame">',
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
    const customSize = options.width !== undefined || options.height !== undefined
    if (probedNativeTestRenderer && customSize) {
      probedNativeTestRenderer.dispose()
      probedNativeTestRenderer = null
    }
    this.native =
      probedNativeTestRenderer ??
      new NativeTestRendererConstructor(options.width, options.height)
    probedNativeTestRenderer = null
  }

  /** Release this renderer's offscreen window and native GPUI context. */
  dispose(): void {
    if (this.disposed) return
    detachAnimationFrameSource(this)
    this.native.dispose()
    this.disposed = true
  }

  capabilities(): RendererCapabilities {
    return this.native.capabilities()
  }

  // ── NativeRenderer interface (all mutations delegate to native) ──

  createElement(id: number, elementType: string): void {
    this.native.createElement(id, elementType)
  }

  destroyElement(id: number): Array<number> {
    return this.native.destroyElement(id)
  }

  appendChild(parentId: number, childId: number): void {
    this.native.appendChild(parentId, childId)
  }

  removeChild(parentId: number, childId: number): void {
    this.native.removeChild(parentId, childId)
  }

  insertBefore(parentId: number, childId: number, beforeId: number): void {
    this.native.insertBefore(parentId, childId, beforeId)
  }

  setStyle(id: number, styleJson: string): void {
    this.native.setStyle(id, styleJson)
  }

  setText(id: number, content: string): void {
    this.native.setText(id, content)
  }

  setEventListener(id: number, eventType: string, hasHandler: boolean): void {
    this.native.setEventListener(id, eventType, hasHandler)
  }

  setRoot(id: number): void {
    this.native.setRoot(id)
  }

  setCustomProp(id: number, key: string, valueJson: string): void {
    this.native.setCustomProp(id, key, valueJson)
  }

  commitMutations(): void {
    this.native.commitMutations()
    this.commitCount++
  }

  applyBatch(json: string): Array<number> {
    return this.native.applyBatch(json)
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
    this.native.simulateKeystrokes(keystrokes)
    this.dispatchNativeEvents()
    this.native.flush()
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
   *  dispatch resulting events to React. */
  nativeSimulateClick(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateClick(x, y, button, modifiers)
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
   *  dispatch resulting events to React. */
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
   *  none of the GPUI build, layout and paint that follows. */
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
   *  @param button - 0=left (default), 1=middle, 2=right */
  nativeSimulateMouseDown(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseDown(x, y, button ?? 0, modifiers)
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
   *  @param button - 0=left (default), 1=middle, 2=right */
  nativeSimulateMouseUp(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseUp(x, y, button ?? 0, modifiers)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  // ── Tree inspection (queries Rust RetainedTree via napi) ────────

  /** Build a flat map of TestElements from the native tree JSON.
   *  One FFI call to get the full tree, then parse into TestElement objects. */
  private buildElementMap(): Map<number, TestElement> {
    const json = JSON.parse(this.native.getTreeJson())
    const map = new Map<number, TestElement>()
    const walk = (node: any, parentId: number | null) => {
      if (!node) return
      map.set(node.id, {
        id: node.id,
        type: node.type,
        style: node.style ?? {},
        text: node.text ?? null,
        events: new Set(node.events ?? []),
        children: (node.children ?? []).map((c: any) => c.id),
        parentId,
        ...(node.authorId ? { authorId: node.authorId } : {}),
        ...(node.dataTestId ? { dataTestId: node.dataTestId } : {}),
        ...(node.testId ? { testId: node.testId } : {}),
        ...(node.customProps ? { customProps: node.customProps } : {}),
      })
      for (const child of node.children ?? []) {
        walk(child, node.id)
      }
    }
    walk(json, null)
    return map
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

  /** Find the first text element containing the given string. */
  findByText(text: string): TestElement | undefined {
    return [...this.buildElementMap().values()].find(
      (el) => el.text != null && el.text.includes(text)
    )
  }

  findByTestId(testId: string): TestElement | undefined {
    const dataTestId = this.native.findByDataTestId(testId)
    if (dataTestId != null) return this.getElement(dataTestId)
    return [...this.buildElementMap().values()].find((el) => el.testId === testId)
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

  focusElement(elementId: number): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.dispatchNativeEvents()
  }

  // ── Scroll API ──────────────────────────────────────────────────

  /** Set the scroll offset of a scrollable element (overflow: "scroll").
   *  x and y are negative pixel values (scroll down = more negative y).
   *  Call flush() internally to apply. */
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

/** Returns every direct child, resolving the renderer's numeric element table. */
export function getChildren(renderer: TestRenderer, element: TestElement): TestElement[] {
  return element.children.map((childId) =>
    getElement(renderer, childId, `child of <${element.type}>`)
  )
}

/** Returns an element's parent from the renderer's numeric element table. */
export function getParent(renderer: TestRenderer, element: TestElement): TestElement {
  if (element.parentId === null) {
    throw new Error(`${describeElement(renderer, element)} has no parent`)
  }

  return getElement(renderer, element.parentId, `parent of ${describeElement(renderer, element)}`)
}

/** Returns an element's text, including the text rendered by every descendant. */
export function textContent(renderer: TestRenderer, element: TestElement): string {
  return `${element.text ?? ""}${getChildren(renderer, element)
    .map((child) => textContent(renderer, child))
    .join("")}`
}

export function getByText(renderer: TestRenderer, text: TextMatcher): TestElement {
  return getQueries(renderer, getRoot(renderer)).getByText(text)
}

export function queryByText(renderer: TestRenderer, text: TextMatcher): TestElement | undefined {
  return getQueries(renderer, getRoot(renderer)).queryByText(text)
}

export function getAllByText(renderer: TestRenderer, text: TextMatcher): TestElement[] {
  return getQueries(renderer, getRoot(renderer)).getAllByText(text)
}

/** Limits text queries to an element and its descendants. */
export function within(renderer: TestRenderer, element: TestElement): TextQueries {
  return getQueries(renderer, element)
}

function getQueries(renderer: TestRenderer, scope: TestElement): TextQueries {
  return {
    getByText: (text) => {
      const matches = findAllByText(renderer, scope, text)

      if (matches.length === 0) throw noMatchError(renderer, scope, text)
      if (matches.length > 1) throw multipleMatchesError(renderer, text, matches)

      const [match] = matches
      if (match === undefined) throw noMatchError(renderer, scope, text)

      return match
    },
    queryByText: (text) => {
      const matches = findAllByText(renderer, scope, text)

      if (matches.length > 1) throw multipleMatchesError(renderer, text, matches)

      return matches[0]
    },
    getAllByText: (text) => {
      const matches = findAllByText(renderer, scope, text)

      if (matches.length === 0) throw noMatchError(renderer, scope, text)

      return matches
    },
  }
}

function findAllByText(
  renderer: TestRenderer,
  scope: TestElement,
  text: TextMatcher
): TestElement[] {
  return getElements(renderer, scope).filter(
    (element) =>
      matchesText(textContent(renderer, element), text) &&
      !hasMatchingChild(renderer, element, text)
  )
}

function hasMatchingChild(
  renderer: TestRenderer,
  element: TestElement,
  text: TextMatcher
): boolean {
  return getChildren(renderer, element).some((child) =>
    matchesText(textContent(renderer, child), text)
  )
}

function getElements(renderer: TestRenderer, scope: TestElement): TestElement[] {
  return [scope, ...getChildren(renderer, scope).flatMap((child) => getElements(renderer, child))]
}

function getRoot(renderer: TestRenderer): TestElement {
  const root = renderer.getRoot()
  if (root === undefined) throw missingRootError()

  return root
}

function getElement(renderer: TestRenderer, id: number, relationship: string): TestElement {
  const element = renderer.getElement(id)
  if (element === undefined) throw missingElementError(id, relationship)

  return element
}

function matchesText(content: string, text: TextMatcher): boolean {
  if (!(text instanceof RegExp)) return content === text

  text.lastIndex = 0
  const matches = text.test(content)
  text.lastIndex = 0
  return matches
}

function noMatchError(renderer: TestRenderer, scope: TestElement, text: TextMatcher): Error {
  const nearMisses = getElements(renderer, scope)
    .map((element) => ({ element, content: textContent(renderer, element) }))
    .filter(({ element, content }) => element.text !== null && content.length > 0)
    .slice(0, 5)
    .map(({ element }) => `  ${describeElement(renderer, element)}`)
  const nearby =
    nearMisses.length === 0 ? "No text was rendered in this scope." : nearMisses.join("\n")

  return new Error(
    `Unable to find an element with text ${describeMatcher(text)} within ${describeElement(renderer, scope)}. Near misses:\n${nearby}`
  )
}

function multipleMatchesError(
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

function describeElement(renderer: TestRenderer, element: TestElement): string {
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

function describeMatcher(text: TextMatcher): string {
  return text instanceof RegExp ? text.toString() : JSON.stringify(text)
}

function missingRootError(): Error {
  return new Error("Unable to search rendered text because the renderer has no root element")
}

function missingElementError(id: number, relationship: string): Error {
  return new Error(`Unable to find ${relationship}: element #${id} is absent`)
}

export interface TestRoot {
  root: Root
  renderer: TestRenderer
  render: (node: ReactNode) => void
  unmount: () => void
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
 * Pass `width` / `height` to size the offscreen window. The 1280x800 default is
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
    unmount,
  }
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
      let state = testRoot.renderer.getCanvasState(element.id)
      const pause = new Int32Array(new SharedArrayBuffer(4))
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if (state?.loadedImageCount === images.length) break
        Atomics.wait(pause, 0, 0, 4)
        testRoot.renderer.flush()
        state = testRoot.renderer.getCanvasState(element.id)
      }
      if (state?.loadedImageCount !== images.length) {
        throw new Error(
          `Canvas scene ${JSON.stringify(resolved.name)} loaded ` +
            `${state?.loadedImageCount ?? 0}/${images.length} image fixtures`
        )
      }
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
