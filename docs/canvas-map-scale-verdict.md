# Canvas map-scale benchmark verdict

Issue: Ernxst/gpuix#84, wave C3

Measured: 2026-08-27

Machine: Apple M1 MacBook Pro, 8 cores, 16 GB

Build: aarch64 release native binding with `test-support`

## Workload and method

`examples/canvas-map.perf.test.tsx` paints a 1280 x 800 map-shaped frame through
the public Canvas 2D API and `createTestRoot`:

- 20 distinct local 256 px image tiles (five columns by four rows)
- 160 stroked polylines with 24 input points each
- 240 filled polygons with eight input points each
- 10 warmups and 40 measured samples per painter order

The command-flush measurement includes a fresh browser-shaped Canvas 2D
recording and `__applyCanvasCommands`. The draw measurement is the immediately
following `TestRenderer.flush`, so it includes native display-list preparation,
layout, and paint. Samples alternate order to limit drift. There is no network
I/O in the measured interval; all image sources are deterministic local fixture
paths and the benchmark waits for all 20 to load and paint.

Two otherwise identical orders isolate path batching:

- **Grouped:** 20 images, then all 400 paths. This produces one contiguous path
  batch.
- **Interleaved:** one image and 12 polygons repeated 20 times, then all 160
  polylines. This produces 20 path batches.

The benchmark is intentionally an observation, not a machine-independent timing
gate. Run it on an uncontended machine with:

```sh
cd examples
bun x vitest run canvas-map.perf.test.tsx --reporter=verbose
```

## Results

Five uncontended invocations produced these p95 ranges. The middle column is the
median of the five invocation-level p95 values.

| Order | Phase | Median p95 | Observed p95 range |
| --- | --- | ---: | ---: |
| Grouped | command flush | 1.94 ms | 1.84-2.53 ms |
| Grouped | draw | 2.02 ms | 1.92-2.51 ms |
| Interleaved | command flush | 1.93 ms | 1.77-2.20 ms |
| Interleaved | draw | 2.00 ms | 1.86-2.24 ms |

Native preparation reported 400 path primitives and 39,840 expanded path
vertices, with 222 vertices in the largest individual path. At the approximately
112-byte `PathRasterizationVertex` size called out in #84, that is 4.26 MiB of
path-vertex upload per frame. Grouped and interleaved frames contain identical
geometry; only the measured path-batch count changes from 1 to 20.

The 222-vertex maximum is a property of this synthetic geometry, not a bound on
real map data. Its regular eight-point polygons and 24-point lines do not model
large concave footprints, holes, dense coastlines, self-intersections, or the
extra vertices produced by real joins. Consumer captures must report the same
expanded-vertex counters before applying this verdict to those shapes.

Across paired invocations, interleaving changed command-flush p95 by -0.33 to
+0.12 ms and draw p95 by -0.27 to +0.07 ms. There is no repeatable interleaving
penalty at this workload.

## Verdict

### A. Direct lyon/u32 path swap: refused

The measured map frame stays near 2 ms p95 draw despite the estimated 4.26 MiB
expanded path upload, and its largest path has 222 vertices, far below the u16
index boundary. The vendored GPUI `PathBuilder` already consumes lyon's indexed
buffer by expanding every triangle through `Path::push_triangle`; the Metal
renderer then expands each `Path` vertex again into `PathRasterizationVertex`.
Changing the tessellator's source index type to u32 would remove an individual
path-size ceiling, but it would not reduce this renderer upload representation.

Therefore the consumer-shaped evidence does not force the pre-authorised
direct-lyon/u32 follow-up. Re-measure it when a real viewport first exceeds
80,000 expanded path vertices per frame (about 8.54 MiB at 112 bytes each), or
when any single prepared path exceeds 32,768 vertices. Crossing either number is
a measurement trigger, not automatic authority to change the index type. The
follow-up becomes authorised only if real geometry reaches the u16 ceiling, or
if at least five uncontended paired runs plus a profile attribute both a
1.0 ms absolute and a 15% relative p95 draw regression to the current path
expansion/upload path.

### B. Fill/image batch-order restructuring: refused

GPUI's Metal renderer ends the main encoder for every `PrimitiveBatch::Paths`,
renders paths through its intermediate target, and then starts the main encoder
again. The benchmark exercises that mechanism directly by increasing contiguous
path runs from 1 to 20. It found no repeatable p95 cost: the interleaved draw was
sometimes faster and at worst 0.07 ms slower in the five paired runs.

Therefore the evidence does not authorise painter-order or batch-order
restructuring. Such a change would also have to preserve Canvas painter order,
so its correctness cost is not justified by the measured result. Re-measure
when a real viewport exceeds 64 visible image tiles or 64 image-separated path
runs (`PrimitiveBatch::Paths`) in one frame. Restructuring becomes authorised
only when at least five uncontended paired runs show an interleaved-versus-
grouped p95 draw penalty of at least 1.0 ms absolute and 15% relative, and a
profile attributes that penalty to encoder switches. Painter-order equivalence
remains a separate acceptance gate.

## Issue-ready decision text

> C3 measured a 1280 x 800 frame with 20 local 256 px tiles, 160 stroked
> 24-point polylines, and 240 filled eight-point polygons. Across five
> uncontended runs, grouped and interleaved variants both stayed around 2 ms
> p95 for command flush and draw. Native preparation produced 39,840 expanded
> path vertices (about 4.26 MiB at 112 bytes each), but the largest individual
> path was only 222 vertices. Increasing path batches from 1 to 20 produced no
> repeatable draw penalty (-0.27 to +0.07 ms paired p95 delta). Verdict: refuse
> both the direct-lyon/u32 swap and fill/image batch-order restructuring for
> this wave. The 222-vertex synthetic maximum does not bound real concave or
> coastline geometry. Re-measure paths above 80,000 expanded vertices/frame or
> 32,768 vertices in one prepared path, and re-measure batching above 64 visible
> tiles or 64 image-separated path runs. Authorise either follow-up only after
> five uncontended paired runs and a profile show both a 1.0 ms absolute and 15%
> relative p95 penalty attributable to that mechanism (or when a real path
> reaches the u16 correctness ceiling).
