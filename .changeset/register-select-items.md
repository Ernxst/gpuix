---
"@gpuix/react": minor
---

`Select` now discovers its items by registration instead of walking its
element tree, so an `Item` wrapped in your own component is still navigable,
selectable, and shown by `Value`. Also export `Props` and `GpuixTheme` from
`@gpuix/react` so those types are reachable without reaching into
`@gpuix/react/types/host.js`.

Fixes #379
