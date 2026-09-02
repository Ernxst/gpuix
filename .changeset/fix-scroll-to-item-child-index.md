---
"@gpuix/native": patch
---

Fixes `renderer.scrollToItem(elementId, index)` on an overflow scroller revealing one row short. The index was handed straight to GPUI's `ScrollHandle::scroll_to_item`, which counts the children it painted, and every element paints an automation bounds tracker before its own content and children — so index 3 revealed the third child, not the fourth. The public API now maps the child index the same way focus reveal and `scrollIntoView()` already do.

That shared mapping was itself one short for a scroller carrying an `onScroll` listener, which paints a second canvas of GPUI's own — the scroll-position tracker — in front of the retained children. So this also fixes the mapping's existing consumers: focus reveal and `scrollIntoView()` on a scroller that reports its scroll position now land on the element they name.

`scrollToItem` now does nothing, rather than revealing an unrelated row, in the two cases where no index names a painted child:

- **an index past the last child.** GPUI holds a reveal it cannot satisfy until a frame can, so a stale index would land as an unexplained jump on the first later frame whose child list is long enough.
- **a scrolling `<text>`**, whose whole subtree GPUI paints as a single flattened run. Documented in the README next to the scroll API, with `scrollTo` as the way to move one.

Virtual lists are unaffected: their indices address list rows, not painted children.

Fixes #245
