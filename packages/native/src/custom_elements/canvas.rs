use std::sync::{Arc, Mutex};

use gpui::prelude::*;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};

const DEFAULT_WIDTH: f64 = 300.0;
const DEFAULT_HEIGHT: f64 = 150.0;

#[derive(Clone, Copy)]
struct CanvasGeometry {
    bounds: gpui::Bounds<gpui::Pixels>,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CacheKey {
    revision: u64,
    origin_x: u32,
    origin_y: u32,
    layout_width: u32,
    layout_height: u32,
    scale_factor: u32,
}

impl CacheKey {
    fn new(revision: u64, bounds: gpui::Bounds<gpui::Pixels>, scale_factor: f32) -> Self {
        Self {
            revision,
            origin_x: f32::from(bounds.origin.x).to_bits(),
            origin_y: f32::from(bounds.origin.y).to_bits(),
            layout_width: f32::from(bounds.size.width).to_bits(),
            layout_height: f32::from(bounds.size.height).to_bits(),
            scale_factor: scale_factor.to_bits(),
        }
    }
}

#[derive(Clone)]
struct PreparedDisplayList {
    quads: Vec<gpui::PaintQuad>,
}

struct PreparedCache {
    key: CacheKey,
    list: Arc<PreparedDisplayList>,
}

pub struct CanvasElement {
    width: f64,
    height: f64,
    geometry: Arc<Mutex<Option<CanvasGeometry>>>,
    prepared: Arc<Mutex<Option<PreparedCache>>>,
}

impl Default for CanvasElement {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            geometry: Arc::new(Mutex::new(None)),
            prepared: Arc::new(Mutex::new(None)),
        }
    }
}

fn dimension(value: &serde_json::Value, fallback: f64) -> f64 {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(fallback)
}

fn local_point(
    geometry: &Arc<Mutex<Option<CanvasGeometry>>>,
    point: gpui::Point<gpui::Pixels>,
) -> (f64, f64) {
    let Some(geometry) = *geometry.lock().unwrap() else {
        return (0.0, 0.0);
    };
    let layout_width = f64::from(f32::from(geometry.bounds.size.width));
    let layout_height = f64::from(f32::from(geometry.bounds.size.height));
    let local_x = f64::from(f32::from(point.x - geometry.bounds.origin.x));
    let local_y = f64::from(f32::from(point.y - geometry.bounds.origin.y));
    (
        if layout_width == 0.0 {
            0.0
        } else {
            local_x * geometry.width / layout_width
        },
        if layout_height == 0.0 {
            0.0
        } else {
            local_y * geometry.height / layout_height
        },
    )
}

fn prepare(
    list: &crate::canvas::DisplayList,
    bounds: gpui::Bounds<gpui::Pixels>,
    width: f64,
    height: f64,
) -> PreparedDisplayList {
    if width == 0.0 || height == 0.0 {
        return PreparedDisplayList { quads: Vec::new() };
    }
    let scale_x = f64::from(f32::from(bounds.size.width)) / width;
    let scale_y = f64::from(f32::from(bounds.size.height)) / height;
    let origin_x = f64::from(f32::from(bounds.origin.x));
    let origin_y = f64::from(f32::from(bounds.origin.y));
    let mut quads = Vec::with_capacity(list.items.len());

    for item in &list.items {
        match item {
            crate::canvas::DisplayItem::FillRect(rect) => {
                let x1 = rect.x.min(rect.x + rect.width);
                let x2 = rect.x.max(rect.x + rect.width);
                let y1 = rect.y.min(rect.y + rect.height);
                let y2 = rect.y.max(rect.y + rect.height);
                let quad_bounds = gpui::bounds(
                    gpui::point(
                        gpui::px((origin_x + x1 * scale_x) as f32),
                        gpui::px((origin_y + y1 * scale_y) as f32),
                    ),
                    gpui::size(
                        gpui::px(((x2 - x1) * scale_x) as f32),
                        gpui::px(((y2 - y1) * scale_y) as f32),
                    ),
                )
                .intersect(&bounds);
                if !quad_bounds.is_empty() {
                    quads.push(gpui::fill(quad_bounds, rect.color));
                }
            }
        }
    }

    PreparedDisplayList { quads }
}

