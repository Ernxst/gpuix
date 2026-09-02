---
"@gpuix/native": minor
"@gpuix/react": minor
---

Carry `clickCount` through the automation mouse dispatchers, so double clicks
can be driven from a test. `simulateClick`, `simulateMouseDown`, and
`simulateMouseUp` take it on the test renderer, the live renderer, and the web
renderer; the automation `click`, `mouseDown`, and `mouseUp` methods take it in
`MouseOptions`; and `locator.dblclick()` and `userEvent.dblClick(element)` send
the whole sequence the way a platform does. The app sees `onClick` (detail 1),
`onClick` (detail 2), then `onDoubleClick` (detail 2) — the DOM order.

**Breaking:** an unknown modifier name now throws instead of being ignored.
`'comand'` used to dispatch a plain click, so a test asserting a cmd-click
passed while exercising an unmodified one. Accepted names are `cmd` (`meta`,
`super`, `win`, `platform`), `ctrl` (`control`), `alt` (`option`), `shift`, and
`fn` (`function`); `undefined` and `''` still mean no modifier.
