---
'@gpuix/react': patch
---

Reuse a TestRenderer-local element snapshot across queries until the native tree mutates, removing repeated whole-tree JSON reads during text queries.

Fixes #113
