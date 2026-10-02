---
'@gpuix/native': patch
'@gpuix/react': patch
---

Apply per-edge collision padding when floating positioners switch anchors or
shift against the window, matching Base UI's padded collision boundary.

Fixes #836
