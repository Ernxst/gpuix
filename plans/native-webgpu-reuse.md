---
title: Reuse-first native WebGPU foundation
description: Select and integrate an existing WebGPU binding before expanding GPU-IX's handwritten implementation.
status: active
updated: 2026-09-12
---

# Reuse-first native WebGPU foundation

Execution evidence is indexed in
[plans/evidence/native-webgpu-reuse/README.md](evidence/native-webgpu-reuse/README.md).

## Outcome and recommendation

Run unmodified Three.js `WebGPURenderer` inside ordinary GPU-IX canvases, with
GPU-only presentation and browser-compatible resource, error, and scheduling
semantics. Minimize the WebGPU implementation that this fork must maintain.

The default is to adopt an existing JavaScript binding and maintain the
Bun/GPUI integration around it. If adoption fails a concrete runtime or
presentation requirement, port a pinned reference implementation's relevant
modules and tests. Continue with independently designed bindings only after
both routes have been evaluated and their blockers recorded.

This is a prerequisite to the remaining work in
[the native WebGPU plan](native-webgpu-threejs.md). The first execution slice
has selected `webgpu@0.6.1` for a bounded lifecycle and presentation spike; it
has not selected it for adoption. The provider-neutral probes, comparative CTS
slice, measured blockers, and next experiment are recorded in the evidence
index above.

[The testing plan](native-webgpu-testing.md) defines the shared CTS baseline,
native integration coverage, and release gates for evaluating and adopting a
provider.

## Fixed requirements and decisions to reopen

Keep these requirements:

- Bun remains the desktop JavaScript runtime. A Node-only result is a useful
  reference, not completion of the runtime requirement.
- Application code uses standard WebGPU objects and an ordinary canvas.
  Three.js receives no patches, private imports, or GPU-IX branches.
- Production frame pixels never pass through CPU readback. Native texture
  import and GPU-only copies are acceptable. Test screenshots/readback are
  separate from production presentation.
- Application errors remain contained. One logical device cannot destroy the
  compositor or interfere with another device's error handling.
- The browser target continues using real browser WebGPU.
- macOS is the first runtime gate. Linux and Windows support remain explicitly
  scoped until exercised on their respective hardware/backends.

Reconsider these implementation choices when evidence warrants it:

- Sharing a single native device between logical devices versus independently
  owned native devices with texture sharing/import.
- High-level wgpu handles versus wgpu-core, wgpu-native, or Dawn for the
  application producer. GPUI's existing backend is a constraint to integrate
  with, not proof that every application resource must use the same library.
- The current per-pass command transport and handwritten JavaScript registry.

Preserve the proven retained Metal texture ownership, explicit GPU readiness
signal/wait, CanvasElement integration, and useful regression tests. Reuse the
behavior and evidence even if a selected provider requires a different native
texture payload. Do not require a Dawn pointer to masquerade as a Rust wgpu
object, or assume different wgpu builds share compatible handles.

## 1. Establish a reproducible baseline

Record the current application and Zed commits, Bun version, OS, GPU, lockfile,
native build options, and active repair changes. The reviewed baseline was
`codex/webgpu-production-macos` at `0ceabb9a0c`, against `080d73e3f8`; subsequent
repairs must be assessed at their actual head.

Use an isolated evaluation checkout. Preserve existing worktrees and unrelated
workspace changes. Install missing dependencies through the checked-in frozen
lockfile. Place sanitized evidence under `plans/evidence/native-webgpu-reuse/`.

Turn the six review findings into reusable behavioral cases. Incorporate
equivalent tests already produced by the repair task rather than duplicating
them. Keep provider differences in fixture setup; the WebGPU calls under test
must stay the same. Canvas cases run through a presentation adapter, since a
headless binding need not provide a browser canvas.

**Output:** pinned baseline, runnable probes, and an evidence index. Do not
begin a second general binding rewrite while assembling the comparison.

## 2. Select candidates with a short source and packaging assessment

Assess these concrete routes. Repository claims below are leads to verify,
not independent evidence of compatibility or conformance.

