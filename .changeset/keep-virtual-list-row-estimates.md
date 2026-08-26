---
'@gpuix/native': patch
'@gpuix/react': patch
---

Keep estimated height for windowed `<virtual-list>` rows that React has not mounted yet.

A missing child used to render as `Empty`. GPUI measured that as height 0. A jump past the mounted window then collapsed the scrollbar.

Unmounted indexes now keep `estimatedItemHeight`. When React mounts the real row, native remasures that index.

```tsx
<virtual-list itemCount={1000} windowStart={0} estimatedItemHeight={40}>
  {visibleRows}
</virtual-list>
```
