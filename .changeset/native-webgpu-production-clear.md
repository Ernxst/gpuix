---
'@gpuix/native': minor
'@gpuix/react': minor
---

Enable the browser-shaped native WebGPU clear-and-present slice in production
macOS windows. GPU-produced Metal textures now compose inside ordinary
`<canvas>` elements without CPU pixel readback or blocking frame submission.

This experimental slice supports `bgra8unorm` clear passes only; it does not yet
include buffers, shaders, pipelines, texture uploads, or Three.js support.