| Candidate | Why inspect it | First question to resolve |
| --- | --- | --- |
| [Dawn's official Node binding](https://github.com/dawn-gpu/node-webgpu) | Existing JavaScript WebGPU objects and CTS integration | Does the pinned addon run safely in our Bun version, and can its textures be exposed to a native presentation adapter? Its README explicitly excludes canvas integration. |
| [bun-webgpu](https://github.com/kommander/bun-webgpu) | Dawn bindings specifically targeting Bun | Do mapping, errors, collection, and callback lifetimes survive the negative tests, and what patches would we maintain? |
| [wgpu-bun](https://github.com/argon-chat/wgpu) | Bun FFI bindings offering wgpu-native and Dawn routes | Is the chosen backend actually available/reproducible, and do its ownership and error semantics hold beyond its own tests? |
| [Deno WebGPU](https://github.com/denoland/deno/tree/main/ext/webgpu) | Reference-backed port fallback, including native resource lifecycle | What can be reused without importing Deno/V8 runtime machinery? |
| [Servo WebGPU](https://book.servo.org/design-documentation/webgpu.html) | Reference for asynchronous device execution and presentation separation | Which modules or tests can inform the adapter without importing a browser runtime? |

For each execution candidate, pin its source commit, package version, native
backend revision, artifact checksums, and license obligations. Record the
actual generated binding mechanism, maintenance/release activity, build
reproducibility, runtime support, and upstream test evidence. Inspect any
required private API: an unversioned native pointer escape hatch is not a
stable integration contract.

Perform the official Node binding's cheap Bun compatibility probe first; do
not assume Node-API compatibility guarantees this particular addon works.
Use Node as a control to separate provider failures from Bun integration
failures. Then exercise the Bun-specific candidates that pass source triage.
Take at most the two strongest runtime candidates into the compositor spike.
Deno and Servo remain references unless source inspection reveals a directly
reusable package with the required runtime contract.

**Output:** a comparison naming code we would depend on, code we would own,
required patches, and measured blockers. Star counts, screenshots, and an
aggregate test total do not select the winner.

## 3. Prove the binding's difficult behavior before window integration

Run each candidate in isolated child processes so crashes are recorded without
terminating the evaluation runner. Record commands, exits, backend identity,
and observations. Exercise:

| Area | Required observation |
| --- | --- |
| Adapter/device acquisition | Honest features and limits; valid required-feature/limit negotiation; failure at the correct promise; creation works before configuring a canvas. |
| Errors | Invalid WGSL, invalid pipeline state, invalid buffer usage/limits, and invalid draw ranges do not abort. Error scopes and uncaptured errors go to the correct device. Preserve the distinction between WebIDL exceptions and asynchronous GPU validation. |
| Mapping | Range alignment/overlap, mapped-at-creation upload, async mapping where implemented, unmap/destroy, and attempted transfer obey the supported browser contract. Cleanup cannot strand a live device. |
| Ownership | Cross-device resources fail correctly; destroying one device leaves another operational; abandoned resources are reclaimable while a device remains alive. |
| Queue behavior | Multiple passes/command buffers and writes execute in order, independent of presenting a window. Resources referenced by encoded or submitted work remain valid for their required lifetime. |
| Pipeline state | Accepted descriptors have their actual effects, including sample mask zero. Unsupported recognized state is not silently discarded. |
| Shutdown | Device destruction, collection, and process shutdown leave no dangling callbacks or persistent background work. |

Add a pinned, maintained allowlist from the
[WebGPU Conformance Test Suite](https://github.com/gpuweb/cts), starting with
the relevant API, validation, mapping, and queue cases. Record every skip and
expected failure with its reason. Check negative tests actually detect errors;
a no-op error-scope implementation must not pass. Do not equate a subset with
general conformance.

Use native resource counters or equivalent lifetime instrumentation to assess
reclamation. Garbage-collection timing itself is nondeterministic; distinguish
an absent release path from collection that has not yet happened.

**Gate:** a reproducible crash, missing ownership mechanism, or fabricated
error result blocks integration. Investigate only a bounded fix with a clear
upstream path; needing to replace most of the binding's lifecycle machinery
disqualifies it as direct adoption.

## 4. Prove GPU-only GPUI presentation

For the surviving provider, implement the smallest internal adapter that
exports or imports a renderable texture plus its lifetime and readiness
dependency. Write down which library owns each handle and when it can be
released. Prefer documented native APIs; isolate any necessary extension and
pin it to the provider build.

Render an animated indexed scene into two ordinary canvases at different
positions. Validate replacement, overlap, stacking, scrolling, rectangular and
rounded clipping, opacity, transforms, resize, and unmount/remount. Unsupported
styles must be named explicitly rather than described as normal canvas parity.

The adapter must also prove:

- Repeated same-turn `getCurrentTexture()` calls preserve identity until expiry.
- Two passes can share the current texture; queue submission does not itself
  invent a one-pass-per-frame rule.
- Canvas backing dimensions follow imperative `width`/`height` changes and
  remain distinct from layout size and DPR. Exercise DPR 1 and 2, then a live
  size/DPR change.
- Opaque and premultiplied composition produce correct pixels, including zero
  and fractional alpha and clip coverage.
- GPU producer/compositor ordering is explicit. Frame owners survive scene
  retirement and in-flight work; reused textures need a reuse fence.
- Canvas remount leaves unrelated device resources usable. Retirement of the
  owning renderer invalidates its wrappers. Physical device loss is delivered
  to the affected owners without corrupting compositor recovery.

Use supported backend loss injection if available and identify it as simulated
loss. Otherwise record the exact unverified hardware-loss behavior; explicit
`device.destroy()` alone is not physical-loss coverage.

Trace production calls for texture mapping, CPU pixel copies, and atlas upload.
Measure warm frame CPU time, GPU time where available, allocation rate, and
resource residency over a fixed workload, alongside the existing presentation
baseline. Retain workload dimensions, duration, and hardware. Use the existing
frame clock and verify that static canvases stop scheduling presentation work.

**Gate:** Bun execution plus a headless triangle is insufficient. The candidate
must reach GPUI without CPU frame readback and with correct synchronization.
Failure of direct sharing permits a GPU-only import/copy experiment, not an
automatic rejection or a hidden CPU fallback.

## 5. Choose adoption, a bounded fork, or a reference-backed port

Write one decision record from the completed experiments:

1. Adopt the provider that passes the runtime and presentation gates with the
   smallest sustainable integration surface.
2. Use a bounded fork when necessary patches are isolated, testable, and can
   be carried or contributed upstream. Inventory each patch and its owner.
3. If direct adoption fails, select a pinned reference implementation and port
   coherent modules—descriptors, resource handles, mapping, errors, and queue
   state—together with their tests. Identify runtime substitutions explicitly.

For the port fallback, prove one representative buffer/mapping/error lifecycle
and one multipass submission through Bun/GPUI before estimating the full port.
Pay particular attention to V8-specific tracing and protected ArrayBuffer
lifetimes: resemblance at the TypeScript interface is not proof that Bun can
provide the same guarantees.

If all routes require inventing the same large semantic layer, report that
finding and the concrete runtime/interoperability blockers. Reassess the
runtime or hosting constraint with the user rather than silently weakening
WebGPU. Record measured investigation effort before estimating remaining work.

**Output:** selected revisions, rejected routes and evidence, maintained patch
surface, tests, remaining risks, and a scoped migration. Further feature work
starts only once this decision is supported by executable evidence.

## 6. Migrate and establish the Three.js acceptance scene

Replace the experimental binding behind the existing public interface. Carry
forward the review regression tests and working presentation adapter. Remove
superseded transport and ownership machinery as the replacement becomes
authoritative; avoid permanently maintaining two implementations of the same
resource semantics. Temporary comparison providers belong in test setup.

Run unmodified, version-pinned Three.js with animated indexed geometry, depth,
a `DataTexture`, a resource update after initialization, resize, and DPR
changes. Include scene disposal/recreation with a long-lived device and two
canvases. Fill observed gaps through the selected provider or bounded patches;
do not recreate a parallel GPU-IX binding for each missing method.

Generate native declarations through the build, update API documentation and
changesets, and preserve attribution. Verify a packaged macOS application can
load its native dependencies without developer paths or runtime downloads.
Run native builds, focused and broader regression checks appropriate to the
migration, React/type checks, browser/Wasm builds, and rendered acceptance.

Keep Linux's existing GPUI device/texture path in the migration assessment.
An independently owned provider may require texture import there. Windows
still needs a deliberate D3D11/DX12 presentation decision. Neither platform is
complete because macOS or cross-compilation passes.

## Completion and first execution slice

This plan is complete when a justified reuse decision has produced the
unmodified Three.js acceptance scene, the six reviewed failures are covered
and repaired, supported lifetime/error/sizing behavior is exercised, and the
remaining platform and API gaps are explicitly documented.

The first execution slice is deliberately smaller: reconcile current repairs,
pin the references, run the binding-level negative/lifecycle probes, and select
the first provider for the GPU-only compositor spike. Deliver its evidence and
next bounded experiment. Do not begin by rewriting all wrappers or by adopting
a package on the strength of its README.
