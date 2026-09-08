---
'@gpuix/native': patch
---

`min-content` on text, and on `min-content` grid tracks, now measures the longest word instead of the whole string. A `<text>` flex item shrinks and wraps to its automatic minimum size instead of overflowing its row. Max-content measurement no longer reuses a wrapped layout left over from an earlier probe.

Fixes #399
