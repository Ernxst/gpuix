---
'@gpuix/native': patch
'@gpuix/react': patch
---

Retain `hoverWithin` styles while a hover-group member holds pointer capture.

The style now clears on capture release outside the group, rather than during the captured drag.

Fixes #9
