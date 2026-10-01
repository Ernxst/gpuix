---
"@gpuix/react": patch
---

Make the named `Select` export carry its compound parts, matching the named
import shape used by Base UI while preserving direct root usage and part aliases.

Fixes #801
