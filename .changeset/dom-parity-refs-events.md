---
"@gpuix/react": major
---

BREAKING: `<a>` without an `href` no longer infers the `link` role or anchor keyboard activation. HTML-AAM gives the `link` role only to an anchor with an `href`; a bare `<a>` computes `generic`. Announcing one as a link promises a destination that does not exist, and it also picked up link key handling (Enter activates, Space declines) that a generic element should not have.

This changes the accessibility tree for a bare `<a>`: it no longer produces a `Link` node, which also means it no longer derives a name from its descendant text and no longer publishes `ariaCurrent` / `ariaExpanded` state. Add `role="link"` to a scripted anchor that really does navigate, or give it the `href` it should have had. `<a href>` is unaffected, as is any element carrying an explicit `role`.

Adds the DOM spellings that were missing from refs and events:

- `getBoundingClientRect()` on every host ref, returning the `DOMRect` shape — `x`, `y`, `width`, `height`, `top`, `right`, `bottom`, `left` — around the same box as `getBounds()`. Never null: an element with no painted box reports an all-zero rect, as the DOM does. `getBounds()` still returns `null` there for callers who need the distinction.
- `clientX` / `clientY` and `pageX` / `pageY` on events. All four hold the same number: they differ in a browser only by the document's own scroll offset, and this renderer has no scrolling document — scroll containers are ordinary elements.
- `stopImmediatePropagation()`. An element's capture and bubble listeners are both AT_TARGET listeners, so as in the DOM `stopPropagation()` still lets the second one run; this is the form that does not.
- `relatedTarget` on `mouseEnter` and `mouseLeave`, naming the element the pointer left or the one it moved to. It stays `null` on `focus` and `blur`: GPUI's focus subscriptions report only the element whose own focus changed, never the other side of the transition.

Corrects the `autoFocus` and keyboard-event prop docs, which claimed `<input>` needed `autoFocus` or a click to receive key events. Inputs and textareas get an implicit tab index of 0 and join the tab order on their own.

Fixes #227
