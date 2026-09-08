---
'@gpuix/react': patch
---

Reject in-flight and later automation requests with the exit reason when a `launch()`-ed child dies instead of leaving them pending forever.

Fixes #315
