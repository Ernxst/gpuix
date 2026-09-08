---
'@gpuix/native': patch
---

Reads now settle layout that a draw re-dirtied, up to three passes, and no longer draw for pending animation-frame callbacks alone. A read during a running animation returns the last drawn frame.

Fixes #406
