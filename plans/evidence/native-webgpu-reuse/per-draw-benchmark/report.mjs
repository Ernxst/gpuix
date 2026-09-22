import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const gpuixResult = JSON.parse(readFileSync(new URL("results-gpuix-bun.json", import.meta.url)))
const dawnNodeResult = JSON.parse(readFileSync(new URL("results-dawn-node.json", import.meta.url)))
const systemVersion = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
const buildVersion = execFileSync("sw_vers", ["-buildVersion"], { encoding: "utf8" }).trim()
const hardware = execFileSync("system_profiler", ["SPHardwareDataType"], { encoding: "utf8" })
const chip = hardware.match(/^\s*Chip:\s*(.+)$/m)?.[1] ?? "not recorded"
const bunVersion = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim()

function milliseconds(nanoseconds) {
  return (nanoseconds / 1_000_000).toFixed(3)
}

function nsPerDraw(measurement, percentile) {
  return Math.round(
    (measurement.encode[percentile] + measurement.finishSubmit[percentile]) / measurement.draws
  )
}

function metricRows(result) {
  return result.measurements.map((measurement) => [
    result.provider,
    measurement.draws.toLocaleString("en-GB"),
    `${milliseconds(measurement.encode.medianNs)} / ${milliseconds(measurement.encode.p95Ns)}`,
    `${milliseconds(measurement.finishSubmit.medianNs)} / ${milliseconds(measurement.finishSubmit.p95Ns)}`,
    measurement.gpuComplete
      ? `${milliseconds(measurement.gpuComplete.medianNs)} / ${milliseconds(measurement.gpuComplete.p95Ns)}`
      : "unsupported",
  ].join(" | "))
}

function perDrawRows(result) {
  return result.measurements.map((measurement) => [
    result.provider,
    measurement.draws.toLocaleString("en-GB"),
    `${nsPerDraw(measurement, "medianNs")} / ${nsPerDraw(measurement, "p95Ns")}`,
  ].join(" | "))
}

const readme = `# WebGPU per-draw CPU benchmark

GPU-IX #525 records and submits each draw in 355–435 ns median CPU time, so it does not meet the roughly 30 ns Chrome JavaScript-binding figure. Dawn under Node costs 1,440–2,073 ns per draw on the same host. Dawn under Bun aborts during this workload, so it has no comparable Bun timing.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS ${systemVersion} (${buildVersion}), ${chip} |
| Bun | ${bunVersion} |
| Node | ${execFileSync("node", ["--version"], { encoding: "utf8" }).trim()} |
| GPU-IX branch | \`codex/webgpu-production-macos\`, commit \`3182d60716\` |
| Zed submodule | \`3682f97a1f40c8b3d28a3771f35c679658c2d4d8\` |
| GPU-IX native build | \`napi build --platform --release --features test-support\` via \`bun run build:native\` |
| Dawn package | \`webgpu@0.6.1\` from this directory's pinned \`bun.lock\` |

## Results

Each cell is median / p95 across 300 frames, in milliseconds. Every N has 50 warm-up frames. Encode starts immediately before \`beginRenderPass\` and ends when \`end()\` returns. Finish and submit starts immediately before \`finish()\` and ends when \`queue.submit()\` returns. GPU complete starts immediately before \`submit()\` and ends when \`queue.onSubmittedWorkDone()\` resolves.

| Provider | Draws/frame | Encode ms | Finish + submit ms | GPU complete ms |
| --- | ---: | ---: | ---: | ---: |
| ${[...metricRows(gpuixResult), ...metricRows(dawnNodeResult)].join(" |\n| ")} |

CPU ns/draw is \`(encode + finish and submit) / draws\`, using the corresponding median or p95 values above.

| Provider | Draws/frame | CPU ns/draw, median / p95 |
| --- | ---: | ---: |
| ${[...perDrawRows(gpuixResult), ...perDrawRows(dawnNodeResult)].join(" |\n| ")} |

## Dawn under Bun

Dawn \`webgpu@0.6.1\` under Bun 1.4.0 aborts during the workload with \`panic: A C++ exception occurred\`; the crash reproduces when \`device.destroy()\`, texture destruction, and explicit GC are all left out.

## Method and comparison limits

All providers use one render pipeline and the same WGSL indexed triangle. Each frame creates one command encoder and one render pass against a 256×256 \`bgra8unorm\` target. The pass calls \`setPipeline\` once, then repeats \`setVertexBuffer\`, \`setIndexBuffer\`, and \`drawIndexed(3)\` N times before \`end\`, \`finish\`, and \`queue.submit\`.

GPU-IX uses the ordinary React-mounted GPU-IX canvas path. Dawn uses one off-screen texture. Texture acquisition happens before the encode timer, so canvas acquisition and presentation are not measured.

The CPU comparison establishes that the GPU-IX recorder and wgpu replay are cheaper than the Dawn/Node binding on this host. It does not isolate wgpu replay from GPU-IX's JavaScript command recording, JSON serialization, native decoding, canvas presentation, or queue-pressure behaviour. The result also does not establish a Dawn/Bun cost because that provider crashes. GPU-IX does not implement \`queue.onSubmittedWorkDone()\`, so its GPU-complete metric is unsupported and its frames can accumulate queue back-pressure. Dawn completes each frame before recording the next.

## Reproduce

From this directory, install the pinned Dawn package, build GPU-IX's release addon from the repository root, then run each provider and regenerate the report:

\`\`\`sh
bun install --frozen-lockfile
(cd ../../../.. && bun run build:native)
bun gpuix-bun.mjs > results-gpuix-bun.json
bun dawn.mjs > results-dawn-bun.json
node dawn.mjs > results-dawn-node.json
node report.mjs
\`\`\`

The completed provider outputs are [results-gpuix-bun.json](results-gpuix-bun.json) and [results-dawn-node.json](results-dawn-node.json).
`

writeFileSync(new URL("README.md", import.meta.url), readme)
