---
'@gpuix/native': patch
'@gpuix/react': patch
---

Add a true-only `visuallyHidden` semantic prop that keeps a named node in AccessKit without painting or reserving layout space. It projects the element as a single accessibility node, so it is rejected with a property diagnostic on interactive elements and on non-`<text>` hosts with children; a visually hidden subtree is not supported yet.

Fixes #133
