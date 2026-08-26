---
'@gpuix/native': minor
'@gpuix/react': minor
---

Unify `<img>` sources behind explicit path, HTTP(S) URL, and in-memory data variants.

PNG, JPEG, WebP, GIF, and full-colour SVG now share the same bounded byte and decode pipeline. URL images use a restricted native HTTP client, reject credentials and unsafe resolved addresses at every redirect hop, enforce five redirects plus total/body timeouts, retry transient failures, cancel on unmount, and revalidate a bounded URL cache with ETag or Last-Modified validators. Loopback and private networks require the documented renderer-level `allowPrivateNetworkImages` opt-in; link-local and cloud-metadata ranges remain blocked.

SVG documents preserve authored colours by default. `tint="currentColor"` explicitly substitutes CSS/XML colour tokens while leaving other authored fills, strokes, IDs, text, and URL references intact. Untinted icons keep the light-on-dark default colour. URL fallbacks redact credentials and queries and never expose response bodies; malformed source values still report the element, property, and rejected value through the existing strict diagnostic channel.

Fixes #12
