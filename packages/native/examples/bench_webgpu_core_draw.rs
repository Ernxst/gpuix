//! Direct wgpu-core control for the native WebGPU canvas draw shape.
//!
//! This bypasses `wgpu`'s public API wrapper and records the pass through one
//! `wgpu_core::global::Global` and resource IDs. It intentionally uses the
//! same Metal adapter, target format, pipeline, buffers and draw commands as
//! `bench_webgpu_draw`.

use std::borrow::Cow;
use std::time::Instant;

use anyhow::{bail, Context as _};
use wgpu_core as wgc;
use wgpu_types as wgt;

const DRAWS: usize = 10_000;
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

fn expect_ok<E: std::fmt::Debug>(error: Option<E>, operation: &str) -> anyhow::Result<()> {
    match error {
        Some(error) => bail!("{operation}: {error:?}"),
        None => Ok(()),
    }
}

struct Resources {
    device: wgc::id::DeviceId,
    queue: wgc::id::QueueId,
    view: wgc::id::TextureViewId,
    pipeline: wgc::id::RenderPipelineId,
    vertex_buffer: wgc::id::BufferId,
    index_buffer: wgc::id::BufferId,
}

fn create_resources(global: &wgc::global::Global) -> anyhow::Result<Resources> {
    let adapter = global
        .request_adapter(
            &wgc::instance::RequestAdapterOptions {
                power_preference: wgt::PowerPreference::LowPower,
                force_fallback_adapter: false,
                compatible_surface: None,
            },
            wgt::Backends::METAL,
            None,
        )
        .context("no hardware Metal adapter")?;
    let (device, queue) = global.adapter_request_device(
        adapter,
        &wgc::device::DeviceDescriptor {
            label: None,
            required_features: wgt::Features::empty(),
            required_limits: wgt::Limits::default(),
            experimental_features: wgt::ExperimentalFeatures::default(),
            memory_hints: wgt::MemoryHints::default(),
            trace: wgt::Trace::default(),
        },
        None,
        None,
    )?;
    let (texture, error) = global.device_create_texture(
        device,
        &wgc::resource::TextureDescriptor {
            label: None,
            size: wgt::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgt::TextureDimension::D2,
            format: wgt::TextureFormat::Bgra8Unorm,
            usage: wgt::TextureUsages::RENDER_ATTACHMENT,
            view_formats: Vec::new(),
        },
        None,
    );
    expect_ok(error, "create target texture")?;
    let (view, error) = global.texture_create_view(
        texture,
        &wgc::resource::TextureViewDescriptor {
            label: None,
            format: None,
            dimension: None,
            usage: None,
            range: wgt::ImageSubresourceRange::default(),
        },
        None,
    );
    expect_ok(error, "create target view")?;
    let buffer = |size, usage| {
        global.device_create_buffer(
            device,
            &wgc::resource::BufferDescriptor {
                label: None,
                size,
                usage,
                mapped_at_creation: false,
            },
            None,
        )
    };
    let (vertex_buffer, error) = buffer(24, wgt::BufferUsages::VERTEX);
    expect_ok(error, "create vertex buffer")?;
    let (index_buffer, error) = buffer(8, wgt::BufferUsages::INDEX);
    expect_ok(error, "create index buffer")?;
    let (shader, error) = global.device_create_shader_module(
        device,
        &wgc::pipeline::ShaderModuleDescriptor {
            label: None,
            runtime_checks: wgt::ShaderRuntimeChecks::default(),
        },
        wgc::pipeline::ShaderModuleSource::Wgsl(Cow::Borrowed(WGSL)),
        None,
    );
    expect_ok(error, "create shader")?;
    let attributes = [wgt::VertexAttribute {
        format: wgt::VertexFormat::Float32x2,
        offset: 0,
        shader_location: 0,
    }];
    let vertex_buffers = [wgc::pipeline::VertexBufferLayout {
        array_stride: 8,
        step_mode: wgt::VertexStepMode::Vertex,
        attributes: Cow::Borrowed(&attributes),
    }];
    let targets = [Some(wgt::ColorTargetState {
        format: wgt::TextureFormat::Bgra8Unorm,
        blend: None,
        write_mask: wgt::ColorWrites::ALL,
    })];
    let stage = |entry_point| wgc::pipeline::ProgrammableStageDescriptor {
        module: shader,
        entry_point: Some(Cow::Borrowed(entry_point)),
        constants: wgc::naga::back::PipelineConstants::default(),
        zero_initialize_workgroup_memory: true,
    };
    let (pipeline, error) = global.device_create_render_pipeline(
        device,
        &wgc::pipeline::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgc::pipeline::VertexState {
                stage: stage("vertex_main"),
                buffers: Cow::Borrowed(&vertex_buffers),
            },
            primitive: wgt::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgt::MultisampleState::default(),
            fragment: Some(wgc::pipeline::FragmentState {
                stage: stage("fragment_main"),
                targets: Cow::Borrowed(&targets),
            }),
            multiview_mask: None,
            cache: None,
        },
        None,
    );
    expect_ok(error, "create render pipeline")?;
    Ok(Resources {
        device,
        queue,
        view,
        pipeline,
        vertex_buffer,
        index_buffer,
    })
}

