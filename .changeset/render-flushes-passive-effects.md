---
"@gpuix/react": patch
---

`render`, `rerender`, `unmount`, and each event the testing pack dispatches run
their React work inside `act`, so the passive effects that update queued — and
the state those effects set — are on screen before the call returns.

They used to go through `flushSync`, which commits and runs the effects but
leaves the state those effects set scheduled at default priority, for the
Scheduler's next task. A component whose visible result comes from a
`useEffect` that sets state, a portal registering with an outlet say, was
therefore not mounted when `render()` returned: only `findByText` or
`expect.poll` could reach it, and both wait on the wall clock. `getByText`
now sees it, exactly as it does under Testing Library, and the async queries
are left for work that is genuinely asynchronous. `unmount` likewise runs a
`useEffect` cleanup before the window goes away, and `userEvent` — like the
`nativeSimulate*` methods under it — delivers each event in its own act scope,
so a handler's state change and everything it schedules land before the next
event is delivered.

Two cases fall back to a synchronous flush, which still commits before
returning but leaves effect-scheduled state to whoever owns the act queue:
`render` called inside the caller's own `act` scope, since React keeps one
queue and drains it when the outermost scope exits, and a production React
build, which ships no `act`.

`act` intercepts the uncaught render errors React would otherwise hand to the
root and rethrows them at the caller. They are handed back to the root, so a
tree that throws still leaves a dead root reporting `getStatus().status ===
"failed"` rather than throwing out of `render()` or escaping an event dispatch
— minus the component stack, which React no longer passes along that path.

Fixes #332
