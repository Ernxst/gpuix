---
"@gpuix/native": minor
"@gpuix/react": minor
---

Expose `scrollTop`, `scrollLeft`, `scrollWidth`, `scrollHeight`, `clientWidth`, `clientHeight`, `scrollTo()` and `scrollIntoView()` on host element refs, so shared React components can read scroll position and extent — "am I at the bottom?" — with the standard `Element` API and the DOM's positive-down sign.

`renderer.scrollTo(id, x, y)` keeps its existing negative-y convention: the instance API is the web-shaped alias over it, and every in-house caller of the low-level renderer stays valid.

Fixes #221
