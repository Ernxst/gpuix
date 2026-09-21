---
'@gpuix/native': patch
---

Empty text nodes now take zero layout space instead of reserving a full line.

GPUI's text layout reserves a full line height for an empty string, and Solid's
universal renderer creates an empty placeholder text node for every dynamic hole
(`<Show>`, `<For>`, `{cond && <x/>}`). Those placeholders were painting as
26px-tall lines, so any conditional inside a flex column added a phantom row. In
the Solid chat example this stretched every `Select` menu item to ~56px because
`MenuRowInner` puts an optional description `<Show>` inside a column.

An empty string paints no glyphs, so it now contributes no height, matching the
DOM. React never emits empty text nodes, so this is a no-op for React apps.

```tsx
// Solid: this row is now 30px, not 56px
<div style={{ display: 'flex', flexDirection: 'column' }}>
  <text>Label</text>
  <Show when={description}>
    <text>{description}</text>
  </Show>
</div>
```
