import type { CanvasPublicInstance } from "../types/host.js"

// `toDataURL()` never produces a data URL here, so it must not type as one.
// The old `: string` signature made this assignment compile and then hand the
// caller `undefined` at runtime.
export function dataUrlIsNotAString(canvas: CanvasPublicInstance): void {
  // @ts-expect-error toDataURL() returns undefined, never a data URL string.
  const url: string = canvas.toDataURL()
  void url
}

// The honest return type is what the implementation actually produces.
export function dataUrlIsUndefined(canvas: CanvasPublicInstance): undefined {
  return canvas.toDataURL("image/png")
}
