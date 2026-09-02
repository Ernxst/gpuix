---
"@gpuix/native": minor
"@gpuix/react": minor
---

Project accessibility props from every custom element. `<svg>`, `<canvas>`,
`<code>`, `<diff>`, `<markdown>`, and `<anchored>` never called the shared
accessibility projection, so even an explicit `role` or `ariaLabel` on them was
structurally inert and was reported as an unsupported host. A `<canvas
role="img" ariaLabel="Throughput chart">` now names a chart and an `<anchored
role="dialog">` announces a popover. A bare `<svg>` infers `graphics-document`
from SVG-AAM.

`<virtual-list>` is now the only host that reports accessibility props as
unsupported.

Fixes #222
