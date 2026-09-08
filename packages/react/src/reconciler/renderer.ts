import React, { type ReactNode } from "react"
import { GpuixRenderer } from "@gpuix/native"
import type { EventPayload, MenuSpec, WindowOptions } from "@gpuix/native"
import { createRoot, flushSync, strictStylesDefault, type Root } from "./reconciler.js"
import type { DebugFrameOverlayMode, NativeRenderer } from "../types/host.js"
import { handleGpuixEvent } from "./event-registry.js"
import {
  attachAnimationFrameSource,
  detachAnimationFrameSource,
} from "../frame-clock.js"
import {
  App as AutomationApp,
  browserRendererAsTest,
  InProcessBackend,
  liveRendererAsTest,
  serveAutomationStdio,
  type LiveAutomationRenderer,
} from "../automation/client.js"

export { createRoot, flushSync, reconciler } from "./reconciler.js"
export type { Root } from "./reconciler.js"

export function createRenderer(
  onEvent?: (event: import("@gpuix/native").EventPayload) => void
): GpuixRenderer {
  const renderer = new GpuixRenderer((err, event) => {
    if (err) {
      console.error("[GPUIX] Native event error:", err)
      return
    }
    if (event) {
      handleGpuixEvent(event, renderer)
      if (onEvent) {
        onEvent(event)
      }
    }
  })
  // A pipe means a controller owns stdin. A TTY is a human keyboard.
  if (typeof process !== "undefined" && process.stdin && !process.stdin.isTTY) {
    const init = renderer.init.bind(renderer)
    renderer.init = (options) => {
      init(options)
      enableAutomation(renderer)
    }
  }
  return renderer
}

/** Timer cadence for platforms without native frame requests and for the
 *  embedded macOS idle-wake fallback while its display link is stopped. */
const DEFAULT_FRAME_MS = 8
const DEFAULT_MAX_CONSECUTIVE_TICK_ERRORS = 3
const TERMINATION_CLEANUP_TIMEOUT_MS = 5_000

export interface FrameLoop {
  stop: () => void
}

export interface FrameLoopOptions {
  /** Cadence for the capability fallback or the idle pump that cannot release frame tokens. */
  frameMs?: number
  onTerminated?: () => void
  onError?: (error: unknown) => void
  onUnrecoverableError?: (error: unknown) => void
  maxConsecutiveTickErrors?: number
}

/**
 * Drive GPUI until the last window closes, using a native display link when available.
 *
 * On Windows and Linux, GPUI owns a blocking event loop on a Rust UI thread,
 * so timer ticks only observe whether that thread is still running. They do
 * not pump the platform loop or request frames.
 *
 * On macOS, a coalesced native callback asks JavaScript for one AppKit pump per
 * display-link request. A separate timer pump cannot dispatch frame tokens; it
 * only keeps input, menus, occluded windows, and termination responsive.
 *
 * Both sources enter the same tick/error/termination path. Timer ticks schedule
 * only after the previous pump finishes, so failures recover without piling up.
 *
 * `tick()` returning false means the last window closed. The loop stops and
 * `onTerminated` runs. `render()` uses that to unmount React and finish cleanup.
 */
export function enableAutomation(renderer: LiveAutomationRenderer): void {
  serveAutomationStdio(new InProcessBackend(liveRendererAsTest(renderer)))
}

