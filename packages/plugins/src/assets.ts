import type { PluginObj } from "@babel/core"

export const FILE_IMPORT_QUERY = "__gpuix_file"

function appendQueryParameter(specifier: string, parameter: string): string {
  const hashIndex = specifier.indexOf("#")
  const address = hashIndex === -1 ? specifier : specifier.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : specifier.slice(hashIndex)
  const separator = address.includes("?")
    ? address.endsWith("?") || address.endsWith("&")
      ? ""
      : "&"
    : "?"

  return `${address}${separator}${parameter}${hash}`
}

/** Translate Bun's text and file import attributes for the Vite dev server. */
export const bunAssetImportAttributes = (
  { types }: { types: typeof import("@babel/core").types },
): PluginObj => ({
  visitor: {
    ImportDeclaration(importPath) {
      const attributes = importPath.node.attributes
      if (attributes === null || attributes === undefined) return
      const typeAttribute = attributes.find((attribute) => {
        const key = attribute.key
        const isTypeKey =
          (types.isIdentifier(key) && key.name === "type") ||
          (types.isStringLiteral(key) && key.value === "type")
        return isTypeKey && types.isStringLiteral(attribute.value)
      })
      if (typeAttribute === undefined || !types.isStringLiteral(typeAttribute.value)) return

      const query =
        typeAttribute.value.value === "text"
          ? "raw"
          : typeAttribute.value.value === "file"
            ? FILE_IMPORT_QUERY
            : undefined
      if (query === undefined) return

      const source = importPath.node.source
      source.value = appendQueryParameter(source.value, query)
      source.extra = {
        ...source.extra,
        raw: JSON.stringify(source.value),
        rawValue: source.value,
      }
      importPath.node.attributes = attributes.filter((attribute) => attribute !== typeAttribute)
    },
  },
})
