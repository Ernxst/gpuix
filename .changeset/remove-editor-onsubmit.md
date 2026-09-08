---
'@gpuix/native': minor
'@gpuix/react': minor
---

BREAKING: `onSubmit` is removed from `<input>` and `<textarea>` (react-dom has no such prop; submit is a form event); Enter and Shift+Enter insert a newline in a `<textarea>`, Enter inserts nothing in an `<input>`, and both deliver `onKeyDown` first so `preventDefault()` cancels the newline; composers move to `onKeyDown` with `event.key === "Enter" && !event.shiftKey`.

Fixes #354
