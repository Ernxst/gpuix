---
'@gpuix/react': patch
---

`Select` now highlights matching options while typing, scrolls the highlighted option into view, and renders no wrapper for `Root`. The trigger exposes its listbox through combobox semantics, scroll arrows appear only when scrolling is possible, and Select parts resolve `className` and `style` functions against their Base UI state.
