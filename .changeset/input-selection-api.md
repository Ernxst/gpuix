---
"@gpuix/native": minor
"@gpuix/react": minor
---

Expose the text-editing members of `HTMLInputElement` on `<input>` and `<textarea>` refs: `value`, `selectionStart`, `selectionEnd`, `selectionDirection`, `setSelectionRange()` and `select()`. Selection was document-scoped only, so currency masking, select-all-on-focus and caret restoration had no way to reach the caret.

Offsets are UTF-16 code units, as the DOM's are, so they line up with `value.slice()` even across astral characters; the editor stores UTF-8 bytes and converts at the boundary. `setSelectionRange()` follows HTML's "set the selection range": offsets past the end of the value point at the end, and an inverted range collapses to a caret at `end` rather than being swapped. `selectionDirection` never reports `"none"` — this editor tracks only which end of the selection moves, and HTML lets a platform without that mode report `"forward"` instead.

Reading or writing any of them draws the committed tree first, as `getBounds()` does. A React commit only reaches the editor when a frame syncs the `value` prop into it, and that sync parks the caret at the end of the new text; without the flush, the next frame would overwrite the caret an effect had just restored.

Assigning `value` writes straight to the native editor and fires no `onChange`. This **differs from ReactDOM**, which re-asserts a controlled input's `value` on every commit: here the write survives until the `value` prop itself changes. On a controlled input, set React state instead.

Fixes #223
