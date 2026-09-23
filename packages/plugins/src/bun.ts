import type { BunPlugin } from "bun"
import { gpuixCssModulesBun } from "./css.js"
import { gpuixUnplugin } from "./unplugin.js"
import type { GpuixBunOptions } from "./bun-types.js"

export type { GpuixBunOptions } from "./bun-types.js"

/**
 * Add GPUIX's native build defaults and CSS-module loader to Bun.build().
 */
export function gpuix(options?: GpuixBunOptions): BunPlugin {
  return gpuixUnplugin.bun(options)
}

/**
 * Register CSS-module compilation with Bun.plugin() for `bun --hot`.
 * Call this from a Bun preload before importing the application entry.
 */
export function gpuixDev(): BunPlugin {
  return gpuixCssModulesBun()
}

export default gpuix
