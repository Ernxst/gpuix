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
import type { MutationTuple } from "./reconciler/batch-renderer.js"
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
  focusElement(elementId: number): void
  getActiveElement(): number | null
  blur(): void
  resolveTabKeyDown(defaultPrevented: boolean): void
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
export type TestIdMatcher = RegExp | string
export type AccessibleNameMatcher =
  | RegExp
  | string
  | ((accessibleName: string, element: TestElement) => boolean)

export interface ByRoleOptions {
  name?: AccessibleNameMatcher
  level?: number
  /** Defaults to false. `true` awaits native hidden-node snapshot support. */
  hidden?: boolean
}

/** Text queries over the GPU-IX desktop test renderer. */
export interface TextQueries {
  getByText: (text: TextMatcher) => TestElement
  queryByText: (text: TextMatcher) => TestElement | null
  getAllByText: (text: TextMatcher) => TestElement[]
  queryAllByText: (text: TextMatcher) => TestElement[]
}

/** Test ID queries over the GPU-IX desktop test renderer. */
export interface TestIdQueries {
  getByTestId: (testId: TestIdMatcher) => TestElement
  queryByTestId: (testId: TestIdMatcher) => TestElement | null
  getAllByTestId: (testId: TestIdMatcher) => TestElement[]
  queryAllByTestId: (testId: TestIdMatcher) => TestElement[]
}

/** Computed accessibility-tree queries over the GPU-IX desktop test renderer. */
export interface RoleQueries {
  getByRole: (role: string, options?: ByRoleOptions) => TestElement
  queryByRole: (role: string, options?: ByRoleOptions) => TestElement | null
  getAllByRole: (role: string, options?: ByRoleOptions) => TestElement[]
  queryAllByRole: (role: string, options?: ByRoleOptions) => TestElement[]
}

