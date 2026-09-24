---
'@gpuix/react': patch
---

Inline styles keep precedence over native state styles compiled from CSS modules, so an authored value stays in effect while that state is active.

Fixes #644
