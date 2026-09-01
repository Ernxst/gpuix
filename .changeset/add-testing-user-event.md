---
"@gpuix/react": major
---

Add an async `userEvent` facade to `createTestRoot()` for element-bound click,
hover, typing, clearing, tabbing, and keyboard interactions. `dblclick` reports
its pending dependency on click-count support in issue #216.

BREAKING: replace the renderer-first `getChildren` and `getParent` exports with
re-resolving `TestElement.children` and `TestElement.parentElement` members.

Fixes #211
