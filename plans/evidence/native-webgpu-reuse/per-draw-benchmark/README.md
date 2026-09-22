# WebGPU per-draw CPU benchmark

GPU-IX #525 records and submits each draw in 355–435 ns median CPU time, so it does not meet the roughly 30 ns Chrome JavaScript-binding figure. Dawn under Node costs 1,440–2,073 ns per draw on the same host. Dawn under Bun aborts during this workload, so it has no comparable Bun timing.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS 15.7.7 (24G720), Apple M1 |
| Bun | 1.4.0 |
| Node | v26.5.0 |
| GPU-IX branch | `codex/webgpu-production-macos`, commit `3182d60716` |
| Zed submodule | `3682f97a1f40c8b3d28a3771f35c679658c2d4d8` |
| GPU-IX native build | `napi build --platform --release --features test-support` via `bun run build:native` |
| Dawn package | `webgpu@0.6.1` from this directory's pinned `bun.lock` |

## Results

Each cell is median / p95 across 300 frames, in milliseconds. Every N has 50 warm-up frames. Encode starts immediately before `beginRenderPass` and ends when `end()` returns. Finish and submit starts immediately before `finish()` and ends when `queue.submit()` returns. GPU complete starts immediately before `submit()` and ends when `queue.onSubmittedWorkDone()` resolves.

| Provider | Draws/frame | Encode ms | Finish + submit ms | GPU complete ms |
| --- | ---: | ---: | ---: | ---: |
| GPU-IX #525 (wgpu recorder and replay) | 1,000 | 0.053 / 0.325 | 0.306 / 0.846 | unsupported |
| GPU-IX #525 (wgpu recorder and replay) | 5,000 | 0.278 / 1.326 | 1.899 / 3.073 | unsupported |
| GPU-IX #525 (wgpu recorder and replay) | 10,000 | 0.511 / 1.688 | 3.040 / 4.252 | unsupported |
| Dawn webgpu@0.6.1 | 1,000 | 1.908 / 3.922 | 0.165 / 0.429 | 0.743 / 2.049 |
| Dawn webgpu@0.6.1 | 5,000 | 7.062 / 17.072 | 0.456 / 1.129 | 1.402 / 3.028 |
| Dawn webgpu@0.6.1 | 10,000 | 13.592 / 21.627 | 0.806 / 1.348 | 2.261 / 3.386 |

CPU ns/draw is `(encode + finish and submit) / draws`, using the corresponding median or p95 values above.

| Provider | Draws/frame | CPU ns/draw, median / p95 |
| --- | ---: | ---: |
| GPU-IX #525 (wgpu recorder and replay) | 1,000 | 359 / 1171 |
| GPU-IX #525 (wgpu recorder and replay) | 5,000 | 435 / 880 |
| GPU-IX #525 (wgpu recorder and replay) | 10,000 | 355 / 594 |
| Dawn webgpu@0.6.1 | 1,000 | 2073 / 4350 |
| Dawn webgpu@0.6.1 | 5,000 | 1504 / 3640 |
| Dawn webgpu@0.6.1 | 10,000 | 1440 / 2297 |

## Dawn under Bun

Dawn `webgpu@0.6.1` under Bun 1.4.0 aborts during the workload with `panic: A C++ exception occurred`; the crash reproduces when `device.destroy()`, texture destruction, and explicit GC are all left out.

## Method and comparison limits

All providers use one render pipeline and the same WGSL indexed triangle. Each frame creates one command encoder and one render pass against a 256×256 `bgra8unorm` target. The pass calls `setPipeline` once, then repeats `setVertexBuffer`, `setIndexBuffer`, and `drawIndexed(3)` N times before `end`, `finish`, and `queue.submit`.

GPU-IX uses the ordinary React-mounted GPU-IX canvas path. Dawn uses one off-screen texture. Texture acquisition happens before the encode timer, so canvas acquisition and presentation are not measured.

The CPU comparison establishes that the GPU-IX recorder and wgpu replay are cheaper than the Dawn/Node binding on this host. It does not isolate wgpu replay from GPU-IX's JavaScript command recording, JSON serialization, native decoding, canvas presentation, or queue-pressure behaviour. The result also does not establish a Dawn/Bun cost because that provider crashes. GPU-IX does not implement `queue.onSubmittedWorkDone()`, so its GPU-complete metric is unsupported and its frames can accumulate queue back-pressure. Dawn completes each frame before recording the next.

## Reproduce

From this directory, install the pinned Dawn package, build GPU-IX's release addon from the repository root, then run each provider and regenerate the report:

```sh
bun install --frozen-lockfile
(cd ../../../.. && bun run build:native)
bun gpuix-bun.mjs > results-gpuix-bun.json
bun dawn.mjs > results-dawn-bun.json
node dawn.mjs > results-dawn-node.json
node report.mjs
```

The completed provider outputs are [results-gpuix-bun.json](results-gpuix-bun.json) and [results-dawn-node.json](results-dawn-node.json).
