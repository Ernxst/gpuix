//! macOS GPU canvas presentation for the browser-shaped React WebGPU slice.
//!
//! Each submitted frame owns its texture until GPUI retires every scene that
//! references it. Allocating a frame texture here is deliberate for the narrow
//! clear-and-present slice: without a compositor-to-producer fence, reusing a
//! texture could let the producer overwrite it while GPUI is still sampling.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result};
use metal::foreign_types::ForeignType as _;
use objc::{msg_send, sel, sel_impl};
use rustc_hash::FxHashMap;

struct WebGpuCanvasFrame {
    _texture: Arc<wgpu::Texture>,
    released: Arc<AtomicU64>,
}

impl Drop for WebGpuCanvasFrame {
    fn drop(&mut self) {
        self.released.fetch_add(1, Ordering::Relaxed);
    }
}

struct WebGpuProducer {
    device: wgpu::Device,
    queue: wgpu::Queue,
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
        Ok(Self { device, queue })
    }

    fn clear_frame(
        &self,
        width: u32,
        height: u32,
        rgba: u32,
        released: Arc<AtomicU64>,
    ) -> Result<gpui::SurfaceSource> {
        if width == 0 || height == 0 {
            anyhow::bail!("Native WebGPU canvas dimensions must be positive");
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
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("clear GPU-IX native WebGPU canvas frame"),
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

/// Submit an empty Metal command buffer after wgpu's clear on the same queue.
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

#[derive(Default)]
pub(crate) struct WebGpuCanvasStore {
    producer: Mutex<Option<WebGpuProducer>>,
    dimensions: Mutex<FxHashMap<u64, (u32, u32)>>,
    released: Arc<AtomicU64>,
}

impl WebGpuCanvasStore {
    fn clear_frame(&self, width: u32, height: u32, rgba: u32) -> Result<gpui::SurfaceSource> {
        let mut producer = self.producer.lock().unwrap();
        if producer.is_none() {
            *producer = Some(WebGpuProducer::new()?);
        }
        producer
            .as_ref()
            .expect("producer was initialized")
            .clear_frame(width, height, rgba, self.released.clone())
    }

    pub(crate) fn present(
        &self,
        id: u64,
        width: u32,
        height: u32,
        rgba: u32,
    ) -> Result<gpui::SurfaceSource> {
        let source = self.clear_frame(width, height, rgba)?;
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
