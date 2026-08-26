---
'@gpuix/native': patch
'@gpuix/react': patch
---

Keep each GPU-backed test renderer's offscreen window and GPUI context isolated.

Creating a second `createTestRoot()` no longer redirects the first root's simulated mouse, click, layout, or screenshot operations to the newer window. Calling the test root's `unmount()` also disposes its native offscreen state.

Fixes #53