impl CanvasElement {
    fn attach_mouse_events(
        &self,
        mut element: gpui::Stateful<gpui::Div>,
        ctx: &CustomRenderContext,
    ) -> gpui::Stateful<gpui::Div> {
        let id = ctx.id;
        for event_type in ctx.events {
            let callback = ctx.event_callback.clone();
            let geometry = self.geometry.clone();
            match event_type.as_str() {
                "click" => {
                    element = element.on_click(move |event, _window, cx| {
                        let (x, y) = local_point(&geometry, event.position());
                        crate::renderer::emit_event_full(&callback, id, "click", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers().into());
                            payload.click_count = Some(event.click_count() as u32);
                            payload.is_right_click = Some(event.is_right_click());
                            payload.button = Some(match event {
                                gpui::ClickEvent::Mouse(event) => {
                                    crate::renderer::mouse_button_to_u32(event.down.button)
                                }
                                gpui::ClickEvent::Keyboard(_) | gpui::ClickEvent::Touch(_) => 0,
                            });
                            payload.input_source = Some(
                                match event {
                                    gpui::ClickEvent::Mouse(_) => "mouse",
                                    gpui::ClickEvent::Keyboard(_) => "keyboard",
                                    gpui::ClickEvent::Touch(_) => "touch",
                                }
                                .to_string(),
                            );
                        });
                        cx.stop_propagation();
                    });
                }
                "auxClick" => {
                    element = element.on_aux_click(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position());
                        crate::renderer::emit_event_full(&callback, id, "auxClick", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers().into());
                            payload.click_count = Some(event.click_count() as u32);
                            payload.is_right_click = Some(event.is_right_click());
                            payload.button = Some(if event.is_right_click() { 2 } else { 1 });
                        });
                    });
                }
                "mouseDown" => {
                    for &button in &[
                        gpui::MouseButton::Left,
                        gpui::MouseButton::Middle,
                        gpui::MouseButton::Right,
                    ] {
                        let callback = callback.clone();
                        let geometry = geometry.clone();
                        element = element.on_mouse_down(button, move |event, _window, _cx| {
                            let (x, y) = local_point(&geometry, event.position);
                            crate::renderer::emit_event_full(
                                &callback,
                                id,
                                "mouseDown",
                                |payload| {
                                    payload.x = Some(x);
                                    payload.y = Some(y);
                                    payload.button =
                                        Some(crate::renderer::mouse_button_to_u32(event.button));
                                    payload.click_count = Some(event.click_count as u32);
                                    payload.modifiers = Some(event.modifiers.into());
                                },
                            );
                        });
                    }
                }
                "mouseUp" => {
                    for &button in &[
                        gpui::MouseButton::Left,
                        gpui::MouseButton::Middle,
                        gpui::MouseButton::Right,
                    ] {
                        let callback = callback.clone();
                        let geometry = geometry.clone();
                        element = element.on_mouse_up(button, move |event, _window, _cx| {
                            let (x, y) = local_point(&geometry, event.position);
                            crate::renderer::emit_event_full(&callback, id, "mouseUp", |payload| {
                                payload.x = Some(x);
                                payload.y = Some(y);
                                payload.button =
                                    Some(crate::renderer::mouse_button_to_u32(event.button));
                                payload.click_count = Some(event.click_count as u32);
                                payload.modifiers = Some(event.modifiers.into());
                            });
                        });
                    }
                }
                "mouseMove" => {
                    element = element.on_mouse_move(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(&callback, id, "mouseMove", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers.into());
                            payload.pressed_button = event
                                .pressed_button
                                .map(crate::renderer::mouse_button_to_u32);
                        });
                    });
                }
                "mouseDownOutside" => {
                    element = element.on_mouse_down_out(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(
                            &callback,
                            id,
                            "mouseDownOutside",
                            |payload| {
                                payload.x = Some(x);
                                payload.y = Some(y);
                                payload.button =
                                    Some(crate::renderer::mouse_button_to_u32(event.button));
                                payload.modifiers = Some(event.modifiers.into());
                            },
                        );
                    });
                }
                "scroll" => {
                    element = element.on_scroll_wheel(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(&callback, id, "scroll", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers.into());
                            payload.precise = Some(event.delta.precise());
                            let delta = event.delta.pixel_delta(gpui::px(20.0));
                            payload.delta_x = Some(f64::from(f32::from(delta.x)));
                            payload.delta_y = Some(f64::from(f32::from(delta.y)));
                            payload.touch_phase = Some(
                                match event.touch_phase {
                                    gpui::TouchPhase::Started => "started",
                                    gpui::TouchPhase::Moved => "moved",
                                    gpui::TouchPhase::Ended => "ended",
                                    gpui::TouchPhase::Cancelled => "cancelled",
                                }
                                .to_string(),
                            );
                        });
                    });
                }
                "mouseEnter" | "mouseLeave" => {}
                _ => {}
            }
        }

        if ctx.events.contains("mouseDown") && ctx.events.contains("mouseMove") {
            element = element.capture_pointer();
        }
        let has_enter = ctx.events.contains("mouseEnter");
        let has_leave = ctx.events.contains("mouseLeave");
        if has_enter || has_leave {
            let callback_enter = has_enter.then(|| ctx.event_callback.clone()).flatten();
            let callback_leave = has_leave.then(|| ctx.event_callback.clone()).flatten();
            element = element.on_hover(move |hovered, _window, _cx| {
                if *hovered {
                    crate::renderer::emit_event_full(
                        &callback_enter,
                        id,
                        "mouseEnter",
                        |payload| {
                            payload.hovered = Some(true);
                        },
                    );
                } else {
                    crate::renderer::emit_event_full(
                        &callback_leave,
                        id,
                        "mouseLeave",
                        |payload| {
                            payload.hovered = Some(false);
                        },
                    );
                }
            });
        }

        element
    }
}

