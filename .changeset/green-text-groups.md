---
'@gpuix/native': patch
'@gpuix/plugins': patch
'@gpuix/react': patch
---

Resolve inherited text styles from CSS module ancestor states before building
descendant text, and preserve stylesheet order when several ancestor states match.

Fixes #747
Fixes #748
