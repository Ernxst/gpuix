---
'@gpuix/native': patch
'@gpuix/react': patch
---

Treat `display: "none"` as a focusability predicate: descendants of a hidden
element refuse programmatic and autoFocus, are skipped by Tab, and a focused
element that becomes hidden blurs. Focus handle lifetime is unchanged, so an
`<input>`/`<textarea>` hidden and shown again keeps working.

Fixes #426
