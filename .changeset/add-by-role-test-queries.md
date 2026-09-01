---
"@gpuix/native": minor
"@gpuix/react": minor
---

Add synchronous `getByRole`, `queryByRole`, `getAllByRole`, and `queryAllByRole`
queries to test roots and `within()` scopes. Queries use the computed AccessKit
role, accessible name, and heading level and re-resolve after renders.

`hidden` defaults to `false`. Passing `hidden: true` currently throws with an
explicit pointer to issue #209 until native snapshots support hidden nodes.
