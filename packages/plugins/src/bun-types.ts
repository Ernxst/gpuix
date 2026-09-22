import type { BuildConfig } from "bun"

export interface GpuixBunOptions {
  /** Defaults to Bun's native target. */
  target?: BuildConfig["target"]
  /** Defaults to ESM output. */
  format?: BuildConfig["format"]
  /** Additional imports to leave for the runtime. */
  external?: string[]
  /** Additional build-time constants. */
  define?: BuildConfig["define"]
  /** Additional package export conditions. */
  conditions?: BuildConfig["conditions"]
  /** Overrides for Bun's JSX transform. */
  jsx?: BuildConfig["jsx"]
}

export type GpuixPluginOptions = GpuixBunOptions & {
  entry?: string
}
