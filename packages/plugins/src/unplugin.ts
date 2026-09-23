import path from "node:path"
import type { BuildConfig, PluginBuilder } from "bun"
import { createUnplugin } from "unplugin"
import { rewriteTextImports } from "./assets.js"
import type { GpuixPluginOptions } from "./bun-types.js"
import { cssModuleId, isCssModule, isCssModuleId, loadCssModule, resolveCssModule } from "./css.js"
import { reactRefreshRuntimePath, transformReactRefresh } from "./refresh.js"

const NATIVE_ENTRY = "\0gpuix:native-entry"
const NATIVE_PACKAGE = "@gpuix/native"

/** CSS modules are compiled in this environment only, never in a web one. */
const GPUIX_ENVIRONMENTS = ["gpuix"]

const VIRTUAL_MODULE_RE = /^\0gpuix:(?:css-module:|native-entry$)/
const TRANSFORM_ID_RE = /\.[cm]?[jt]sx?(?:$|[?#])/
const RESOLVE_ID_RE = /(?:\.module\.css(?:$|[?#])|^react-refresh\/runtime$|^\0gpuix:native-entry$)/

function isGpuixViteEnvironment(context: unknown): boolean {
  return (context as { environment?: { name?: string } }).environment?.name === "gpuix"
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

          return resolveCssModule(this, id, importer, meta.framework, GPUIX_ENVIRONMENTS)
        },
      },
      load: {
        filter: { id: VIRTUAL_MODULE_RE },
        async handler(id) {
          if (isCssModuleId(id)) return loadCssModule(this, id)

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
