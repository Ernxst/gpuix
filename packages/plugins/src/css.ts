import { readFile } from "node:fs/promises"
import path from "node:path"
import type { BunPlugin } from "bun"
import type { Plugin } from "vite"
import type { AcceptedPlugin } from "postcss"
import { createUnplugin } from "unplugin"
import { transformGpuixCssModule, type CssImportResolver } from "./css-modules.js"

const CSS_MODULE_PREFIX = "\0gpuix:css-module:"

export const CSS_MODULE_RESOLVE_RE = /\.module\.css(?:$|[?#])/
export const CSS_MODULE_VIRTUAL_RE = /^\0gpuix:css-module:/

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
  resolve?: (
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ) => Promise<{ id: string; external?: boolean } | null>
}

type ViteLoadContext = {
  addWatchFile: (id: string) => void
  resolve?: ViteResolveContext["resolve"]
}

export type CssModulesOptions = {
  /** PostCSS plugins to run after the built-in ones. */
  plugins?: readonly AcceptedPlugin[]
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
): Promise<string | undefined> {
  if (!isCssModule(id)) return undefined
  if (framework === "bun") return cssModuleId(resolveBunCssModule(id, importer))
  if (framework !== "vite") return undefined

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
  plugins: readonly AcceptedPlugin[] = [],
): Promise<{ code: string; map: null }> {
  const sourceId = sourceIdFromCssModuleId(id)
  const viteContext = context as ViteLoadContext
  viteContext.addWatchFile?.(sourceId)
  const resolveImport: CssImportResolver | undefined = viteContext.resolve
    ? async (specifier, importer) => {
        const resolved = await viteContext.resolve?.(specifier, importer, { skipSelf: true })
        if (!resolved || resolved.external) {
          throw new Error(`[gpuix] cannot resolve CSS import ${JSON.stringify(specifier)} from ${JSON.stringify(importer)}`)
        }
        return cleanId(resolved.id)
      }
    : undefined
  const css = await readFile(sourceId, "utf8")
  return {
    code: await compileCssModuleCode(
      css,
      sourceId,
      plugins,
      resolveImport,
      (file) => viteContext.addWatchFile?.(file),
    ),
    map: null,
  }
}

/** Emit a self-contained module that tags every compiled class style. */
async function compileCssModuleCode(
  css: string,
  sourceId: string,
  plugins: readonly AcceptedPlugin[] = [],
  resolveImport?: CssImportResolver,
  watchImport?: (file: string) => void,
): Promise<string> {
  return (
    `const styles = ${JSON.stringify(await transformGpuixCssModule(css, sourceId, plugins, resolveImport, watchImport))};\n` +
    `for (const style of Object.values(styles)) {\n` +
    `  Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true });\n` +
    `}\n` +
    `export default styles`
  )
}

/**
 * Compile `.module.css` imports into GPUIX styles, and nothing else.
 *
 * A Vite or Vitest project can use this plugin wherever it needs native CSS
 * module compilation.
 */
export const gpuixCssUnplugin = createUnplugin<CssModulesOptions, false>((userOptions, meta) => {
  return {
    name: "gpuix-css-modules",
    // Resolve before Vite's own CSS plugin, which would otherwise claim the
    // file and hand back a stylesheet the native renderer cannot use.
    vite: { enforce: "pre" },
    resolveId: {
      filter: { id: CSS_MODULE_RESOLVE_RE },
      handler(id, importer) {
        return resolveCssModule(this, id, importer, meta.framework)
      },
    },
    load: {
      filter: { id: CSS_MODULE_VIRTUAL_RE },
      handler(id) {
        return loadCssModule(this, id, userOptions.plugins)
      },
    },
  }
})

/** Compile `.module.css` imports into GPUIX styles in Vite or Vitest. */
export function gpuixCssModules(options: CssModulesOptions = {}): Plugin {
  return gpuixCssUnplugin.vite(options)
}

/**
 * The same transform for Bun, in `Bun.build()` or `Bun.plugin()`.
 *
 * Bun's bundler compiles `.module.css` to class names of its own, so a build
 * without this plugin hands the renderer strings it cannot resolve.
 */
export function gpuixCssModulesBun(options: CssModulesOptions = {}): BunPlugin {
  return {
    name: "gpuix-css-modules",
    setup(build) {
      build.onResolve({ filter: /\.module\.css$/ }, ({ path: id, importer }) => ({
        path: resolveBunCssModule(id, importer),
      }))

      build.onLoad({ filter: /\.module\.css$/, namespace: "file" }, async ({ path: id }) => ({
        contents: await compileCssModuleCode(
          await readFile(id, "utf8"),
          id,
          options.plugins,
          (specifier, importer) => Bun.resolveSync(specifier, path.dirname(importer)),
        ),
        loader: "js",
        resolveDir: path.dirname(id),
      }))
    },
  }
}

export default gpuixCssModules
