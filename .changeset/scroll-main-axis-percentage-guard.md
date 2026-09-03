---
"@gpuix/react": patch
---

Percentage `minWidth` on the scroll main axis — a child of a `flexDirection: "row"`
container with `overflowX: "scroll"` — is now covered by regression tests, for
content narrower than the scrollport, for a percentage that overflows it, and for
a child with no authored flex properties. The behaviour itself already shipped in
`0.7.0-fork.1` (#184); only the cross-axis half was under test.

Refs #294
