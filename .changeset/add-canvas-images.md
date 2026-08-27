---
'@gpuix/native': patch
'@gpuix/react': patch
---

Add browser-shaped `Image` and `createImageBitmap` exports and replay all three Canvas 2D `drawImage` forms through GPUI's shared image cache.

Closes #84
