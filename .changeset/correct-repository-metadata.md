---
'@gpuix/native': patch
'@gpuix/react': patch
---

Point the `repository` field at this fork.

Both manifests still named `remorses/gpuix`, so every "Repository" link a registry or tooling
renders from a packed tarball led to upstream rather than the source these builds come from.
Both now read `https://github.com/Ernxst/gpuix`.
