---
"@gpuix/native": patch
"@gpuix/react": patch
---

Recorded element bounds are now the border box, like `getBoundingClientRect()`.
Every element records its own painted box through gpui's `on_painted` instead of
an `absolute().size_full()` canvas child, whose percentage size resolved against
the container minus its borders: a flex-stretched 400px scroller with
`borderWidth: 4` reported 392px wide even though its border box was 400px.
Layout was always border-box; only the measurement lied.

`borderStyle` is now a supported style property and accepts the full CSS
`border-style` value set. `"none"` and `"hidden"` compute the used border width
to zero, exactly like CSS — the space returns to the content box and nothing
paints. `"solid"` and `"dashed"` paint true to name; `"dotted"` degrades to
dashed and the 3D styles (`"double"`, `"groove"`, `"ridge"`, `"inset"`,
`"outset"`) degrade to solid, the fallback CSS 2.1 permits. State overlays
resolve like CSS: `hover: { borderStyle: "solid" }` overrides a dashed base,
and it turns a border suppressed by `borderStyle: "none"` back on at the
base's declared width. Declaring only `borderWidth` and `borderColor` still
paints a solid border.

Fixes #301
