---
"@gpuix/native": minor
"@gpuix/react": minor
---

`overflow`, `overflowX`, and `overflowY` accept `"auto"`, the most common
overflow value in browser stylesheets. It was rejected by the style
validator, so the element was not a scroll container at all.

`"auto"` scrolls exactly like `"scroll"`. A browser's only difference
between the two is scrollbar reservation — `scroll` always shows a gutter,
`auto` only once content overflows. GPUIX paints no scrollbar gutter at all
and GPUI's scroll handles no-op when there is nothing to scroll, so the two
collapse to the same scroll container, which is the overlay-scrollbar
behaviour macOS browsers default to anyway. An `auto` container whose
content fits reports its viewport as the scroll extent and clamps any scroll
attempt back to 0, like the DOM.

Fixes #302
