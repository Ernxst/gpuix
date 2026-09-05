---
"@gpuix/react": minor
---

Add `toBeInViewport(options?)` to `@gpuix/react/testing/matchers`, vitest browser
mode's matcher over the desktop's one viewport: the window.

`{ ratio }` is the least fraction of the element's own area that must be
visible, an `IntersectionObserver` ratio, so `{ ratio: 1 }` demands the whole
box and the default of `0` accepts any part of it. The intersection is the
observer's: the painted box is clipped by every clipping ancestor as well as by
the window, so a row inside a scroller that has clipped it away is not in the
viewport even while its box sits inside the window. It states directly, and more
accurately, what a hand-rolled `getBoundingClientRect()` comparison against the
window size was claiming in a scrolling or culling test.

The clip is the mask GPUI paints: an ancestor clips both axes as soon as either
`overflow` is not `visible`, a `<virtual-list>` clips without declaring one, and
a clipper with a visible border clips to its content box.

An element that painted no box has nothing to measure and is not in the viewport
— a culled `<virtual-list>` row reports as off screen. An element with no area
follows the observer's rule for a zero-area target: the ratio is 1 when the box
intersects the viewport or touches its edge, and 0 otherwise. Unlike vitest's,
the matcher is synchronous: vitest's is asynchronous only because an
`IntersectionObserver` is.
