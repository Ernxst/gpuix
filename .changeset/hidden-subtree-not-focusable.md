---
'@gpuix/native': patch
'@gpuix/react': patch
---

Treat `display: "none"` as a focusability predicate: a hidden element and its
descendants are not focusable, are skipped by Tab, and a focused element that
becomes hidden blurs; `autoFocus` on a hidden element does not fire, as in the
browser, even after it is later shown. Focus handle lifetime is unchanged, so
an `<input>`/`<textarea>` hidden and shown again keeps working.

Fixes #426
