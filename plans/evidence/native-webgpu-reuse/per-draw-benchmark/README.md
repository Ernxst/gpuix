# WebGPU per-draw CPU benchmark

GPU-IX #525 records and submits each draw in 355–435 ns median CPU time, so it does not meet the roughly 30 ns Chrome JavaScript-binding figure. Its native replay is dominated by wgpu render-pass recording at 191 ns/draw. The direct wgpu baseline is 161 ns/draw. wgpu-bun is 216–336 ns/draw under Bun; its Dawn mode is the faster 216 ns/draw at 10,000 draws. Dawn's own `webgpu@0.6.1` package is 1,440 ns/draw under Node and aborts under Bun.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS 15.7.7 (24G720), Apple M1 |
| Bun | 1.4.0 |
| Node | v26.5.0 |
| GPU-IX branch | `codex/webgpu-production-macos`, commit `3182d60716` |
| Zed submodule | `3682f97a1f40c8b3d28a3771f35c679658c2d4d8` |
| GPU-IX native build | `napi build --platform --release --features test-support` via `bun run build:native` |
| Rust baseline | `wgpu 29.0.4`, Cargo release profile |
| Dawn package | `webgpu@0.6.1` from this directory's pinned `bun.lock` |
| wgpu-bun package | `wgpu-bun@29.1.0`; native `29.0.1.1`, or `v20260807.193620` with `WGPU_BUN_IMPL=dawn` |

## Provider results

Each cell is median / p95 across 300 frames, in milliseconds. Every N has 50 warm-up frames. Encode starts immediately before `beginRenderPass` and ends when `end()` returns. Finish and submit starts immediately before `finish()` and ends when `queue.submit()` returns. GPU complete starts immediately before `submit()` and ends when `queue.onSubmittedWorkDone()` resolves.

| Provider | Draws/frame | Encode ms | Finish + submit ms | GPU complete ms |
| --- | ---: | ---: | ---: | ---: |
| GPU-IX #525 (wgpu recorder and replay) | 1,000 | 0.053 / 0.325 | 0.306 / 0.846 | unsupported |
| GPU-IX #525 (wgpu recorder and replay) | 5,000 | 0.278 / 1.326 | 1.899 / 3.073 | unsupported |
| GPU-IX #525 (wgpu recorder and replay) | 10,000 | 0.511 / 1.688 | 3.040 / 4.252 | unsupported |
| Dawn webgpu@0.6.1 | 1,000 | 1.908 / 3.922 | 0.165 / 0.429 | 0.743 / 2.049 |
| Dawn webgpu@0.6.1 | 5,000 | 7.062 / 17.072 | 0.456 / 1.129 | 1.402 / 3.028 |
| Dawn webgpu@0.6.1 | 10,000 | 13.592 / 21.627 | 0.806 / 1.348 | 2.261 / 3.386 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 1,000 | 0.126 / 0.375 | 0.210 / 0.751 | 1.505 / 2.187 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 5,000 | 0.541 / 0.798 | 0.813 / 1.005 | 2.088 / 3.333 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 10,000 | 1.084 / 2.520 | 1.544 / 4.686 | 4.099 / 7.288 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 1,000 | 0.233 / 0.398 | 0.156 / 0.272 | 2.501 / 2.697 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 5,000 | 0.803 / 1.385 | 0.470 / 0.819 | 2.850 / 4.072 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 10,000 | 1.322 / 1.936 | 0.838 / 1.101 | 4.294 / 4.606 |

CPU ns/draw is `(encode + finish and submit) / draws`, using the corresponding median or p95 values above.

| Provider | Draws/frame | CPU ns/draw, median / p95 |
| --- | ---: | ---: |
| GPU-IX #525 (wgpu recorder and replay) | 1,000 | 359 / 1171 |
| GPU-IX #525 (wgpu recorder and replay) | 5,000 | 435 / 880 |
| GPU-IX #525 (wgpu recorder and replay) | 10,000 | 355 / 594 |
| Dawn webgpu@0.6.1 | 1,000 | 2073 / 4350 |
| Dawn webgpu@0.6.1 | 5,000 | 1504 / 3640 |
| Dawn webgpu@0.6.1 | 10,000 | 1440 / 2297 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 1,000 | 336 / 1126 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 5,000 | 271 / 361 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 10,000 | 263 / 721 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 1,000 | 390 / 670 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 5,000 | 255 / 441 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 10,000 | 216 / 304 |

wgpu-bun makes one FFI call for every timed WebGPU method. There are `3N + 5` such calls per frame: render-pass begin, pipeline, three calls per draw, pass end, finish and submit.

| Provider | Draws/frame | Timed calls/frame | CPU ns/call, median / p95 |
| --- | ---: | ---: | ---: |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 1,000 | 3,005 | 112 / 375 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 5,000 | 15,005 | 90 / 120 |
| wgpu-bun@29.1.0 / 29.0.1.1 / shim | 10,000 | 30,005 | 88 / 240 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 1,000 | 3,005 | 130 / 223 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 5,000 | 15,005 | 85 / 147 |
| wgpu-bun@29.1.0 / v20260807.193620 / shim | 10,000 | 30,005 | 72 / 101 |

## GPU-IX native-side breakdown

This is a separate 10,000-draw GPU-IX run with 50 warm-up and 300 measured frames. Temporary `Instant` timing was added only to `webgpu_canvas.rs` and reverted before this change was committed. The measured finish-plus-submit median was 2,976,791 ns (297.7 ns/draw).

