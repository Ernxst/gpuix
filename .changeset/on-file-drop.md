---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add bubbling DOM-shaped drag-and-drop events for Finder and OS file drops.

Use `onDragOver` with `preventDefault()` to accept a drop, then read files from `onDrop`.

```tsx
<div
  onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => openFiles(event.dataTransfer.files)}
  style={{ width: 400, height: 300 }}
>
  <text>Drop files here</text>
</div>
```

`event.dataTransfer.files` contains `GpuixFile` objects with absolute `path`, `name`, `size`, `lastModified`, and extension-derived `type`. `onFileDrop` remains the desktop-namespace alias for `onDrop`.

Works on `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `markdown`, `diff`, and `anchored`. `<virtual-list>` does not take this event; wrap it in a `div`. Desktop only. Internal GPUI drags and hover-while-dragging styles are not part of this event.
