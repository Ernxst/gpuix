---
"@gpuix/native": minor
"@gpuix/react": minor
---

Intrinsic keyword probes now measure the effective state refinement, including its authored layout and typography fields, so hover and focus content sizes match the state being painted.

Static intrinsic probes are cached until their subtree, interaction state, viewport, inherited text context, wrapping width, or image content changes. The test renderer exposes the probe layout count for verifying this behavior.

Fixes #313
Fixes #310
