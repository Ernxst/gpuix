---
"@gpuix/react": minor
---

Add `waitFor` to `createTestRoot()` and `findBy*`/`findAllBy*` queries to the
bound and `within()` query sets. Each attempt drains microtasks, advances the
async frame clock and the timer dispatcher, and flushes the renderer, so
timer-driven UI settles instead of hanging on wall-clock time. Timeout,
interval, and error semantics follow Testing Library, including an `interval`
of `0`, which is clamped rather than rejected. The canvas golden helper's
hand-rolled `Atomics.wait` image poll now runs on the same loop, with a
repaint-only pump so waiting for a file to decode cannot advance the scene's
clocks.

Fixes #213
