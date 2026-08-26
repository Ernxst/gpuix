---
'@gpuix/native': patch
---

Dispatch a matching key-up event for each keystroke in the native test renderer, restoring Enter and Space keyboard activation through `simulateKeystrokes`.

Fixes #60
