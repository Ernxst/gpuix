---
'@gpuix/native': minor
'@gpuix/react': minor
---

Accept the `border`, `borderTop`, `borderRight`, `borderBottom`, and
`borderLeft` shorthands, plus a multi-value `borderWidth` string. Each folds
into the existing longhand fields. GPUI paints one border color and style for
all four sides, so when two of the shorthands disagree on color or style, one
is rejected with a diagnostic naming both.

Fixes #403
