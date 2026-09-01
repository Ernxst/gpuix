---
'@gpuix/native': patch
'@gpuix/react': patch
---

Expose authored roles and accessible names on loaded `<img>` elements in the
native AccessKit tree, and give `<img>` the HTML-AAM implicit `img` role with
`alt` as its accessible name (`alt=""` infers `presentation`).

Fixes #149