export function startFrameLoop(
  renderer: Pick<GpuixRenderer, "capabilities" | "tick"> &
    Partial<Pick<GpuixRenderer, "quit" | "setFrameRequestHandler" | "tickIdle">>,
  options: FrameLoopOptions = {}
): FrameLoop {
  const frameClock = renderer.capabilities().frameClock
  if (!frameClock.requiresTick) {
    return { stop: () => {} }
  }

  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let nativeFrameSource = false
  let consecutiveFrameTickErrors = 0
  let consecutiveIdleTickErrors = 0
  const maxConsecutiveTickErrors = Math.max(
    1,
    options.maxConsecutiveTickErrors ?? DEFAULT_MAX_CONSECUTIVE_TICK_ERRORS
  )

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (nativeFrameSource) {
      renderer.setFrameRequestHandler?.(null)
    }
  }

  const scheduleTimer = (callback: () => void, delayMs: number): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(callback, delayMs)
  }

  const drive = (source: "native" | "idle" | "timer"): void => {
    if (stopped) return
    if (timer !== null) clearTimeout(timer)
    timer = null
    const started = performance.now()
    let running: boolean | void = true
    try {
      running = source === "idle" ? renderer.tickIdle?.() : renderer.tick()
      if (source === "idle") {
        consecutiveIdleTickErrors = 0
      } else {
        consecutiveFrameTickErrors = 0
      }
    } catch (error) {
      const consecutiveTickErrors =
        source === "idle"
          ? (consecutiveIdleTickErrors += 1)
          : (consecutiveFrameTickErrors += 1)
      console.error("[gpuix] native frame tick failed", error)
      try {
        options.onError?.(error)
      } catch (reportingError) {
        console.error("[gpuix] frame-loop error reporter failed", reportingError)
      }

      if (consecutiveTickErrors >= maxConsecutiveTickErrors) {
        stop()
        try {
          renderer.quit?.()
        } catch (quitError) {
          console.error("[gpuix] failed to quit after repeated tick errors", quitError)
        }
        if (options.onUnrecoverableError) {
          options.onUnrecoverableError(error)
        } else {
          queueMicrotask(() => {
            throw error
          })
        }
        return
      }
    }
    if (running === false) {
      stop()
      options.onTerminated?.()
      return
    }

    const wait = Math.max(0, frameMs - (performance.now() - started))
    scheduleTimer(() => drive(nativeFrameSource ? "idle" : "timer"), wait)
  }

  if (frameClock.externalFrame && renderer.setFrameRequestHandler && renderer.tickIdle) {
    try {
      nativeFrameSource = renderer.setFrameRequestHandler(() => drive("native"))
    } catch (error) {
      console.error("[gpuix] failed to install native frame requests", error)
      try {
        options.onError?.(error)
      } catch (reportingError) {
        console.error("[gpuix] frame-loop error reporter failed", reportingError)
      }
    }
  }

  if (nativeFrameSource) {
    scheduleTimer(() => drive("idle"), frameMs)
  } else {
    drive("timer")
  }

  return { stop }
}

const RENDER_HOST_KEY = "__gpuixRenderHost"
const BROWSER_AUTOMATION_KEY = "gpuix"

declare global {
  var gpuix: AutomationApp | undefined
}

export function installBrowserAutomation(
  renderer: LiveAutomationRenderer
): AutomationApp {
  const existing = Reflect.get(globalThis, BROWSER_AUTOMATION_KEY)
  if (existing instanceof AutomationApp) return existing

  const automation = new AutomationApp(
    new InProcessBackend(browserRendererAsTest(renderer))
  )
  Reflect.set(globalThis, BROWSER_AUTOMATION_KEY, automation)
  return automation
}

