---
'@gpuix/native': patch
'@gpuix/react': patch
---

Harden virtual-list row boundaries, initial estimates, and cross-axis sizing.

Direct `<virtual-list>` usage now defaults `estimatedItemHeight` to 48 px, while
`estimatedItemHeight={null}` explicitly opts out. Uniform estimates survive the
list's first width observation, so unvisited rows contribute to the scrollbar
from the first frame.

Development renders reject a single wrapper child unless `itemCount={1}` makes
the one-row intent explicit, with guidance toward `VirtualList` and its
`itemCount`/`renderItem` API. Every native row now gets the same full-width
wrapper while explicit child widths and focus identity remain intact.

Fixes #1
