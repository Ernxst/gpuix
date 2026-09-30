---
'@gpuix/native': minor
'@gpuix/react': minor
---

Enable the browser-shaped native WebGPU rendering slice in production macOS
windows. GPU-produced Metal textures now compose inside ordinary `<canvas>`
elements without CPU pixel readback or blocking frame submission.

This experimental slice supports `bgra8unorm` clear passes, WGSL shader modules,
automatic-layout triangle-list pipelines, mapped-at-creation buffers,
`writeBuffer`, vertex and index layouts, indexed drawing, ordered multi-pass
submission, logical-device error containment, and deterministic renderer
invalidation. It does not yet include bind groups, texture uploads, depth, or
Three.js support.
