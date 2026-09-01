---
"@gpuix/react": patch
---

Warn when a host element receives `className`, or fail in strict-style mode, so shared DOM components do not silently lose CSS-class styling on the native renderer.

Fixes #219
