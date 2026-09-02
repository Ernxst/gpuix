---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add a true-only `visuallyHidden` semantic prop that keeps a named node in AccessKit without painting or reserving layout space. It projects the element as a single accessibility node carrying its own semantics and its flattened text — as the accessible name under a role that names itself from its contents, and as the node's value under any other role, because a one-node projection has no child node to carry the text the way painted text does. A plain-text subtree survives under any role, so the wrapper the web spells `<div role="status" class="sr-only">` keeps its text in the accessibility tree, and `role="status"` additionally makes it a live region whose updates are announced. It is rejected with a property diagnostic on interactive elements, and on hosts whose subtree carries accessibility semantics of its own or a focusable or interactive descendant; a visually hidden subtree with its own nodes or controls is not supported yet.

Fixes #133
