import React from "react"
import type { ReactNode } from "react"
import ReactReconciler from "react-reconciler"
import type { OpaqueRoot } from "react-reconciler"
import { ConcurrentRoot } from "react-reconciler/constants.js"
import {
  attachCanvasImageLoader,
  detachCanvasImageLoader,
} from "../canvas/image.js"
import { GpuixContext } from "../hooks/use-gpuix.js"
import type {
  Container,
  ElementIdAllocator,
  NativeRenderer,
  StyleDiagnostic,
} from "../types/host.js"
import { wrapWithBatching } from "./batch-renderer.js"
import {
  enqueueRendererDiagnostic,
  installRendererDiagnosticChannel,
} from "./renderer-diagnostics.js"
import { attachRoot, containerForRenderer, detachRoot } from "./event-registry.js"
import { hostConfig } from "./host-config.js"

// Cast to any because @types/react-reconciler is out of date with react-reconciler 0.33.0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciler = ReactReconciler(hostConfig as any)

/**
 * Register with the React DevTools global hook.
 *
 * This is not only for DevTools, and it is not optional. React Fast Refresh
 * reaches a renderer through the same hook: `react-refresh` patches
 * `hook.inject`, keeps the `scheduleRefresh` and `setRefreshHandler` helpers
 * this call passes in, and drives hot updates through them.
 *
 * Drop this call and there is **no error and no page reload**. Bun still marks
 * the edited module self-accepting and still calls `performReactRefresh()`,
 * which iterates zero mounted roots and schedules nothing. The bundle updates
 * and the painted UI silently stays stale.
 *
 * The hook has to already exist when this module evaluates. Bun's HMR runtime
 * calls `injectIntoGlobalHook(window)` during bundle init, so it does in the
 * dev server, and `injectIntoDevTools()` is a no-op returning `false` in plain
 * Node. Do not test that return value: it ends in `hook.checkDCE ? true : false`
 * and `react-refresh` installs no `checkDCE`, so a working injection still
 * reports `false`. `fast-refresh.test.tsx` asserts the observable behaviour.
 */
try {
  // @ts-expect-error the types for `react-reconciler` are not up to date with the library
  reconciler.injectIntoDevTools()
} catch {
  // No DevTools hook in this process.
}

const _r = reconciler as typeof reconciler & {
  flushSyncFromReconciler?: typeof reconciler.flushSync
}
export const flushSync = _r.flushSyncFromReconciler ?? _r.flushSync

/** Run the passive effects (`useEffect`) the last commit queued instead of
 *  leaving them to the scheduler's next task. Returns whether any ran. */
export const flushPassiveEffects = _r.flushPassiveEffects

export interface RootFailure {
  readonly status: "failed"
  readonly error: unknown
  readonly componentStack: string | null
  readonly diagnostic: StyleDiagnostic
}

export type RootStatus =
  | { readonly status: "active" }
  | RootFailure
  | { readonly status: "unmounted" }

export interface Root {
  render: (node: ReactNode) => void
  unmount: () => void
  /** The root stays failed after cleanup so consumers can inspect the fatal cause. */
  getStatus: () => RootStatus
}

/**
 * Uncaught-error handlers, keyed by the two objects a caller can be holding:
 * the root itself, and the container the event registry resolves from a
 * renderer.
 *
 * Deliberately not on `Root`. Reporting an error into somebody else's root is
 * not something an application does; it exists for the one caller that takes
 * React's error path away from it, below.
 */
const uncaughtErrorHandlers = new WeakMap<object, (error: unknown) => void>()

/**
 * Hand a root an uncaught render error that reached the caller instead of it.
 *
 * React normally routes such an error to the root's own handler. Inside `act`
 * it does not: it collects those errors and rethrows them out of the `act`
 * call, so a caller that renders inside `act` — the test renderer — has to hand
 * them back for the root to go on reporting itself as dead. A root this module
 * did not create is ignored.
 */
export function reportUncaughtErrorToRoot(root: Root, error: unknown): void {
  uncaughtErrorHandlers.get(root)?.(error)
}

/**
 * As `reportUncaughtErrorToRoot`, for a caller holding the renderer rather than
 * the root: the native event pipeline, which reaches React through the root the
 * event registry attached to that renderer. A renderer with no attached root —
 * one already unmounted — is ignored.
 */
export function reportUncaughtErrorToRenderer(
  renderer: NativeRenderer,
  error: unknown
): void {
  const container = containerForRenderer(renderer)
  if (container === undefined) return
  uncaughtErrorHandlers.get(container)?.(error)
}

export interface RootOptions {
  /** Reject invalid fields and emit actionable diagnostics. Defaults on in non-production Node runtimes. */
  strictStyles?: boolean
  /** Receives the fatal state React records instead of rethrowing an uncaught root error. */
  onUncaughtError?: (failure: RootFailure) => void
}

