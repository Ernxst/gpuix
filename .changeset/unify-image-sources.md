---
'@gpuix/native': minor
'@gpuix/react': minor
---

Unify `<img>` sources behind explicit path, HTTP(S) URL, and in-memory data variants.

PNG, JPEG, WebP, GIF, and full-colour SVG now share the same bounded byte and decode pipeline. URL images use the configured native HTTP client, reject bad status or MIME responses, enforce the 10 MiB source limit, and revalidate a bounded URL cache with ETag or Last-Modified validators.

SVG documents preserve authored colours by default. `tint="currentColor"` explicitly substitutes the resolved inherited colour while leaving other authored fills and strokes intact. Malformed source values report the element, property, and rejected value through the existing strict diagnostic channel.

Fixes #12
