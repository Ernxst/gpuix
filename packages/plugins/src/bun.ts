import type { BunPlugin } from "bun"
import { gpuixUnplugin } from "./unplugin.js"
import type { GpuixBunOptions } from "./bun-types.js"

export type { GpuixBunOptions } from "./bun-types.js"

/**
 * Add GPUIX's native build defaults and CSS-module loader to Bun.build().
 */
export function gpuix(options?: GpuixBunOptions): BunPlugin {
  return gpuixUnplugin.bun(options)
}

export default gpuix
