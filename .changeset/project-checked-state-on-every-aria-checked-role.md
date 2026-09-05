---
"@gpuix/native": patch
---

Project a checked state for every WAI-ARIA role that carries `aria-checked`.
`ariaChecked` was applied to `role="checkbox"` and `role="switch"` alone and
dropped, with an "ignored property" style diagnostic, on `role="radio"`,
`menuitemcheckbox`, `menuitemradio`, `option`, and `treeitem` — so a radio group
reached the accessibility tree with no checked item, where a browser computes
one.
