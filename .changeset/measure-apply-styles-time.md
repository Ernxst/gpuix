---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose `takeApplyStylesMicros()` on the test renderer: the microseconds spent
re-deriving gpui styles from `StyleDesc` since the last call, cleared on read.
It is a subset of `takeRenderBuildMicros()`, so an app can measure what a
per-node style cache could remove before building one.
