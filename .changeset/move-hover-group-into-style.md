---
'@gpuix/native': minor
'@gpuix/react': minor
---

Move `hoverGroup` into `style` and align `hoverWithin` with the CSS
`.group:hover .descendant` pattern. `hoverWithin` now applies to every element
type, activates when any marked ancestor is hovered (including through nested
groups), and uses the ancestor's full hit-tested box including padding.

**Breaking:** `hoverGroup` is no longer an element prop. Replace
`<div hoverGroup="row">` with `<div style={{ hoverGroup: "row" }}>`.
