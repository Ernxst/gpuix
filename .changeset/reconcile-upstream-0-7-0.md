---
'@gpuix/native': patch
'@gpuix/react': patch
---

Reconcile the fork with upstream 0.7.0, adopting the element keyboard-callback documentation and preserving the fork's Tab focus model with `preventDefault()`, its focus-reveal traversal, and its renderer capability reads.

`requiresTick` is now true on Windows and Linux, so `startFrameLoop` runs on every platform; its ticks there observe whether the GPUI UI thread is still alive rather than pumping the platform loop.
