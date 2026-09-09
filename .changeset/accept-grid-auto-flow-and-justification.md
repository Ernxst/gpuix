---
'@gpuix/native': minor
'@gpuix/react': minor
---

Accept `gridAutoFlow`, `gridAutoRows`, `gridAutoColumns`, `justifyItems`, and
`justifySelf`. `gridAutoFlow` controls how items auto-place into implicit
tracks (`"row"`, `"column"`, `"dense"`, `"row dense"`, `"column dense"`);
`gridAutoRows` / `gridAutoColumns` size those implicit tracks with the same
track objects as `gridTemplateColumns` / `-Rows`, minus `repeat`; `justifyItems`
and `justifySelf` align grid items on the inline axis and are ignored by flex
containers, as in CSS.

Fixes #251
