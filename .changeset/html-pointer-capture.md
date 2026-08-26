---
'@gpuix/native': minor
'@gpuix/react': minor
---

Continue `onMouseMove` and `onMouseUp` after the pointer leaves the element that received `onMouseDown`.

This matches HTML [`setPointerCapture`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture). If the same node listens for down and move, GPUIX captures the pointer until mouse up. A clip, resizer, or slider can keep receiving events without a full-window overlay.

```tsx
<div
  onMouseDown={(e) => startDrag(e)}
  onMouseMove={(e) => moveDrag(e)}
  onMouseUp={() => endDrag()}
/>
```

A node with only `onMouseDown` / `onMouseUp` does not capture. Release outside still cancels the click, as in the DOM.

Fixes #20