fn frame(global: &wgc::global::Global, resources: &Resources) -> anyhow::Result<(u128, u128)> {
    let (encoder, error) = global.device_create_command_encoder(
        resources.device,
        &wgt::CommandEncoderDescriptor { label: None },
        None,
    );
    expect_ok(error, "create command encoder")?;
    let attachments = [Some(wgc::command::RenderPassColorAttachment {
        view: resources.view,
        depth_slice: None,
        resolve_target: None,
        load_op: wgt::LoadOp::Clear(wgt::Color::BLACK),
        store_op: wgt::StoreOp::Store,
    })];
    let record_started = Instant::now();
    let (mut pass, error) = global.command_encoder_begin_render_pass(
        encoder,
        &wgc::command::RenderPassDescriptor {
            label: None,
            color_attachments: Cow::Borrowed(&attachments),
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        },
    );
    expect_ok(error, "begin render pass")?;
    global.render_pass_set_pipeline(&mut pass, resources.pipeline)?;
    for _ in 0..DRAWS {
        global.render_pass_set_vertex_buffer(&mut pass, 0, resources.vertex_buffer, 0, None)?;
        global.render_pass_set_index_buffer(
            &mut pass,
            resources.index_buffer,
            wgt::IndexFormat::Uint16,
            0,
            None,
        )?;
        global.render_pass_draw_indexed(&mut pass, 3, 1, 0, 0, 0)?;
    }
    global.render_pass_end(&mut pass)?;
    let record_ns = record_started.elapsed().as_nanos();
    let submit_started = Instant::now();
    let (command_buffer, error) = global.command_encoder_finish(
        encoder,
        &wgt::CommandBufferDescriptor { label: None },
        None,
    );
    expect_ok(error, "finish command encoder")?;
    global
        .queue_submit(resources.queue, &[command_buffer])
        .map_err(|(_, error)| anyhow::anyhow!("submit command buffer: {error:?}"))?;
    Ok((record_ns, submit_started.elapsed().as_nanos()))
}

fn main() -> anyhow::Result<()> {
    let global = wgc::global::Global::new(
        "GPU-IX wgpu-core benchmark",
        wgt::InstanceDescriptor::new_without_display_handle(),
        None,
    );
    let resources = create_resources(&global)?;
    for _ in 0..WARMUP_FRAMES {
        let _ = frame(&global, &resources)?;
    }
    let mut recording = Vec::with_capacity(MEASURED_FRAMES);
    let mut finish_submit = Vec::with_capacity(MEASURED_FRAMES);
    for _ in 0..MEASURED_FRAMES {
        let (record_ns, submit_ns) = frame(&global, &resources)?;
        recording.push(record_ns);
        finish_submit.push(submit_ns);
    }
    let record_median = percentile(&mut recording.clone(), 0.5);
    let record_p95 = percentile(&mut recording, 0.95);
    let submit_median = percentile(&mut finish_submit.clone(), 0.5);
    let submit_p95 = percentile(&mut finish_submit, 0.95);
    println!(
        "direct_wgpu_core_10k record_ns_median={record_median} record_ns_p95={record_p95} finish_submit_ns_median={submit_median} finish_submit_ns_p95={submit_p95} total_ns_per_draw_median={} total_ns_per_draw_p95={}",
        (record_median + submit_median) / DRAWS as u128,
        (record_p95 + submit_p95) / DRAWS as u128,
    );
    Ok(())
}
