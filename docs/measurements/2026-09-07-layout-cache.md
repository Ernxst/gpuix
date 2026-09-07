# Layout cache measurement

This fixture records the synthetic nested-column layout curve behind GPUIX
#364. It keeps the layout tree small enough to run as a focused native
measurement while exercising the repeated content-width probes that collide
in Taffy's nine-slot per-node cache.

Run the complete fixture from the React package directory:

    cd packages/react
    bunx vitest run --config ../../docs/measurements/fixtures/layout-cache.vitest.config.ts

To isolate the baseline curve in a fresh process:

    cd packages/react
    bunx vitest run --config ../../docs/measurements/fixtures/layout-cache.vitest.config.ts \
      -t 'base auto-width wrappers'

The -t form matters for timing work: the fixture has all original variants,
and Vitest's configured isolate: false keeps them in one worker. A focused
invocation avoids later cases inheriting process state. Set
GPUIX_LAYOUT_BENCH_OUTPUT to write the accumulated JSON results; without it,
the fixture writes no files.

The fixture is [layout-cache.probe.test.tsx](./fixtures/layout-cache.probe.test.tsx)
and its path-stable configuration is
[layout-cache.vitest.config.ts](./fixtures/layout-cache.vitest.config.ts).
The configuration derives both the repository root and the React package root
from import.meta.url, so it does not depend on a checkout path.

## Measurement protocol

The measurements below were taken on 2026-09-07 on macOS Apple Silicon with
the release native build, a 1440x900 test window, and 60 rows. Each point
warms up with three flushes, resets the frame overlay statistics, then records
eight measured draws and reports the p90. Caches were not forcibly disabled.
The numbers describe this synthetic tree and the test renderer; they do not
measure a live window or establish a downstream application gain.

The baseline was GPUIX commit 0d92f02 with the Zed submodule at a7367d93.
The cache-only comparison uses the same fixture and protocol after the
parent-width cache partition. The final comparison also includes the separate
Style clone reduction.

| variant | depth 0 | depth 2 | depth 4 | depth 6 |
| --- | ---: | ---: | ---: | ---: |
| baseline, one process | 6.16 ms | 12.81 ms | 43.57 ms | 146.48 ms |
| cache-only, one process | 5.74 ms | 5.83 ms | 6.14 ms | 6.31 ms |
| cache + Style clone reduction, fresh process 1 | 7.06 ms | 5.55 ms | 6.53 ms | 6.09 ms |
| cache + Style clone reduction, fresh process 2 | 5.28 ms | 5.24 ms | 5.59 ms | 5.79 ms |
| cache + Style clone reduction, fresh process 3 | 5.24 ms | 5.33 ms | 5.64 ms | 5.89 ms |

The cache change removes the depth multiplier in this fixture. The three
fresh-process final runs do not show a standalone reliable timing gain from
the Style clone reduction; the cache change dominates the observed curve.

The fixture also retains the original controls: definite-width wrappers,
minHeight: 0, alignItems: flex-start, definite width on the innermost or
outermost wrapper, definite-width rows, and definite-height rows.

## Compute-count regression evidence

A Rust fixture with the same nested-row structure was run with both caches
using a test-only uncached-compute counter at the GPUIX/Taffy cache boundary.
The Rust fixture uses fixed intrinsic leaves and direct Taffy layout, so it is
a structural regression oracle rather than the JavaScript scene itself. It
counts layout computations rather than relying on machine-dependent timing.

| cache | total, depth 0 | total, depth 2 | total, depth 4 | total, depth 6 | maximum per node |
| --- | ---: | ---: | ---: | ---: | ---: |
| stock nine-slot cache | 4561 | 13935 | 51443 | 201487 | 16 / 40 / 136 / 520 |
| parent-width-partitioned cache | 4561 | 5472 | 5486 | 5500 | 16 / 18 / 18 / 18 |

The stock-cache control fails the real regression shape: uncached work grows
rapidly with wrapper depth. The partitioned cache keeps each node near its
finite set of distinct inputs and keeps total work effectively flat after the
row subtree is present.

The causal boundary is Taffy's parent-width comparison. The uncached regression
counter is in the [GPUI Taffy regression seam](../../zed/crates/gpui/src/taffy.rs#L1562-L1585),
at the [uncached layout boundary](../../zed/crates/gpui/src/taffy.rs#L268-L274).
Cache::get includes the x-axis parent-size bits in its ComputeSize match,
while compute_cache_slot selects among nine slots without those bits. GPUIX
partitions the public taffy::Cache instances by the normalized parent-width
value, retains one global cache for the sole PerformLayout entry, and clears
all frame-local caches together. The implementation reuses Taffy's public
matching and slot logic; it does not copy the complete private Taffy cache-key
algorithm. The Style clone reduction separately removes the per-miss clone
cost.

Each measured sample is one explicit window.draw call performed by
renderer.flush() in the [native test renderer](../../packages/native/src/test_renderer.rs#L799-L806).
The reported p90 is therefore over these explicit flushes.

## Verification recorded with this artifact

- The fixture and configuration contain no checkout-specific absolute paths.
- The default fixture path has no JSON side effect; output is opt-in through
  GPUIX_LAYOUT_BENCH_OUTPUT.
- The measurement protocol records run count, warm-ups, cache policy, and
  scope limits.
- Fifteen focused GPUI tests passed for the final native integration.
- This artifact does not claim a full repository gate or a live-window
  remeasurement.
