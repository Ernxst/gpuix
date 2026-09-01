---
"@gpuix/react": major
---

Remove the renderer-first `getByText`, `queryByText`, `getAllByText`, and `within` test query exports.

Migration: replace renderer-first calls with the bound queries returned by `createTestRoot()`.
