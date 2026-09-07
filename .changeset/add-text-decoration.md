---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `textDecoration` style prop with `"underline"`, `"line-through"`, and `"none"` values.

```tsx
<text style={{ color: '#3b82f6', textDecoration: 'underline' }}>
  Learn more
</text>
```

GPUI already paints underlines and strikethroughs natively.
This wires the existing API through `StyleDesc` so React components can use it.
