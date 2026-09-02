---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose authored roles and accessible names on loaded `<img>` elements in the
native AccessKit tree, and give `<img>` the HTML-AAM implicit `img` role with
`alt` as its accessible name (`alt=""` infers `presentation`).

Every `<img>` now contributes an accessibility node it did not before, so
snapshots of the accessibility tree and `getByRole` counts change.

Fixes #149
