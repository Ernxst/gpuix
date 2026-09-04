---
"@gpuix/react": patch
---

`render`, `rerender`, and `unmount` from the testing pack run their React work
inside `act`, so the passive effects the commit queued — and the state those
effects set — are on screen before the call returns.

They used to go through `flushSync`, which commits and runs the effects but
leaves the state those effects set scheduled at default priority, for the
Scheduler's next task. A component whose visible result comes from a
`useEffect` that sets state, a portal registering with an outlet say, was
therefore not mounted when `render()` returned: only `findByText` or
`expect.poll` could reach it, and both wait on the wall clock. `getByText`
now sees it, exactly as it does under Testing Library, and the async queries
are left for work that is genuinely asynchronous. `unmount` likewise runs a
`useEffect` cleanup before the window goes away.

`act` intercepts the uncaught render errors React would otherwise hand to the
root and rethrows them at the caller. They are handed back to the root, so a
tree that throws still leaves a dead root reporting `getStatus().status ===
"failed"` rather than throwing out of `render()` — minus the component stack,
which React no longer passes along that path.

Fixes #332
