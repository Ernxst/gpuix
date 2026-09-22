const TEXT_IMPORT = /(from\s+["'])([^"']+)(["'])\s+with\s+\{\s*type\s*:\s*["']text["']\s*\}/g

/** Translate Bun's text import attribute to Vite's raw-asset query. */
export function rewriteTextImports(code: string): string {
  return code.replace(TEXT_IMPORT, (_match, start: string, id: string, end: string) => {
    const query = id.includes("?") ? "&raw" : "?raw"
    return `${start}${id}${query}${end}`
  })
}
