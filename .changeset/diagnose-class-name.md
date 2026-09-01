---
"@gpuix/react": patch
---

Warn when a host element receives a non-empty `className`, or fail in strict-style mode, so shared DOM components do not silently lose CSS-class styling on the native renderer. `className=""` and `className={null}` apply no classes on the web either and stay silent.

Fixes #219
