---
'@gpuix/native': patch
'@gpuix/react': patch
---

Keep uniformly rounded and per-corner rounded Select, Combobox, and Tooltip
content rounded through the complete deferred overlay surface. The anchored
fallback background no longer appears as square corners behind a rounded popup.

The outer surface now also owns visibility and opacity, including hover and
active refinements, so its fallback fill follows the content without multiplying
opacity. `pointerEvents: "none"` disables the anchored occluder.
