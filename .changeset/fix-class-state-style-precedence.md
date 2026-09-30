---
'@gpuix/react': patch
---

Inline styles keep precedence over native state styles compiled from CSS modules, while undefined inline values leave the compiled class declaration in effect.

Fixes #644
