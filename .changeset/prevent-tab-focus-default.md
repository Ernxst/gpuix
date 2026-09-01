---
'@gpuix/native': patch
'@gpuix/react': patch
---

Let focused elements cancel Tab and Shift+Tab traversal with
`event.preventDefault()` in either keydown phase, matching the browser while
preserving the existing default focus order.
