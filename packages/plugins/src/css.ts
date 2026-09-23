import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "vite"
import { createUnplugin } from "unplugin"
import { transformGpuixCssModule } from "./css-modules.js"

const CSS_MODULE_PREFIX = "\0gpuix:css-module:"

export const CSS_MODULE_RESOLVE_RE = /\.module\.css(?:$|[?#])/
export const CSS_MODULE_VIRTUAL_RE = /^\0gpuix:css-module:/

export interface GpuixCssOptions {
  /**
   * Vite environments to compile CSS modules in. Every environment by default,
   * which is what a native-only config and a Vitest config want. The native
   * development plugin passes `["gpuix"]` so that a config also serving a web
   * build leaves that environment on Vite's own CSS modules.
   */
  environments?: string[]
}

export function cleanId(id: string): string {
  return id.split(/[?#]/, 1)[0]
}

export function isCssModule(id: string): boolean {
  return cleanId(id).endsWith(".module.css")
}

export function cssModuleId(sourceId: string): string {
  // `encodeURIComponent` leaves periods alone. Encode them too so Vite's CSS
  // plugin does not mistake this virtual JavaScript module for a CSS request.
  return `${CSS_MODULE_PREFIX}${encodeURIComponent(sourceId).replaceAll(".", "%2E")}`
}

export function isCssModuleId(id: string): boolean {
  return id.startsWith(CSS_MODULE_PREFIX)
}

export function sourceIdFromCssModuleId(id: string): string {
  return decodeURIComponent(id.slice(CSS_MODULE_PREFIX.length))
}

export function resolveBunCssModule(id: string, importer: string | undefined): string {
  const sourceId = cleanId(id)
  if (path.isAbsolute(sourceId)) return sourceId
  if (importer !== undefined && path.isAbsolute(importer)) {
    return path.resolve(path.dirname(importer), sourceId)
  }
  return path.resolve(sourceId)
}

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

export function inSelectedEnvironment(context: unknown, environments?: string[]): boolean {
  if (environments === undefined) return true
  const name = (context as ViteResolveContext).environment?.name
  return name !== undefined && environments.includes(name)
}

/**
 * Point a `.module.css` import at the virtual module that holds its compiled
 * styles. Bun resolves the file itself; Vite asks the rest of the pipeline
 * first so that aliases and package imports keep working.
 */
export async function resolveCssModule(
  context: unknown,
  id: string,
  importer: string | undefined,
  framework: string,
  environments?: string[],
): Promise<string | undefined> {
  if (!isCssModule(id)) return undefined
  if (framework === "bun") return cssModuleId(resolveBunCssModule(id, importer))
  if (framework !== "vite" || !inSelectedEnvironment(context, environments)) return undefined

  const resolved = await (context as ViteResolveContext).resolve?.(id, importer, {
    skipSelf: true,
  })
  if (resolved === null || resolved === undefined || resolved.external) return undefined
  return cssModuleId(cleanId(resolved.id))
}

/** Compile the CSS behind a virtual module id into a native style object. */
export async function loadCssModule(
  context: unknown,
  id: string,
): Promise<{ code: string; map: null }> {
  const sourceId = sourceIdFromCssModuleId(id)
  ;(context as ViteLoadContext).addWatchFile?.(sourceId)
  const css = await readFile(sourceId, "utf8")
  return {
    code: `export default ${JSON.stringify(transformGpuixCssModule(css, sourceId))}`,
    map: null,
  }
}

/**
 * Compile `.module.css` imports into GPUIX styles, and nothing else.
 *
 * The native development plugin needs Bun and a Vite environment of its own;
 * this one needs neither, so a Vitest run, a `vite build`, or another bundler
 * can compile CSS modules the same way the application build does.
 */
export const gpuixCssUnplugin = createUnplugin<GpuixCssOptions | undefined, false>(
  (userOptions, meta) => {
    const environments = userOptions?.environments

    return {
      name: "gpuix-css-modules",
      // Resolve before Vite's own CSS plugin, which would otherwise claim the
      // file and hand back a stylesheet the native renderer cannot use.
      vite: { enforce: "pre" },
      resolveId: {
        filter: { id: CSS_MODULE_RESOLVE_RE },
        handler(id, importer) {
          return resolveCssModule(this, id, importer, meta.framework, environments)
        },
      },
      load: {
        filter: { id: CSS_MODULE_VIRTUAL_RE },
        handler(id) {
          return loadCssModule(this, id)
        },
      },
    }
  },
)

/** Compile `.module.css` imports into GPUIX styles in Vite or Vitest. */
export function gpuixCssModules(options?: GpuixCssOptions): Plugin {
  return gpuixCssUnplugin.vite(options)
}

export default gpuixCssModules
