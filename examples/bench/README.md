# App benchmarks

Fixtures and a harness (`scripts/app-bench.ts`) for measuring what a GPUIX
app costs to ship, start, and build — the same numbers Jamon Holmgren
published for 21 Mac app frameworks, measured the same way every time.

Run: `bun scripts/app-bench.ts [--runs N]` (default 10) from the repository
root, with the sandbox disabled — GPUI panics opening a window inside it
("Attempted to create a NULL object" from `system-configuration`). Before the
first run:

```
bun install --frozen-lockfile
bun run build:native
bun run build:react
cd packages/native && cargo build --release --example hello_bench
```

## Fixtures

- **`hello-gpuix.tsx`** — one window, one line of text, 400×300. Compiled
  with `bun build --compile`, the same way `examples/compile-chat.ts`
  compiles the chat example, since that compiled binary is what a GPUIX app
  actually ships.
- **`../../packages/native/examples/hello_bench.rs`** — the same shape, built
  directly against this repo's GPUI checkout with `cargo build --release
  --example hello_bench`, no JS, no napi bridge. The baseline both other
  fixtures are measured against.
- **`../chat.tsx`** — the real chat example, included for startup and
  memory only. It gets a `GPUIX_BENCH=1`-gated marker (see below); the gate
  keeps `bun --hot chat.tsx` and `bun run compile` behaving exactly as
  before when a human runs them without that variable set. Bundle and build
  numbers aren't reported for it: `compile-chat.ts` already covers icons and
  macOS app-bundling, so its build/rebuild timing is not comparable to the
  hello-world fixtures.

## Metrics

- **Bundle** — size in MB of the compiled artefact: `bun build --compile`'s
  output for GPUIX, the `cargo build --release` binary for GPUI. What a user
  downloads or a CI artefact ships, not source size.
- **Startup** — wall time from process spawn to the app's *second* presented
  frame, measured against the compiled binary, because that's what ships.
  Both fixtures print one `GPUIX_BENCH {"event":"ready",...}` line to stdout
  from inside a `requestAnimationFrame(() => requestAnimationFrame(...))`
  scheduled right after `render()` (the GPUI baseline uses the equivalent
  `window.on_next_frame` nested the same way — see the README's "Schedule
  animation frames" section for why these are the same primitive across
  desktop and browser). The harness records `Date.now()` at spawn and diffs
  it against the marker's absolute `readyAtEpochMs`. The marker also carries
  an in-process phase split — `import`, `render()`, and the two-frame
  warmup ("to-frame") — each timed with `performance.now()` inside the
  fixture; GPUI has no JS import phase, so that field is `null` rather than
  zero.
- **Memory** — sampled about 2 seconds after the ready marker, window idle.
  Two figures: **physical footprint**, what Activity Monitor shows
  (`footprint <pid>`, falling back to `vmmap --summary <pid>`'s "Physical
  footprint" line if `footprint` doesn't parse), and **RSS**
  (`ps -o rss= -p <pid>`). They diverge because footprint discounts shared,
  reclaimable, and compressed pages that RSS counts in full.
- **Build** — cold `bun build --compile` / `cargo build --release --example
  hello_bench`, and a rebuild after touching one source file (a trailing
  comment appended then removed, so the fixture's behaviour never changes).
  "Cold" for GPUI is `cargo clean -p gpuix-native --release` followed by a
  build — it forces a full recompile of this crate's own code, not of every
  dependency from an empty registry cache; a from-nothing build (the ~7–8
  minutes this checkout's very first `cargo build` took, most of it
  dependency compilation `mbx` normally caches away) isn't something a
  benchmark can afford to run every time without being dominated by
  unrelated dependency-graph noise.
## Focus

Every fixture the harness launches takes focus. An unfocused GPUIX window
(`focus: false`, e.g. via each fixture's `GPUIX_BENCH_BACKGROUND=1` escape
hatch for a manual run that must not steal focus) opens behind the active
app's windows. GPUI stops its display link while a window is covered, so
`requestAnimationFrame` pauses, as it does in browsers, and the ready marker
may never arrive.

Each app runs under `script -q /dev/null` so its stdin is an open terminal, as
in a manual launch. With a non-TTY stdin GPUIX turns on automation, which
costs memory and startup time. Running this harness will take over your
keyboard focus repeatedly;
don't try to use the machine for anything else while it runs.

## Runs

After building, the harness launches each fixture once and reports that
launch as **first launch**, apart from the startup samples. macOS scans a
newly written executable before running it, and the scan grows with file
size: about 170 ms for the 6.6 MB GPUI binary and 800 ms for the 91 MB GPUIX
binary on the reference machine. A GPUIX binary also scans its extracted
`.node` the first time Bun writes it to `$TMPDIR`. The JSON keeps every
startup sample in run order.

Startup and memory report the median and min/max of `--runs` samples
(default 10). Fixtures are interleaved run by run — fixture A's run 1, then
B's run 1, then A's run 2, and so on — rather than run back to back, because
single-run timings on the reference machine vary by up to 45%; interleaving
keeps a mid-run slowdown from landing entirely on whichever fixture happened
to run last. Build runs once per fixture per harness invocation.

Every launched process is killed and every edited source file restored even
if a run throws, including the GPUIX and GPUI source files rebuilt with a
touched line.

## Output

A Markdown table (fixture × metric) prints to stdout, with a "Jamon
reference" column carrying the figures Jamon Holmgren published for the same
app shape across 21 Mac app frameworks — not remeasured here, just kept
alongside for comparison. The full run, including every raw sample, is
written to `tmp/app-bench/<timestamp>.json`.
