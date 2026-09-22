import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const nodeResult = JSON.parse(readFileSync(new URL("results-dawn-node.json", import.meta.url)))
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

const metricRows = nodeResult.measurements.map((measurement) => [
  measurement.draws.toLocaleString("en-GB"),
  `${milliseconds(measurement.encode.medianNs)} / ${milliseconds(measurement.encode.p95Ns)}`,
  `${milliseconds(measurement.finishSubmit.medianNs)} / ${milliseconds(measurement.finishSubmit.p95Ns)}`,
  `${milliseconds(measurement.gpuComplete.medianNs)} / ${milliseconds(measurement.gpuComplete.p95Ns)}`,
].join(" | "))
const perDrawRows = nodeResult.measurements.map((measurement) => [
  measurement.draws.toLocaleString("en-GB"),
  `${nsPerDraw(measurement, "medianNs")} / ${nsPerDraw(measurement, "p95Ns")}`,
].join(" | "))

const readme = `# WebGPU per-draw CPU benchmark

Only Dawn under Node completed the workload. Dawn under Bun aborted with a C++ exception, and GPU-IX #525 could not build because the branch's required Zed submodule revision is unavailable. These are benchmark results, not missing table entries.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS ${systemVersion} (${buildVersion}), ${chip} |
| Bun | ${bunVersion} |
| Node | ${execFileSync("node", ["--version"], { encoding: "utf8" }).trim()} |
| GPU-IX native build requested | \`napi build --platform --release --features test-support\` via \`bun run build:native\` |
| Dawn package | \`webgpu@0.6.1\` from this directory's pinned \`bun.lock\` |

## Provider outcomes

| Provider/runtime | Outcome |
| --- | --- |
| GPU-IX #525 / Bun | Not run. The branch worktree's \`zed\` submodule has no files, so Cargo cannot read \`crates/gpui/Cargo.toml\`. The submodule commit recorded by the branch, \`3682f97\`, is absent from its configured remote. An isolated build using the locally available compatible Zed revision \`b1f963e\` reached Rust compilation but failed because that revision lacks \`aria_has_popup\`, \`aria_role_description\`, and \`MetalTextureSurface::new_opaque\`. |
| Dawn \`webgpu@0.6.1\` / Bun 1.4.0 | Crashed before emitting a result: Bun reported \`panic: A C++ exception occurred\`. Retrying without explicit texture/device teardown had the same result. |
| Dawn \`webgpu@0.6.1\` / Node v26.5.0 | Completed. The raw 300-frame samples are in [results-dawn-node.json](results-dawn-node.json). |

## Dawn under Node results

Each cell is median / p95 across 300 frames, in milliseconds. Every N has 50 warm-up frames. Encode starts immediately before \`beginRenderPass\` and ends when \`end()\` returns. Finish and submit starts immediately before \`finish()\` and ends when \`queue.submit()\` returns. GPU complete starts immediately before \`submit()\` and ends when \`queue.onSubmittedWorkDone()\` resolves.

| Draws/frame | Encode ms | Finish + submit ms | GPU complete ms |
| ---: | ---: | ---: | ---: |
| ${metricRows.join(" |\n| ")} |

CPU ns/draw is \`(encode + finish and submit) / draws\`, using the corresponding median or p95 values above.

| Draws/frame | CPU ns/draw, median / p95 |
| ---: | ---: |
| ${perDrawRows.join(" |\n| ")} |

## Method and comparison limits

All providers use one render pipeline and the same WGSL indexed triangle. Each frame creates one command encoder and one render pass against a 256×256 \`bgra8unorm\` target. The pass calls \`setPipeline\` once, then repeats \`setVertexBuffer\`, \`setIndexBuffer\`, and \`drawIndexed(3)\` N times before \`end\`, \`finish\`, and \`queue.submit\`.

GPU-IX is configured to use the ordinary React-mounted GPU-IX canvas path. Dawn uses one off-screen texture. The texture acquisition happens before the encode timer, so canvas acquisition and presentation are not measured.

This run cannot determine whether GPU-IX beats Chrome's published 30 ns per-draw binding figure or whether its wgpu replay cost warrants reconsidering Dawn. Dawn's Node result is not a direct comparison: it uses an off-screen target and waits for GPU completion between frames. GPU-IX #525 does not implement \`queue.onSubmittedWorkDone()\`, so even a successful GPU-IX run would report GPU completion as unsupported and could accumulate queue back-pressure.

## Reproduce

From this directory, install the pinned Dawn package. Build GPU-IX's release addon from the repository root only when its Zed submodule resolves, then run each provider:

\`\`\`sh
bun install --frozen-lockfile
(cd ../../../.. && bun run build:native)
bun gpuix-bun.mjs > results-gpuix-bun.json
bun dawn.mjs > results-dawn-bun.json
node dawn.mjs > results-dawn-node.json
node report.mjs
\`\`\`
`

writeFileSync(new URL("README.md", import.meta.url), readme)
