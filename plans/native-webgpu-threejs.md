---
title: Native WebGPU for GPU-IX Canvas
description: >
  Add a browser-shaped WebGPU context to the existing GPU-IX canvas so
  unmodified Three.js WebGPURenderer code can render as GPUI content without
  CPU readback.
status: active
updated: 2026-09-12
---

# Native WebGPU for GPU-IX Canvas

## Outcome

Make the existing GPU-IX `<canvas>` support unmodified browser-shaped WebGPU:

```ts
const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const context = canvas.getContext("webgpu")
context.configure({ device, format: "bgra8unorm" })
```

The product boundary is an ordinary, unmodified Three.js `WebGPURenderer`
scene composited inside GPUI without reading rendered pixels back to the CPU.
Do not add a GPU-IX-specific public GPU API or require a patched Three.js.

Strict zero-copy is preferred, not required. A GPU-only texture copy or native
texture import is acceptable when direct sharing is unavailable, provided the
observable API stays the same and no frame pixels pass through the CPU.

## Current status

| Milestone | State | Evidence |
| --- | --- | --- |
| macOS wgpu-to-GPUI texture proof | Complete | `plans/evidence/native-webgpu-macos/phase1-proof.md` |
| Production macOS clear-and-present | Complete | `plans/evidence/native-webgpu-macos/production-clear-present.md` |
| Browser-shaped binding foundation | Partial | Logical devices, buffers, shader modules, render pipelines, and draw commands implemented |
| First shader pipeline | Complete | `plans/evidence/native-webgpu-macos/first-shader-pipeline.md` |
| Buffers and indexed geometry | Complete | `plans/evidence/native-webgpu-macos/buffers-indexed-geometry.md` |
| Bindings, textures, and depth | Next | No bind groups, texture upload, or depth attachment yet |
| Three.js compatibility | Unstarted | No textures, bind groups, depth, or observed renderer gap pass |
| Linux presentation | Architecturally mapped | Runtime implementation and X11/Wayland validation remain |
| Windows presentation | Needs backend decision | D3D11 compositor and DX12 WebGPU interop remain unresolved |

The completed production slice is commit `7375537b9b` on
`codex/webgpu-production-macos`.

## What works now

On native macOS, importing `@gpuix/react/globals` enables:

- `navigator.gpu.requestAdapter()` and `adapter.requestDevice()`;
- `canvas.getContext("webgpu")` with normal 2D/WebGPU context locking;
- `GPUCanvasContext.configure()` for `bgra8unorm`;
- `getCurrentTexture()`, `createView()`, command encoders, one color
  attachment, render-pass clear, command-buffer finish, and `queue.submit()`;
- WGSL shader modules, automatic-layout triangle-list render pipelines,
  `setPipeline()`, and `draw()` with vertex and instance ranges;
- buffer creation, mapped-at-creation ranges, `unmap()`, `queue.writeBuffer()`,
  vertex/index layouts and bindings, and `drawIndexed()`;
- renderer-owned logical-device, buffer, shader-module, and render-pipeline
  lifetimes with device and renderer ownership checks;
- independently updating canvases with normal GPUI bounds, overlap,
  rectangular clipping, scrolling, and stacking;
- frame replacement, resize, unmount, remount, and retained texture release;
- GPU-ordered Metal shared-event synchronization without CPU polling or frame
  readback.

This is deliberately not general WebGPU. `mapAsync()`, mapped reads, bind
groups, texture uploads, depth, compute, multisampling, query sets, error
scopes, and Three.js remain unsupported.

## Settled architecture

### Browser API, native implementation

The public API follows the browser. JavaScript wrappers validate ownership and
state, then send opaque resource references and commands to the renderer-owned
native implementation. Platform-specific presentation stays behind that
common API.

### One physical device, logical JavaScript devices

Logical `GPUDevice` objects may share the renderer's physical device, but they
must remain observably isolated:

- `requestDevice()` advertises only enabled physical features and limits;
- `GPUDevice.destroy()` releases that logical device's resources without
  destroying the compositor device;
- every child resource and canvas context belongs to one logical device and
  renderer;
- wrappers reject deterministically after device destruction, renderer
  replacement, or physical device loss;
- JavaScript cannot replace or interfere with GPUI's recovery machinery.

These rules are executable for logical devices, shader modules, render
pipelines, canvas binding, and command submission. Later resource families must
join the same registry rather than create parallel ownership machinery.

### Canvas ownership and sizing

Canvas context selection remains mutually exclusive:

```text
canvas.getContext("2d") succeeds
  canvas.getContext("webgpu") returns null

canvas.getContext("webgpu") succeeds
  canvas.getContext("2d") returns null
```

WebGPU backing dimensions are distinct from layout size. DPR and resize rules
must match browser behavior closely enough for Three.js `setSize()` and
`setPixelRatio()` without double scaling.

### macOS presentation

The renderer owns one lazily created wgpu device and queue. Every submitted
canvas frame receives a distinct `Bgra8Unorm` texture. Its owner remains alive
until GPUI retires every scene referencing it, preventing the producer from
overwriting a texture while the compositor samples it.

After wgpu submits the producer commands, an empty Metal command buffer on the
same underlying queue signals the GPUI surface's `MTLSharedEvent`. Queue order
therefore establishes readiness without `device.poll()`, a CPU wait, or pixel
readback. GPUI encodes the corresponding wait before sampling the texture.

