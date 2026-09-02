---
"@gpuix/native": minor
---

Flatten accessible names by the CSS rules a browser uses. Adjacent text nodes
run together, so `<div role="button">Item{count}</div>` names `Item5` rather
than `Item 5` — React splits that interpolation into two host nodes, and
neither has a box to separate from. Sibling elements still separate with a
space, since each is an item of its parent's flex box, and a `<text>` nested in
a `<text>` does not: those are painted as one line. The flat string is
whitespace-normalized at the end, as accname requires.

Name-from-contents and `ariaLabelledBy` / `ariaDescribedBy` now flatten through
one walk, so a name computed from an element's own subtree and a name taken
from a referenced one can no longer disagree about spacing.

Fixes #272
