---
"@gpuix/native": minor
"@gpuix/react": minor
---

Emit a `semantics` block on every tree node — `role`, `label`, `value`,
`placeholder`, and `disabled` — at both tree detail levels, and add
`ByLabelText`, `ByPlaceholderText`, and `ByDisplayValue` query families on test
roots, `within()` scopes, and automation locators.

The locator tree omits `customProps`, which left an input's value unreachable
from a locator; the block is the small, cheap part worth carrying at both
levels. `semantics.role` is the authored `role` prop, not GPUI's computed
accessibility role, and `semantics.value` is the retained `value` prop, so an
uncontrolled input reports the last value the author set rather than its live
editing buffer.

Testing Library's `ByAltText` and `ByTitle` have no desktop counterpart: label
an element with `ariaLabel` and query it by label or by role name.
