---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add native desktop window controls to the renderer.

```tsx
const renderer = useGpuixRequired()

renderer.minimizeWindow?.()
renderer.zoomWindow?.()
renderer.toggleFullscreen?.()
```

The methods forward to GPUI's platform window on macOS, Windows, Linux, and
FreeBSD.

Fixes remorses/gpuix#68
