# Native WebGPU reuse: first execution slice

Captured on 2026-09-12. This directory contains the reusable provider-neutral
probes, exact package locks, and the decision from the first execution slice of
[the reuse-first plan](../../native-webgpu-reuse.md).

## Baseline

| Item | Pinned value |
| --- | --- |
| GPU-IX branch | `codex/native-webgpu-reuse` |
| GPU-IX commit | `0ceabb9a0cbebebf4797b2aab22e2b58840a8a4c` |
| Comparison base | `080d73e3f8` |
| Zed commit | `602f751a671e009d5c6748010603526da23a17a5` |
| Bun | `1.4.0 (34cbb9a40)` |
| Node control | `v26.5.0` |
| Host | macOS 15.7.7 (24G720), Apple M1, 8 GPU cores |
| Repository lock | `bun.lock` SHA-256 `bea2f4e3d025e002ebc0b86189b8f48ed2a3cf6607094df363376272a9eae115` |
| Native build | `napi build --platform --release --features test-support` |

The new worktree copied, rather than modified, the active repair work from
`codex/webgpu-production-macos`. The copied GPU-IX patch had SHA-256
`7f929ec18636dc98d859b75ef5831270572f98622e1bf2705162ac585f039849`;
the Zed patch had SHA-256
`63410eac69eb428da97f32ff51181519b5b7095cd51c24bafc4c5e1c84d524b3`.
The original checkout remains untouched.

The repair cases already covered texture identity and expiry, ordered
multi-pass submission, imperative bitmap sizing, sample-mask propagation,
mapped-range detachment, renderer replacement, logical-device ownership, and
native validation attribution. One copied test incorrectly constructed a
type-only `GPUAdapter`; it now acquires the device through the public
`navigator.gpu` path.

Baseline verification:

```text
bun install --frozen-lockfile
  exit 0

bun run build:native
  exit 0

cd packages/react
bun run test -- src/__tests__/webgpu.test.ts src/__tests__/canvas.test.tsx src/__tests__/render.test.tsx
  exit 0
  3 files passed, 81 tests passed
```

## Candidate pins and packaging

| Candidate | Source and backend pin | Package/artifact pin | Assessment |
| --- | --- | --- | --- |
| Dawn official Node binding | `dawn-gpu/node-webgpu` `v0.6.1`, commit `f2585d1b386b0f8df63b3d080131e35ab448a9bb`; Dawn `80ee0043018a51532ea0fa2e77496cc66634157e` | `webgpu@0.6.1`, npm SHA-1 `4a2b276331657db6873f5bf81a2bd254e32db4d1`; installed `dawn.node` SHA-256 `5761a41fdfaa2bbd86ed542faee9e6a8bebbe0fa67c5ae4ae4c2f3efe81920f5` | Full Dawn Node binding, official CTS runner, MIT package plus Dawn BSD-3-Clause obligations. The package contains a universal 20 MB addon and needs no runtime download. |
| bun-webgpu | `kommander/bun-webgpu` `v0.1.7`, commit `7be02a5357e47a54dcb83d03265ead19c7961d76`; binary workflow run `22080543611` at fork commit `d18e21db186c42c073a90f91bdea0cc438b1924d` | `bun-webgpu@0.1.7`, npm SHA-1 `9c15b4d6f33b2f5bbf8d42f4c36ba0d5ed4aa084`; Darwin package SHA-1 `dbb8cd3e681e41912cda1357d46dcd05db5bb1db`; installed dylib SHA-256 `6aec36170d1f96acd17a415fd1de184459821bf921b0694734125fe4fa8725d5` | Apache-2.0 binding with a 9 MB platform dylib. The package identifies the fork workflow run but not the corresponding upstream Dawn revision. Its published CTS summary still has failures and skips. |
| wgpu-bun | `argon-chat/wgpu` `v29.1.0`, commit `58925ede019e4451404e137e6272abc934e59f4f`; wgpu-native `v29.0.1.1`; optional Dawn `v20260807.193620`, commit `c23537c0682b5bf9c2636e0818a3a8a00591b3c3` | `wgpu-bun@29.1.0`, npm SHA-1 `1d168de144e15811df6888089ae8bd4c2c92afcd`; wgpu-native dylib SHA-256 `e72e8f1777dd0315bfee91c6b7e7b105234d5c1cc1621db4cf92ffee2ac2ae32`; Dawn package SHA-1 `e7611f13804eb9fb34ea83561ed56eccde19b2ab`, dylib SHA-256 `b62cf2a025495b889fa0199da4e0b25f5e421390b89bbed17bc11faee933eb22` | MIT binding; platform packages also carry upstream licenses. The TypeScript objects expose raw WebGPU C handles, but no supported Metal texture or IOSurface handle. No WebGPU CTS run is claimed. |

