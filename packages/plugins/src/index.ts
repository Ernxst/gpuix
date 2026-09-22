import type { Plugin } from "vite"
import { gpuixUnplugin } from "./unplugin.js"
import type { GpuixOptions } from "./types.js"

export type { GpuixOptions } from "./types.js"

/**
 * Run a GPUIX application as a Vite environment during development.
 */
export function gpuix(options: GpuixOptions): Plugin {
  return gpuixUnplugin.vite(options)
}
