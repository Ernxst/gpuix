---
"@gpuix/react": major
---

BREAKING: `CanvasPublicInstance.toDataURL()` is typed `undefined` instead of `string`. The implementation always emitted a diagnostic and returned `undefined` cast to `never`, so the old signature handed callers `undefined` typed as a data URL and the failure surfaced somewhere else entirely. Code that assigned the result to a `string` now fails to compile, which is the point; there was never a data URL to assign.

Runtime behaviour is unchanged. Under `strictStyles` the call throws `Canvas2DNotImplementedError`; otherwise it warns once per element and returns `undefined`.

It stays unimplemented for a named reason. `HTMLCanvasElement.toDataURL()` encodes the canvas bitmap, and GPUI has no per-element readback. The one readback that exists, `captureScreenshot()`, is a whole-window `render_to_image()` built only into `test-support` builds: cropping it to the element would return the composited pixels at the laid-out size, so anything painted over the canvas leaks in, an occluded canvas returns nothing, and the dimensions are the layout box rather than the bitmap's `width` x `height`. That trades a wrong type for wrong pixels.

Keep the source data you drew from and re-encode that, or capture through the automation screenshot path when a window image is what you actually want.

Fixes #225
