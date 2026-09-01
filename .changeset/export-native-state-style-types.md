---
"@gpuix/react": patch
---

Export `NativeStateStyleKey` and `NativeStateStyle` so shared web/native style
helpers can add GPUIX state styles without maintaining a stale key union.

Fixes #168
