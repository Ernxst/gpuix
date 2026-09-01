# Vendored W3C Canvas conformance cases

`yaml/` is the 11-suite subset of W3C web-platform-tests used by the canvas
conformance harness. The files are vendored at the same revision as the
reference survey in issue #228. They are third-party source under the W3C
web-platform-tests BSD-3 license; see `THIRD_PARTY_NOTICES.md`.

The harness never downloads tests. Regenerate the committed case table after
updating the YAML:

```sh
bun scripts/convert-canvas-wpt.ts
```

Run it on the recording context and native retained-canvas renderer:

```sh
bun run canvas:wpt
```

`ledger.json` records every converted case as a pass or a skip with a named
unsupported API or native-rendering divergence. `CANVAS_WPT_UPDATE_LEDGER=1`
is an explicit re-triage mode; ordinary runs reject a stale or missing ledger.
The run prints its own `pass / skip / unexplained` counts and the ranked gap
table; set `WPT_REPORT=<file>` for the same triage as JSON.

## Why this is not part of `bun run test`

Each case boots and disposes a native retained-canvas renderer, so the sweep
takes about two minutes — comparable to the whole React suite it would join.
`packages/react`'s `test` script therefore excludes `canvas-wpt.test.tsx` and
the harness stays standalone via `bun run canvas:wpt` (from the repository root
or from `packages/react`). It is a conformance ledger, not a regression gate:
`bun run test` must stay fast enough to run on every change, and a ledger drift
here is triaged deliberately rather than blocking unrelated work.
