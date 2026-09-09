---
'@gpuix/react': patch
---

`cancelAnimationFrame` called from a frame callback now stops a sibling callback queued for the same frame, matching the browser's animation-frame steps.

Fixes #421
