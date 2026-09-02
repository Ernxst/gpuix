---
"@gpuix/react": minor
---

Add `render(node, options?)` to `@gpuix/react/testing`, shaped like
vitest-browser-react's. It returns everything `createTestRoot()` returns plus
`rerender(node)`, shares one offscreen window across a test file (reusing it
when the options match and replacing it when they differ), and unmounts the
previous tree and resets the window state before every render, so a reused
window is never a reused tree. The new `@gpuix/react/testing/vitest` entry registers
`afterEach(cleanup)`; `@gpuix/react/testing` stays free of any vitest import
and exports `cleanup()` for other runners.

Fixes #286
