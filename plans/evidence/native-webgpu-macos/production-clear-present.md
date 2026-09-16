# macOS production WebGPU clear-and-present

Commit `7375537b9b` moves the macOS texture proof into the production renderer.
The public path is browser-shaped: importing `@gpuix/react/globals` installs
`navigator.gpu`, and an ordinary canvas accepts `getContext("webgpu")`,
`configure()`, a clear render pass, and `queue.submit()`.

## Architecture observed

- The native renderer lazily creates one hardware Metal wgpu device and queue.
- Every submitted frame gets a distinct `Bgra8Unorm` render-attachment texture.
- The retained GPUI surface owner keeps the wgpu texture alive until every
  referencing scene retires.
- An empty Metal command buffer, submitted after the wgpu producer work on the
  same native queue, signals the surface's shared event.
- The GPUI Metal compositor waits for that event before sampling the texture.
- The production path performs no texture mapping, CPU pixel readback, BGRA
  `RenderImage` conversion, or image-atlas upload.
- Resize and unmount remove the canvas presentation and release retired frame
  owners without affecting other canvases.

The screenshot assertions below read the final window only as test evidence;
that readback is outside the presentation path.

## Verification

Native release build with generated N-API declarations:

```sh
bun run build:native
```

Exit 0. The generated `GpuixRenderer` declaration contains
`presentWebGpuClear(id, width, height, rgba)`.

Production native compile without test-support:

```sh
cargo check --manifest-path packages/native/Cargo.toml --no-default-features
```

Exit 0. Remaining warnings were existing dead-code and manifest warnings.

React build:

```sh
bun run build:react
```

Exit 0.

Focused production renderer test:

```sh
cd packages/react
bun x vitest run src/__tests__/render.test.tsx \
  -t "presents successive WebGPU frames through the production macOS renderer"
```

Exit 0: one passed. The hidden production window presented successive green
and yellow frames from one canvas while a second overlapping canvas remained
blue, then removed the second canvas and resized the first. Pixel assertions
were taken from the actual compositor output.

Shared presentation and lifecycle coverage:

```sh
cd packages/react
bun x vitest run \
  src/__tests__/canvas.test.tsx \
  src/__tests__/native-webgpu-canvas.test.tsx \
  src/__tests__/render.test.tsx
```

Exit 0: 67 passed across three files. Coverage includes overlap, rectangular
clipping, scrolling, successive frames, resize, unmount, remount, presentation
replacement, and retained texture release.

Full React suite:

```sh
cd packages/react
bun run test
```

Exit 0: 1,417 passed across 87 files.

The new animated example passed an isolated strict TypeScript check. A broad
`tsc --project examples/tsconfig.json` invocation remains red on unrelated
pre-existing example errors, including missing SVG declarations and ES library
target mismatches.

## Surviving limits

- Only `bgra8unorm` render-pass clears are implemented.
- No native buffers, WGSL shader modules, pipelines, bind groups, texture
  uploads, depth, multisampling, compute, or Three.js support exists yet.
- Frame textures are deliberately not pooled because no
  compositor-to-producer reuse fence exists yet.
- macOS is the only production native platform enabled by this commit.

Verdict: the macOS production presentation, synchronization, and frame-lifetime
architecture works. The next slice can build the first shader pipeline without
reopening the compositor design.
