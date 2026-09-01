---
'@gpuix/react': patch
---

Match loaded DOM `Image` dimensions so unconstrained `width` and `height` expose
the decoded image size alongside `naturalWidth` and `naturalHeight`. Explicit
constructor or property dimensions remain authoritative, matching the browser.

Document GPUIX canvas bitmap dimensions as a deliberate desktop-superset
coordinate space that rasterizes at layout resolution, including guidance for
shared device-pixel-ratio code.

Fixes #142