type RenderSlot = {
  renderer?: NativeRenderer
  root?: Root
  loop?: FrameLoop
  onEvent?: (event: EventPayload) => void
  onMenuAction?: (event: MenuActionEvent) => void
  onTerminated?: () => void | Promise<void>
  termination?: Promise<TerminationOutcome>
  processExitScheduled?: boolean
  fatal: boolean
  /** Set once, when `slot.renderer` is first installed: true for a renderer
   *  `render()` created itself, false for one passed in through the `renderer`
   *  option. `errorOverlay` is keyed off this rather than the current call's
   *  `renderer` argument, so a later `render()` call that omits `renderer`
   *  (a remount against the same embedder-owned instance) cannot turn the
   *  overlay on for a renderer the embedder still owns. */
  ownsRenderer?: boolean
  /** Resolved once per `render()` call; false unless `ownsRenderer` is true,
   *  since an embedder-owned renderer keeps that lifecycle to itself. */
  errorOverlay: boolean
  /** True from the moment the overlay root starts mounting until a normal
   *  `render()` (including Reload) replaces it. Guards a second unrelated
   *  failure from re-entering the overlay branch while it is already up. */
  overlayActive: boolean
  /** What Reload remounts: the arguments of the most recent `render()` call. */
  lastNode?: ReactNode
  lastOptions?: RenderOptions
  processHandlers?: {
    uncaughtException: (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void
    unhandledRejection: (reason: unknown) => void
  }
}

interface TerminationOutcome {
  clean: boolean
}

export interface MenuActionEvent {
  id: string
}

function renderSlot(): RenderSlot {
  const existing = Reflect.get(globalThis, RENDER_HOST_KEY)
  if (existing) {
    return existing
  }
  const created: RenderSlot = { fatal: false, errorOverlay: false, overlayActive: false }
  Reflect.set(globalThis, RENDER_HOST_KEY, created)
  return created
}

export interface RenderOptions extends WindowOptions {
  onEvent?: (event: EventPayload) => void
  onMenuAction?: (event: MenuActionEvent) => void
  /** Runs once after menu Quit, explicit quit, last-window close, or an owned renderer's fatal error. */
  onTerminated?: () => void | Promise<void>
  renderer?: NativeRenderer
  /** GPUI scene overlay. Does not go through React or layout. */
  debugFrameOverlay?: DebugFrameOverlayMode
  /** Reject invalid fields and emit actionable diagnostics. Defaults on in non-production Node runtimes. */
  strictStyles?: boolean
  /**
   * Show a full-window "Runtime error" panel instead of quitting when an owned
   * renderer's root dies, the process hits an uncaught exception or unhandled
   * rejection, or an event handler throws. Defaults on in non-production Node
   * runtimes, the same predicate `strictStyles` defaults from (also off in a
   * Bun standalone executable). Ignored for an injected `renderer`: the
   * embedder owns that lifecycle and already decides whether to recover,
   * unmount, or exit from the failed root it observes. While the overlay is
   * showing, an unrelated failure is logged and otherwise ignored rather than
   * torn down further; only a failure of the overlay itself is fatal.
   */
  errorOverlay?: boolean
}

export function resetRender(): void {
  const slot = Reflect.get(globalThis, RENDER_HOST_KEY) as RenderSlot | undefined
  removeProcessTerminationGuards(slot)
  slot?.loop?.stop()
  if (slot?.renderer) detachAnimationFrameSource(slot.renderer)
  slot?.renderer?.setApplicationEventHandler?.(null)
  slot?.root?.unmount()
  const automation = Reflect.get(globalThis, BROWSER_AUTOMATION_KEY)
  void automation?.close()
  Reflect.deleteProperty(globalThis, BROWSER_AUTOMATION_KEY)
  Reflect.deleteProperty(globalThis, RENDER_HOST_KEY)
}

function dispatchApplicationEvent(slot: RenderSlot, event: EventPayload): void {
  if (event.eventType === "menuAction" && event.value) {
    slot.onMenuAction?.({ id: event.value })
  } else if (event.eventType === "terminated") {
    finishNativeTermination(slot)
  }
  slot.onEvent?.(event)
}

function removeProcessTerminationGuards(slot: RenderSlot | undefined): void {
  if (!slot?.processHandlers || typeof process === "undefined") return
  process.off("uncaughtException", slot.processHandlers.uncaughtException)
  process.off("unhandledRejection", slot.processHandlers.unhandledRejection)
  slot.processHandlers = undefined
}

function terminateRenderSlot(
  slot: RenderSlot,
  options: { quit?: boolean } = {}
): Promise<TerminationOutcome> {
  if (slot.termination) return slot.termination

  let completeTermination!: (outcome: TerminationOutcome) => void
  const termination = new Promise<TerminationOutcome>((resolve) => {
    completeTermination = resolve
  })
  // Publish the promise before cleanup so any re-entrant native termination
  // delivery shares this work instead of running it twice.
  slot.termination = termination

  slot.loop?.stop()
  slot.loop = undefined
  if (slot.renderer) detachAnimationFrameSource(slot.renderer)
  removeProcessTerminationGuards(slot)
  let clean = true

  const root = slot.root
  slot.root = undefined
  if (root) {
    try {
      root.unmount()
    } catch (error) {
      clean = false
      console.error("[gpuix] React unmount failed during termination", error)
    }
  }

  if (options.quit) {
    try {
      slot.renderer?.quit?.()
    } catch (error) {
      clean = false
      console.error("[gpuix] native quit failed during termination", error)
    }
  }

  let cleanup: void | Promise<void> = undefined
  try {
    cleanup = slot.onTerminated?.()
  } catch (error) {
    clean = false
    console.error("[gpuix] onTerminated failed", error)
  }
  void Promise.resolve(cleanup).then(
    () => completeTermination({ clean }),
    (error) => {
      clean = false
      console.error("[gpuix] onTerminated rejected", error)
      completeTermination({ clean })
    }
  )
  return termination
}

function exitAfterTermination(
  slot: RenderSlot,
  termination: Promise<TerminationOutcome>,
  forcedExitCode?: number
): void {
  if (slot.processExitScheduled || typeof process === "undefined") return
  slot.processExitScheduled = true
  process.exitCode = forcedExitCode ?? 0

  const timeout = setTimeout(() => {
    console.error("[gpuix] termination cleanup timed out; forcing process exit")
    process.exit(1)
  }, TERMINATION_CLEANUP_TIMEOUT_MS)
  timeout.unref?.()

  void termination.then(({ clean }) => {
    clearTimeout(timeout)
    process.exit(forcedExitCode ?? (clean ? 0 : 1))
  })
}

function finishNativeTermination(slot: RenderSlot): void {
  const termination = terminateRenderSlot(slot)
  if (slot.renderer instanceof GpuixRenderer) {
    exitAfterTermination(slot, termination)
  }
}

function terminateFatally(slot: RenderSlot, error: unknown, origin: string): void {
  slot.fatal = true
  console.error(`[gpuix] fatal JavaScript error (${origin}); quitting native application`, error)
  const termination = terminateRenderSlot(slot, { quit: true })
  exitAfterTermination(slot, termination, 1)
}

function stringifyThrown(thrown: unknown): string {
  try {
    return String(thrown)
  } catch {
    return "Unknown error"
  }
}

function formatRuntimeError(
  error: unknown,
  componentStack?: string | null
): { message: string; stack: string } {
  let message: string
  let stack: string
  if (error instanceof Error) {
    message = error.message || error.name
    stack = error.stack ?? `${error.name}: ${error.message}`
  } else {
    message = typeof error === "string" ? error : stringifyThrown(error)
    stack = message
  }
  if (!message) message = "Unknown error"
  const extra = componentStack?.trim()
  if (extra && !stack.includes(extra)) stack = `${stack}\n${extra}`
  if (!stack.includes(message)) stack = `${message}\n${stack}`
  return { message, stack }
}

/** The overlay's element tree, built directly against gpuix host elements
 *  rather than through a component module — it has to render with nothing
 *  else (including the app's own tree) still standing. */
function runtimeErrorOverlay(
  error: { message: string; stack: string },
  onReload: () => void
): ReactNode {
  const lines = error.stack.length === 0 ? [error.message] : error.stack.split("\n")
  return React.createElement(
    "div",
    {
      "data-testid": "runtime-error-overlay",
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 32,
        gap: 16,
        backgroundColor: "#1c0b0b",
      },
    },
    React.createElement(
      "text",
      { style: { fontSize: 22, fontWeight: 700, color: "#f87171" } },
      "Runtime error"
    ),
    React.createElement(
      "div",
      {
        "data-testid": "runtime-error-stack",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          overflowY: "scroll",
          gap: 2,
        },
      },
      ...lines.map((line) =>
        React.createElement(
          "text",
          { style: { fontSize: 13, color: "#fecaca" } },
          line === "" ? " " : line
        )
      )
    ),
    React.createElement(
      "div",
      {
        "data-testid": "runtime-error-reload",
        role: "button",
        onClick: onReload,
        style: {
          alignSelf: "flex-start",
          padding: 10,
          paddingLeft: 16,
          paddingRight: 16,
          borderRadius: 8,
          backgroundColor: "#7f1d1d",
          hover: { backgroundColor: "#991b1b" },
        },
      },
      React.createElement(
        "text",
        { style: { fontSize: 14, fontWeight: 600, color: "#fee2e2" } },
        "Reload"
      )
    )
  )
}

