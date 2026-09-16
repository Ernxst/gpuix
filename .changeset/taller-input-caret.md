---
'@gpuix/native': patch
'@gpuix/react': patch
---

Draw the `<input>` and `<textarea>` caret at the full `fontSize` instead of 75% of it.

The bar still sits inside the line box, so extra `lineHeight` does not stretch it past the glyphs.
