---
'@gpuix/react': patch
---

Add a macOS frosted-glass window example that combines `windowBackground: 'blurred'` with a transparent titlebar and translucent React surfaces.

```tsx
render(<App />, {
  titlebarTransparent: true,
  windowBackground: 'blurred',
})
```
