---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `focusNext()` and `focusPrevious()` to `GpuixRenderer`, `TestGpuixRenderer`, the web renderer, and `TestRenderer`.

Both take the same path as the default `Tab` and `Shift+Tab`: reveal the next focusable row when it is a virtual item that has not been painted yet, move GPUI focus with `window.focus_next()` / `window.focus_prev()`, then scroll the newly focused element into view. Neither dispatches a `keydown`, so a `preventDefault()` handler cannot cancel them.

```ts
renderer.focusNext()
renderer.focusPrevious()
```
