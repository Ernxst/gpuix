---
"@gpuix/native": minor
"@gpuix/react": minor
---

`interpolateSize: "allow-keywords"` lets a `width` or `height` transition travel
to or from `auto`, so a container whose target size is intrinsic can animate
open and closed instead of stepping:

```tsx
const lane = {
  display: 'flex',
  minWidth: 0,
  overflow: 'hidden',
  transition: { properties: ['width'], durationMs: 120 },
}

<div style={{ interpolateSize: 'allow-keywords' }}>
  <div style={{ ...lane, width: open ? 'auto' : 0 }}>{children}</div>
</div>
```

This mirrors CSS `interpolate-size`: the property is inherited, so one
declaration opts a subtree in and a nested `"numeric-only"` (the default) turns
it back off. The number comes from GPUI's own layout of the intrinsic state, so
an app that used to measure its content in a layout effect and state both
widths can delete the measurement, the state, and the ref. The endpoint is
measured when the run starts and held for the run, so streaming text or a
nested transition cannot push the finish line out; the settled element is
`auto` again rather than a pinned pixel width, so it picks up whatever the
content grew to.

It covers `width` and `height` on `<div>` and `<text>`, and only on an axis
whose `auto` comes from the element's own content. A stretched axis — a flex
cross axis under the default `stretch`, a block child's width, a grid item —
resolves to the parent's size, where no content measurement applies, so it
keeps stepping. `minWidth`, `minHeight`, `maxWidth`, `maxHeight` and the custom
surfaces' outer containers keep stepping too, and reduced motion snaps as it
does for every other transition. The measured endpoint is the max-content size
on the animated axis; README documents where that diverges from a squeezed lane.

Fixes #295
