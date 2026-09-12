//! macOS GPU canvas resources and presentation for the browser-shaped WebGPU slice.
//!
//! Each submitted frame owns its texture until GPUI retires every scene that
//! references it. Allocating a frame texture here is deliberate: without a
//! compositor-to-producer fence, reusing a texture could let the producer
//! overwrite it while GPUI is still sampling.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result};
use metal::foreign_types::ForeignType as _;
use objc::{msg_send, sel, sel_impl};
use rustc_hash::{FxHashMap, FxHashSet};

const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;

// Keep these internal wire opcodes in sync with packages/react/src/canvas/webgpu.ts.
const WEB_GPU_SET_PIPELINE: u32 = 1;
const WEB_GPU_DRAW: u32 = 2;

#[derive(Debug, PartialEq)]
enum WebGpuPassCommand {
    SetPipeline(u64),
    Draw {
        vertex_count: u32,
        instance_count: u32,
        first_vertex: u32,
        first_instance: u32,
    },
}

struct WebGpuCanvasFrame {
    _texture: Arc<wgpu::Texture>,
    released: Arc<AtomicU64>,
}

impl Drop for WebGpuCanvasFrame {
    fn drop(&mut self) {
        self.released.fetch_add(1, Ordering::Relaxed);
    }
}

struct WebGpuShaderModule {
    device_id: u64,
    module: wgpu::ShaderModule,
}

struct WebGpuRenderPipeline {
    device_id: u64,
    pipeline: wgpu::RenderPipeline,
}

struct WebGpuProducer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    next_resource_id: u64,
    logical_devices: FxHashSet<u64>,
    shader_modules: FxHashMap<u64, WebGpuShaderModule>,
    render_pipelines: FxHashMap<u64, WebGpuRenderPipeline>,
}

