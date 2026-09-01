# Vendored W3C Canvas conformance cases

`yaml/` is the 11-suite subset of W3C web-platform-tests used by the canvas
conformance harness, vendored byte-identical from
`html/canvas/tools/yaml/` at web-platform-tests commit
[`7413adf`](https://github.com/web-platform-tests/wpt/tree/7413adf41ac497181510ff906de6ba842bd21e48/html/canvas/tools/yaml).
`scripts/convert-canvas-wpt.ts` pins the same SHA and stamps it into
`generated/canvas-wpt.json`; re-vendoring means bumping both together. The files
are third-party source under the W3C web-platform-tests BSD-3 license; see
`THIRD_PARTY_NOTICES.md`.

The harness never downloads tests. Regenerate the committed case table after
updating the YAML:

```sh
bun scripts/convert-canvas-wpt.ts
```

Run it on the recording context and native retained-canvas renderer:

```sh
bun run canvas:wpt
```

## The ledger

`ledger.json` records every converted case with one of three statuses:

- `pass` - the case ran and every assertion held.
- `fail` - GPUIX implements the surface the case exercises and gets it wrong:
  a failed assertion, a spec-valid value the native stream rejected, a missing
  exception, a pixel that does not match. These are conformance defects.
- `skip` - a capability GPUIX does not claim, or a fixture this harness does
  not provide. Every skip names the gap or gaps responsible.

A case that a gap blocks statically is still executed: the gap is its *expected*
outcome, so the day the capability lands the case starts passing and shows up as
an unexplained deviation instead of remaining quietly skipped. A case blocked by
several gaps is counted against each of them, so the ranked table also reports
how many cases each gap unblocks on its own (`sole`).

`CANVAS_WPT_UPDATE_LEDGER=1` is the explicit re-triage mode; ordinary runs
reject a stale or missing ledger. The run prints its own
`pass / fail / skip / unexplained` counts, the spec violations by name, and the
ranked gap table; set `WPT_REPORT=<file>` for the same triage as JSON.

## Why this is not part of `bun run test`, and what that costs you

Each of the 516 runnable cases boots and disposes a native retained-canvas
renderer, so the sweep takes several minutes (3-8 on a loaded laptop) - much
longer than the whole React suite it would join.
`packages/react`'s `test` and `test:watch` scripts therefore exclude
`canvas-wpt.test.tsx` and the harness stays standalone via `bun run canvas:wpt`
(from the repository root or from `packages/react`). It is a conformance ledger,
not a regression gate: `bun run test` must stay fast enough to run on every
change, and a ledger drift here is triaged deliberately rather than blocking
unrelated work.

That makes the sweep a manual discipline, and it has two silent failure modes
worth knowing:

- **No CI job runs `canvas:wpt`.** Nothing catches ledger drift automatically.
  Run it by hand when you touch the canvas recording context, the canvas opcode
  stream, or the native canvas decoder, and commit the re-triaged ledger with
  the change that caused it.
- **The suite skips itself without a native renderer.** The whole `describe`
  is `describe.skip` when `isNativeTestRendererAvailable()` is false, so on a
  machine with no built native binary the run is green having tested nothing.
  Check the reported counts, not the exit code.
