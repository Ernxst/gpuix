---
"@gpuix/react": minor
---

Add `waitFor` to `createTestRoot()` and `findBy*`/`findAllBy*` queries to the
bound and `within()` query sets. Each attempt drains microtasks, advances the
async frame clock and the timer dispatcher, and flushes the renderer, so
timer-driven UI settles instead of hanging on wall-clock time. Timeout,
interval, and error semantics follow Testing Library. The canvas golden helper's
hand-rolled `Atomics.wait` image poll now runs on the same pump.

Fixes #213
