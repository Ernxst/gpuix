import path from "node:path"
import { isRunnableDevEnvironment, type Plugin } from "vite"
import { rewriteTextImports } from "./assets.js"
import { reactRefreshRuntimePath, transformReactRefresh } from "./refresh.js"

const NATIVE_ENTRY = "\0gpuix:native-entry"

export interface GpuixOptions {
  /** Native application entry, relative to Vite's root. */
  entry: string
}

/**
 * Run a GPUIX application as a Vite environment.
 *
 * This plugin is deliberately development-only. It transforms, evaluates, and
 * hot-updates a native GPUIX entry in the same Bun process. Native application
 * packaging remains Bun's build contract.
 */
export function gpuix({ entry }: GpuixOptions): Plugin {
  let entryId: string | undefined

  return {
    name: "gpuix",
    apply: "serve",
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
    resolveId(id) {
      if (id === NATIVE_ENTRY) return NATIVE_ENTRY
      if (id === "react-refresh/runtime") {
        return { id: reactRefreshRuntimePath, external: true }
      }
    },
    load(id) {
      if (id !== NATIVE_ENTRY || entryId === undefined) return undefined

      return `import * as RefreshRuntime from "react-refresh/runtime"

RefreshRuntime.injectIntoGlobalHook(globalThis)
globalThis.$RefreshReg$ = () => {}
globalThis.$RefreshSig$ = () => (type) => type

await import(${JSON.stringify(entryId)})
`
    },
    transform(code, id) {
      if (this.environment.name !== "gpuix") return undefined
      const source = rewriteTextImports(code)
      return transformReactRefresh(source, id) ?? (source === code ? undefined : { code: source, map: null })
    },
    configureServer(server) {
      if (process.versions.bun === undefined) {
        throw new Error(
          "[gpuix] Vite must run under Bun. Add `[run] bun = true` to bunfig.toml, then start it with `bun run dev`.",
        )
      }

      const environment = server.environments.gpuix
      if (!isRunnableDevEnvironment(environment)) {
        throw new Error("[gpuix] the Vite gpuix environment is not runnable")
      }

      entryId = path.resolve(server.config.root, entry)
      void environment.runner.import(NATIVE_ENTRY).catch((error: unknown) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
        server.config.logger.error(`[gpuix] failed to start the native entry\n${detail}`)
      })
    },
  }
}
