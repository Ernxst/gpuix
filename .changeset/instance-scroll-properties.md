---
"@gpuix/native": minor
"@gpuix/react": minor
---

Expose `scrollTop`, `scrollLeft`, `scrollWidth`, `scrollHeight`, `clientWidth`, `clientHeight`, `scrollTo()` and `scrollIntoView()` on host element refs, so shared React components can read scroll position and extent — "am I at the bottom?" — with the standard `Element` API and the DOM's positive-down sign.

`renderer.scrollTo(id, x, y)` keeps its existing negative-y convention: the instance API is the web-shaped alias over it, and every in-house caller of the low-level renderer stays valid.

Reading a scroll property forces layout in the native renderer, as `Element.scrollHeight` does, so the chat-autoscroll idiom `el.scrollTop = el.scrollHeight` sees the real extent from a mount effect. `scrollIntoView()` defaults to the DOM's `block: "start"` and honors `block: "nearest"`; alignments gpui cannot express warn once and reveal by the nearest edge, or throw under `strictStyles`. The four extents round to whole pixels, matching their `long` DOM types.

Only `overflow: "scroll"` elements and `<virtual-list>` are scroll containers here. `overflow: "hidden"`, which the web treats as programmatically scrollable, reports its viewport as its scroll extent and drops scroll writes.

Fixes #221
