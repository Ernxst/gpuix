import type { RefObject } from "react"

import type { Instance, PublicInstance } from "../types/host.js"

export type CanvasCommandRef = PublicInstance | RefObject<PublicInstance | null>

function resolveCanvasInstance(ref: CanvasCommandRef): PublicInstance {
  const instance = "current" in ref ? ref.current : ref
  if (!instance) {
    throw new Error("Cannot apply canvas commands before the <canvas> ref is mounted")
  }
  if (instance.type !== "canvas") {
    throw new TypeError(
      `__applyCanvasCommands expected a <canvas> ref, received <${instance.type}>`
    )
  }
  return instance
}

/**
 * Phase-A1 transport hook. It intentionally bypasses React so tests and the
 * phase-A2 CanvasRenderingContext2D recorder can replace a retained display
 * list without committing or remounting the host tree.
 */
export function __applyCanvasCommands(
  ref: CanvasCommandRef,
  ops: Uint32Array,
  operands: Float64Array,
  strings: readonly string[]
): void {
  const instance = resolveCanvasInstance(ref) as Instance
  instance.__applyCanvasCommands(ops, operands, strings)
}
