import type { BunPlugin, BuildConfig, PluginBuilder } from "bun"
import { gpuixCssModulesBun } from "./css.js"
import type { GpuixBunOptions } from "./bun-types.js"

export type { GpuixBunOptions } from "./bun-types.js"

const NATIVE_PACKAGE = "@gpuix/native"

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

function configureBuild(build: PluginBuilder, options: GpuixBunOptions): void {
  build.config.target ??= options.target ?? "bun"
  build.config.format ??= options.format ?? "esm"

  build.config.external = [
    ...new Set([...(build.config.external ?? []), NATIVE_PACKAGE, ...(options.external ?? [])]),
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

/**
 * Add GPUIX's native build defaults and CSS-module loader to Bun.build().
 */
export function gpuix(options?: GpuixBunOptions): BunPlugin {
  return {
    name: "gpuix",
    setup(build) {
      configureBuild(build, options ?? {})
      gpuixCssModulesBun().setup?.(build)
    },
  }
}

/**
 * Register CSS-module compilation with Bun.plugin() for `bun --hot`.
 * Call this from a Bun preload before importing the application entry.
 */
export function gpuixDev(): BunPlugin {
  return gpuixCssModulesBun()
}

export default gpuix
