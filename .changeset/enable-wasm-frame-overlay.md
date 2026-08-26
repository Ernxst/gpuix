---
'@gpuix/native': patch
'@gpuix/react': patch
---

Enable the debug frame overlay on the browser Wasm build.

`render({ debugFrameOverlay })` already worked on desktop. The Wasm renderer now exposes `setDebugFrameOverlay` / `getDebugFrameOverlay`. If the GPUI window is still opening, the mode is stored and applied on first paint. The web chat example turns **full** mode on so draw time is visible in the canvas.

```ts
render(<App />, { debugFrameOverlay: 'full' })
```
