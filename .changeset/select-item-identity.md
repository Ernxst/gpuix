---
'@gpuix/react': patch
---

Select content keeps its items mounted with stable host elements across open and close instead of remounting them each open.

Fixes #420
