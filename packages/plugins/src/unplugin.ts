import { readFile } from "node:fs/promises"
import path from "node:path"
import type { BuildConfig, PluginBuilder } from "bun"
import { createUnplugin } from "unplugin"
import { rewriteTextImports } from "./assets.js"
import type { GpuixPluginOptions } from "./bun-types.js"
import { transformGpuixCssModule } from "./css-modules.js"
import { reactRefreshRuntimePath, transformReactRefresh } from "./refresh.js"

const NATIVE_ENTRY = "\0gpuix:native-entry"
const CSS_MODULE_PREFIX = "\0gpuix:css-module:"
const NATIVE_PACKAGE = "@gpuix/native"

const VIRTUAL_MODULE_RE = /^\0gpuix:(?:css-module:|native-entry$)/
const TRANSFORM_ID_RE = /\.[cm]?[jt]sx?(?:$|[?#])/
const RESOLVE_ID_RE = /(?:\.module\.css(?:$|[?#])|^react-refresh\/runtime$|^\0gpuix:native-entry$)/

type ViteResolveContext = {
  environment?: { name?: string }
  resolve?: (
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ) => Promise<{ id: string; external?: boolean } | null>
}

type ViteLoadContext = {
  addWatchFile: (id: string) => void
}

function cleanId(id: string): string {
  return id.split(/[?#]/, 1)[0]
}

function isCssModule(id: string): boolean {
  return cleanId(id).endsWith(".module.css")
}

function cssModuleId(sourceId: string): string {
  // `encodeURIComponent` leaves periods alone. Encode them too so Vite's CSS
  // plugin does not mistake this virtual JavaScript module for a CSS request.
  return `${CSS_MODULE_PREFIX}${encodeURIComponent(sourceId).replaceAll(".", "%2E")}`
}

function sourceIdFromCssModuleId(id: string): string {
  return decodeURIComponent(id.slice(CSS_MODULE_PREFIX.length))
}

function isGpuixViteEnvironment(context: unknown): boolean {
  return (context as { environment?: { name?: string } }).environment?.name === "gpuix"
}

export function resolveBunCssModule(id: string, importer: string | undefined): string {
  const sourceId = cleanId(id)
  if (path.isAbsolute(sourceId)) return sourceId
  if (importer !== undefined && path.isAbsolute(importer)) {
    return path.resolve(path.dirname(importer), sourceId)
  }
  return path.resolve(sourceId)
}

function asList(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function mergeConditions(
  configured: BuildConfig["conditions"],
  requested: BuildConfig["conditions"],
): BuildConfig["conditions"] {
  const merged = [...asList(requested), ...asList(configured)]
  return merged.length === 0 ? undefined : [...new Set(merged)]
}

function configureBunBuild(build: PluginBuilder, options: GpuixPluginOptions): void {
  build.config.target ??= options.target ?? "bun"
  build.config.format ??= options.format ?? "esm"

  build.config.external = [
    ...new Set([
      ...(build.config.external ?? []),
      NATIVE_PACKAGE,
      ...(options.external ?? []),
    ]),
  ]

  if (options.define !== undefined || build.config.define !== undefined) {
    build.config.define = {
      ...(options.define ?? {}),
      ...(build.config.define ?? {}),
    }
  }

  const conditions = mergeConditions(build.config.conditions, options.conditions)
  if (conditions !== undefined) build.config.conditions = conditions

  build.config.jsx = {
    runtime: "automatic",
    importSource: "@gpuix/react",
    ...(options.jsx ?? {}),
    ...(build.config.jsx ?? {}),
  }
}

export const gpuixUnplugin = createUnplugin<GpuixPluginOptions | undefined, false>(
  (userOptions, meta) => {
    const options = userOptions ?? {}
    let entryId: string | undefined

    return {
      name: "gpuix",
      resolveId: {
        filter: { id: RESOLVE_ID_RE },
        async handler(id, importer) {
          if (id === NATIVE_ENTRY) {
            return meta.framework === "vite" ? NATIVE_ENTRY : undefined
          }

          if (id === "react-refresh/runtime") {
            if (meta.framework !== "vite") return undefined
            return { id: reactRefreshRuntimePath, external: true }
          }

          if (!isCssModule(id)) return undefined

          if (meta.framework === "bun") {
            return cssModuleId(resolveBunCssModule(id, importer))
          }

          if (meta.framework !== "vite" || !isGpuixViteEnvironment(this)) {
            return undefined
          }

          const context = this as unknown as ViteResolveContext
          const resolved = await context.resolve?.(id, importer, { skipSelf: true })
          if (resolved === null || resolved === undefined || resolved.external) {
            return undefined
          }
          return cssModuleId(cleanId(resolved.id))
        },
      },
      load: {
        filter: { id: VIRTUAL_MODULE_RE },
        async handler(id) {
          if (id.startsWith(CSS_MODULE_PREFIX)) {
            const sourceId = sourceIdFromCssModuleId(id)
            const context = this as unknown as ViteLoadContext
            context.addWatchFile(sourceId)
            const css = await readFile(sourceId, "utf8")
            return {
              code: `export default ${JSON.stringify(
                transformGpuixCssModule(css, sourceId),
              )}`,
              map: null,
            }
          }

          if (meta.framework !== "vite" || id !== NATIVE_ENTRY || entryId === undefined) {
            return undefined
          }

          return `import * as RefreshRuntime from "react-refresh/runtime"

RefreshRuntime.injectIntoGlobalHook(globalThis)
globalThis.$RefreshReg$ = () => {}
globalThis.$RefreshSig$ = () => (type) => type

await import(${JSON.stringify(entryId)})
`
        },
      },
      vite: {
        apply: (_config, { command }) => {
          if (command === "build") {
            throw new Error(
              "[gpuix] Vite builds are not supported for native apps; use @gpuix/plugins/bun with Bun.build().",
            )
          }
          return command === "serve" && process.env.VITEST === undefined
        },
        enforce: "pre",
        config() {
          return {
            environments: {
              gpuix: {
                consumer: "server",
                // Runtime dependencies must be loaded by Bun, not evaluated by
                // Vite's module runner. In particular, N-API modules are CommonJS
                // loaders around a loaded native library.
                resolve: {
                  external: ["@gpuix/native", "@gpuix/react", "react", "react-refresh"],
                },
              },
            },
          }
        },
        transform: {
          filter: { id: TRANSFORM_ID_RE },
          handler(code, id) {
            if (!isGpuixViteEnvironment(this)) return undefined
            const source = rewriteTextImports(code)
            return (
              transformReactRefresh(source, id) ??
              (source === code ? undefined : { code: source, map: null })
            )
          },
        },
        hotUpdate(context) {
          if (!isGpuixViteEnvironment(this) || !isCssModule(context.file)) {
            return undefined
          }

          const module = this.environment.moduleGraph.getModuleById(
            cssModuleId(path.resolve(context.file)),
          )
          return module === undefined ? undefined : [module]
        },
        configureServer(server) {
          if (process.versions.bun === undefined) {
            throw new Error(
              "[gpuix] Vite must run under Bun. Start it with `bun run --bun vite`.",
            )
          }

          const environment = server.environments.gpuix as unknown as
            | { runner?: { import: (id: string) => Promise<unknown> } }
            | undefined
          if (environment?.runner === undefined) {
            throw new Error("[gpuix] the Vite gpuix environment is not runnable")
          }

          if (options.entry === undefined) {
            throw new Error("[gpuix] Vite requires an `entry` option")
          }

          entryId = path.resolve(server.config.root, options.entry)
          void environment.runner.import(NATIVE_ENTRY).catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
            server.config.logger.error(`[gpuix] failed to start the native entry\n${detail}`)
          })
        },
      },
      bun: {
        loader: "js",
        setup(build) {
          configureBunBuild(build, options)
        },
      },
    }
  },
)
