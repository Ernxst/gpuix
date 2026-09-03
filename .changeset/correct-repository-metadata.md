---
'@gpuix/native': patch
'@gpuix/react': patch
---

Point the `repository` field at this fork and drop `publishConfig`.

Both manifests still named `remorses/gpuix`, so every "Repository" link a registry or tooling
renders from a packed tarball led to upstream rather than the source these builds come from. Both
now read `git+https://github.com/Ernxst/gpuix.git`.

`publishConfig` is gone from both. It named the npm registry and `access: public`, and this fork
does not publish to npm — its builds ship as tarballs attached to GitHub releases.
