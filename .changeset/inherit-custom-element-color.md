---
'@gpuix/native': patch
'@gpuix/react': patch
---

Document and regression-test inherited `color` for custom SVG icons. `<svg>`
is always the monochrome icon surface; use `<img>` for full-colour SVGs.

Fixes #7
