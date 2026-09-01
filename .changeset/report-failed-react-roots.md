---
"@gpuix/react": patch
---

Expose uncaught React root failures as inspectable root state and renderer diagnostics. Owned top-level apps terminate instead of leaving a silently dead native window, while injected embedders keep control of process recovery.

Fixes #138
