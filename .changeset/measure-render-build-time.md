---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose `takeRenderBuildMicros()` on the test renderer: the microseconds spent
rebuilding the element tree since the last call, cleared on read. Whatever a
draw costs beyond it is layout, prepaint and paint, so the two halves can be
compared without an external profiler.
