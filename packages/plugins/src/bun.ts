import { readFile } from "node:fs/promises"
import path from "node:path"
import type { BunPlugin } from "bun"
import { resolveBunCssModule } from "./css.js"
import { gpuixUnplugin } from "./unplugin.js"
import type { GpuixBunOptions } from "./bun-types.js"
import { transformGpuixCssModule } from "./css-modules.js"

export type { GpuixBunOptions } from "./bun-types.js"

/**
 * Add GPUIX's native build defaults and CSS-module loader to Bun.build().
 */
export function gpuix(options?: GpuixBunOptions): BunPlugin {
  return gpuixUnplugin.bun(options)
}

/**
 * Register native CSS-module loading with Bun.plugin() for bun --hot.
 * Call this from a Bun preload before importing the application entry.
 */
export function gpuixDev(): BunPlugin {
  return {
    name: "gpuix-dev",
    setup(build) {
      build.onResolve({ filter: /\.module\.css$/ }, ({ path: id, importer }) => ({
        path: resolveBunCssModule(id, importer),
      }))

      build.onLoad({ filter: /\.module\.css$/, namespace: "file" }, async ({ path: id }) => ({
        contents: `export default ${JSON.stringify(
          transformGpuixCssModule(await readFile(id, "utf8"), id),
        )}`,
        loader: "js",
        resolveDir: path.dirname(id),
      }))
    },
  }
}

export default gpuix