The exact transitive package graphs are retained in each probe directory's
`bun.lock`.

## Probe

`probes/shared/behavioral-probe.mjs` keeps provider setup outside the WebGPU
calls under test. Each candidate runs in a separate process and exercises:

- adapter features/limits and rejected feature/limit negotiation;
- invalid WGSL and invalid buffer usage with synchronous versus scoped errors
  recorded separately;
- mapped-range overlap, transfer, unmap, and destruction;
- buffer upload/copy/map ordering;
- multiple ordered render command buffers with pixel readback;
- readback-proven `sampleMask: 0`;
- cross-device ownership and survival of the unrelated device.

Metal adapter discovery returns `null` under the Codex macOS Seatbelt for both
Node and Bun. The runs below were therefore repeated outside Seatbelt. GPU-IX's
own native build and focused tests remain sandboxed.

| Provider/runtime | Command | Exit | Result |
| --- | --- | --- | --- |
| Official Dawn / Node control | `node --expose-gc probe.mjs` in `probes/node-webgpu` | 0 | 11/12. Only transfer of the mapped Dawn ArrayBuffer failed with `DataCloneError`. |
| Official Dawn / Bun | `bun probe.mjs` in `probes/node-webgpu` | 0 | 12/12. Metal adapter `apple-m1`; ordered readback and sample-mask result both `[0,255,0,255]`. |
| bun-webgpu / Bun | `bun probe.mjs` in `probes/bun-webgpu` | 0 | 11/12. Mapped range transfer failed. WGSL validation was scoped, but `getCompilationInfo()` threw `not implemented`. |
| wgpu-bun / wgpu-native / Bun | `bun probe.mjs` in `probes/wgpu-bun` | 134 | Cross-device queue submission aborted the process inside `wgpuQueueSubmit` before the probe could emit JSON. Direct adoption is rejected. |
| wgpu-bun / Dawn / Bun | `WGPU_BUN_IMPL=dawn bun probe.mjs` in `probes/wgpu-bun` | 0 | 11/12. Overlapping mapped ranges were accepted. A device-lost callback also named a non-live device during the run; attribution needs a focused negative case before use. |

## Comparative CTS slice

The checked-in [manifest](cts/manifest.json) fixes 11 selectors (15 cases)
before comparing provider results. They cover adapter/device creation, default
limits, mapped-at-creation buffers, buffer command ordering, texture copy,
valid and invalid WGSL diagnostics, a rendered clear/readback, and sample-mask
output. The suite is pinned to `gpuweb/cts`
`a2134bc7916dc6004781a137690b8741aef9aae1`, the revision embedded by the
official provider's Dawn pin. `cts/run-slice.mjs` invokes the upstream command
line runner through the actual Bun binding, isolates every selector in a child
process, and treats a crash, timeout, or zero executed cases as non-green.

The CTS runner synchronously requires its provider module, while bun-webgpu's
setup is asynchronous. Its adapter therefore performs the package's real
`setupGlobals()` in a Bun preload and supplies `navigator.gpu`; it does not
emulate any GPU behavior. Runs require host Metal access because adapter
discovery is blocked by Seatbelt.

| Provider | Executed | Pass | Assertion failures | Crash before result | Harness/liveness blocked | Skip/timeout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Official `webgpu@0.6.1` | 15/15 | 15 | 0 | 0 | 0 | 0 |
| `bun-webgpu@0.1.7` | 15/15 | 11 | 4 | 0 | 0 | 0 |
| `wgpu-bun@29.1.0`, Dawn mode | 2/15 | 2 | 0 | 11 | 2 | 0 |