/** Reload re-mounts the app exactly as a fresh `render()` call would: the
 *  overlay root is unmounted, the frame loop restarts, and event/menu
 *  handlers are reinstalled from the recorded options. */
function reloadApp(slot: RenderSlot): void {
  if (slot.lastNode === undefined || !slot.lastOptions || slot.termination) return
  render(slot.lastNode, slot.lastOptions)
}

/** Unmount the dead root and mount a fresh overlay root in its place. Thrown
 *  synchronously back to `handleFatalRenderError`, which falls back to the
 *  fatal path; a failure of the overlay root itself goes fatal from its own
 *  `onUncaughtError` below instead, since by then this call has returned. */
function showRuntimeErrorOverlay(
  slot: RenderSlot,
  error: unknown,
  componentStack?: string | null
): void {
  const host = slot.renderer
  if (!host) throw new Error("GPUIX renderer is not initialized")
  const formatted = formatRuntimeError(error, componentStack)
  slot.root?.unmount()
  slot.overlayActive = true
  let overlayRoot!: Root
  overlayRoot = createRoot(host, {
    onUncaughtError: ({ error: overlayError }) => {
      queueMicrotask(() => {
        if (slot.root !== overlayRoot || slot.fatal) return
        terminateFatally(slot, overlayError, "runtime error overlay")
      })
    },
  })
  slot.root = overlayRoot
  flushSync(() => {
    overlayRoot.render(runtimeErrorOverlay(formatted, () => reloadApp(slot)))
  })
}

