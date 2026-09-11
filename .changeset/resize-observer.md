---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add a native post-paint `ResizeObserver` to `@gpuix/react/globals`.

`ResizeObserver` observes GPUIX public instances with `content-box`,
`border-box`, or `device-pixel-content-box` sizing and batches changed entries
per painted frame.

Fixes #483
