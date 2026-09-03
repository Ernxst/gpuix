---
"@gpuix/native": minor
"@gpuix/react": minor
---

Dimension props (`width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
`maxHeight`) accept the CSS intrinsic sizing keywords `min-content`,
`max-content`, and `fit-content`, and the viewport units `vw` / `vh`.
Previously all five were rejected by the style validator (`invalid length at
byte 0`), so none of them ever reached layout.

`vw` / `vh` resolve against the window's viewport size, per frame, so they
track a resize the way a browser does, and they compose inside `calc()` /
`clamp()`.

The intrinsic keywords carry no representation in GPUI's `Length` or in
taffy's flex and block algorithms (taffy 0.13 reserves those tags for grid
tracks), so the renderer measures them: the element is built once more with
the keyword props forced back to `auto` and laid out as its own root under
`AvailableSpace::MinContent` / `MaxContent`, the same probe mechanism
`interpolateSize` uses for intrinsic transition endpoints. `fit-content`
substitutes its CSS definition, `clamp(min-content, stretch, max-content)`,
with `stretch` expressed as `100%` of the containing block. On the block axis
all three keywords resolve to the content's laid-out height, which is what a
browser computes for them there. Keywords are measured on `<div>` and
`<text>`; a custom element cannot be re-entered to measure, so a keyword
there behaves as `auto`.

Fixes #300
