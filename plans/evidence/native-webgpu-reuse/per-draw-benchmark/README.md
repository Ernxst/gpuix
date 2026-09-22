# WebGPU per-draw CPU benchmark

GPU-IX’s batched canvas route remains well above Chrome’s published 30 ns JavaScript-binding figure. Its steady 10,000-draw CPU cost is about 334 ns/draw on this M1, versus 161 ns/draw for the same pass recorded directly through `wgpu`. The remaining gap is primarily JavaScript recording/submission and wgpu’s own validation and resource tracking, not the native command decoder.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS 15.7.7, Apple M1 |
| Bun | 1.4.0 |
| Node | v26.5.0 |
| Native build | `napi build --platform --release --features test-support` |
| wgpu | 29.0.4 |
| Dawn package | `webgpu@0.6.1` |
| wgpu-bun | `wgpu-bun@29.1.0` |

Each frame creates one encoder and one pass for a 256×256 `bgra8unorm` target. The pass sets a pipeline once, then repeats `setVertexBuffer`, `setIndexBuffer`, and `drawIndexed(3)`. It uses 50 warm-up frames and 300 measured frames through 10,000 draws; 50,000 and 100,000 draws use 100 measured frames.

## GPU-IX #525 after the retained optimisation

The retained native change resolves pipeline and buffer references once per pass, validates them before replay, and reuses released presentation frame wrappers. The typed-array recorder was reverted because Bun made its encode path slower: 10,000-draw encode rose from 51 to 178 ns/draw.

This single final capture records median / p95 CPU timing in milliseconds. GPU completion remains unsupported by GPU-IX’s queue.

| Draws | Frames | Encode ms | Finish + submit ms | CPU ns/draw, median / p95 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 300 | 0.007 / 0.016 | 0.066 / 0.095 | 727 / 1,112 |
| 1,000 | 300 | 0.055 / 0.478 | 0.302 / 1.611 | 358 / 2,089 |
| 10,000 | 300 | 0.478 / 1.363 | 2.929 / 3.878 | 341 / 524 |
| 50,000 | 100 | 2.717 / 3.741 | 16.589 / 22.458 | 386 / 524 |
| 100,000 | 100 | 5.508 / 11.018 | 33.398 / 50.098 | 389 / 611 |

The five-trial local baseline is the repeatable regression reference. It records whole-frame CPU time and ns/draw in [baseline.json](baseline.json); its 10,000-draw median is 334 ns/draw and its p95 is 538 ns/draw. GPU-IX cannot wait for submitted work, so per-frame p95 includes retained-presentation queue pressure and is not comparable with providers that wait for completion.

Before the retained native change, the 10,000-draw median was 355 ns/draw and p95 was 594 ns/draw. The latest baseline is 334 / 538 ns/draw, a 6% / 9% improvement. At high counts, the median rises from 334 ns/draw at 10,000 to 371 at 50,000 and 368 at 100,000; there was no device-limit failure.

## Native phase profile

Temporary `Instant` timers were added to `webgpu_canvas.rs`, profiled at 10,000 draws, then removed before committing. Values below are native-only median / p95 ns per draw; the outer JavaScript timer is a separate run and must not be added to these p95s.

| Native phase | Median ns/draw | p95 ns/draw |
| --- | ---: | ---: |
| Decode ops | 26.2 | 27.8 |
| Resolve resources and ranges | 12.3 | 16.2 |
| Frame/view preparation | 1.2 | 2.4 |
| wgpu render-pass recording | 171.3 | 182.5 |
| Finish, submit and ready signal | 2.3 | 4.0 |
| **Native producer total** | **213.0** | **229.5** |

The remaining submit-path residual includes JavaScript descriptor preparation and the N-API boundary. The direct typed-array recorder would remove a copy there, but it cost roughly 127 ns/draw more during Bun recording and was not retained.

## Small-frame split

Temporary timers around the native test-renderer bridge were run at 100 and 1,000 draws, then removed. These are synchronous median CPU times in microseconds; the JavaScript submit column is the outer submit time after subtracting native replay and presentation setup. The full-frame p95 remains in the main result table and baseline because independently sampled phase p95s cannot be combined.

| Draws | JavaScript recording | JavaScript submit and N-API | Native replay | Presentation install and GPUI invalidation | Whole frame |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 6.6 | 33.9 | 49.0 | 0.3 | 89.7 |
| 1,000 | 50.0 | 71.8 | 226.3 | 0.3 | 348.4 |

The asynchronous GPUI compositor is outside the submit-return interval, so it cannot be attributed to that CPU total. No significant synchronous presentation cost remained after frame-wrapper reuse. The largest removable-looking cost is JavaScript submission preparation and N-API, but the attempted typed-array recorder regressed Bun’s recording path and was discarded.

## wgpu controls

`packages/native/examples/bench_webgpu_draw.rs` is the high-level Rust control. It uses the same adapter, target, pipeline and commands with no JavaScript, N-API, decode, canvas or presentation work.

| Control, 10,000 draws | Record ns/draw, median / p95 | Finish + submit ns/draw, median / p95 | Total ns/draw, median / p95 |
| --- | ---: | ---: | ---: |
| Direct `wgpu` | 29 / 33 | 132 / 134 | **161 / 166** |
| Direct `wgpu-core` Global plus IDs | 39 / 93 | 147 / 358 | **186 / 450** |

The core path is not faster, so GPU-IX does not prototype replay on `wgpu-core`. The source explains why: `render_pass_set_vertex_buffer` and `render_pass_set_index_buffer` resolve the buffer ID and append `ArcRenderCommand`s, while pass-end encoding performs resource tracking and validation. The high-level API wrapper is not the limiting layer. At 100,000 draws, direct `wgpu` rises to 192 ns/draw median, confirming that part of the high-count increase belongs to wgpu itself.

## Other providers

The earlier cross-provider data remains in the checked-in result files and can be rerun with the commands below. Dawn `webgpu@0.6.1` measured 1,440 ns/draw at 10,000 draws under Node, and aborts under Bun during the workload even with `device.destroy()`, explicit texture destruction and explicit GC removed. `wgpu-bun`’s fastest 10,000-draw result was 216 ns/draw through `WGPU_BUN_IMPL=dawn`, or 72 ns per FFI call.

## Local regression check

Build the release addon first, then run:

```sh
bun run build:native
bun run bench:webgpu
```

The check never builds the addon. It fails if the macOS addon is absent or contains debug sections. It runs five trials in one GPU-IX canvas process, reusing the one benchmark scene, then takes the median per-size result. It fails a median regression above 10% or p95 regression above 20%; both limits are `REGRESSION_THRESHOLDS` in [bench.mjs](bench.mjs). `baseline.json` stores whole-frame CPU time, ns/draw, machine, macOS, Bun and build profile. Update it only after reviewing an intended change:

```sh
bun run bench:webgpu --update-baseline
```

Comparison providers are excluded by default. Run `bun run bench:webgpu --providers=dawn,wgpu-bun,wgpu-bun-dawn` to invoke them; Dawn under Bun is expected to abort as described above.

The final release build passed this check twice. The current result files are [GPU-IX](results-gpuix-bun.json), [Dawn/Node](results-dawn-node.json), [wgpu-bun native](results-wgpu-bun-native.json), and [wgpu-bun Dawn](results-wgpu-bun-dawn.json).
