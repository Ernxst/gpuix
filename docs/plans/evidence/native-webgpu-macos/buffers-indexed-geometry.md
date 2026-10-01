# macOS native WebGPU buffers and indexed geometry

The second rendering slice adds browser-shaped GPU buffers and indexed geometry
to the production macOS path. Buffers share the renderer-owned logical-device
registry with shaders and pipelines, while queue writes and draw commands stay
ordered on the same wgpu queue used for presentation.

## Architecture observed

- `GPUBufferUsage`, `GPUDevice.createBuffer()`, mapped-at-creation
  `getMappedRange()`/`unmap()`, `GPUQueue.writeBuffer()`, and `GPUBuffer.destroy()`
  are exposed through the native WebGPU subset.
- Mapped-at-creation bytes remain in JavaScript until the logical device binds
  to a renderer. Native buffer creation then copies them through wgpu's mapped
  creation path, including for vertex-only and index-only usage.
- Queue writes respect typed-array element offsets and sizes, copy bytes before
  returning, and require the declared `COPY_DST` usage.
- Render pipelines accept explicit vertex-buffer layouts. Render passes encode
  vertex/index bindings and indexed draws in the existing private command stream.
- Native decoding repeats resource ownership, usage, range, and integer checks;
  JavaScript validation is not the native trust boundary.
- Logical-device destruction destroys all owned native buffers. Individual
  buffer destruction is idempotent and removes the registry entry.

## Verification

Native release build with generated N-API declarations:

```sh
bun run build:native
```

Exit 0.

Focused API tests:

```sh
cd packages/react
bun x vitest run src/__tests__/webgpu.test.ts
```

Exit 0: seven passed. Coverage includes initial mapped upload, range overlap and
alignment, typed-array write slicing, declared usage, cross-device rejection,
buffer destruction, vertex layout encoding, buffer bindings, and indexed draw
encoding.

Focused production renderer test:

```sh
cd packages/react
bun x vitest run src/__tests__/render.test.tsx \
  -t "renders updated indexed geometry through production WebGPU resize and remount"
```

Exit 0: one passed. The actual macOS renderer drew an indexed red quad from
mapped-at-creation vertex and index buffers, updated it to a green quad through
`writeBuffer()`, then reused the same device, pipeline, and buffers after the
canvas was resized and remounted. Pixel assertions read compositor output only
as test evidence; production presentation performs no CPU readback.

Native decoder tests:

```sh
cargo test --manifest-path packages/native/Cargo.toml \
  webgpu_canvas::tests -- --nocapture
```

Exit 0: three passed.

Full React suite:

```sh
cd packages/react
bun run test
```

Exit 0: 1,425 passed across 88 files. This command rebuilt the React package and
passed the test-project typecheck before running the suite.

The animated two-canvas indexed-geometry example passed a strict isolated
TypeScript check and mounted in a production native window without runtime
errors.

## Surviving limits

- Buffer mapping is limited to `mappedAtCreation`; `mapAsync()` and mapped reads
  are not implemented.
- Render pipelines remain automatic-layout triangle lists with one
  `bgra8unorm` color target.
- Bind groups, samplers, texture uploads, depth, compute, multisampling, query
  sets, and WebGPU error scopes remain unsupported.
- macOS remains the only production native platform enabled.

Verdict: GPU buffer initialization, dynamic queue writes, vertex/index layout,
indexed drawing, and resource survival across canvas replacement now work
through the production macOS compositor. The next slice is bindings, texture
upload, and depth.