bun-webgpu reported four per-stage storage limits as zero, rejected the
omitted-size `copyBufferToBuffer` overload, and did not implement compilation
info for valid or invalid WGSL. wgpu-bun's Dawn mode exited 139 in seven
selectors covering 11 selected cases; the adapter and device selectors exited
zero before a CTS result, exposing an async liveness failure rather than a
pass. The exact normalized counts and failure summaries are retained in
[results.json](cts/results.json). This is a comparative adoption filter, not a
claim of general WebGPU conformance or a substitute for the broader inventory
and release gates in the testing plan.

### Official binding teardown

The official binding has a separate Bun lifecycle blocker. The minimized
`probes/node-webgpu/teardown.mjs` results were reproduced in isolated
processes:

| Mode | Exit | Observation |
| --- | --- | --- |
| `device` | 0 | Natural teardown completed. |
| `device-gc` | 134 | Forced Bun collection immediately after `device.destroy()` raised a C++ exception and aborted Bun. |
| `texture-device` | 0 | Explicit texture/device destruction with natural teardown completed. |
| `texture-device-gc` | 134 | The same forced-collection crash reproduced. |
| `texture-settle-device-gc` | 0 | Awaiting `queue.onSubmittedWorkDone()` before destruction prevented the crash. |
| `device-rooted-gc` | 134 | Starting queue completion and strongly rooting the wrapper while calling synchronous `destroy()` still aborted. Rooting alone is insufficient. |

This is a provider/runtime lifecycle defect, not a reason to weaken the
shutdown requirement. Direct adoption remains blocked until the addon keeps
its native instance rooted and defers the native teardown until completion,
while preserving synchronous JavaScript destroyed-state semantics. This must
be fixed below the public wrapper: a bounded JavaScript rooting experiment
still exited 134, and application code must not have to make
`GPUDevice.destroy()` asynchronous.

## Presentation model and decision

The part that must cross the provider/GPUI boundary is texture memory,
readiness, and lifetime—not a Rust `wgpu::Device`, a Dawn C++ object, or a
WebGPU C handle. Removing either implementation leaves the same macOS model:

1. GPU-IX owns an IOSurface-backed Metal allocation for a canvas frame.
2. The application provider imports that IOSurface as a renderable WebGPU
   texture.
3. End-access returns a retained `MTLSharedEvent` and signal value.
4. GPUI waits for that value, composites the same allocation, and returns it to
   the reuse pool only after both producer and compositor release it.

Dawn already has native
[IOSurface shared texture memory](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/metal/SharedTextureMemoryMTL.mm)
and shared-fence support. This avoids pretending a Dawn handle is a Rust
`wgpu` handle and gives the adapter an explicit synchronization contract.

The first provider for a **bounded fork and presentation feasibility spike** is
`webgpu@0.6.1`, not yet an adoption decision. It is the only candidate that
passed every provider-neutral case under Bun and it carries Dawn's broader
binding/CTS surface. Reflection in `probes/node-webgpu/introspect.mjs`
confirmed that the package exports only `create`, `globals`, and `isMac`;
its GPU texture has no exposed native handle. The fork therefore has two
deliberate responsibilities:

1. repair the Bun teardown/rooting failure and make every minimized teardown
   mode exit 0; and
2. add one provider-private canvas bridge inside the same addon that imports a
   renderer-owned IOSurface and returns the end-access shared event/value.

The next bounded experiment is one 64×64 ordinary GPU-IX canvas clear using
that bridge. GPUI will wrap the IOSurface's Metal texture in the existing
retained surface path, wait on the returned event, and display it without a
map/readback/atlas upload. The experiment must trace those forbidden calls and
exercise at least two frame-buffer reuses. If teardown cannot be repaired
locally or the bridge requires broad Dawn internal surgery, reject this route
before expanding the JavaScript API and move the same presentation experiment
to `wgpu-bun`'s Dawn mode after fixing its mapped-range and callback
attribution defects.
