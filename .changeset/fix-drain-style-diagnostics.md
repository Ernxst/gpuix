---
"@gpuix/native": patch
"@gpuix/react": patch
---

Keep emitted style and accessibility validation diagnostics available through
`drainStyleDiagnostics()` until the consumer drains them. React continues to
warn once without consuming the assertion-facing queue.

Fixes #132
