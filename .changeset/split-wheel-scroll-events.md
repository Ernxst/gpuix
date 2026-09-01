---
"@gpuix/native": minor
"@gpuix/react": major
---

Add DOM-compatible `onWheel` events with pixel or line deltas, and make `onScroll` report non-bubbling scroll-position changes.

BREAKING: Wheel handlers must move from `onScroll` to `onWheel`. `onScroll` no longer carries wheel deltas and now fires only after a scrollable element's position changes; read `event.currentTarget.scrollTop` or `scrollLeft` instead.

BREAKING: `deltaX` and `deltaY` use DOM signs, the negation of the platform deltas the old `onScroll` payload exposed. `deltaY` is positive scrolling down. Handlers that negated the old values should drop the compensation.

Fixes #220
