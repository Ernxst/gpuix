---
'@gpuix/native': minor
'@gpuix/react': minor
'@gpuix/plugins': minor
---

Add `focusWithin`, `activeWithin`, and `dragOver` native style states.

`focusWithin` styles a container while it or a descendant has focus, matching CSS `:focus-within`. It needs no `hoverGroup` marker: the relationship comes from the focused element's own ancestry, and the container gets a focus handle without becoming a tab stop even without `tabIndex`.

`activeWithin` shares the `hoverGroup` marker with `hoverWithin`, styling a descendant while the nearest marked ancestor is pressed, matching CSS `.group:active .descendant`.

`dragOver` styles an element while OS files are dragged over it. Desktop-only: there is no web equivalent.

CSS modules now accept `:focus-within` alongside the pseudo-classes they already fold into a native state style.

Fixes #629, #570
