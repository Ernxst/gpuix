---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add bubbling DOM drag events for Finder and OS file drops: `onDragEnter`,
`onDragOver`, `onDragLeave`, and `onDrop`. A drop is accepted when a
`dragOver` handler calls `preventDefault()`; accepted `onDrop` handlers read
files from `event.dataTransfer.files` as `GpuixFile` objects with absolute
`path`, `name`, `size`, `lastModified`, and extension-derived `type` values.

`onFileDrop` remains the desktop-namespace alias with its raw, non-bubbling
payload.

Refs #460
