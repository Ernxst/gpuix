# macOS native WebGPU presentation proof

The focused proof renders a wgpu `Bgra8Unorm` texture with a real Metal
adapter, retains its native `MTLTexture`, and inserts it into GPUI's surface
scene. GPUI encodes an `MTLSharedEvent` wait before it begins the compositor
draw. After the producer queue completes, the test signals that event and the
compositor samples the texture. The only pixel readback is the final test
assertion; the presentation path maps no wgpu buffer and copies no pixels to
the CPU.

Command, run with host GPU access:

```sh
cargo test --manifest-path zed/crates/gpui_apple/Cargo.toml --features test-support \
  wgpu_metal_texture_waits_then_composites_without_producer_readback -- --nocapture
```

Final result: exit 0. One test passed on the host Metal adapter in 45.96 s.
It observed `[255, 0, 0, 255]` at the composed output's centre after the
producer cleared the wgpu texture red.

Ownership is retained in `MetalTextureSurface`: its `metal::Texture` owns an
Objective-C retain acquired while wgpu's guarded HAL texture is live, and its
opaque owner keeps the `Arc<wgpu::Texture>` alive until GPUI retires all scene
references. The shared event is created from that retained texture's device.
The compositor rejects a texture whose device differs from its own.

`CanvasElement` now reads these internal presentation sources from the same
retained canvas store as Canvas 2D display lists and removes them when the
element is removed. This is intentionally an internal seam; no `navigator.gpu`
or canvas `webgpu` context API exists yet.

Remaining fixture work before opening JavaScript bindings: exercise two live
CanvasElement sources through the test renderer for overlap, rectangular
clipping and scrolling; replace one source across resize/remount; and make the
producer signal the shared event directly from the wgpu command buffer rather
than the proof's post-completion host callback. The current proof establishes
the zero-readback texture and compositor bridge, not full browser WebGPU
semantics.
