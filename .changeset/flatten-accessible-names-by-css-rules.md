---
"@gpuix/native": minor
---

Flatten accessible names by the CSS rules a browser uses. Adjacent text nodes
run together, so `<div role="button">Item{count}</div>` names `Item5` rather
than `Item 5` — React splits that interpolation into two host nodes, and
neither has a box to separate from. Sibling elements still separate with a
space, since each is an item of its parent's flex box, and a `<text>` nested in
a `<text>` does not: those are painted as one line. A hidden element keeps its
boundary while dropping its text, so `5<div ariaHidden/>kg` still names `5 kg`.
The flat string is normalized over the whitespace CSS collapses — the ASCII
set — so a no-break space an author typed survives into the name.

Name-from-contents and `ariaLabelledBy` / `ariaDescribedBy` now flatten through
one walk, so a name computed from an element's own subtree and a name taken
from a referenced one can no longer disagree about spacing. That walk names each
descendant the way accname's step 2F does, which it previously did only while
resolving a reference: a descendant's `ariaLabel` now replaces the subtree it
names when a role is named from its contents. `<div role="button"><img
alt="Save"/></div>` is named `Save`, and a `role="row"` built from labelled
cells takes its name from those labels instead of going unnamed.

One consequence to know: a `visuallyHidden` element projects its text as an
AccessKit value through this flattener, so that value is whitespace-normalized
while the same text painted by a `<text>` host is not. Irregular authored
spacing therefore reads slightly differently projected than painted.

Fixes #272
