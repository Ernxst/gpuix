---
'@gpuix/native': minor
'@gpuix/react': minor
---

Accept `listStyle: "none"` and `listStyleType: "none"`. Native `<ul>`, `<ol>` and `<li>` paint no marker, so `"none"` is the one value that matches what is drawn; every other marker value is still rejected with a strict-style diagnostic.

Fixes #369
