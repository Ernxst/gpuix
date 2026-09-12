---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose `isWindowDirty()` on the test renderer. A tree at rest reports `false`
after a draw, so `drawPendingFrame()` is a no-op; a window that re-dirties
every frame makes a page pay a second full draw per update, which a harness
that only calls `flush()` cannot see. Reading it needs no debug frame overlay,
which would dirty the window itself and make the measurement circular.
