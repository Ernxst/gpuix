---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `onFileDrop` for Finder and OS file drops.

Put the listener on the element that should receive the drop. GPUI hit-tests the pointer and delivers the paths to that node, the same way `onClick` works. Nested targets work: the inner listener gets the drop.

```tsx
<div
  onFileDrop={(event) => openFiles(event.paths ?? [])}
  style={{ width: 400, height: 300 }}
>
  <text>Drop files here</text>
</div>
```

`event.paths` is `string[]`: absolute Unicode filesystem paths. `event.x` and `event.y` are the drop point in window pixels. An empty drop, or a drop that contains a non-Unicode path, does not fire.

Works on `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `markdown`, `diff`, and `anchored`. `<virtual-list>` does not take this event; wrap it in a `div`. Desktop only. Internal GPUI drags and hover-while-dragging styles are not part of this event.
