---
"@gpuix/react": minor
---

Add `configureTestWindow`, a suite-wide default for the offscreen test window's
`width`, `height`, and `scaleFactor`, in the style of `configureScreenshots`:
set it once from a vitest setup file rather than repeating the geometry at every
`createTestRoot()` and `render()`. Precedence is per field — a per-call option
wins over the configured default, which wins over the built-in 1280x800 at scale
factor 2 — and `configureTestWindow({})` restores the built-in geometry.
`configuredTestWindow()` reads the defaults back, so a test that changes them
for itself can restore what the suite configured rather than resetting to the
built-in geometry.

A window's geometry is fixed when it is constructed, so configuring drops the
window `render()` shares and — unless the new defaults resolve to the geometry
it was opened at — the probe window the first `TestRenderer` reuses. `render()`
now decides window reuse on the resolved geometry, so a `configureTestWindow`
after the first `render()` in a file reaches every later one.

Fixes #330
