---
'@gpuix/native': patch
'@gpuix/plugins': patch
'@gpuix/react': patch
---

Paint inherited text colour and `currentColor` consistently when CSS module
`:focus`, `:focus-visible`, or `:focus-within` descendant selectors match.

Fixes #747
Fixes #748
