# Native WebGPU foundation review repair

The first shader and indexed-buffer slices were reviewed before adding further
resource families. The review found that a render pass was incorrectly acting
as the canvas presentation boundary, native wgpu validation could abort the
process, and general resources lacked a reclaimable lifecycle. Those
foundational assumptions were repaired before bind groups, textures, or depth.

## Repaired model

- `getCurrentTexture()` returns one stable texture until successful
  presentation. Multiple passes may target its views.
- `GPUQueue.submit()` validates the complete JavaScript submission, flattens
  all command buffers into one ordered native submission, and installs every
  completed canvas frame only after native validation and queue submission
  succeed. A failed later pass cannot visibly expose an earlier prefix.
- Native wgpu operations run inside validation, internal, and out-of-memory
  scopes. Logical-device error scopes and uncaptured-error events receive those
  failures; malformed WGSL no longer invokes wgpu's fatal default handler.
- Buffers, shader modules, and render pipelines have native release paths.
  Devices retain only weak wrapper references, finalization makes unreachable
  resources reclaimable, and explicit device destruction remains deterministic.
- Renderer teardown invalidates every surviving wrapper bound to that renderer,
  while ordinary canvas unmount/remount continues to preserve a live device.
- Mapped-range cleanup tolerates an already transferred `ArrayBuffer` and
  device destruction completes unconditionally.
- Clear colors are snapshotted when a pass is recorded and support dictionary
  and four-element array forms.
- Default canvas presentation is opaque in the Metal compositor.
  `alphaMode: "premultiplied"` is explicitly rejected until supported.
- The pipeline sample mask crosses the native transport and has its specified
  effect at the currently supported sample count of one.
- Imperative canvas `width` and `height` update WebGPU backing dimensions and
  expire a previously acquired canvas texture.

## Acceptance evidence

The production macOS test exercises the repaired boundary through ordinary
browser-shaped calls. In one run it:

- records two passes against one current texture;
- submits command buffers for two canvases together and verifies both pixels;
- contains malformed WGSL, an invalid pipeline, an over-limit buffer, and an
  out-of-range indexed draw without terminating either logical device;
- verifies that invalid work does not replace the last completed frame;
- verifies opaque composition from a clear with zero stored alpha; and
- verifies that a zero sample mask suppresses fragment writes.

The focused production test passed against the release native binary. The
isolated native malformed-WGSL probe exited zero, caught a JavaScript error,
printed its survival marker, and created a second logical device. The renderer
replacement probe rejected both a write and shader creation through the old
device. A forced-GC probe collected an otherwise unreachable buffer wrapper.

Final verification on 2026-09-12:

- `cargo test --manifest-path packages/native/Cargo.toml --no-default-features webgpu_canvas::tests -- --nocapture`: 5 passed;
- `cargo check --manifest-path packages/native/Cargo.toml --no-default-features`: passed;
- `bun run build:native` and `bun run build:react`: passed;
- the four focused WebGPU and canvas test files: 82 passed;
- the full React suite: 88 files and 1,435 tests passed;
- `bun run web:wasm`: passed; and
- the native WebGPU example created and mounted its AppKit window using the
  rebuilt release addon.

## Remaining foundation limits

Adapter features and limits, asynchronous physical acquisition failure,
proactive `device.lost` delivery and recovery, premultiplied canvas alpha, and a
maintained WebGPU conformance allowlist remain unfinished. These are stated as
gaps rather than deferred under the completed ownership model. Bind groups,
textures, depth, DataTexture rendering, and unmodified Three.js remain the next
feature milestone.
