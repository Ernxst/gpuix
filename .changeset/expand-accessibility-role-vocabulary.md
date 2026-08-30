---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose every WAI-ARIA, Graphics ARIA, and Digital Publishing ARIA role with a
corresponding AccessKit role, including complete table, list, listbox, and
landmark families. Make the TypeScript role vocabulary declaration-mergeable,
forward row and column indices, counts, and spans to AccessKit, and scope
contents-derived accessible names and descendant-label suppression to roles whose
ARIA definitions allow them. Author-named roles now preserve descendant text as
separate accessible nodes, including ARIA 1.3's author-only `listitem` and
`tooltip` name-from-content classifications.

Fixes #129 and #174
