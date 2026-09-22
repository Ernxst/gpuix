//! Direct wgpu baseline for the native WebGPU canvas command shape.
//!
//! Run with `cargo run --release --example bench_webgpu_draw` from
//! `packages/native`. It deliberately has no JavaScript, N-API, command
//! decoding, JSON, canvas presentation, or error-scope work in its timed path.

use std::time::Instant;

use anyhow::Context as _;

const DEFAULT_DRAWS: usize = 10_000;
const WARMUP_FRAMES: usize = 50;
const MEASURED_FRAMES: usize = 300;

const WGSL: &str = r#"
struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertex_main(@location(0) position: vec2f) -> VertexOutput {
  return VertexOutput(vec4f(position, 0.0, 1.0));
}

@fragment
fn fragment_main() -> @location(0) vec4f {
  return vec4f(0.2, 0.7, 1.0, 1.0);
}
"#;

fn percentile(samples: &mut [u128], percentile: f64) -> u128 {
    samples.sort_unstable();
    samples[(samples.len() as f64 * percentile).ceil() as usize - 1]
}

fn frame(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::RenderPipeline,
    vertex_buffer: &wgpu::Buffer,
    index_buffer: &wgpu::Buffer,
    view: &wgpu::TextureView,
    draws: usize,
) -> (u128, u128) {
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("direct wgpu baseline"),
    });
    let record_started = Instant::now();
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("direct wgpu baseline"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        for _ in 0..draws {
            pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint16);
            pass.draw_indexed(0..3, 0, 0..1);
        }
    }
    let record_ns = record_started.elapsed().as_nanos();
    let submit_started = Instant::now();
    queue.submit([encoder.finish()]);
    (record_ns, submit_started.elapsed().as_nanos())
}

fn main() -> anyhow::Result<()> {
    let draws = std::env::var("WEBGPU_BENCH_DRAWS")
        .ok()
        .map(|value| value.parse())
        .transpose()
        .context("WEBGPU_BENCH_DRAWS must be a positive integer")?
        .filter(|draws: &usize| *draws > 0)
        .unwrap_or(DEFAULT_DRAWS);
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::LowPower,
        force_fallback_adapter: false,
        ..Default::default()
    }))
    .context("no hardware Metal adapter")?;
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default()))?;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("direct wgpu baseline"),
        size: wgpu::Extent3d {
            width: 256,
            height: 256,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Bgra8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&Default::default());
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("direct wgpu baseline"),
        source: wgpu::ShaderSource::Wgsl(WGSL.into()),
    });
    let vertex_attributes = [wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Float32x2,
        offset: 0,
        shader_location: 0,
    }];
    let vertex_layout = [wgpu::VertexBufferLayout {
        array_stride: 8,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &vertex_attributes,
    }];
    let targets = [Some(wgpu::ColorTargetState {
        format: wgpu::TextureFormat::Bgra8Unorm,
        blend: None,
        write_mask: wgpu::ColorWrites::ALL,
    })];
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("direct wgpu baseline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vertex_main"),
            buffers: &vertex_layout,
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fragment_main"),
            targets: &targets,
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    });
    let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("direct wgpu baseline"),
        size: 24,
        usage: wgpu::BufferUsages::VERTEX,
        mapped_at_creation: false,
    });
    let index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("direct wgpu baseline"),
        size: 8,
        usage: wgpu::BufferUsages::INDEX,
        mapped_at_creation: false,
    });

    for _ in 0..WARMUP_FRAMES {
        let _ = frame(
            &device,
            &queue,
            &pipeline,
            &vertex_buffer,
            &index_buffer,
            &view,
            draws,
        );
    }
    let mut recording = Vec::with_capacity(MEASURED_FRAMES);
    let mut finish_submit = Vec::with_capacity(MEASURED_FRAMES);
    for _ in 0..MEASURED_FRAMES {
        let (record_ns, submit_ns) = frame(
            &device,
            &queue,
            &pipeline,
            &vertex_buffer,
            &index_buffer,
            &view,
            draws,
        );
        recording.push(record_ns);
        finish_submit.push(submit_ns);
    }

    let record_median = percentile(&mut recording.clone(), 0.5);
    let record_p95 = percentile(&mut recording, 0.95);
    let submit_median = percentile(&mut finish_submit.clone(), 0.5);
    let submit_p95 = percentile(&mut finish_submit, 0.95);
    println!(
        "direct_wgpu_draws={draws} record_ns_median={record_median} record_ns_p95={record_p95} finish_submit_ns_median={submit_median} finish_submit_ns_p95={submit_p95} total_ns_per_draw_median={} total_ns_per_draw_p95={}",
        (record_median + submit_median) / draws as u128,
        (record_p95 + submit_p95) / draws as u128,
    );
    Ok(())
}