impl CustomElement for CanvasElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        let width = self.width;
        let height = self.height;
        let geometry = self.geometry.clone();
        let prepared_cache = self.prepared.clone();
        let display_lists = ctx.canvas_display_lists.clone();
        let id = ctx.id;
        let drawing = gpui::canvas(
            move |bounds, window, _cx| {
                *geometry.lock().unwrap() = Some(CanvasGeometry {
                    bounds,
                    width,
                    height,
                });
                let list = display_lists.lock().unwrap().get(&id).cloned();
                let revision = list.as_ref().map_or(0, |list| list.revision);
                let key = CacheKey::new(revision, bounds, window.scale_factor());
                let mut cache = prepared_cache.lock().unwrap();
                if let Some(cached) = cache.as_ref().filter(|cached| cached.key == key) {
                    return cached.list.clone();
                }
                let prepared = Arc::new(
                    list.as_deref()
                        .map_or(PreparedDisplayList { quads: Vec::new() }, |list| {
                            prepare(list, bounds, width, height)
                        }),
                );
                *cache = Some(PreparedCache {
                    key,
                    list: prepared.clone(),
                });
                prepared
            },
            move |_bounds, prepared, window, _cx| {
                for quad in &prepared.quads {
                    window.paint_quad(quad.clone());
                }
            },
        )
        .size_full();

        let element_id = gpui::SharedString::from(format!("__gpuix_canvas_{}", ctx.id));
        let mut root = gpui::div()
            .id(element_id)
            .relative()
            .w(gpui::px(self.width as f32))
            .h(gpui::px(self.height as f32));
        if let Some(style) = ctx.style {
            root = crate::renderer::apply_styles(root, style);
            if style.pointer_events.as_deref() == Some("none") {
                root = root.ignore_mouse();
            } else if crate::style::should_occlude(Some(style), !ctx.events.is_empty()) {
                root = root.block_mouse_except_scroll();
            }
        }
        root = root
            .child(crate::automation::bounds_tracker(ctx.id, None))
            .child(drawing);
        self.attach_mouse_events(root, &ctx).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "width" => self.width = dimension(&value, DEFAULT_WIDTH),
            "height" => self.height = dimension(&value, DEFAULT_HEIGHT),
            _ => {}
        }
        *self.prepared.lock().unwrap() = None;
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["width", "height"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[
            "click",
            "auxClick",
            "mouseDown",
            "mouseUp",
            "mouseMove",
            "mouseEnter",
            "mouseLeave",
            "mouseDownOutside",
            "scroll",
        ]
    }

    fn destroy(&mut self) {
        *self.geometry.lock().unwrap() = None;
        *self.prepared.lock().unwrap() = None;
    }
}

pub struct CanvasFactory;

impl CustomElementFactory for CanvasFactory {
    fn element_type(&self) -> &str {
        "canvas"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(CanvasElement::default())
    }
}
