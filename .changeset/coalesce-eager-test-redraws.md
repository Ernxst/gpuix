---
'@gpuix/native': patch
'@gpuix/react': patch
---

Eager test roots draw once after pending native tasks settle instead of redrawing
after each image load. Completed image loads remain visible after `flush()`.

Fixes #708
