---
'@gpuix/native': patch
'@gpuix/react': patch
---

Deliver test-renderer animation-frame callbacks synchronously from
`advanceAsyncClock()`, with native frame timestamps and committed state updates
visible before the call returns. The test renderer's `requestFrame()` no
longer takes a callback argument — a test-support surface only.

Fixes #411