function describeThrownValue(error: unknown): string {
  try {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return String(error)
  } catch {
    return "<unprintable thrown value>"
  }
}

declare const Bun: {
  readonly isStandaloneExecutable: boolean
}

export function strictStylesDefault(): boolean {
  if (typeof Bun !== "undefined" && Bun.isStandaloneExecutable) return false
  if (typeof process === "undefined") return false
  return process.env?.NODE_ENV !== "production"
}

const ID_ALLOCATOR_KEY = "__gpuixIdAllocators"

type IdAllocatorSlot = {
  allocators: WeakMap<NativeRenderer, ElementIdAllocator>
}

function idAllocatorSlot(): IdAllocatorSlot {
  // Bun --hot re-evaluates this module, producing duplicate module instances per reload pass.
  const existing = Reflect.get(globalThis, ID_ALLOCATOR_KEY) as IdAllocatorSlot | undefined
  if (existing) return existing

  const created: IdAllocatorSlot = { allocators: new WeakMap() }
  Reflect.set(globalThis, ID_ALLOCATOR_KEY, created)
  return created
}

function idAllocatorFor(renderer: NativeRenderer): ElementIdAllocator {
  const { allocators } = idAllocatorSlot()
  let alloc = allocators.get(renderer)
  if (!alloc) {
    alloc = { nextElementId: 0 }
    allocators.set(renderer, alloc)
  }
  return alloc
}

export function createRoot(renderer: NativeRenderer, options: RootOptions = {}): Root {
  const strictStyles = options.strictStyles ?? strictStylesDefault()
  installRendererDiagnosticChannel(renderer)
  renderer.setStrictStyles?.(strictStyles)
  attachCanvasImageLoader(renderer)
  let container: OpaqueRoot | null = null
  const batchedRenderer = wrapWithBatching(renderer)
  const gpuixContainer: Container = {
    renderer: batchedRenderer,
    native: renderer,
    ids: idAllocatorFor(renderer),
    eventHandlers: new Map(),
    eventTargets: new Map(),
    hoverPath: [],
    preventedKeyboardActivations: new Map(),
    strictStyles,
  }
  attachRoot(renderer, gpuixContainer)
  let status: RootStatus = { status: "active" }

  const cleanup = (): void => {
    if (container) {
      // Must be sync. A late unmount destroy()s remounted ids and the window goes black.
      flushSync(() => {
        reconciler.updateContainer(null, container, null, () => {})
      })
      container = null
    }
    detachRoot(renderer, gpuixContainer)
    detachCanvasImageLoader(renderer)
    if (status.status === "active") status = { status: "unmounted" }
  }

  const handleUncaughtError = (
    error: unknown,
    errorInfo?: { componentStack?: string | null }
  ): void => {
    if (status.status === "failed") return

    const diagnostic: StyleDiagnostic = {
      // Host ids start at 1, so zero identifies the container itself.
      elementId: 0,
      elementType: "root",
      property: "status",
      value: '"failed"',
      message:
        `[gpuix] React root is dead after an uncaught render error: ` +
        describeThrownValue(error),
    }
    const failure: RootFailure = {
      status: "failed",
      error,
      componentStack: errorInfo?.componentStack ?? null,
      diagnostic,
    }
    status = failure
    enqueueRendererDiagnostic(renderer, diagnostic)
    // Keep React's established `(error, errorInfo)` leading arguments for error
    // observers while adding the otherwise-missing dead-root outcome. The
    // errorInfo is rebuilt rather than passed through, so a caller that had no
    // stack to give — React drops it when `act` intercepts the error — logs
    // React's shape with a null stack instead of a bare `undefined`.
    console.error(error, { componentStack: failure.componentStack }, diagnostic.message)
    options.onUncaughtError?.(failure)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  container = (reconciler.createContainer as any)(
    gpuixContainer,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    handleUncaughtError,
    console.error,
    console.error,
    null
  )

  const root: Root = {
    render: (node): void => {
      const activeContainer = container
      if (!activeContainer) {
        throw new Error("Cannot render an unmounted GPUIX root")
      }
      reconciler.updateContainer(
        React.createElement(
          GpuixContext.Provider,
          { value: { renderer } },
          node
        ),
        activeContainer,
        null,
        () => {}
      )
    },

    unmount: cleanup,
    getStatus: (): RootStatus => status,
  }

  // Reachable from either handle a caller can have: the root, or — through the
  // event registry — the renderer this container is attached to.
  uncaughtErrorHandlers.set(root, handleUncaughtError)
  uncaughtErrorHandlers.set(gpuixContainer, handleUncaughtError)

  return root
}
