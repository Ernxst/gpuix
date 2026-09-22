---
title: Native WebGPU testing and release gates
description: Upstream conformance through the shipped Bun binding, plus native composition, lifetime, and application acceptance tests.
status: draft
updated: 2026-09-12
---

# Native WebGPU testing and release gates

## Recommendation

Make the upstream WebGPU Conformance Test Suite (CTS) the primary API correctness
oracle. Run it through the same JavaScript binding, Bun runtime, and native
backend that applications ship. Supplement it with tests for the boundaries
GPU-IX owns: runtime integration, GPUI presentation, React lifecycle, and packaging.

The [upstream CTS](https://github.com/gpuweb/cts) tests normative WebGPU behavior
and supports standalone execution or embedding in WPT. Reuse its assertions;
maintain a small provider/bootstrap adapter rather than a parallel conformance
suite. Passing tests directly against wgpu or Dawn does not establish that our
JavaScript binding preserves their behavior.

This draft accompanies [the reuse plan](native-webgpu-reuse.md) and
[the application outcome](native-webgpu-threejs.md). It specifies work to implement,
not tests already running or a current conformance claim.

## What each layer establishes

| Layer | Primary evidence | Boundary it covers |
| --- | --- | --- |
| Upstream CTS | Upstream assertions through the shipped Bun provider | API validation, resource operations, shaders, commands, synchronization and computed results |
| Binding and lifetime tests | Standard API behavior plus native ownership instrumentation | Bun objects, mapping, callbacks, GC, device isolation and teardown |
| GPUI integration tests | Actual window output and GPU submission/ownership evidence | Presentation, composition, resize, canvas expiry and safe texture retirement |
| Application and packaging tests | Unmodified Three.js scenes using built packages | React lifecycle, realistic rendering, asset loading and distributable runtime |
| Endurance and performance tests | Fixed workloads, traces and resource trends | Leaks, idle behavior, frame pacing and GPU-only presentation |

Use existing native decoder tests for malformed transport, size/offset overflow,
invalid handles and ownership mismatches wherever that transport remains after
provider selection. Keep these focused on boundaries our code actually owns.

## 1. Establish the CTS runner before selecting a provider

Pin the CTS commit and its dependency versions. Record the provider commit,
native backend revision, Bun version, build flags and package digest with every
run. Use the same CTS revision and query set when comparing adoption candidates.

Start from upstream runner infrastructure. Dawn's
[Node runner documentation](https://dawn.googlesource.com/dawn/+/HEAD/src/dawn/node/README.md)
provides an existing provider-based harness and browser comparison route; inspect
the pinned implementation before adapting its bootstrap to Bun. Node execution
is a useful control, while Bun execution is the acceptance requirement.

The adapter may install genuine provider globals, initialize the device and
report results. It must not emulate missing GPU operations, suppress validation
errors, replace asynchronous completion with resolved promises, or adjust an
assertion to match the implementation. Report a missing harness prerequisite
separately from an unsupported optional GPU feature.

Run a representative slice immediately: adapter/device creation, limits and
features, buffers and mapping, invalid shader handling, command encoding and
submission, texture operations, and a rendered/read-back result. Resolve exact
CTS selectors from the pinned tree; record them in a checked-in manifest.
Test readback is appropriate for result verification even though production
presentation must remain GPU-only.

Prove the runner fails when a deliberately incorrect expectation is introduced
in an isolated harness self-test. Also prove that a missing adapter, a crashed
child process, a timeout, and zero executed cases cannot produce a green gate.

**Deliverable:** reproducible Bun runner, query manifest, machine-readable results
and a baseline for every shortlisted provider. Use this evidence in the reuse
decision before expanding the current handwritten API.

## 2. Define honest coverage and advancement rules

Discover the full pinned CTS inventory. Map each relevant family to the public
support contract, including negative behavior and optional-feature negotiation.
Select the required set from that contract before examining which cases pass.
A Three.js smoke test must not define the whole supported API.

Report these outcomes separately: pass, assertion failure, crash, timeout,
legitimate capability skip, implementation gap, and harness/environment blocked.
Retain upstream result details and explain any normalization. Include discovered,
selected and executed counts; count executable cases, not source files or test
plans without assertions. Retain stable case identifiers and failing seeds.

A release gate requires every applicable case in the claimed support set to
pass. Missing mandatory behavior cannot be relabeled an optional-feature skip.
During development, known failures can remain visible with an issue and scope,
but cannot count as completed support. New failures, unexpected skips, unexplained
count reductions or missing result shards fail the gate.

Keep a broad inventory run to expose gaps outside the initial product scope.
Passing a declared subset means that subset passed; it does not justify calling
the implementation fully WebGPU-conformant. CTS version upgrades get a separate
comparison showing added cases, changed expectations and regressions.

Use browser/reference results to investigate disagreements. The specification
and upstream tests remain the authority; a second implementation may also have
bugs. Prefer upstream reports and corrections to local expectation changes.
CTS executed through WPT is the same suite in a different harness, not an
independent second conformance result.

## 3. Cover binding semantics and the six review regressions

First reuse relevant CTS cases. Add local regression tests where the pinned CTS
does not exercise our Bun or GPUI boundary. Reconcile with tests already written
by the repair task and avoid duplicate suites.

| Reviewed failure | Required regression evidence |
| --- | --- |
| A pass immediately presents/expires the canvas texture | Multiple passes and command buffers retain valid references until the defined presentation boundary; repeated current-texture access has the specified identity; final pixels include all work |
| Invalid WGSL aborts the process | Invalid input produces the specified diagnostic/error behavior; error scopes and uncaptured errors are attributed to the right device; valid work continues afterward |
| Strong registries retain resources; old devices survive renderer replacement | Unreachable resources eventually release after necessary GPU completion; explicit teardown is deterministic; stale renderer resources cannot access the replacement renderer |
| Canvas alpha semantics are ignored | Opaque and premultiplied canvas output matches analytically defined pixels over a colored background |
| Multisample mask is ignored | A zero sample mask leaves the destination unchanged; representative nonzero masks behave correctly |
| Transferred mapped storage breaks cleanup | Mapped storage follows specified transfer/detachment rules in Bun, and cleanup remains complete and exception-safe |

For JavaScript semantics, test descriptor defaults, dictionary/sequence conversion,
record-time value capture, offsets/ranges and cross-device objects. Distinguish
synchronous conversion exceptions from asynchronous GPU validation. Cover async
pipeline creation, mapping completion, queue completion, error-scope nesting,
device destruction and loss wherever these are exposed.

Exercise ordinary reference dropping, explicit destruction, in-flight destruction,
and application shutdown. Use bounded GC stress with instrumentation to test
eventual release; do not assume collection must happen in one particular turn.
Track wrapper/handle ownership and completion, not just process RSS, which
includes backend caches. Verify two logical devices cannot steal each other's
errors or destroy the compositor. Add seeded operation sequences spanning
create/use/submit/destroy/reconfigure to probe transitions beyond happy paths.

Run potentially crashing or hanging negative cases in supervised child processes
with deadlines and captured exit status. An abort is a failed case, never a skip.
Backend fault injection can exercise loss and callback cleanup deterministically;
label it as simulated loss rather than evidence of physical GPU failure recovery.

## 4. Verify presentation on a real macOS GPU

Use the production native backend and an actual GPUI window, with screenshots
captured after known rendering completion. Cover:

- Two independently updating canvases, repeated acquisition and multiple passes;
  unrelated windows/devices continue rendering during another canvas's teardown.
- Canvas configure/unconfigure/reconfigure, imperative dimensions, layout resize,
  DPR 1 and 2, zero-sized/hidden states, detach/reattach and rapid mount/unmount.
- Opaque and premultiplied alpha, supported formats/color spaces, clipping,
  rounded corners, opacity, transforms, stacking and DOM-like overlays/input.
- Texture ownership across queue completion, skipped presentation and window
  destruction. Use synchronization and ownership observations to detect premature
  retirement, rather than relying only on whether a screenshot happened to work.

Prefer exact interior-pixel assertions for simple deterministic fixtures. For
antialiased edges or cross-backend images, define tolerances for the specific
operation and preserve expected/actual/diff images. Never fix a rendering failure
by globally widening screenshot tolerance. Browser comparison fixtures must use
the same scene inputs, dimensions, color settings and captured frame.

Require explicit preflight checks for adapter/backend, display access and a
render/readback probe. Native-required jobs fail as incomplete when these are
unavailable; an entire `describe.skip` cannot qualify the build. A native build
or headless test does not establish window presentation.

AppKit tests need a host session with WindowServer/HIServices access. If the agent
sandbox blocks initialization, retain the environment error and run the exact
suite on the authorized host boundary. Do not change rendering behavior to make
the restricted environment pass.

## 5. Exercise real applications, packaging and sustained use

Pin Three.js and run its unmodified `WebGPURenderer` in a representative React
app: animated indexed geometry, depth/occlusion, DataTexture creation and updates,
resize/DPR changes, overlays, multiple canvases and scene/resource disposal.
Wait for initialization and a known frame, then verify pixels and interaction.
Keep this scene small enough to diagnose; add further examples as supported
features expand. The browser target runs equivalent scenes using browser WebGPU.

Build React and native outputs before running examples. Test the release tarballs
in a clean consumer directory and the supported compiled Bun distribution path,
including native library discovery and packaged assets. Qualification must use
the built artifacts being released, not stale development outputs.

Measure fixed scenes during idle, continuous animation, texture streaming,
resize stress and repeated mount/unmount. Retain frame-time distributions,
allocation/handle trends and CPU/GPU timing where available. Establish hardware-
specific baselines and explicit regression budgets before making these gates;
record warmup and duration. Resources should settle after work completes, allowing
documented bounded caches rather than requiring all GPU memory to return to zero.

Instrument frame presentation and inspect a GPU trace to establish that production
pixels never travel through CPU readback. Scope this assertion to presentation;
test screenshots and application-requested buffer mapping are separate operations.
Source searches and average FPS alone do not prove GPU-only presentation or
correct synchronization.

## 6. Schedule coverage and make release evidence mandatory

The current workflow defaults to Linux builds for push/PR cost control; macOS
testing is manually dispatched. It does not currently provide a WebGPU CTS gate.
Preserve that budget policy while establishing a designated real-GPU verification
host. Hosted runner labels alone do not guarantee usable hardware/display access.

| Cadence | Required scope |
| --- | --- |
| Each relevant PR | Existing builds/affected tests, focused CTS validation and execution families, all six regressions, macOS composition/lifetime smoke |
| Scheduled extended run, initially manual | Broader CTS inventory, shader/result coverage, seeded lifecycle stress, sustained workloads and reference comparisons |
| Release or backend/Bun/provider upgrade | Complete claimed-support CTS set, full native integration suite, application acceptance and clean packaged-consumer verification on every claimed platform |

Measure runtime before choosing shard sizes or an automatic schedule. Until a
reliable hardware job exists, attach a host-run report for the exact commit and
artifact digest as a required review/release check. Generic Linux CI success
cannot substitute for it. A change after qualification requires requalification
of the affected boundaries and artifacts.

Start with the supported Apple Silicon/Metal configuration. Add Intel macOS,
Linux and Windows hardware/backend matrices when those become claimed targets.
Software adapters can broaden repeatable API testing but do not qualify native
hardware sharing, presentation or performance. Record OS, GPU, driver/backend,
runtime and feature/limit configuration so each result has a defined scope.

Every qualifying report includes exact source/build identities, CTS pin, selectors,
counts and exclusions, hardware preflight, exit codes, failure details, visual
artifacts and known unsupported behavior. Retain complete shard results even
when another shard fails.

## Implementation order and completion criteria

1. Establish the pinned CTS runner and honest result accounting. Run the same
   representative slice against the current provider and adoption candidates.
2. Convert the review reproductions into permanent regressions and bring up the
   real-window integration fixture. Use both suites to choose the binding.
3. Expand the support manifest to the original Three.js outcome and all API
   behavior the package exposes. Close required failures without changing tests
   to match implementation defects.
4. Add packaged application acceptance, ownership stress and measured performance
   budgets. Wire the hardware evidence into merge/release review.
5. Qualify the resulting artifact against the complete declared support set and
   publish its precise compatibility scope in the relevant README section.

The foundation is ready when the upstream tests for its declared API pass through
the shipped runtime, invalid application calls remain contained, native rendering
and resource retirement are verified, and the unmodified application works from
the distributable package. This plan is complete when those gates are runnable
and required; writing a checklist alone does not establish coverage.
