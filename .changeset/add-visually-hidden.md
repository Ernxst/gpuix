---
'@gpuix/native': patch
'@gpuix/react': patch
---

Add a true-only `visuallyHidden` semantic prop that keeps a named node in AccessKit without painting or reserving layout space. It projects the element as a single accessibility node carrying its own semantics and its flattened text — as the accessible name under a role that names itself from its contents, and as the node's value under any other role, the slot the painted text would have used. A plain-text subtree survives under any role, so the live region the web spells `<div role="status" class="sr-only">` works as written. It is rejected with a property diagnostic on interactive elements and on hosts whose subtree carries semantics of its own; a visually hidden subtree with its own roled nodes is not supported yet.

Fixes #133
