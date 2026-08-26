---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add native `focus` and keyboard-only `focusVisible` style states, plus paint-only `outlineColor`, `outlineWidth`, and `outlineOffset` styles.

Focus outlines can sit outside a rounded border without changing the element's measured size. Pointer focus applies `focus` but not `focusVisible`; keyboard focus applies both. State styles remain one level deep and use the same strict style diagnostics as direct styles.

Focused clickable elements now activate through their existing `onClick` handler on Enter or Space. Anchors with an `href` are native tab stops without app-side keyboard wiring, while text editors keep Space as text input.

```tsx
<div
  tabIndex={0}
  style={{
    focusVisible: {
      outlineColor: '#89b4fa',
      outlineWidth: 2,
      outlineOffset: 2,
    },
  }}
/>
```

Fixes #10
