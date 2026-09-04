---
"@gpuix/react": minor
---

Add `configureTestWindow`, a suite-wide default for the offscreen test window's
`width`, `height`, and `scaleFactor`, in the style of `configureScreenshots`:
set it once from a vitest setup file rather than repeating the geometry at every
`createTestRoot()` and `render()`. Precedence is per field — a per-call option
wins over the configured default, which wins over the built-in 1280x800 at scale
factor 2 — and `configureTestWindow({})` restores the built-in geometry.

Fixes #330
