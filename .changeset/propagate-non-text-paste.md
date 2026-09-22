---
'@gpuix/native': patch
'@gpuix/react': patch
---

Let `Cmd+V` and `Ctrl+V` reach `onKeyDown` when the clipboard has no text.

Text still pastes natively, including text accompanied by an image. Applications
can now handle image-only and file clipboard contents instead of losing the
paste shortcut or inserting a copied file path as text.
