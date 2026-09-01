---
'@gpuix/react': patch
---

Expose UI Events key names and `repeat` on synthetic keyboard events, so shared
DOM-style handlers observe values such as `Enter`, `ArrowDown`, and `Escape`.

Fixes #217
