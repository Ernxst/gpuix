---
'@gpuix/native': minor
'@gpuix/react': minor
---

A role-less element carrying `ariaLabel`, `ariaLabelledBy`, `ariaDescription` or `ariaDescribedBy` now projects a `generic` node with that name and description (platform adapters prune it; the test harness and `toHaveAccessibleName`/`toHaveAccessibleDescription` see it), a role-less descendant's `ariaLabel` now contributes to an ancestor's name from contents, and plain `<input>`/`<textarea>` project `textbox` nodes named by `ariaLabelledBy`, `ariaLabel` or `placeholder` with the live value.

Fixes #353
Fixes #358
