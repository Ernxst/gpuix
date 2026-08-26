---
'@gpuix/native': minor
'@gpuix/react': minor
---

Accept bare `<img src>` strings as DOM-compatible source sugar: HTTP(S) strings
use the existing URL pipeline and all other strings are filesystem paths. URL
security validation, including private-network opt-in, applies unchanged.

Add `TestRenderer.getImageLoadState(elementId)` so tests can assert native
image loading failures without screenshots or fallback-text checks.

Fixes #64
