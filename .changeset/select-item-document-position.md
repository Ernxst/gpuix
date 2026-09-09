---
"@gpuix/react": minor
---

`Select` orders its items by document position instead of registration order,
so a conditionally rendered item that mounts after its siblings - open or
closed - still navigates where it appears in JSX. `PublicInstance` gains
`compareDocumentPosition()`, matching `Node.compareDocumentPosition()`, with
its `DOCUMENT_POSITION_*` bitmask constants exported from `@gpuix/react`.

Fixes #387
