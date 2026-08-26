---
'@gpuix/native': patch
---

Record last-paint automation bounds for native `<img>` elements, so tests and
automation can assert that a successfully loaded image painted.

Fixes #64
