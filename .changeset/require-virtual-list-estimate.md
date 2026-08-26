---
'@gpuix/react': patch
'@gpuix/native': patch
---

Require `estimatedItemHeight` when `<virtual-list>` uses `itemCount`.

Windowed mode needs a height hint for rows React has not mounted. Without it, a jump past the window stored height 0 and collapsed the scrollbar.

TypeScript now requires the estimate next to `itemCount`. Native ignores `itemCount` when the estimate is missing, so the list stays the mounted children only.

```tsx
<virtual-list itemCount={1000} windowStart={0} estimatedItemHeight={40}>
  {visibleRows}
</virtual-list>
```
