---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add cross-platform application menus, explicit quit, and graceful React termination.

Desktop renderers now install a minimal Quit menu by default. Applications can
replace it with a menu tree, receive stable action ids in JavaScript, update the
tree with `setMenus()`, or opt out with an empty array. `renderer.quit()`, menu
Quit, and last-window close share the same platform lifecycle and run
`onTerminated` once without a synchronous `process.exit(0)`.

The macOS frame pump now survives individual tick errors. Repeated native
failures and uncaught JavaScript errors quit the native window before the
process exits, so `bun --hot` cannot leave an unresponsive orphaned window.

Fixes #5