export interface TestQueries extends TextQueries, TestIdQueries, RoleQueries {}

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

  // Keep direct mutation methods at runtime for one compatibility release.

  private applyCompatibilityMutation(mutation: MutationTuple): Array<number> {
    const destroyedIds = this.native.applyBatch(JSON.stringify([mutation]))
    this.invalidateElementMap()
    return destroyedIds
  }

  createElement(id: number, elementType: string): void {
    this.applyCompatibilityMutation(["createElement", id, elementType])
  }

  destroyElement(id: number): Array<number> {
    return this.applyCompatibilityMutation(["destroyElement", id])
  }

  appendChild(parentId: number, childId: number): void {
    this.applyCompatibilityMutation(["appendChild", parentId, childId])
  }

  removeChild(_parentId: number, childId: number): void {
    // The atomic transport intentionally has no detach-only operation because
    // React removals now own and destroy the removed subtree.
    this.applyCompatibilityMutation(["destroyElement", childId])
  }

  insertBefore(parentId: number, childId: number, beforeId: number): void {
    this.applyCompatibilityMutation(["insertBefore", parentId, childId, beforeId])
  }

  setStyle(id: number, styleJson: string): void {
    this.applyCompatibilityMutation(["setStyle", id, styleJson])
  }

  setText(id: number, content: string): void {
    this.applyCompatibilityMutation(["setText", id, content])
  }

  setEventListener(id: number, eventType: string, hasHandler: boolean): void {
    this.applyCompatibilityMutation(["setEventListener", id, eventType, hasHandler])
  }

  setRoot(id: number): void {
    this.applyCompatibilityMutation(["setRoot", id])
  }

  setCustomProp(id: number, key: string, valueJson: string): void {
    const value = JSON.parse(valueJson) as MutationTuple[number]
    this.applyCompatibilityMutation(["setCustomPropValue", id, key, value])
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
   *  dispatch resulting events to React. */
  nativeSimulateClick(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateClick(x, y, button, modifiers)
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
    if (this.elementMap) return this.elementMap

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
    // The snapshot is shared across queries until the next mutation, so freeze
    // it: a consumer test mutating a returned TestElement would otherwise
    // silently corrupt every later static-tree query instead of failing loudly.
    for (const element of map.values()) {
      Object.freeze(element.style)
      Object.freeze(element.events)
      Object.freeze(element.children)
      if (element.customProps) Object.freeze(element.customProps)
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

  /** Advance GPUI's test dispatcher and run due timers.
   *  This is not `clockFastForward`. That moves the motion clock only.
   *  Use this for caret blink, input drag autoscroll, and list edge scroll. */
  advanceTime(milliseconds: number): void {
    this.native.advanceTime(milliseconds)
    this.dispatchNativeEvents()
  }

  focusElement(elementId: number): void {
    this.native.flush()
    this.native.focusElement(elementId)
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

  resolveTabKeyDown(defaultPrevented: boolean): void {
    this.native.resolveTabKeyDown(defaultPrevented)
    // Production reports the resulting focus transition on a later frame.
    // Draw it now so the enclosing drain loop observes blur/focus in order.
    this.native.flush()
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

function getQueries(
  renderer: TestRenderer,
  resolveScope: () => TestElement,
  includeScope: boolean
): TestQueries {
  return {
    getByText: (text) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope)

      if (matches.length === 0) throw noTextMatchError(renderer, scope, text, includeScope)
      if (matches.length > 1) throw multipleTextMatchesError(renderer, text, matches)

      const [match] = matches
      if (match === undefined) throw noTextMatchError(renderer, scope, text, includeScope)

      return match
    },
    queryByText: (text) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope)

      if (matches.length > 1) throw multipleTextMatchesError(renderer, text, matches)

      return matches[0] ?? null
    },
    getAllByText: (text) => {
      const scope = resolveScope()
      const matches = findAllByText(renderer, scope, text, includeScope)

      if (matches.length === 0) throw noTextMatchError(renderer, scope, text, includeScope)

      return matches
    },
    queryAllByText: (text) => findAllByText(renderer, resolveScope(), text, includeScope),
    getByTestId: (testId) => {
      const scope = resolveScope()
      const matches = findAllByTestId(renderer, scope, testId, includeScope)

      if (matches.length === 0) throw noTestIdMatchError(renderer, scope, testId)
      if (matches.length > 1) throw multipleTestIdMatchesError(renderer, testId, matches)

      const [match] = matches
      if (match === undefined) throw noTestIdMatchError(renderer, scope, testId)

      return match
    },
    queryByTestId: (testId) => {
      const matches = findAllByTestId(renderer, resolveScope(), testId, includeScope)

      if (matches.length > 1) throw multipleTestIdMatchesError(renderer, testId, matches)

      return matches[0] ?? null
    },
    getAllByTestId: (testId) => {
      const scope = resolveScope()
      const matches = findAllByTestId(renderer, scope, testId, includeScope)

      if (matches.length === 0) throw noTestIdMatchError(renderer, scope, testId)

      return matches
    },
    queryAllByTestId: (testId) => findAllByTestId(renderer, resolveScope(), testId, includeScope),
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
  }
}

function findAllByText(
  renderer: TestRenderer,
  scope: TestElement,
  text: TextMatcher,
  includeScope: boolean
): TestElement[] {
  return getElements(renderer, scope, includeScope).filter(
    (element) =>
      matchesText(textContent(renderer, element), text) &&
      !hasMatchingChild(renderer, element, text)
  )
}

function findAllByTestId(
  renderer: TestRenderer,
  scope: TestElement,
  testId: TestIdMatcher,
  includeScope: boolean
): TestElement[] {
  return getElements(renderer, scope, includeScope).filter(
    (element) =>
      (element.dataTestId !== undefined && matchesTestId(element.dataTestId, testId)) ||
      (element.testId !== undefined && matchesTestId(element.testId, testId))
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
  scope: TestElement,
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
        matchesAccessibleName(candidate.name, options.name, candidate.element)
    )
    .map((candidate) => candidate.element)
}

function accessibleHosts(
  renderer: TestRenderer,
  scope: TestElement,
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

function matchesAccessibleName(
  accessibleName: string,
  matcher: AccessibleNameMatcher,
  element: TestElement
): boolean {
  if (typeof matcher === "function") return matcher(accessibleName, element)
  if (!(matcher instanceof RegExp)) return accessibleName === matcher

  matcher.lastIndex = 0
  const matches = matcher.test(accessibleName)
  matcher.lastIndex = 0
  return matches
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

function getElements(renderer: TestRenderer, scope: TestElement, includeScope = true): TestElement[] {
  return [
    ...(includeScope ? [scope] : []),
    ...getChildren(renderer, scope).flatMap((child) => getElements(renderer, child)),
  ]
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

function matchesTestId(value: string, testId: TestIdMatcher): boolean {
  if (!(testId instanceof RegExp)) return value === testId

  testId.lastIndex = 0
  const matches = testId.test(value)
  testId.lastIndex = 0
  return matches
}

function noTextMatchError(
  renderer: TestRenderer,
  scope: TestElement,
  text: TextMatcher,
  includeScope: boolean
): Error {
  const nearMisses = getElements(renderer, scope, includeScope)
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
  scope: TestElement,
  testId: TestIdMatcher
): Error {
  return new Error(
    `Unable to find an element with test ID ${describeMatcher(testId)} within ${describeElement(renderer, scope)}`
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
  scope: TestElement,
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
    `Unable to find an accessible element with the role ${JSON.stringify(role)}${describeRoleOptions(options)} within ${describeElement(renderer, scope)}.\n\nHere are the accessible roles:\n\n${available}`
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

function describeElement(renderer: TestRenderer, element: TestElement): string {
  const identity = [
    element.dataTestId === undefined ? undefined : `data-testid=${JSON.stringify(element.dataTestId)}`,
    element.testId === undefined ? undefined : `testId=${JSON.stringify(element.testId)}`,
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

export interface TestRoot extends TestQueries {
  root: Root
  renderer: TestRenderer
  render: (node: ReactNode) => void
  within: (element: TestElement) => TestQueries
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
  const queries = getQueries(renderer, () => getRoot(renderer), true)
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
