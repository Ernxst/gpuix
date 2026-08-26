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

import type { ReactNode } from "react"
import type { EventPayload, MenuSpec } from "@gpuix/native"
import {
  normalizeScrollWheelOptions,
  type NativeScrollWheelOptions,
  type ScrollWheelInput,
} from "./automation/client.js"
import type {
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  HighlightMatch,
  NativeRenderer,
  StyleDesc,
  StyleDiagnostic,
} from "./types/host.js"
import { createRoot, flushSync, type Root } from "./reconciler/reconciler.js"
import { handleGpuixEvent } from "./reconciler/event-registry.js"
export {
  applyMacCpuThrottleFromEnv,
  MAC_CPU_THROTTLES,
  readMacCpuThrottle,
} from "./cpu-throttle.js"
export type { MacCpuThrottle } from "./cpu-throttle.js"

interface NativeTestRendererApi extends NativeRenderer {
  dispose(): void
  applyBatch(json: string): number[]
  flush(): void
  advanceAsyncClock(deltaMs: number): void
  setReducedMotion(enabled: boolean): void
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
  getAutomationTree(): string
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
  scrollToItem(elementId: number, index: number): void
  getScrollOffset(elementId: number): number[] | null
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

// ── TestRenderer ─────────────────────────────────────────────────────

export class TestRenderer implements NativeRenderer {
  commitCount = 0
  private disposed = false
  private applicationEventHandler: ((event: EventPayload) => void) | null = null
  private windowEventHandler: ((event: EventPayload) => void) | null = null

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
    this.native.dispose()
    this.disposed = true
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

  /** Advance GPUI timers and, when paused, the native animation frame clock. */
  advanceAsyncClock(deltaMs: number): void {
    this.native.advanceAsyncClock(deltaMs)
  }

  /** Override GPUI's reduced-motion policy for deterministic tests. */
  setReducedMotion(enabled: boolean): void {
    this.native.setReducedMotion(enabled)
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

  /** Scroll a child into view by its index in the children list. */
  scrollToItem(elementId: number, index: number): void {
    this.native.flush()
    this.native.scrollToItem(elementId, index)
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

  getWindowSize(): { width: number; height: number; scaleFactor: number } {
    return this.native.getWindowSize!()
  }

  isActive(): boolean {
    return this.native.isActive!()
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
  renderer.setAllowPrivateNetworkImages(options.allowPrivateNetworkImages ?? false)
  const root = createRoot(renderer)
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
