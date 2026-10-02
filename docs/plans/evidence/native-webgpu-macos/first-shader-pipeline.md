# macOS first native WebGPU shader pipeline

The first real rendering slice extends the production macOS presentation path
with renderer-owned logical devices, WGSL shader modules, render pipelines, and
draw commands. Public code remains browser-shaped: resources are created on a
`GPUDevice`, encoded with `setPipeline()` and `draw()`, submitted through the
queue, and presented by an ordinary GPU-IX canvas.

## Architecture observed

- One lazily created physical wgpu device and queue serve renderer-local logical
  devices without exposing compositor ownership to JavaScript.
- Native shader modules and render pipelines use opaque IDs and record their
  logical-device owner. Cross-device and cross-renderer use is rejected.
- A logical device can describe resources before it configures a canvas. Native
  resources materialize after the device binds to that renderer.
- `GPUDevice.destroy()` removes the logical device and all shader and pipeline
  entries it owns without destroying the shared physical device.
- Command buffers carry a compact internal `setPipeline`/`draw` stream. Native
  decoding validates operand ranges and resource ownership before encoding the
  wgpu render pass.
- The rendered texture uses the established per-frame lifetime and Metal shared
  event path. No presentation pixels are mapped or read back through the CPU.

## Verification

Native release build with generated N-API declarations:

```sh
bun run build:native
```

Exit 0. The generated renderer declarations expose logical-device creation and
destruction, shader and pipeline creation, and command-stream presentation.

Production native compile:

```sh
cargo check --manifest-path packages/native/Cargo.toml --no-default-features
```

Exit 0.

React build and test typecheck:

```sh
bun run build:react
cd packages/react
bun run typecheck:test
```

Both exited 0.

Focused API and production rendering coverage:

```sh
cd packages/react
bun x vitest run \
  src/__tests__/webgpu.test.ts \
  src/__tests__/canvas.test.tsx \
  src/__tests__/native-webgpu-canvas.test.tsx \
  src/__tests__/render.test.tsx
```

Exit 0: 73 passed across four files. The production test launched the actual
macOS renderer, first rendered a red triangle on the left, then cleared it and
rendered a green triangle on the right. Pixel assertions read compositor output
only as test evidence; the runtime presentation path performs no CPU readback.

The animated two-canvas example passed an isolated strict TypeScript check and
mounted in a production native window.

Full React suite:

```sh
cd packages/react
bun run test
```

Exit 0: 1,423 passed across 88 files.

Native command-stream decoder tests:

```sh
cargo test --manifest-path packages/native/Cargo.toml \
  webgpu_canvas::tests -- --nocapture
```

Exit 0: two passed. The tests cover a valid pipeline/draw stream and malformed
opcodes, missing operands, invalid integer operands, and trailing operands.

## Surviving limits

- Only automatic-layout, no-buffer, triangle-list render pipelines with one
  `bgra8unorm` color target are supported.
- There are no buffers, mapped ranges, queue writes, vertex/index layouts,
  indexed draws, bind groups, texture uploads, depth, compute, or multisampling.
- Shader compilation and pipeline validation do not yet expose browser WebGPU
  error scopes or uncaptured-error events.
- Frame textures remain unpooled because there is no compositor-to-producer
  reuse fence yet.
- macOS remains the only production native platform enabled.

Verdict: the shader, pipeline, command, and logical-resource ownership seams now
work through the production macOS compositor. The next vertical slice is
buffers, queue writes, vertex/index layouts, and indexed drawing.
