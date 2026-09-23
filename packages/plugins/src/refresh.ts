import { transformSync, type PluginItem } from "@babel/core"
import { createRequire } from "node:module"
import { bunAssetImportAttributes } from "./assets.js"

const require = createRequire(import.meta.url)
const reactRefreshBabel = require("react-refresh/babel") as PluginItem

export const reactRefreshRuntimePath = require.resolve("react-refresh/runtime")

const REFRESH_RUNTIME = "react-refresh/runtime"
const REACT_SOURCE = /\.[cm]?[jt]sx?$/
const REFRESH_PREAMBLE = `import * as RefreshRuntime from ${JSON.stringify(REFRESH_RUNTIME)}

if (!globalThis.$RefreshReg$) {
  throw new Error("[gpuix] React Refresh was not initialised before the native entry")
}

const prevRefreshReg = globalThis.$RefreshReg$
const prevRefreshSig = globalThis.$RefreshSig$
globalThis.$RefreshReg$ = (type, name) => RefreshRuntime.register(type, __MODULE_ID__ + " " + name)
globalThis.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform

`
const REFRESH_PREAMBLE_LINES = REFRESH_PREAMBLE.split("\n").length - 1

/**
 * Add React Refresh registration and boundary handling to a source module.
 *
 * The Babel plugin recognises component definitions. Components receive a
 * Refresh boundary; other modules still pass through Babel so Bun import
 * attributes can be translated before Vite processes them.
 */
export function transformReactRefresh(code: string, id: string) {
  if (!REACT_SOURCE.test(id) || id.includes("/node_modules/")) return undefined

  const result = transformSync(code, {
    babelrc: false,
    configFile: false,
    filename: id,
    parserOpts: { plugins: ["jsx", "typescript", "importAttributes"] },
    plugins: [bunAssetImportAttributes, [reactRefreshBabel, { skipEnvCheck: true }]],
    sourceMaps: true,
  })

  const transformed = result?.code
  if (transformed === null || transformed === undefined) return undefined

  const map = result?.map
  if (!transformed.includes("$RefreshReg$(")) {
    return { code: transformed, map: map ?? null }
  }

  return {
    code: `${REFRESH_PREAMBLE.replace("__MODULE_ID__", JSON.stringify(id))}${transformed}

globalThis.$RefreshReg$ = prevRefreshReg
globalThis.$RefreshSig$ = prevRefreshSig

if (import.meta.hot) {
  import.meta.hot.accept((nextExports) => {
    if (!nextExports) return

    for (const [name, value] of Object.entries(nextExports)) {
      if (!RefreshRuntime.isLikelyComponentType(value)) {
        import.meta.hot.invalidate(
          "[gpuix] Fast Refresh only preserves state for modules that export React components.",
        )
        return
      }
    }

    RefreshRuntime.performReactRefresh()
  })
}
`,
    map: map === null || map === undefined
      ? null
      : { ...map, mappings: `${";".repeat(REFRESH_PREAMBLE_LINES)}${map.mappings}` },
  }
}