A future bounded texture pool may reuse retired textures once an explicit
compositor-to-producer reuse fence exists. Do not reuse live frame textures
without that fence.

## Platform strategy

### macOS

The presentation architecture is proven. Continue expanding the shared WebGPU
resource and command layer; no further compositor redesign is expected.

### Linux

GPUI already renders with wgpu, exposes the window's `Arc<wgpu::Device>` and
`Arc<wgpu::Queue>`, and samples a type-erased `Arc<wgpu::Texture>` in its
surface path. The Linux implementation should create WebGPU resources on that
same window device, submit on its queue, and present the texture directly.

Same-queue ordering should eliminate a native interop semaphore. The remaining
work is acquiring the context at the renderer boundary, handling device loss,
and validating real X11 and Wayland sessions. Do not claim Linux support from
cross-compilation alone.

### Windows

GPUI currently uses a D3D11 compositor while native wgpu normally uses DX12.
The Windows renderer's surface batch is a no-op and the scene has no retained
Windows texture payload. Windows therefore requires a compositor-level
decision before WebGPU presentation can be enabled.

The preferred direction is a wgpu/DX12-compatible GPUI presentation path.
Shared D3D12-to-D3D11 resources and fences are a fallback investigation, not a
default architecture. CPU readback is not an acceptable production fallback.

Keep the JavaScript API and resource semantics identical across platforms;
only device acquisition, texture presentation, synchronization, and device-loss
handling should vary.

## Implementation roadmap

### 1. First shader pipeline

Completed on 2026-09-12 through the browser-shaped API:

1. Introduce renderer-owned opaque IDs and ownership checks for shader modules
   and render pipelines.
2. Implement `createShaderModule()`, the minimum render-pipeline descriptor,
   `setPipeline()`, and `draw()`.
3. Render a triangle generated from `vertex_index`, avoiding buffers until the
   shader and pipeline path is proven.
4. Present it through the existing macOS frame lifecycle and Metal event path.
5. Add invalid-owner, destroyed-device, stale-texture, encoder, and pass-state
   tests alongside the rendered production fixture.

Acceptance: an animated triangle rendered by public WebGPU-shaped calls appears
inside an ordinary GPU-IX canvas with no CPU frame readback.

### 2. Buffers and indexed geometry

Completed on 2026-09-12: add buffers, mapped-at-creation ranges, `writeBuffer`,
vertex/index layouts, `setVertexBuffer`, `setIndexBuffer`, and indexed drawing.
Make logical-device destruction release every owned native resource
deterministically.

Acceptance: animated indexed geometry updates a buffer after initialization
and continues presenting through resize and remount.

### 3. Bindings, textures, and depth

Next:

Add bind-group layouts, bind groups, samplers, textures, texture views,
`writeTexture`, depth attachments, and the relevant copy commands.

Acceptance: a depth-tested scene renders a `DataTexture`, proving texture
upload independently of browser image decoding.

### 4. Minimum useful Three.js compatibility

Run unmodified Three.js `WebGPURenderer` code and fill API gaps in observed
dependency order. The acceptance scene must contain:

- animated indexed geometry;
- depth testing;
- a `DataTexture`;
- resize and device-pixel-ratio changes;
- a representative resource update after initialization;
- no patches, private imports, or GPU-IX branches inside Three.js.

An untextured cube alone does not establish compatibility. Image-loaded
materials and `copyExternalImageToTexture` are a later explicit capability.

### 5. Runtime semantics and hardening

Cover descriptor validation, buffer mapping and `ArrayBuffer` lifetime, queue
ordering, encoder/pass invalidation, resource destruction, error scopes,
uncaptured errors, multiple canvases and logical devices, renderer replacement,
physical device loss, and scheduling only while presentation changes.

Use a maintained allowlist of relevant WebGPU conformance cases where they can
run against the N-API surface. Do not claim general conformance from a small
subset.

### 6. Platform expansion

Port the proven common resource layer to Linux using GPUI's device directly.
Validate X11 and Wayland on hardware. Treat Windows as a separate GPUI renderer
milestone and settle its D3D11/DX12 direction before implementation.

### 7. Public completion

Document the exact supported API and gaps, add changesets, generate native
declarations through the build, preserve upstream attribution, run native,
React, browser, example, and platform verification, and visually inspect
multiple canvases, clipping, scrolling, resize, unmount, DPR, and device-loss
states.

## Evidence policy

Keep this file concise and current. Store retained commands, exit statuses,
rendered observations, timings, platform details, and verification gaps under
`plans/evidence/native-webgpu-*`. Link each completed milestone from the status
table.

Create GitHub issues only when a roadmap item has become a bounded,
independently deliverable slice. Until then, this plan is the sole tracker.

## Decision gates

```text
A. macOS resource semantics cannot match browser-observable behavior
   -> investigate a separate device or native texture-import model
   -> do not weaken ownership or error behavior silently

B. Browser-shaped API requires a patched Three.js
   -> stop; this misses the product goal

C. Linux works but Windows requires disproportionate renderer work
   -> ship explicitly scoped platform support
   -> do not conceal platform divergence

D. Common Three.js scenes work but semantics remain partial
   -> label the API experimental and publish an exact gap list
   -> do not claim WebGPU conformance
```

The continuation prompt can remain: **“Continue the native WebGPU plan.”**
