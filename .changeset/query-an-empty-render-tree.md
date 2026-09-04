---
"@gpuix/react": patch
---

Query an empty render tree the way the web does. When a component renders
`null` the renderer holds no root element, and every query family used to throw
"Unable to search rendered text because the renderer has no root element".
`queryBy*` now returns `null`, `queryAllBy*` returns `[]`, `getBy*` and
`getAllBy*` throw their usual "Unable to find ..." error naming the empty tree
as the searched scope, and `findBy*` rejects with that error after its timeout.
The empty scope is resolved once, for text, test ID, role, label, placeholder,
and display-value queries alike, whether searching the whole tree or `within` an
element with no descendants.

Fixes #333