function handleFatalRenderError(
  slot: RenderSlot,
  error: unknown,
  origin: string,
  componentStack?: string | null
): void {
  if (slot.fatal) return
  if (slot.overlayActive) {
    console.error(
      `[gpuix] JavaScript error (${origin}) while the runtime error overlay is showing; ignoring`,
      error
    )
    return
  }
  // Only an owned, still-alive renderer gets an overlay: an injected renderer
  // never sets slot.errorOverlay, and every call site here already excludes
  // injected renderers by construction (see the onUncaughtError and
  // startFrameLoop wiring in render(), and the process guards installed only
  // for an owned renderer).
  if (slot.errorOverlay && slot.renderer && !slot.termination) {
    console.error(`[gpuix] JavaScript error (${origin}); showing runtime error overlay`, error)
    try {
      showRuntimeErrorOverlay(slot, error, componentStack)
      return
    } catch (overlayError) {
      slot.overlayActive = false
      console.error("[gpuix] failed to show runtime error overlay", overlayError)
    }
  }
  terminateFatally(slot, error, origin)
}

function installProcessTerminationGuards(slot: RenderSlot): void {
  if (slot.processHandlers || typeof process === "undefined") return

  const uncaughtException = (
    error: Error,
    origin: NodeJS.UncaughtExceptionOrigin
  ): void => handleFatalRenderError(slot, error, origin)
  const unhandledRejection = (reason: unknown): void =>
    handleFatalRenderError(slot, reason, "unhandledRejection")
  process.on("uncaughtException", uncaughtException)
  process.on("unhandledRejection", unhandledRejection)
  slot.processHandlers = { uncaughtException, unhandledRejection }
}

