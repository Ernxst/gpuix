---
"@gpuix/native": minor
---

Key events now reach the root element when nothing is focused, the way a browser targets `document.body`. `onKeyDown`, `onKeyUp` and their capture forms on the element at the top of the tree fire for every key pressed before the user has focused anything, which is what a "press `/` to search" or palette shortcut needs on first paint. Until now those keys vanished: GPUI delivers keys along the focus path, and the only no-focus fallback was the synthesized Tab key down.

`event.target` is the root element, and its capture and bubble listeners both run at `AT_TARGET`. The fallback fires only while the root wrapper itself holds focus, so it adds no delivery once an element — or a text editor — takes focus. Tab is untouched — its key binding dispatches the focus action, which consumes the key event before any key listener runs — so traversal and `preventDefault()` cancellation behave exactly as before.

What this does **not** give a root listener is a way to tell "nothing is focused" from "the user is typing into a focused element". An element listening for keys is told about every key event that passes through it, including those travelling up from a focused descendant, and it is told with its own id as `event.target` — so a root handler also runs for each character typed into a focused `<input>`, and runs twice for the one keypress when that descendant listens for keys too — once as the DOM bubble with the descendant as `event.target` at phase `3`, once as the ancestor's own delivery with the root as `event.target` at phase `2`. The target is inconsistent rather than uniformly wrong, so neither it nor `eventPhase` separates the cases. That is pre-existing behaviour in ancestor key delivery, unchanged here. Gate a global shortcut on the focus read instead, comparing `getActiveElement()` against the root's own id so a focusable, focused root still fires it — the README shows the guard.

No new public API. Upstream's `RenderOptions.onKeyDown` / `setWindowKeyEvents` surface stays rejected.

Fixes #248
