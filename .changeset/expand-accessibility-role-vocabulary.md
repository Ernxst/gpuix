---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose every WAI-ARIA, Graphics ARIA, and Digital Publishing ARIA role with a
corresponding AccessKit role, including complete table, list, listbox, and
landmark families. Make the TypeScript role vocabulary declaration-mergeable,
forward row and column indices, counts, and spans to AccessKit, and scope
contents-derived accessible names to roles whose ARIA definitions allow them.

Fixes #129 and #174
