---
'@gpuix/native': patch
'@gpuix/react': patch
---

Match DOM keyboard activation: anchors and href-bearing aliases activate on
unmodified Enter only, while button-kind elements retain Enter and Space.

Fixes #63
