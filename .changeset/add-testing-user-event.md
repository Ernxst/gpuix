---
"@gpuix/react": major
---

Add an async `userEvent` facade to `createTestRoot()` for element-bound click,
hover, typing, clearing, tabbing, and keyboard interactions. Keystrokes are
committed one physical keypress at a time, so a focus-moving key inside a
string is honoured before the next key is sent. `clear()` uses the platform
select-all chord. `dblClick` reports its pending dependency on click-count
support in issue #216; it is spelled as in Testing Library, user-event v14, and
Vitest browser mode.

BREAKING: replace the renderer-first `getChildren` and `getParent` exports with
re-resolving `TestElement.children` and `TestElement.parentElement` members.
`TestElement.children` is now a `readonly TestElement[]` instead of an array of
numeric ids, `TestElement.parentId` is gone, and the remaining scalar fields are
`readonly`. Five in-repo call sites moved with it.

Fixes #211
