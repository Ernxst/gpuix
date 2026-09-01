import type { NativeRenderer, StyleDiagnostic } from "../types/host.js"

// Keep warning history scoped to the renderer, which makes it collectible with
// the root, while the cap bounds memory for long-running renderers.
const MAX_REPORTED_STYLE_DIAGNOSTICS = 1_024
const reportedStyleDiagnostics = new WeakMap<NativeRenderer, Map<string, undefined>>()

const RENDERER_DIAGNOSTIC_CHANNELS_KEY = "__gpuixRendererDiagnosticChannels"

interface RendererDiagnosticChannelsSlot {
  readonly channels: WeakMap<NativeRenderer, StyleDiagnostic[]>
}

function rendererDiagnosticChannels(): WeakMap<NativeRenderer, StyleDiagnostic[]> {
  // Bun --hot can re-evaluate this module while preserving the renderer. Keep
  // one sidecar so a remount does not stack method wrappers or lose evidence.
  const existing = Reflect.get(globalThis, RENDERER_DIAGNOSTIC_CHANNELS_KEY) as
    | RendererDiagnosticChannelsSlot
    | undefined
  if (existing) return existing.channels

  const created: RendererDiagnosticChannelsSlot = { channels: new WeakMap() }
  Reflect.set(globalThis, RENDERER_DIAGNOSTIC_CHANNELS_KEY, created)
  return created.channels
}

/** Add reconciler diagnostics to the renderer's existing assertion channel. */
export function installRendererDiagnosticChannel(renderer: NativeRenderer): void {
  const channels = rendererDiagnosticChannels()
  if (channels.has(renderer)) return

  const pending: StyleDiagnostic[] = []
  const nativeDrain = renderer.drainStyleDiagnostics?.bind(renderer)
  channels.set(renderer, pending)

  // Callers drain the renderer they supplied, not the internal batching facade,
  // so the combined assertion channel must live on this original instance.
  Object.defineProperty(renderer, "drainStyleDiagnostics", {
    configurable: true,
    writable: true,
    value: (): StyleDiagnostic[] => {
      return [...(nativeDrain?.() ?? []), ...pending.splice(0)]
    },
  })

  if (!renderer.takeStyleDiagnosticsForReporting) {
    // The reporting fallback normally calls the public drain. Keep that from
    // consuming fatal assertion evidence during React's cleanup commit.
    Object.defineProperty(renderer, "takeStyleDiagnosticsForReporting", {
      configurable: true,
      writable: true,
      value: (): StyleDiagnostic[] => nativeDrain?.() ?? [],
    })
  }
}

export function enqueueRendererDiagnostic(
  renderer: NativeRenderer,
  diagnostic: StyleDiagnostic
): void {
  installRendererDiagnosticChannel(renderer)
  rendererDiagnosticChannels().get(renderer)!.push(diagnostic)
}

export function reportStyleDiagnostics(renderer: NativeRenderer): void {
  const diagnostics =
    renderer.takeStyleDiagnosticsForReporting?.() ?? renderer.drainStyleDiagnostics?.() ?? []
  if (diagnostics.length === 0) return

  let reported = reportedStyleDiagnostics.get(renderer)
  if (!reported) {
    reported = new Map()
    reportedStyleDiagnostics.set(renderer, reported)
  }

  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([diagnostic.elementId, diagnostic.property, diagnostic.message])
    if (reported.has(key)) {
      reported.delete(key)
      reported.set(key, undefined)
      continue
    }

    reported.set(key, undefined)
    if (reported.size > MAX_REPORTED_STYLE_DIAGNOSTICS) {
      const oldest = reported.keys().next()
      if (!oldest.done) reported.delete(oldest.value)
    }
    console.warn(diagnostic.message)
  }
}
