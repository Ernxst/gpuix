---
"@gpuix/native": minor
"@gpuix/react": minor
---

Accept standard `id` and `data-*` attributes on host elements. Author IDs now
appear in style diagnostics and can be resolved by the GPU test renderer,
while identity metadata remains readable through synthetic-event host handles.

Fixes #27
