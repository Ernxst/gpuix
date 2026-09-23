/**
 * Class names a build left unresolved in a `cn()` result, carried on the
 * merged styles so the reconciler can name them in its diagnostic. The
 * property is non-enumerable, so the styles still serialise to the renderer
 * unchanged and `Object.assign` does not copy it between results.
 *
 * Declared here, away from `./cn`, so the reconciler can read the marker
 * without pulling the class-name merger into the renderer bundle.
 */
export const UNRESOLVED_CLASS_NAMES = Symbol.for("gpuix.unresolvedClassNames")

/** Class names carried on `value`, if a `cn()` call left any there. */
export function unresolvedClassNames(value: object): string[] | undefined {
  const names = (value as Record<symbol, unknown>)[UNRESOLVED_CLASS_NAMES]
  return Array.isArray(names) && names.length > 0 ? (names as string[]) : undefined
}
