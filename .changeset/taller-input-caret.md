---
'@gpuix/native': patch
'@gpuix/react': patch
---

Draw the `<input>` and `<textarea>` caret at **line height**, like Chrome.

A composer with `fontSize: 14` and `lineHeight: 20` now paints a 20px bar instead of a 14px em-square bar. Extra leading stretches the caret with the row.