impl WebGpuProducer {
    fn new() -> Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            force_fallback_adapter: false,
            ..Default::default()
        }))
        .context("Native WebGPU requires a Metal adapter")?;
        if adapter.get_info().device_type == wgpu::DeviceType::Cpu {
            anyhow::bail!("Native WebGPU requires a hardware Metal adapter, not a CPU fallback");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&Default::default()))
            .context("Native WebGPU device creation failed")?;
        Ok(Self {
            device,
            queue,
            next_resource_id: 1,
            logical_devices: FxHashSet::default(),
            shader_modules: FxHashMap::default(),
            render_pipelines: FxHashMap::default(),
        })
    }

    fn allocate_resource_id(&mut self) -> Result<u64> {
        let id = self.next_resource_id;
        if id > MAX_SAFE_JS_INTEGER {
            anyhow::bail!("Native WebGPU exhausted its JavaScript-safe resource ids");
        }
        self.next_resource_id = id
            .checked_add(1)
            .context("Native WebGPU resource id overflow")?;
        Ok(id)
    }

    fn create_logical_device(&mut self) -> Result<u64> {
        let id = self.allocate_resource_id()?;
        self.logical_devices.insert(id);
        Ok(id)
    }

    fn require_logical_device(&self, device_id: u64) -> Result<()> {
        if !self.logical_devices.contains(&device_id) {
            anyhow::bail!("Native WebGPU logical device {device_id} is destroyed or unknown");
        }
        Ok(())
    }

    fn destroy_logical_device(&mut self, device_id: u64) {
        if !self.logical_devices.remove(&device_id) {
            return;
        }
        self.shader_modules
            .retain(|_, resource| resource.device_id != device_id);
        self.render_pipelines
            .retain(|_, resource| resource.device_id != device_id);
    }

    fn create_shader_module(
        &mut self,
        device_id: u64,
        label: Option<&str>,
        code: String,
    ) -> Result<u64> {
        self.require_logical_device(device_id)?;
        let module = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label,
                source: wgpu::ShaderSource::Wgsl(code.into()),
            });
        let id = self.allocate_resource_id()?;
        self.shader_modules
            .insert(id, WebGpuShaderModule { device_id, module });
        Ok(id)
    }

    fn create_render_pipeline(
        &mut self,
        device_id: u64,
        label: Option<&str>,
        vertex_module_id: u64,
        vertex_entry_point: Option<&str>,
        fragment_module_id: u64,
        fragment_entry_point: Option<&str>,
    ) -> Result<u64> {
        self.require_logical_device(device_id)?;
        let vertex_module = self
            .shader_modules
            .get(&vertex_module_id)
            .with_context(|| format!("Unknown WebGPU shader module {vertex_module_id}"))?;
        let fragment_module = self
            .shader_modules
            .get(&fragment_module_id)
            .with_context(|| format!("Unknown WebGPU shader module {fragment_module_id}"))?;
        if vertex_module.device_id != device_id || fragment_module.device_id != device_id {
            anyhow::bail!("WebGPU shader module belongs to a different logical device");
        }

        let targets = [Some(wgpu::ColorTargetState {
            format: wgpu::TextureFormat::Bgra8Unorm,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label,
                layout: None,
                vertex: wgpu::VertexState {
                    module: &vertex_module.module,
                    entry_point: vertex_entry_point,
                    buffers: &[],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &fragment_module.module,
                    entry_point: fragment_entry_point,
                    targets: &targets,
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
        let id = self.allocate_resource_id()?;
        self.render_pipelines.insert(
            id,
            WebGpuRenderPipeline {
                device_id,
                pipeline,
            },
        );
        Ok(id)
    }

    fn render_frame(
        &self,
        width: u32,
        height: u32,
        rgba: u32,
        device_id: Option<u64>,
        commands: &[WebGpuPassCommand],
        released: Arc<AtomicU64>,
    ) -> Result<gpui::SurfaceSource> {
        if width == 0 || height == 0 {
            anyhow::bail!("Native WebGPU canvas dimensions must be positive");
        }
        let max_dimension = self.device.limits().max_texture_dimension_2d;
        if width > max_dimension || height > max_dimension {
            anyhow::bail!(
                "Native WebGPU canvas dimensions {width}x{height} exceed the device limit {max_dimension}"
            );
        }
        if let Some(device_id) = device_id {
            self.require_logical_device(device_id)?;
        } else if !commands.is_empty() {
            anyhow::bail!("Native WebGPU draw commands require a logical device");
        }

        let texture = Arc::new(self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("GPU-IX native WebGPU canvas frame"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        }));
        let metal_texture = retained_metal_texture(&texture)?;
        let frame = Arc::new(WebGpuCanvasFrame {
            _texture: texture.clone(),
            released,
        });
        let surface = gpui_apple::metal_renderer::MetalTextureSurface::new(metal_texture, 1, frame);

        let red = ((rgba >> 24) & 0xff) as f64 / 255.0;
        let green = ((rgba >> 16) & 0xff) as f64 / 255.0;
        let blue = ((rgba >> 8) & 0xff) as f64 / 255.0;
        let alpha = (rgba & 0xff) as f64 / 255.0;
        let view = texture.create_view(&Default::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("GPU-IX native WebGPU canvas frame"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("GPU-IX native WebGPU canvas render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: red,
                            g: green,
                            b: blue,
                            a: alpha,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            let mut pipeline_is_set = false;
            for command in commands {
                match *command {
                    WebGpuPassCommand::SetPipeline(pipeline_id) => {
                        let pipeline =
                            self.render_pipelines.get(&pipeline_id).with_context(|| {
                                format!("Unknown WebGPU render pipeline {pipeline_id}")
                            })?;
                        if Some(pipeline.device_id) != device_id {
                            anyhow::bail!(
                                "WebGPU render pipeline belongs to a different logical device"
                            );
                        }
                        pass.set_pipeline(&pipeline.pipeline);
                        pipeline_is_set = true;
                    }
                    WebGpuPassCommand::Draw {
                        vertex_count,
                        instance_count,
                        first_vertex,
                        first_instance,
                    } => {
                        if !pipeline_is_set {
                            anyhow::bail!("A WebGPU render pipeline must be set before draw");
                        }
                        let vertex_end = first_vertex
                            .checked_add(vertex_count)
                            .context("WebGPU vertex range overflow")?;
                        let instance_end = first_instance
                            .checked_add(instance_count)
                            .context("WebGPU instance range overflow")?;
                        pass.draw(first_vertex..vertex_end, first_instance..instance_end);
                    }
                }
            }
        }
        self.queue.submit([encoder.finish()]);
        signal_after_submitted_work(&self.queue, &surface.ready_event, surface.ready_value)?;

        Ok(surface.surface_source(gpui::size(
            gpui::DevicePixels(width as i32),
            gpui::DevicePixels(height as i32),
        )))
    }
}

fn retained_metal_texture(texture: &wgpu::Texture) -> Result<metal::Texture> {
    let texture = unsafe { texture.as_hal::<wgpu::hal::api::Metal>() }
        .context("Native WebGPU texture did not use Metal")?;
    let raw = texture.raw_handle() as *const _ as *mut objc::runtime::Object;
    #[allow(unexpected_cfgs)]
    let retained: *mut objc::runtime::Object = unsafe { msg_send![raw, retain] };
    if retained.is_null() {
        anyhow::bail!("Native WebGPU could not retain its Metal texture");
    }
    Ok(unsafe { metal::Texture::from_ptr(retained.cast()) })
}

/// Submit an empty Metal command buffer after wgpu's work on the same queue.
/// Metal queue ordering makes its event signal the exact producer boundary,
/// without polling the device or blocking the JavaScript/UI thread.
fn signal_after_submitted_work(
    queue: &wgpu::Queue,
    event: &metal::SharedEvent,
    value: u64,
) -> Result<()> {
    let queue = unsafe { queue.as_hal::<wgpu::hal::api::Metal>() }
        .context("Native WebGPU queue did not use Metal")?;
    let raw_queue = queue.as_raw() as *const _ as *mut objc::runtime::Object;
    let raw_event = event.as_ptr();
    #[allow(unexpected_cfgs)]
    unsafe {
        let command_buffer: *mut objc::runtime::Object = msg_send![raw_queue, commandBuffer];
        if command_buffer.is_null() {
            anyhow::bail!("Native WebGPU could not create its Metal signal command buffer");
        }
        let _: () = msg_send![command_buffer, encodeSignalEvent: raw_event value: value];
        let _: () = msg_send![command_buffer, commit];
    }
    Ok(())
}

fn js_resource_id(value: f64, kind: &str) -> Result<u64> {
    if !value.is_finite()
        || value <= 0.0
        || value.fract() != 0.0
        || value > MAX_SAFE_JS_INTEGER as f64
    {
        anyhow::bail!("Invalid WebGPU {kind} id: {value}");
    }
    Ok(value as u64)
}

fn command_u32(value: f64, name: &str) -> Result<u32> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > u32::MAX as f64 {
        anyhow::bail!("WebGPU {name} must be an unsigned 32-bit integer");
    }
    Ok(value as u32)
}

fn decode_pass_commands(ops: &[u32], operands: &[f64]) -> Result<Vec<WebGpuPassCommand>> {
    let mut cursor = 0;
    let mut decoded = Vec::with_capacity(ops.len());
    let mut next_operand = |name: &str| -> Result<f64> {
        let value = operands
            .get(cursor)
            .copied()
            .with_context(|| format!("Missing WebGPU {name} operand at index {cursor}"))?;
        cursor += 1;
        Ok(value)
    };

    for op in ops {
        match *op {
            WEB_GPU_SET_PIPELINE => decoded.push(WebGpuPassCommand::SetPipeline(js_resource_id(
                next_operand("pipeline id")?,
                "render pipeline",
            )?)),
            WEB_GPU_DRAW => decoded.push(WebGpuPassCommand::Draw {
                vertex_count: command_u32(next_operand("vertex count")?, "vertexCount")?,
                instance_count: command_u32(next_operand("instance count")?, "instanceCount")?,
                first_vertex: command_u32(next_operand("first vertex")?, "firstVertex")?,
                first_instance: command_u32(next_operand("first instance")?, "firstInstance")?,
            }),
            op => anyhow::bail!("Unknown WebGPU pass opcode {op}"),
        }
    }
    if cursor != operands.len() {
        anyhow::bail!(
            "WebGPU pass command stream left {} trailing operands",
            operands.len() - cursor
        );
    }
    Ok(decoded)
}

#[derive(Default)]
pub(crate) struct WebGpuCanvasStore {
    producer: Mutex<Option<WebGpuProducer>>,
    dimensions: Mutex<FxHashMap<u64, (u32, u32)>>,
    released: Arc<AtomicU64>,
}

impl WebGpuCanvasStore {
    fn with_producer<T>(
        &self,
        use_producer: impl FnOnce(&mut WebGpuProducer) -> Result<T>,
    ) -> Result<T> {
        let mut producer = self.producer.lock().unwrap();
        if producer.is_none() {
            *producer = Some(WebGpuProducer::new()?);
        }
        use_producer(producer.as_mut().expect("producer was initialized"))
    }

    pub(crate) fn create_device(&self) -> Result<f64> {
        self.with_producer(|producer| producer.create_logical_device().map(|id| id as f64))
    }

    pub(crate) fn destroy_device(&self, device_id: f64) -> Result<()> {
        let device_id = js_resource_id(device_id, "logical device")?;
        self.with_producer(|producer| {
            producer.destroy_logical_device(device_id);
            Ok(())
        })
    }

    pub(crate) fn create_shader_module(
        &self,
        device_id: f64,
        label: Option<String>,
        code: String,
    ) -> Result<f64> {
        let device_id = js_resource_id(device_id, "logical device")?;
        self.with_producer(|producer| {
            producer
                .create_shader_module(device_id, label.as_deref(), code)
                .map(|id| id as f64)
        })
    }

    pub(crate) fn create_render_pipeline(
        &self,
        device_id: f64,
        label: Option<String>,
        vertex_module_id: f64,
        vertex_entry_point: Option<String>,
        fragment_module_id: f64,
        fragment_entry_point: Option<String>,
    ) -> Result<f64> {
        let device_id = js_resource_id(device_id, "logical device")?;
        let vertex_module_id = js_resource_id(vertex_module_id, "vertex shader module")?;
        let fragment_module_id = js_resource_id(fragment_module_id, "fragment shader module")?;
        self.with_producer(|producer| {
            producer
                .create_render_pipeline(
                    device_id,
                    label.as_deref(),
                    vertex_module_id,
                    vertex_entry_point.as_deref(),
                    fragment_module_id,
                    fragment_entry_point.as_deref(),
                )
                .map(|id| id as f64)
        })
    }

    pub(crate) fn present(
        &self,
        id: u64,
        width: u32,
        height: u32,
        rgba: u32,
    ) -> Result<gpui::SurfaceSource> {
        let released = self.released.clone();
        let source = self.with_producer(|producer| {
            producer.render_frame(width, height, rgba, None, &[], released)
        })?;
        self.dimensions.lock().unwrap().insert(id, (width, height));
        Ok(source)
    }

    pub(crate) fn present_commands(
        &self,
        id: u64,
        width: u32,
        height: u32,
        device_id: f64,
        rgba: u32,
        ops: &[u32],
        operands: &[f64],
    ) -> Result<gpui::SurfaceSource> {
        let device_id = js_resource_id(device_id, "logical device")?;
        let commands = decode_pass_commands(ops, operands)?;
        let released = self.released.clone();
        let source = self.with_producer(|producer| {
            producer.render_frame(width, height, rgba, Some(device_id), &commands, released)
        })?;
        self.dimensions.lock().unwrap().insert(id, (width, height));
        Ok(source)
    }

    #[cfg(feature = "test-support")]
    pub(crate) fn install(
        &self,
        id: u64,
        width: u32,
        height: u32,
        rgba: u32,
    ) -> Result<gpui::SurfaceSource> {
        self.present(id, width, height, rgba)
    }

    #[cfg(feature = "test-support")]
    pub(crate) fn advance(&self, id: u64, rgba: u32) -> Result<gpui::SurfaceSource> {
        let (width, height) = self
            .dimensions
            .lock()
            .unwrap()
            .get(&id)
            .copied()
            .with_context(|| format!("No GPU canvas is installed for element {id}"))?;
        self.present(id, width, height, rgba)
    }

    pub(crate) fn remove(&self, ids: &[u64]) {
        let mut dimensions = self.dimensions.lock().unwrap();
        for id in ids {
            dimensions.remove(id);
        }
    }

    #[cfg(feature = "test-support")]
    pub(crate) fn installed_count(&self) -> u32 {
        self.dimensions.lock().unwrap().len() as u32
    }

    #[cfg(feature = "test-support")]
    pub(crate) fn released_count(&self) -> u32 {
        self.released.load(Ordering::Relaxed) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_pipeline_and_draw_commands() {
        assert_eq!(
            decode_pass_commands(
                &[WEB_GPU_SET_PIPELINE, WEB_GPU_DRAW],
                &[7.0, 3.0, 2.0, 1.0, 4.0]
            )
            .unwrap(),
            vec![
                WebGpuPassCommand::SetPipeline(7),
                WebGpuPassCommand::Draw {
                    vertex_count: 3,
                    instance_count: 2,
                    first_vertex: 1,
                    first_instance: 4,
                },
            ]
        );
    }

    #[test]
    fn rejects_malformed_command_streams() {
        assert!(decode_pass_commands(&[WEB_GPU_DRAW], &[3.0]).is_err());
        assert!(decode_pass_commands(&[], &[1.0]).is_err());
        assert!(decode_pass_commands(&[99], &[]).is_err());
        assert!(decode_pass_commands(&[WEB_GPU_SET_PIPELINE], &[1.5]).is_err());
    }
}
