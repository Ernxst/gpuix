---
'@gpuix/native': minor
'@gpuix/react': minor
---

Under `interpolateSize: "allow-keywords"`, a `width` or `height` transition whose endpoint is `min-content`, `max-content`, `fit-content`, or `fit-content(<limit>)` now interpolates the same way an `auto` endpoint already did: it travels between measured pixel values in both directions and keyword to keyword, and settles as the declared keyword rather than a pinned pixel. A `fit-content` endpoint clamps to the containing block's content-box width, and a percentage `fit-content(<limit>)` resolves against that same basis. An explicit keyword also animates on an axis the parent would otherwise stretch, unlike `auto`.

Fixes #312