/** Mount the app. Under `bun --hot`, later calls remount on the same native window. */
export function render(node: ReactNode, options: RenderOptions = {}): Root {
  const {
    onEvent,
    onMenuAction,
    onTerminated,
    renderer: injected,
    debugFrameOverlay,
    menus,
    strictStyles,
    errorOverlay,
    ...windowOptions
  } = options
  const slot = renderSlot()
  const remount = slot.root != null
  if (slot.termination) {
    throw new Error("GPUIX renderer has terminated and cannot be remounted")
  }
  slot.onEvent = onEvent
  slot.onMenuAction = onMenuAction
  slot.onTerminated = onTerminated
  slot.overlayActive = false
  slot.lastNode = node
  slot.lastOptions = options
  if (!slot.renderer) {
    if (injected) {
      slot.renderer = injected
      slot.ownsRenderer = false
    } else {
      const renderer = createRenderer((event) => dispatchApplicationEvent(slot, event))
      renderer.init({
        ...windowOptions,
        ...(menus === undefined ? {} : { menus }),
      })
      slot.renderer = renderer
      slot.ownsRenderer = true
      installProcessTerminationGuards(slot)
      console.log("[gpuix] created native window")
    }
  }
  slot.errorOverlay = slot.ownsRenderer ? (errorOverlay ?? strictStylesDefault()) : false
  const host = slot.renderer
  if (!host) {
    throw new Error("GPUIX renderer is not initialized")
  }
  const browserFrameSource = Reflect.get(globalThis, "requestAnimationFrame")
  if (host.requestFrame) {
    const requestFrame = host.requestFrame.bind(host)
    attachAnimationFrameSource({
      owner: host,
      request: requestFrame,
    })
  } else if (typeof browserFrameSource !== "function") {
    throw new Error("The GPUIX renderer does not provide a display-paced frame clock")
  }
  host.setApplicationEventHandler?.((event) => dispatchApplicationEvent(slot, event))
  if (menus !== undefined && (injected || remount)) {
    if (!host.setMenus) {
      throw new Error("The injected GPUIX renderer does not support application menus")
    }
    host.setMenus(menus as MenuSpec[])
  }
  if (
    typeof window !== "undefined" &&
    host instanceof GpuixRenderer &&
    !Reflect.has(globalThis, BROWSER_AUTOMATION_KEY)
  ) {
    installBrowserAutomation(host)
  }
  if (debugFrameOverlay) {
    host.setDebugFrameOverlay?.(debugFrameOverlay)
  }
  if (slot.root) {
    console.log("[gpuix] remount: unmount previous tree")
    slot.root.unmount()
  }
  let root!: Root
  root = createRoot(host, {
    strictStyles,
    onUncaughtError: ({ error, componentStack }) => {
      // Injected renderers are embedder-owned lifecycles: the failed root and
      // renderer diagnostic are the recovery signal, and the embedder decides
      // whether to unmount, recover, or exit its process.
      if (injected) return
      // React 19 reports this from its commit path instead of rethrowing it,
      // so neither flushSync's catch nor the process guards can observe it.
      queueMicrotask(() => {
        if (slot.root !== root) return
        handleFatalRenderError(slot, error, "uncaught React root error", componentStack)
      })
    },
  })
  slot.root = root
  try {
    flushSync(() => {
      root.render(node)
    })
  } catch (error) {
    void terminateRenderSlot(slot, { quit: !injected })
    throw error
  }
  // Started even for a root that just failed: a render-phase failure (an
  // uncaught error or strict-styles rejection during this very
  // `root.render(node)`) needs the loop alive to pump input and repaint
  // before the overlay it is about to show can do anything.
  if (!injected && slot.renderer instanceof GpuixRenderer) {
    const native = slot.renderer
    slot.loop?.stop()
    slot.loop = startFrameLoop(native, {
      onTerminated: () => {
        finishNativeTermination(slot)
      },
      // A broken native tick loop cannot paint an overlay either, so this
      // always goes fatal rather than through handleFatalRenderError.
      onUnrecoverableError: (error) => {
        if (!slot.fatal) terminateFatally(slot, error, "repeated native tick failure")
      },
    })
  }
  if (root.getStatus().status === "failed") return root
  console.log(remount ? "[gpuix] remount complete" : "[gpuix] mount complete")
  return root
}
