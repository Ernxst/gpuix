---
"@gpuix/react": minor
---

Defer loading and constructing the native test renderer until it is first used.
This lets `file:` and `link:` consumers keep one deduped React runtime for
their test suite.

**Breaking:** `hasNativeTestRenderer` was removed; use
`isNativeTestRendererAvailable()`.
