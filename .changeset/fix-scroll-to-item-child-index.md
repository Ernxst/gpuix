---
"@gpuix/native": patch
---

Fixes `renderer.scrollToItem(elementId, index)` on an overflow scroller revealing one row short. The index was handed straight to GPUI's `ScrollHandle::scroll_to_item`, which counts the children it painted, and every element paints an automation bounds tracker before its own content and children — so index 3 revealed the third child, not the fourth. The public API now maps the child index the same way focus reveal and `scrollIntoView()` already do. On a `<text>` scroller, whose subtree GPUI paints as a single flattened run, no index names a child, so the reveal is left unrequested rather than scrolling to an unrelated row.

Virtual lists are unaffected: their indices address list rows, not painted children.

Fixes #245