| Phase | Median ns/draw | What it includes |
| --- | ---: | --- |
| JavaScript submit preparation plus N-API boundary and argument transfer (residual) | 64.2 | The end-to-end timer less all native phases below. This is an upper bound for N-API alone because it includes uninstrumented JavaScript submission preparation. |
| JSON submission descriptor parse | 0.0 | `serde_json` parse in `submit_commands`. |
| Decode `ops` buffer | 27.3 | Decode the recorded pass commands into native operations. |
| Frame/view allocation | 6.8 | Per-frame render target bookkeeping and view work. |
| wgpu render-pass recording | 190.5 | `set_pipeline`, `set_vertex_buffer`, `set_index_buffer`, and `draw_indexed`. |
| Finish, queue submit and ready signal | 3.1 | `encoder.finish`, `queue.submit`, and completion signalling. |
| Other producer work | 5.7 | Error scopes, locking and remaining submission work. |
| **Total** | **297.7** | **Finish plus submit** |

The Time Profiler capture used the same 10,000-draw/300-frame harness. Its native stack samples included the following flat hot functions; the release addon had no line-level debug symbols, so compiler-generated symbols cannot be usefully subdivided.

| Flat samples | Function |
| ---: | --- |
| 668 | `alloc::collections::btree::map::entry::VacantEntry::insert_entry` under GPUI subscriptions |
| 598 | `WebGpuCanvasStore::present` |
| 371 | `WebGpuCanvasStore::present` (second instruction range) |
| 165 | `WebGpuProducer::require_logical_device` |

Those samples cover the complete React/canvas process, including initial layout and presentation. The phase timers above isolate the submitted pass, and show that the render-pass method replay, rather than the sampled presentation work, dominates the 10,000-draw native submission.

## Direct wgpu baseline

`packages/native/examples/bench_webgpu_draw.rs` records the same 10,000-draw pass directly through `wgpu 29.0.4`, with the same off-screen 256×256 target and no JavaScript, N-API, decode, JSON, canvas, presentation or error scopes in the timed path. In the Cargo release build, 300 measured frames after 50 warm-up frames produced:

| Phase | Median ns/draw | p95 ns/draw |
| --- | ---: | ---: |
| Render-pass recording | 32 | 40 |
| Finish + submit | 130 | 151 |
| **Total** | **161** | **190** |

## Dawn under Bun

Dawn `webgpu@0.6.1` under Bun 1.4.0 aborts during the workload with `panic: A C++ exception occurred`; the crash reproduces when `device.destroy()`, texture destruction, and explicit GC are all left out.

## Method and comparison limits

All providers use one render pipeline and the same WGSL indexed triangle. Each frame creates one command encoder and one render pass against a 256×256 `bgra8unorm` target. The pass calls `setPipeline` once, then repeats `setVertexBuffer`, `setIndexBuffer`, and `drawIndexed(3)` N times before `end`, `finish`, and `queue.submit`.

GPU-IX uses the ordinary React-mounted GPU-IX canvas path. Dawn and wgpu-bun use one off-screen texture. Texture acquisition happens before the encode timer, so canvas acquisition and presentation are not measured. GPU-IX does not implement `queue.onSubmittedWorkDone()`, so GPU completion is unsupported and GPU-IX frames can accumulate queue back-pressure. The other providers wait for completion before recording the next frame. That makes GPU-complete figures unlike GPU-IX and affects queue pressure, but it does not affect a provider's synchronous encode or submit timer in isolation.

The Rust direct-wgpu baseline's `finish + submit` cost is higher than GPU-IX's timed queue call because wgpu can defer backend work until `queue.submit`; therefore, its total is the useful comparison, not either phase individually. The CPU totals do not isolate wgpu replay from GPU-IX's JavaScript recording and submission preparation. wgpu-bun’s reported native version is 29.0.1.1 despite its JavaScript package version 29.1.0, and its Dawn seam reports a date version, so those are related but not byte-identical native implementations.

## Largest native-cost opportunities

| Change | Expected saving at 10,000 draws | Basis and constraint |
| --- | ---: | --- |
| Prevalidate resource IDs, device ownership and buffer ranges once, then replay resolved pipeline/buffer references | 120–160 ns/draw | GPU-IX replay records at 191 ns/draw while direct wgpu records at 31 ns/draw. The difference is dominated by the repeated map lookups, ownership/usage checks and range work around each wgpu call. Retain WebGPU validation behaviour at the command boundary. |
| Cache a decoded command stream, or decode directly into an executable compact representation | up to 27 ns/draw | The current `ops` decode alone measures 27.3 ns/draw. Caching requires invalidation when the JavaScript command buffer is changed or released. |
| Reuse the per-frame surface/texture wrapper and fold the extra Metal ready-event submission into presentation where GPUI permits it | 7–10 ns/draw | Frame/view work is 6.8 ns/draw and finish/submit/ready signalling is 3.1 ns/draw. This needs an ownership-safe presentation path; it cannot assume a canvas target is permanently reusable. |

## Reproduce

From this directory, install the pinned providers, build GPU-IX's release addon from the repository root, then run each provider and regenerate the report:

```sh
bun install --frozen-lockfile
(cd ../../../.. && bun run build:native)
bun gpuix-bun.mjs > results-gpuix-bun.json
bun dawn.mjs > results-dawn-bun.json
node dawn.mjs > results-dawn-node.json
bun wgpu-bun.mjs > results-wgpu-bun-native.json
WGPU_BUN_IMPL=dawn bun wgpu-bun.mjs > results-wgpu-bun-dawn.json
(cd ../../../.. && cargo run --release -p gpuix-native --example bench_webgpu_draw)
node report.mjs
```

The completed provider outputs are [results-gpuix-bun.json](results-gpuix-bun.json), [results-dawn-node.json](results-dawn-node.json), [results-wgpu-bun-native.json](results-wgpu-bun-native.json), and [results-wgpu-bun-dawn.json](results-wgpu-bun-dawn.json).
