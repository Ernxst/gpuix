---
"@gpuix/react": patch
"@gpuix/plugins": patch
---

Fixes #751
Fixes #752
Fixes #753
Fixes #754
Fixes #755
Fixes #756

Make shared styles and host props assignable with exact optional property
checking, support negated screenshot assertions, expose the test window title,
and make the plugins React peer optional so Bun accepts the compatible release
tarball without broadening its supported fork version range.
