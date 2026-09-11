---
'@gpuix/native': minor
'@gpuix/react': minor
---

A bare numeric `lineHeight`, such as `1.35`, now reads as a unitless multiplier of the resolved font size, matching React DOM's `lineHeight` instead of the previous pixel shorthand. Callers who want an absolute row height pass `"Npx"`, for example `"20px"`.

Fixes #486
