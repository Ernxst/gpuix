---
"@gpuix/native": minor
---

Key events now reach the root element when nothing is focused, the way a browser targets `document.body`. `onKeyDown`, `onKeyUp` and their capture forms on the element at the top of the tree fire for every key pressed before the user has focused anything, which is what a "press `/` to search" or palette shortcut needs on first paint. Until now those keys vanished: GPUI delivers keys along the focus path, and the only no-focus fallback was the synthesized Tab key down.

`event.target` is the root element, and its capture and bubble listeners both run at `AT_TARGET`. The fallback fires only while the root wrapper itself holds focus, so as soon as an element (or a text editor) takes focus the key belongs to it and nothing is delivered twice. Tab is untouched — its key binding dispatches the focus action, which consumes the key event before any key listener runs — so traversal and `preventDefault()` cancellation behave exactly as before.

No new public API. Upstream's `RenderOptions.onKeyDown` / `setWindowKeyEvents` surface stays rejected.

Fixes #248
