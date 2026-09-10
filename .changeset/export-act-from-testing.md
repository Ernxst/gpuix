---
'@gpuix/react': minor
---

`act` is exported from `@gpuix/react/testing` (and `@gpuix/react/testing/vitest`,
which re-exports it): Testing Library's contract over this renderer, for
driving a state update or an effect outside `render`, `userEvent`, and the
other helpers that already wrap themselves in it. It sets
`IS_REACT_ACT_ENVIRONMENT`, runs the scope through React's own `act`, and
restores the previous value afterward, including when the scope throws or its
returned promise rejects. A synchronous scope commits, flushes its effects,
and is done by the time `act()` returns; an asynchronous one returns a promise
that resolves once React finishes draining.

Fixes #459
