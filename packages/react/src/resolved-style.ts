import type { PublicInstance, StyleDesc } from "./types/host.js"

/**
 * The computed-style subset exposed by GPU-IX. `display` and `visibility` are
 * read from resolved inline and compiled-class styles, defaulting to `block`
 * and `visible`. Other computed-style properties are not provided.
 */
export interface GpuixComputedStyle {
  readonly display: string
  readonly visibility: string
}

const resolvedStyles = new WeakMap<PublicInstance, GpuixComputedStyle>()

export function setResolvedStyle(instance: PublicInstance, style: StyleDesc | undefined): void {
  resolvedStyles.set(instance, {
    display: style?.display ?? "block",
    visibility: style?.visibility ?? "visible",
  })
}

export function getResolvedStyle(instance: PublicInstance): GpuixComputedStyle {
  return resolvedStyles.get(instance) ?? { display: "block", visibility: "visible" }
}
