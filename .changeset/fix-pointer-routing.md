---
'@gpuix/native': patch
'@gpuix/react': patch
---

Keep captured pointer drags routed to their retained element across redraws,
outside its bounds, and through mouse-down-driven React commits. Mouse event
payloads and host refs now expose `setPointerCapture()` and
`releasePointerCapture()`.

Passive fills and absolute decorations no longer block controls behind them.
Pointer, focus, and scroll behavior still opts a node into hit testing;
`pointerEvents: "auto"` forces participation and `"none"` always passes
ordinary hits through.

Fixes #14
Fixes #31
