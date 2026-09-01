---
'@gpuix/native': major
'@gpuix/react': major
---

Require custom renderers to implement one atomic `applyBatch(json)` mutation transport.

`NativeRenderer` no longer exposes the individual React mutation methods.
React now collects raw style and custom-prop values and sends one validated
batch per commit on desktop, web, and in the test renderer.
