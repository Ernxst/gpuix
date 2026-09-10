---
'@gpuix/native': patch
---

`<input>` and `<textarea>` now size their rows from `style.fontSize` and `style.lineHeight`.

Without an explicit `lineHeight`, the row follows GPUI's default leading, so a larger `fontSize` grows the box. Pass `lineHeight` to set the row in pixels. `minRows` and `maxRows` still multiply that row height.

```tsx
<textarea
  value={draft}
  minRows={1}
  maxRows={8}
  style={{ fontSize: 14, lineHeight: 20 }}
/>
```
