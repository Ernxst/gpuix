---
'@gpuix/native': minor
'@gpuix/react': minor
---

Transition `hoverWithin` refinements and the container surfaces of `canvas`,
`code`, `diff`, `input`, `textarea`, `markdown`, and `anchored` elements. Custom
surfaces now interpolate the outer-container subset: opacity; solid
background, border, and outline colours; width, height, min/max dimensions;
insets; and shorthand or per-corner radii. `img` hover transitions now use the
same retained track as its existing React-driven transitions.

Element-internal painting remains outside the transition surface: canvas display
lists, syntax-highlight token colours, diff gutters, and markdown text runs are
not independently interpolated. Custom `color` transition properties and
`hoverWithin` refinements are diagnosed; wrap the element in a `div` or `text`
when those states need to animate.

Refs #87
