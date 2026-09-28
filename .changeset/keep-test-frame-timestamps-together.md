---
'@gpuix/native': patch
'@gpuix/react': patch
---

Keep test-renderer animation-frame requests pending until `advanceAsyncClock()`.
`drawPendingFrame()` can still advance GPUI frame work, but it no longer leaves
an earlier timestamp for the next clock advance to deliver.

Fixes #706
