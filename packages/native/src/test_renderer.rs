/// TestGpuixRenderer — GPU-backed GPUI test renderer exposed to Node.js via napi.
///
/// Uses gpui::VisualTestAppContext with a deterministic virtual display,
/// the native Metal or DirectX renderer, and TestDispatcher scheduling. Runs
/// the SAME GpuixView, build_element(), apply_styles(), and event handlers as
/// production without consulting the host display list.
///
/// Windows are positioned offscreen at (-10000, -10000) — invisible but
/// fully rendered by the native GPU. This enables capture_screenshot() for visual
/// test validation.
///
/// VisualTestAppContext is !Send, so it is stored in thread-local state.
/// All napi calls happen on the JS main thread.
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use gpui::AppContext as _;

use crate::element_tree::EventPayload;
use crate::renderer::{
    apply_batch_to_tree_with_diagnostics, catch_gpui_initialization, debug_frame_overlay_mode_name,
    debug_frame_overlay_stats_js, default_http_client, dispatch_application_menu_action,
    drain_style_diagnostics, has_application_menus, init_application_menu_support,
    install_application_menus, parse_debug_frame_overlay_mode, parse_style_json,
    pending_custom_prop_diagnostic, pending_style_diagnostics, set_application_menus,
    to_element_id, DebugFrameOverlayStats, EventCallback, GpuixStyleDiagnostic, GpuixView,
    MenuSpec, PendingStyleDiagnostic, WindowSize,
};
use crate::retained_tree::RetainedTree;
use crate::style::StyleDesc;

// ── Thread-local storage for !Send GPUI types ────────────────────────

/// Bundles VisualTestAppContext + window handle + view entity.
/// Stored in thread_local because VisualTestAppContext is !Send (Rc<AppCell>).
/// Field order is load-bearing: Rust drops fields in declaration order, and
/// gpui panics at app teardown if an `Entity` handle outlives its `App`.
/// `view` must therefore be declared before `cx`.
struct VisualTestState {
    view: gpui::Entity<GpuixView>,
    window: gpui::AnyWindowHandle,
    cx: gpui::VisualTestAppContext,
}

/// Release every `Entity` handle the view is holding, while the `App` is alive.
///
/// The test build enables gpui's leak detector, which panics if a handle
/// outlives its `App`. `<input>` keeps an `Entity<TextEditorState>` in the
/// view's custom element registry, so that panic fires from a thread-local
/// destructor at process exit. macOS never runs this destructor, so the panic
/// only appeared once Windows started running the suite: every test file
/// passed and then the vitest worker died with "Worker exited unexpectedly".
///
/// `drop` runs before the fields are dropped, so `view` and `cx` are both
/// still usable here.
impl Drop for VisualTestState {
    fn drop(&mut self) {
        let view = self.view.clone();
        // Unmount, exactly as React would: empty the tree, then paint one more
        // frame. The registry is not the only owner of the entity. `<input>`
        // installs an `ElementInputHandler` during paint, and a clone of that
        // lives in the window's rendered frame and in the platform window. A
        // frame with nothing in it is what drops those, and it has to happen
        // while the `App` is still alive.
        self.cx.update(|cx| {
            view.update(cx, |view, cx| {
                if let Ok(mut tree) = view.tree.lock() {
                    tree.root_id = None;
                }
                view.custom_registry.destroy_all();
                view.focus_subscriptions.clear();
                view.focus_handles.clear();
                cx.notify();
            });
        });
        // Err only means the window is already gone, which is the state this
        // is trying to reach.
        self.cx
            .update_window(self.window, |_, window, _| window.refresh())
            .ok();
        self.cx.run_until_parked();
    }
}

thread_local! {
    static TEST_STATES: RefCell<HashMap<u64, VisualTestState>> = RefCell::new(HashMap::new());
}

static NEXT_TEST_STATE_ID: AtomicU64 = AtomicU64::new(1);

/// Access VisualTestAppContext + window + view mutably within thread_local.
/// The closure receives (&mut cx, window_handle, &view_entity).
/// Returns Err if this renderer's state has already been disposed.
fn with_test_state<R>(
    state_id: u64,
    f: impl FnOnce(
        &mut gpui::VisualTestAppContext,
        gpui::AnyWindowHandle,
        &gpui::Entity<GpuixView>,
    ) -> Result<R>,
) -> Result<R> {
    TEST_STATES.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let state = borrow
            .get_mut(&state_id)
            .ok_or_else(|| Error::from_reason("TestGpuixRenderer has been disposed"))?;
        f(&mut state.cx, state.window, &state.view)
    })
}

fn dispose_test_state(state_id: u64) {
    let _ = TEST_STATES.try_with(|cell| cell.borrow_mut().remove(&state_id));
}

/// Default offscreen window size. Matches gpui's `open_offscreen_window_default`,
/// so a `new TestGpuixRenderer()` with no size behaves exactly as before.
///
/// Note for layout tests: 1280 is wide enough that a centered max-width content
/// column stays capped whether a sidebar is open or closed. A test that needs to
/// observe re-wrapping must pass a narrower width explicitly.
const DEFAULT_WINDOW_WIDTH: f64 = 1280.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;

/// Validate a caller-supplied window dimension, falling back to `default`.
///
/// Checks the value *after* the `f32` cast: a finite `f64` such as `1e300`
/// saturates to `f32::INFINITY`, which would open a window with no usable size.
fn window_dimension(value: Option<f64>, default: f64, label: &str) -> Result<f32> {
    let Some(value) = value else {
        return Ok(default as f32);
    };
    let pixels = value as f32;
    if !pixels.is_finite() || pixels <= 0.0 {
        return Err(Error::from_reason(format!(
            "TestGpuixRenderer {label} must be a positive, finite number, got {value}"
        )));
    }
    Ok(pixels)
}

/// Convert JS button number (0=left, 1=middle, 2=right) to GPUI MouseButton.
fn u32_to_mouse_button(button: u32) -> gpui::MouseButton {
    match button {
        1 => gpui::MouseButton::Middle,
        2 => gpui::MouseButton::Right,
        _ => gpui::MouseButton::Left,
    }
}

fn point_is_inside(bounds: crate::automation::ElementBounds, point: (f64, f64)) -> bool {
    point.0 >= bounds.x
        && point.0 < bounds.x + bounds.width
        && point.1 >= bounds.y
        && point.1 < bounds.y + bounds.height
}

fn nearest_hover_group(tree: &RetainedTree, element_id: u64) -> Option<u64> {
    let mut current = Some(element_id);
    while let Some(id) = current {
        let element = tree.elements.get(&id)?;
        if element
            .custom_props
            .get("hoverGroup")
            .and_then(serde_json::Value::as_str)
            .is_some()
        {
            return Some(id);
        }
        current = element.parent;
    }
    None
}

fn style_object(style: &StyleDesc) -> Result<serde_json::Map<String, serde_json::Value>> {
    let serde_json::Value::Object(mut object) = serde_json::to_value(style)
        .map_err(|error| Error::from_reason(format!("Style serialization failed: {error}")))?
    else {
        return Err(Error::from_reason(
            "Style serialization returned a non-object",
        ));
    };
    object.retain(|key, value| {
        !value.is_null()
            && !matches!(
                key.as_str(),
                "hover" | "hoverWithin" | "active" | "focus" | "focusVisible"
            )
    });
    Ok(object)
}

fn refine_style_object(
    resolved: &mut serde_json::Map<String, serde_json::Value>,
    refinement: Option<&StyleDesc>,
) -> Result<()> {
    let Some(refinement) = refinement else {
        return Ok(());
    };
    resolved.extend(style_object(refinement)?);
    Ok(())
}

// ── TestGpuixRenderer ────────────────────────────────────────────────

/// GPU-backed GPUI test renderer. Uses VisualTestAppContext with the native
/// Metal or DirectX renderer and TestDispatcher for deterministic scheduling.
/// Same GpuixView and rendering pipeline as production.
///
/// Usage from JS:
///   const r = new TestGpuixRenderer()
///   r.createElement(1, "div")
///   r.setRoot(1)
///   r.commitMutations()
///   r.flush()                  // triggers GpuixView::render() on the GPU
///   r.simulateClick(50, 50)    // dispatches through GPUI hit testing
///   const events = r.drainEvents()
///   r.captureScreenshot("/tmp/test.png")  // saves rendered UI as PNG
#[napi]
pub struct TestGpuixRenderer {
    state_id: u64,
    tree: Arc<Mutex<RetainedTree>>,
    events: Arc<Mutex<Vec<EventPayload>>>,
    /// Same handle GpuixView paints against, so tests can assert on the live
    /// selection after simulating a drag.
    selection: crate::text::SharedSelection,
    image_network_policy: crate::custom_elements::img::ImageNetworkPolicy,
    strict_styles: AtomicBool,
    style_diagnostics: Mutex<Vec<PendingStyleDiagnostic>>,
    /// Mouse-down origin for the current GPUI active-state sequence.
    /// GPUI keeps `active` applied until mouse-up even if the pointer moves.
    active_pointer_origin: Mutex<Option<(f64, f64)>>,
}

#[napi]
impl TestGpuixRenderer {
    #[napi(constructor)]
    pub fn new(width: Option<f64>, height: Option<f64>) -> Result<Self> {
        catch_gpui_initialization("GPUI test renderer initialization", || {
            Self::try_new(width, height)
        })
    }

    fn try_new(width: Option<f64>, height: Option<f64>) -> Result<Self> {
        let state_id = NEXT_TEST_STATE_ID.fetch_add(1, Ordering::Relaxed);
        let window_size = gpui::size(
            gpui::px(window_dimension(width, DEFAULT_WINDOW_WIDTH, "width")?),
            gpui::px(window_dimension(height, DEFAULT_WINDOW_HEIGHT, "height")?),
        );
        let tree = Arc::new(Mutex::new(RetainedTree::new()));
        let events: Arc<Mutex<Vec<EventPayload>>> = Arc::new(Mutex::new(Vec::new()));

        // Event callback: push to Vec instead of ThreadsafeFunction.
        let events_clone = events.clone();
        let event_callback: Option<EventCallback> = Some(Arc::new(move |payload: EventPayload| {
            events_clone.lock().unwrap().push(payload);
        }));

        let tree_clone = tree.clone();
        let callback_clone = event_callback.clone();
        let selection = crate::text::SharedSelection::default();
        let selection_clone = selection.clone();
        let image_network_policy = crate::custom_elements::img::ImageNetworkPolicy::default();
        let image_network_policy_for_view = image_network_policy.clone();

        let platform = gpui_platform::current_platform(false);
        let mut cx = gpui::VisualTestAppContext::new(platform);
        cx.update(|cx| {
            cx.set_http_client(default_http_client());
            crate::renderer::init_key_bindings(cx);
            crate::custom_elements::input::init(cx);
            init_application_menu_support(cx, event_callback.clone());
            install_application_menus(cx, "GPUIX Test", None).expect("default test menu is valid");
        });

        // Open an offscreen window at (-10000, -10000) with the same GpuixView
        // and native GPU renderer as production.
        let window_handle = cx
            .open_offscreen_window(window_size, |_window, app| {
                app.new(|_cx| {
                    GpuixView::new(
                        tree_clone,
                        callback_clone,
                        Arc::new(Mutex::new(event_callback.clone())),
                        "GPUIX Test".to_string(),
                        selection_clone,
                        image_network_policy_for_view,
                    )
                })
            })
            .map_err(|e| Error::from_reason(format!("Failed to open test window: {}", e)))?;

        // Get the root entity (Entity<GpuixView>) from the window.
        let view = window_handle
            .entity(&cx)
            .map_err(|e| Error::from_reason(format!("Failed to get root view: {}", e)))?;

        // Convert typed WindowHandle<GpuixView> to AnyWindowHandle for simulation methods.
        let window: gpui::AnyWindowHandle = window_handle.into();

        // Store !Send types on the JS main thread.
        TEST_STATES.with(|cell| {
            cell.borrow_mut()
                .insert(state_id, VisualTestState { cx, window, view });
        });

        Ok(Self {
            state_id,
            tree,
            events,
            selection,
            image_network_policy,
            strict_styles: AtomicBool::new(true),
            style_diagnostics: Mutex::new(Vec::new()),
            active_pointer_origin: Mutex::new(None),
        })
    }

    /// Dispose this renderer's offscreen window and GPUI application context.
    /// Further interaction attempts fail instead of being routed to another root.
    #[napi]
    pub fn dispose(&self) {
        dispose_test_state(self.state_id);
    }

    /// The same capability contract as a live renderer, scoped to this
    /// offscreen GPU-backed window.
    #[napi]
    pub fn capabilities(&self) -> crate::renderer::RendererCapabilities {
        crate::renderer::test_renderer_capabilities()
    }

    // ── Mutation API (same interface as GpuixRenderer) ────────────────

    #[napi]
    pub fn create_element(&self, id: f64, element_type: String) -> Result<()> {
        let id = to_element_id(id)?;
        self.tree.lock().unwrap().create_element(id, element_type);
        Ok(())
    }

    /// Destroy an element and all descendants. Returns destroyed IDs
    /// so JS can clean up event handlers.
    #[napi]
    pub fn destroy_element(&self, id: f64) -> Result<Vec<f64>> {
        let id = to_element_id(id)?;
        let destroyed = self.tree.lock().unwrap().destroy_element(id);
        Ok(destroyed.iter().map(|&id| id as f64).collect())
    }

    #[napi]
    pub fn append_child(&self, parent_id: f64, child_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        self.tree.lock().unwrap().append_child(parent_id, child_id);
        Ok(())
    }

    #[napi]
    pub fn remove_child(&self, parent_id: f64, child_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        self.tree.lock().unwrap().remove_child(parent_id, child_id);
        Ok(())
    }

    #[napi]
    pub fn insert_before(&self, parent_id: f64, child_id: f64, before_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        let before_id = to_element_id(before_id)?;
        self.tree
            .lock()
            .unwrap()
            .insert_before(parent_id, child_id, before_id);
        Ok(())
    }

    #[napi]
    pub fn set_style(&self, id: f64, style_json: String) -> Result<()> {
        let id = to_element_id(id)?;
        let parsed = parse_style_json(&style_json);
        let mut tree = self.tree.lock().unwrap();
        let style = tree
            .styles
            .intern_parsed(style_json.as_bytes(), parsed.style);
        tree.set_style(id, style);
        let live_elements = tree.elements.len();
        tree.styles.maybe_sweep(live_elements);
        drop(tree);
        if self.strict_styles.load(Ordering::Relaxed) {
            self.style_diagnostics
                .lock()
                .unwrap()
                .extend(pending_style_diagnostics(id, parsed.problems));
        }
        Ok(())
    }

    #[napi]
    pub fn set_strict_styles(&self, enabled: bool) {
        self.strict_styles.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.style_diagnostics.lock().unwrap().clear();
        }
    }

    /// Opt in to loopback and private-network URL image sources for local tests.
    /// Link-local and cloud-metadata addresses remain blocked.
    #[napi]
    pub fn set_allow_private_network_images(&self, enabled: bool) {
        self.image_network_policy.set_allow_private(enabled);
    }

    #[napi]
    pub fn drain_style_diagnostics(&self) -> Vec<GpuixStyleDiagnostic> {
        drain_style_diagnostics(&self.style_diagnostics, &self.tree)
    }

    #[napi]
    pub fn set_text(&self, id: f64, content: String) -> Result<()> {
        let id = to_element_id(id)?;
        self.tree.lock().unwrap().set_text(id, content);
        Ok(())
    }

    #[napi]
    pub fn set_event_listener(&self, id: f64, event_type: String, has_handler: bool) -> Result<()> {
        let id = to_element_id(id)?;
        self.tree
            .lock()
            .unwrap()
            .set_event_listener(id, event_type, has_handler);
        Ok(())
    }

    /// Set the root element (called from appendChildToContainer).
    #[napi]
    pub fn set_root(&self, id: f64) -> Result<()> {
        let id = to_element_id(id)?;
        self.tree.lock().unwrap().root_id = Some(id);
        Ok(())
    }

    /// Set a custom prop on an element (for non-div/text elements like input, editor, diff).
    #[napi]
    pub fn set_custom_prop(&self, id: f64, key: String, value_json: String) -> Result<()> {
        let id = to_element_id(id)?;
        let value: serde_json::Value = serde_json::from_str(&value_json)
            .map_err(|e| Error::from_reason(format!("Failed to parse custom prop value: {}", e)))?;
        let mut tree = self.tree.lock().unwrap();
        let diagnostic = pending_custom_prop_diagnostic(&tree, id, &key, &value);
        tree.set_custom_prop(id, key, value);
        drop(tree);
        if self.strict_styles.load(Ordering::Relaxed) {
            if let Some(diagnostic) = diagnostic {
                self.style_diagnostics.lock().unwrap().push(diagnostic);
            }
        }
        Ok(())
    }

    /// Get a custom prop value from an element.
    #[napi]
    pub fn get_custom_prop(&self, id: f64, key: String) -> Result<Option<String>> {
        let id = to_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        Ok(tree
            .get_custom_prop(id, &key)
            .map(|v| serde_json::to_string(v).unwrap_or_default()))
    }

    /// Signal that a batch of mutations is complete.
    /// In tests, this is a no-op — flush() handles the actual re-render.
    #[napi]
    pub fn commit_mutations(&self) -> Result<()> {
        Ok(())
    }

    /// Apply a batch of mutations in a single FFI call.
    /// Same format as GpuixRenderer::apply_batch (string op names).
    /// Returns accumulated destroyed IDs from all destroyElement ops.
    #[napi]
    pub fn apply_batch(&self, json: String) -> Result<Vec<f64>> {
        let mut tree = self.tree.lock().unwrap();
        let strict_styles = self.strict_styles.load(Ordering::Relaxed);
        let outcome =
            apply_batch_to_tree_with_diagnostics(&mut tree, json.as_bytes(), strict_styles)
                .map_err(Error::from_reason)?;
        drop(tree);
        if strict_styles {
            self.style_diagnostics
                .lock()
                .unwrap()
                .extend(outcome.diagnostics);
        }
        Ok(outcome.destroyed_ids)
    }

    // ── Test-specific methods ────────────────────────────────────────

    /// Replace the application menu using the production conversion and GPUI APIs.
    #[napi]
    pub fn set_menus(&self, menus: Vec<MenuSpec>) -> Result<()> {
        with_test_state(self.state_id, |cx, _window, _view| {
            cx.update(|cx| set_application_menus(cx, menus))
                .map_err(Error::from_reason)?;
            Ok(())
        })
    }

    /// Dispatch a configured application action through GPUI's global action pipeline.
    #[napi]
    pub fn simulate_menu_action(&self, id: String) -> Result<()> {
        with_test_state(self.state_id, |cx, _window, _view| {
            cx.update(|cx| dispatch_application_menu_action(cx, &id))
                .map_err(Error::from_reason)?;
            cx.run_until_parked();
            Ok(())
        })
    }

    /// Whether GPUI reports a currently installed application menu bar.
    #[napi]
    pub fn has_main_menu(&self) -> Result<bool> {
        with_test_state(self.state_id, |cx, _window, _view| {
            Ok(cx.update(|cx| has_application_menus(cx)))
        })
    }

    /// Notify the view entity and run GPUI until parked.
    /// This triggers GpuixView::render() → build_element() → GPUI layout.
    /// Must be called after mutations and before simulating events (GPUI's
    /// hit testing requires elements to be laid out).
    #[napi]
    pub fn flush(&self) -> Result<()> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.update(app, |_, cx| {
                    cx.notify();
                });
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;

            cx.run_until_parked();
            Ok(())
        })
    }

    /// Advance GPUI's async executor clock so tests can deterministically fire
    /// timers such as bounded image retry/revalidation deadlines. When the
    /// renderer animation clock is paused, advance that clock by the same
    /// amount and render the resulting transition frame as well.
    #[napi]
    pub fn advance_async_clock(&self, delta_ms: f64) -> Result<()> {
        if !delta_ms.is_finite() || delta_ms < 0.0 {
            return Err(Error::from_reason(
                "advanceAsyncClock delta must be a finite non-negative number",
            ));
        }
        with_test_state(self.state_id, |cx, window, view| {
            cx.advance_clock(std::time::Duration::from_secs_f64(delta_ms / 1000.0));
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.update(app, |view, cx| {
                    if view.clock.fast_forward_if_frozen_ms(delta_ms).is_some() {
                        cx.notify();
                    }
                });
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            cx.run_until_parked();
            Ok(())
        })
    }

    /// Override GPUI's reduced-motion policy for deterministic tests.
    #[napi]
    pub fn set_reduced_motion(&self, enabled: bool) -> Result<()> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                app.set_reduce_motion(enabled);
                view.update(app, |_, cx| cx.notify());
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            cx.run_until_parked();
            Ok(())
        })
    }

    /// Number of retained style-transition tracks. Exposed only by the
    /// offscreen renderer so lifecycle tests can prove unmounted tracks leave.
    #[napi]
    pub fn get_style_transition_count(&self) -> Result<u32> {
        self.flush()?;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                u32::try_from(view.read(app).transition_states.len()).unwrap_or(u32::MAX)
            })
            .map_err(|error| Error::from_reason(error.to_string()))
        })
    }

    /// Number of GPUI frame requests emitted by active style transitions since
    /// this offscreen renderer was created. Imperative motion is not counted.
    #[napi]
    pub fn get_style_transition_frame_request_count(&self) -> Result<u32> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.read(app).style_transition_frame_requests
            })
            .map_err(|error| Error::from_reason(error.to_string()))
        })
    }

    #[napi]
    pub fn get_window_size(&self) -> Result<WindowSize> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_view, window, _app| {
                let viewport_size = window.viewport_size();
                WindowSize {
                    width: f64::from(f32::from(viewport_size.width)),
                    height: f64::from(f32::from(viewport_size.height)),
                    scale_factor: f64::from(window.scale_factor()),
                }
            })
            .map_err(|error| Error::from_reason(error.to_string()))
        })
    }

    /// Simulate a native window resize through GPUI's bounds observer.
    #[napi]
    pub fn simulate_resize(&self, width: f64, height: f64) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_view, window, app| {
                window.simulate_resize(
                    gpui::size(gpui::px(width as f32), gpui::px(height as f32)),
                    app,
                );
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            cx.run_until_parked();
            Ok(())
        })
    }

    /// Simulate a click at the given window coordinates.
    /// Dispatches MouseDown + MouseUp through GPUI's input pipeline,
    /// which triggers the same event handlers as production.
    /// IMPORTANT: Call flush() before this — hit testing requires laid-out elements.
    /// `modifiers` uses the `press()` syntax: "cmd", "cmd-shift", "alt".
    #[napi]
    pub fn simulate_click(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<()> {
        let modifiers = crate::automation::parse_modifiers(modifiers.as_deref());
        let button = button.unwrap_or(0);
        let result = with_test_state(self.state_id, |cx, window, _view| {
            // Not `cx.simulate_click`: that helper hard-codes the left button,
            // so a right click silently became a left click.
            let position = gpui::point(gpui::px(x as f32), gpui::px(y as f32));
            let gpui_button = u32_to_mouse_button(button);
            cx.simulate_event(
                window,
                gpui::MouseDownEvent {
                    position,
                    modifiers,
                    button: gpui_button,
                    click_count: 1,
                    first_mouse: false,
                },
            );
            cx.simulate_event(
                window,
                gpui::MouseUpEvent {
                    position,
                    modifiers,
                    button: gpui_button,
                    click_count: 1,
                },
            );
            Ok(())
        });
        *self.active_pointer_origin.lock().unwrap() = None;
        result
    }

    /// Simulate key strokes through GPUI's input pipeline.
    /// Format: space-separated keys, e.g. "a", "enter", "cmd-shift-p".
    /// The focused element receives keyDown/keyUp events.
    #[napi]
    pub fn simulate_keystrokes(&self, keystrokes: String) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            let keystrokes = keystrokes
                .split_whitespace()
                .map(|keystroke| {
                    gpui::Keystroke::parse(keystroke).map_err(|error| {
                        Error::from_reason(format!("Invalid keystroke '{}': {}", keystroke, error))
                    })
                })
                .collect::<Result<Vec<_>>>()?;

            for keystroke in keystrokes {
                // Match GPUI's simulated key-down/text-input path before releasing the key.
                cx.dispatch_keystroke(window, keystroke.clone());
                cx.simulate_event(window, gpui::KeyUpEvent { keystroke });
            }
            Ok(())
        })
    }

    /// Simulate a single key down event through GPUI's input pipeline.
    /// Format: modifier-key string, e.g. "a", "enter", "cmd-s".
    /// Unlike simulate_keystrokes, this dispatches ONLY a KeyDownEvent —
    /// no automatic KeyUpEvent follows. Use with simulate_key_up for
    /// fine-grained key event testing.
    #[napi]
    pub fn simulate_key_down(&self, keystroke: String, is_held: Option<bool>) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            let parsed = gpui::Keystroke::parse(&keystroke).map_err(|e| {
                Error::from_reason(format!("Invalid keystroke '{}': {}", keystroke, e))
            })?;

            cx.simulate_event(
                window,
                gpui::KeyDownEvent {
                    keystroke: parsed,
                    is_held: is_held.unwrap_or(false),
                    prefer_character_input: false,
                },
            );

            Ok(())
        })
    }

    /// Simulate a single key up event through GPUI's input pipeline.
    /// Format: modifier-key string, e.g. "a", "enter", "cmd-s".
    /// Pairs with simulate_key_down for fine-grained key event testing.
    #[napi]
    pub fn simulate_key_up(&self, keystroke: String) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            let parsed = gpui::Keystroke::parse(&keystroke).map_err(|e| {
                Error::from_reason(format!("Invalid keystroke '{}': {}", keystroke, e))
            })?;

            cx.simulate_event(window, gpui::KeyUpEvent { keystroke: parsed });

            Ok(())
        })
    }

    /// Simulate a mouse move to the given coordinates.
    /// pressed_button: optional mouse button held during move (0=left, 1=middle, 2=right).
    /// Used to simulate drag events.
    #[napi]
    pub fn simulate_mouse_move(
        &self,
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<()> {
        let modifiers = crate::automation::parse_modifiers(modifiers.as_deref());
        with_test_state(self.state_id, |cx, window, _view| {
            let button: Option<gpui::MouseButton> = pressed_button.map(u32_to_mouse_button);

            cx.simulate_mouse_move(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                button,
                modifiers,
            );

            Ok(())
        })
    }

    /// Focus an element by its numeric ID.
    /// The element must have a FocusHandle (created by sync_focus_handles when
    /// the element has keyDown, keyUp, focus, or blur listeners).
    /// Call flush() before this so the element tree and focus handles exist.
    #[napi]
    pub fn focus_element(&self, id: f64) -> Result<()> {
        let id = to_element_id(id)?;

        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();

            cx.update_window(window, |_, window, app| {
                view.update(app, |view, cx| {
                    view.reveal_virtual_list_ancestor(id);
                    if let Some(handle) = view.focus_handles.get(&id) {
                        handle.focus(window, cx);
                    }
                    cx.notify();
                });
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;

            cx.run_until_parked();
            Ok(())
        })
    }

    #[napi]
    pub fn set_pointer_capture(&self, id: f64) -> Result<()> {
        let id = to_element_id(id)?;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let result = cx
                .update_window(window, |_, window, app| {
                    view.update(app, |view, _cx| view.set_pointer_capture(id, window))
                })
                .map_err(|error| Error::from_reason(error.to_string()))?;
            result.map_err(Error::from_reason)
        })
    }

    #[napi]
    pub fn release_pointer_capture(&self, id: f64) -> Result<()> {
        let id = to_element_id(id)?;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, window, app| {
                view.update(app, |view, _cx| {
                    view.release_pointer_capture(id, window);
                });
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            Ok(())
        })
    }

    /// Simulate a platform window activation change through the production observer path.
    #[napi]
    pub fn simulate_window_activation(&self, active: bool) -> Result<()> {
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, app| {
                window.simulate_active_status_change(active, app);
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            cx.run_until_parked();
            Ok(())
        });
        if !active {
            *self.active_pointer_origin.lock().unwrap() = None;
        }
        result
    }

    /// Simulate the platform deactivating the test window.
    #[napi]
    pub fn simulate_window_deactivation(&self) -> Result<()> {
        self.simulate_window_activation(false)
    }

    /// Whether the offscreen native window is active and receiving key events.
    #[napi]
    pub fn is_active(&self) -> Result<bool> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| window.is_window_active())
                .map_err(|error| Error::from_reason(error.to_string()))
        })
    }

    /// An offscreen test window cannot request foreground activation.
    #[napi]
    pub fn activate_window(&self, env: Env) -> Result<()> {
        crate::renderer::unsupported_capability(env, "window.activate")
    }

    /// Simulate a mouse down event at the given window coordinates.
    /// Button: 0=left, 1=middle, 2=right. Defaults to left (0).
    #[napi]
    pub fn simulate_mouse_down(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<()> {
        let modifiers = crate::automation::parse_modifiers(modifiers.as_deref());
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_mouse_down(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                u32_to_mouse_button(button.unwrap_or(0)),
                modifiers,
            );
            Ok(())
        });
        if result.is_ok() {
            *self.active_pointer_origin.lock().unwrap() = Some((x, y));
        }
        result
    }

    /// Simulate a mouse up event at the given window coordinates.
    /// Button: 0=left, 1=middle, 2=right. Defaults to left (0).
    #[napi]
    pub fn simulate_mouse_up(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<()> {
        let modifiers = crate::automation::parse_modifiers(modifiers.as_deref());
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_mouse_up(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                u32_to_mouse_button(button.unwrap_or(0)),
                modifiers,
            );
            Ok(())
        });
        *self.active_pointer_origin.lock().unwrap() = None;
        result
    }

    /// Simulate a scroll wheel event at the given position.
    /// delta_x and delta_y default to pixels (negative = scroll up/left).
    #[napi]
    pub fn simulate_scroll_wheel(
        &self,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        options: Option<crate::automation::ScrollWheelOptions>,
    ) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            let event = crate::automation::scroll_wheel_event(x, y, delta_x, delta_y, options)
                .map_err(Error::from_reason)?;
            cx.simulate_event(window, event);
            Ok(())
        })
    }

    // ── Selection API ──────────────────────────────────────────────────

    /// The current text selection joined in document order, or null.
    #[napi]
    pub fn get_selected_text(&self) -> Option<String> {
        self.selection.lock().selected_text()
    }

    /// Drop the current selection.
    #[napi]
    pub fn clear_selection(&self) {
        self.selection.lock().clear();
    }

    /// Syntax-cache counters as `[hits, misses, documents]`.
    ///
    /// GPUIX rebuilds its whole element tree every frame, so a `<code>` block
    /// that misses the cache reparses at frame rate. A test can watch the hit
    /// count to catch that regression before a profiler does.
    #[napi]
    pub fn get_syntax_cache_stats(&self) -> Vec<f64> {
        let stats = crate::syntax::cache::stats();
        vec![
            stats.hits as f64,
            stats.misses as f64,
            stats.documents as f64,
        ]
    }

    /// Every string painted in the last frame, in paint order.
    ///
    /// `getAllText()` only sees `<text>` nodes in the retained tree. Native
    /// elements such as `<code>` and `<diff>` draw their text inside gpui, so
    /// this is the only way to assert on what they actually rendered.
    #[napi]
    pub fn get_painted_text(&self) -> Result<Vec<String>> {
        self.flush()?;
        Ok(crate::text::painted_text())
    }

    /// Every highlight wash painted in the last frame, in paint order.
    ///
    /// A quad is invisible to `getPaintedText()`, so this is the only way to
    /// assert on `highlight` without a screenshot. Each entry carries its rects,
    /// so a soft-wrapped match is provably two boxes.
    #[napi]
    pub fn get_painted_highlights(&self) -> Result<Vec<crate::element_tree::HighlightMatch>> {
        self.flush()?;
        Ok(crate::text::painted_highlights()
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Drag-select from one point to another: mouse down, move, up.
    ///
    /// A single helper rather than three calls because the listeners that drive
    /// selection are registered during **paint**, so a flush must sit between
    /// the down and the move. Getting that order wrong silently selects nothing,
    /// which is a miserable thing to debug from JS.
    #[napi]
    pub fn drag_select(&self, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<()> {
        self.flush()?;
        self.simulate_mouse_down(x1, y1, None, None)?;
        self.flush()?;
        self.simulate_mouse_move(x2, y2, Some(0), None)?;
        self.flush()?;
        self.simulate_mouse_up(x2, y2, None, None)?;
        self.flush()?;
        Ok(())
    }

    // ── Scroll API ─────────────────────────────────────────────────────

    /// Set the scroll offset of a scrollable element.
    /// x and y are negative pixel values (scroll down = more negative y).
    /// Call flush() after to apply the offset and re-render.
    #[napi]
    pub fn scroll_to(&self, element_id: f64, x: f64, y: f64) -> Result<()> {
        let id = to_element_id(element_id)?;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.update(app, |view, _cx| {
                    if view.set_virtual_list_offset(id, x as f32, y as f32) {
                        return;
                    }
                    if let Some(handle) = view.scroll_handles.get(&id) {
                        handle.set_offset(gpui::point(gpui::px(x as f32), gpui::px(y as f32)));
                    }
                });
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(())
        })
    }

    /// Scroll a child into view by its index in the children list.
    /// Call flush() after to apply and re-render.
    #[napi]
    pub fn scroll_to_item(&self, element_id: f64, index: f64) -> Result<()> {
        let id = to_element_id(element_id)?;
        let index = index as usize;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.update(app, |view, _cx| {
                    if view.scroll_virtual_list_to_item(id, index) {
                        return;
                    }
                    if let Some(handle) = view.scroll_handles.get(&id) {
                        handle.scroll_to_item(index);
                    }
                });
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(())
        })
    }

    /// `"hidden"` | `"minimal"` | `"full"`.
    #[napi]
    pub fn set_debug_frame_overlay(&self, mode: String) -> Result<String> {
        let mode = parse_debug_frame_overlay_mode(&mode)?;
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| {
                window.set_debug_frame_overlay_mode(mode);
                debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
            })
            .map_err(|e| Error::from_reason(e.to_string()))
        })
    }

    /// Hidden → minimal → full → hidden.
    #[napi]
    pub fn cycle_debug_frame_overlay(&self) -> Result<String> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| {
                window.cycle_debug_frame_overlay_mode();
                debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
            })
            .map_err(|e| Error::from_reason(e.to_string()))
        })
    }

    #[napi]
    pub fn get_debug_frame_overlay(&self) -> Result<String> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| {
                debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
            })
            .map_err(|e| Error::from_reason(e.to_string()))
        })
    }

    /// Clears the last 1000 draw samples. Frame count stays.
    #[napi]
    pub fn reset_debug_frame_overlay_stats(&self) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| {
                window.reset_debug_frame_overlay_stats();
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(())
        })
    }

    /// Same numbers as the on-screen overlay: current, p90, p99, max, frames.
    #[napi]
    pub fn get_debug_frame_overlay_stats(&self) -> Result<DebugFrameOverlayStats> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, _app| {
                debug_frame_overlay_stats_js(window.debug_frame_overlay_stats())
            })
            .map_err(|e| Error::from_reason(e.to_string()))
        })
    }

    /// Get the current scroll offset of a scrollable element.
    /// Returns [x, y] or null if the element has no scroll handle.
    #[napi]
    pub fn get_scroll_offset(&self, element_id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(element_id)?;
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let result = cx
                .update_window(window, |_, _window, app| {
                    view.update(app, |view, _cx| {
                        if let Some(offset) = view.virtual_list_offset(id) {
                            return Some(offset.to_vec());
                        }
                        view.scroll_handles.get(&id).map(|handle| {
                            let offset = handle.offset();
                            vec![
                                f64::from(f32::from(offset.x)),
                                f64::from(f32::from(offset.y)),
                            ]
                        })
                    })
                })
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(result)
        })
    }

    /// Capture a screenshot of the current rendered state and save as PNG.
    /// Supported on macOS through Metal and Windows through DirectX.
    #[napi]
    pub fn capture_screenshot(&self, path: String) -> Result<()> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();

            // Flush: notify view and run until parked so layout/rendering are current.
            cx.update_window(window, |_, _window, app| {
                view.update(app, |_, cx| {
                    cx.notify();
                });
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;

            // Force a window refresh before capture so render_to_image reads
            // the most recent frame scene.
            cx.update_window(window, |_, window, _app| {
                window.refresh();
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;

            cx.run_until_parked();

            // Capture via the platform renderer's render_to_image implementation.
            let image = cx
                .capture_screenshot(window)
                .map_err(|e| Error::from_reason(format!("Screenshot capture failed: {}", e)))?;

            // Save as PNG (format inferred from file extension).
            image
                .save(&path)
                .map_err(|e| Error::from_reason(format!("Failed to save screenshot: {}", e)))?;

            Ok(())
        })
    }

    /// Return and clear all collected events since the last drain.
    /// Events are collected synchronously — no event loop queuing.
    #[napi]
    pub fn drain_events(&self) -> Vec<EventPayload> {
        let mut events = self.events.lock().unwrap();
        events.drain(..).collect()
    }

    // ── Tree inspection ──────────────────────────────────────────────

    /// Get all text content in the tree (depth-first order).
    #[napi]
    pub fn get_all_text(&self) -> Vec<String> {
        let tree = self.tree.lock().unwrap();
        let mut texts = Vec::new();
        if let Some(root_id) = tree.root_id {
            Self::collect_text(root_id, &tree, &mut texts);
        }
        texts
    }

    /// Find element IDs matching the given type (e.g. "div", "text").
    #[napi]
    pub fn find_by_type(&self, element_type: String) -> Vec<f64> {
        let tree = self.tree.lock().unwrap();
        tree.elements
            .values()
            .filter(|e| e.element_type == element_type)
            .map(|e| e.id as f64)
            .collect()
    }

    /// Resolve an author-defined `id` attribute to the renderer element ID.
    #[napi]
    pub fn find_by_element_id(&self, author_id: String) -> Option<f64> {
        self.tree
            .lock()
            .unwrap()
            .find_by_element_id(&author_id)
            .map(|id| id as f64)
    }

    /// Resolve a standard `data-testid` attribute to the renderer element ID.
    #[napi]
    pub fn find_by_data_test_id(&self, data_test_id: String) -> Option<f64> {
        self.tree
            .lock()
            .unwrap()
            .find_by_data_test_id(&data_test_id)
            .map(|id| id as f64)
    }

    /// Check if an element has a specific event listener.
    #[napi]
    pub fn has_event_listener(&self, id: f64, event_type: String) -> Result<bool> {
        let id = to_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        Ok(tree
            .elements
            .get(&id)
            .map(|e| e.events.contains(&event_type))
            .unwrap_or(false))
    }

    /// Get the text content of an element.
    #[napi]
    pub fn get_text(&self, id: f64) -> Result<Option<String>> {
        let id = to_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        Ok(tree.elements.get(&id).and_then(|e| e.content.clone()))
    }

    /// Get the full tree as JSON for snapshot testing.
    #[napi]
    pub fn get_tree_json(&self) -> Result<String> {
        let tree = self.tree.lock().unwrap();
        let json = tree.to_json(&std::collections::HashMap::new());
        serde_json::to_string_pretty(&json)
            .map_err(|e| Error::from_reason(format!("JSON serialization failed: {}", e)))
    }

    /// Return the declared descriptor with currently applied state refinements
    /// overlaid in the same order GPUI resolves them for painting.
    #[napi]
    pub fn get_resolved_style(&self, id: f64) -> Result<Option<String>> {
        let id = to_element_id(id)?;
        let (style, hover_group_id, hover_group_accepts_pointer) = {
            let tree = self.tree.lock().unwrap();
            let Some(element) = tree.elements.get(&id) else {
                return Ok(None);
            };
            let hover_group_id = nearest_hover_group(&tree, id);
            let hover_group_accepts_pointer = hover_group_id.is_some_and(|group_id| {
                tree.elements
                    .get(&group_id)
                    .and_then(|group| group.style.as_ref())
                    .and_then(|style| style.pointer_events.as_deref())
                    != Some("none")
            });
            (
                element.style.clone().unwrap_or_default(),
                hover_group_id,
                hover_group_accepts_pointer,
            )
        };

        self.flush()?;
        let element_bounds = crate::automation::get_bounds(id);
        let hover_group_bounds = hover_group_id.and_then(crate::automation::get_bounds);
        let active_pointer_origin = *self.active_pointer_origin.lock().unwrap();

        let (pointer, focus, keyboard_input, transitioned_style) =
            with_test_state(self.state_id, |cx, window, view| {
                let view = view.clone();
                cx.update_window(window, |_, window, app| {
                    let mouse = window.mouse_position();
                    let reduce_motion = app.reduce_motion();
                    let view = view.read(app);
                    let focus = view
                        .focus_handles
                        .get(&id)
                        .is_some_and(|handle| handle.is_focused(window));
                    let keyboard = window.last_input_was_keyboard();
                    let transitioned_style = view
                        .transition_states
                        .get(&id)
                        .map(|state| state.frame(view.clock.now(), reduce_motion).style);
                    (
                        (f64::from(f32::from(mouse.x)), f64::from(f32::from(mouse.y))),
                        focus,
                        keyboard,
                        transitioned_style,
                    )
                })
                .map_err(|error| Error::from_reason(error.to_string()))
            })?;

        let accepts_pointer = style.pointer_events.as_deref() != Some("none");
        let hovered = accepts_pointer
            && !keyboard_input
            && element_bounds.is_some_and(|bounds| point_is_inside(bounds, pointer));
        let hover_within = hover_group_accepts_pointer
            && !keyboard_input
            && hover_group_bounds.is_some_and(|bounds| point_is_inside(bounds, pointer));
        let active = accepts_pointer
            && active_pointer_origin.is_some_and(|origin| {
                element_bounds.is_some_and(|bounds| point_is_inside(bounds, origin))
            });

        let effective_style = transitioned_style.as_ref().unwrap_or(&style);
        let mut resolved = style_object(effective_style)?;
        if focus {
            refine_style_object(&mut resolved, effective_style.focus.as_deref())?;
        }
        if focus && keyboard_input {
            refine_style_object(&mut resolved, effective_style.focus_visible.as_deref())?;
        }
        if hover_within {
            refine_style_object(&mut resolved, effective_style.hover_within.as_deref())?;
        }
        if hovered {
            refine_style_object(&mut resolved, effective_style.hover.as_deref())?;
        }
        if active {
            refine_style_object(&mut resolved, effective_style.active.as_deref())?;
        }

        serde_json::to_string(&resolved)
            .map(Some)
            .map_err(|error| Error::from_reason(format!("Style serialization failed: {error}")))
    }

    /// Return the current async image load state for a live `<img>` element.
    /// This is test-only state; production images keep their loading fallback.
    #[napi]
    pub fn get_image_load_state(&self, id: f64) -> Result<Option<String>> {
        let id = to_element_id(id)?;
        self.flush()?;
        let state = with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            cx.update_window(window, |_, _window, app| {
                view.read(app).custom_registry.test_state(id)
            })
            .map_err(|error| Error::from_reason(error.to_string()))
        })?;
        state
            .map(|state| serde_json::to_string(&state))
            .transpose()
            .map_err(|error| {
                Error::from_reason(format!("Image state serialization failed: {error}"))
            })
    }

    /// Tree JSON with last-paint bounds. Used by the automation locators.
    #[napi]
    pub fn get_automation_tree(&self) -> Result<String> {
        self.flush()?;
        let tree = self.tree.lock().unwrap();
        let json = tree.to_automation_json(&crate::automation::all_bounds());
        serde_json::to_string(&json)
            .map_err(|e| Error::from_reason(format!("JSON serialization failed: {}", e)))
    }

    /// Last painted bounds for an element, or null if it was not painted.
    #[napi]
    pub fn get_element_bounds(&self, id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(id)?;
        self.flush()?;
        Ok(crate::automation::get_bounds(id)
            .map(|bounds| vec![bounds.x, bounds.y, bounds.width, bounds.height]))
    }

    #[napi]
    pub fn clock_pause(&self) -> Result<f64> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let now_ms = cx
                .update_window(window, |_, _window, app| {
                    view.update(app, |view, cx| {
                        let now_ms = view.clock.pause();
                        cx.notify();
                        now_ms
                    })
                })
                .map_err(|e| Error::from_reason(e.to_string()))?;
            cx.run_until_parked();
            Ok(now_ms)
        })
    }

    #[napi]
    pub fn clock_set(&self, now_ms: f64) -> Result<f64> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let now_ms = cx
                .update_window(window, |_, _window, app| {
                    view.update(app, |view, cx| {
                        let now_ms = view.clock.set_ms(now_ms);
                        cx.notify();
                        now_ms
                    })
                })
                .map_err(|e| Error::from_reason(e.to_string()))?;
            cx.run_until_parked();
            Ok(now_ms)
        })
    }

    #[napi]
    pub fn clock_fast_forward(&self, delta_ms: f64) -> Result<f64> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let now_ms = cx
                .update_window(window, |_, _window, app| {
                    view.update(app, |view, cx| {
                        let now_ms = view.clock.fast_forward_ms(delta_ms);
                        cx.notify();
                        now_ms
                    })
                })
                .map_err(|e| Error::from_reason(e.to_string()))?;
            cx.run_until_parked();
            Ok(now_ms)
        })
    }

    #[napi]
    pub fn clock_resume(&self) -> Result<f64> {
        with_test_state(self.state_id, |cx, window, view| {
            let view = view.clone();
            let now_ms = cx
                .update_window(window, |_, _window, app| {
                    view.update(app, |view, cx| {
                        let now_ms = view.clock.resume();
                        cx.notify();
                        now_ms
                    })
                })
                .map_err(|e| Error::from_reason(e.to_string()))?;
            cx.run_until_parked();
            Ok(now_ms)
        })
    }

    /// Get the root element ID, or null if no root is set.
    #[napi]
    pub fn get_root_id(&self) -> Option<f64> {
        self.tree.lock().unwrap().root_id.map(|id| id as f64)
    }

    // ── Private helpers ──────────────────────────────────────────────

    fn collect_text(id: u64, tree: &RetainedTree, texts: &mut Vec<String>) {
        if let Some(element) = tree.elements.get(&id) {
            if let Some(ref content) = element.content {
                texts.push(content.clone());
            }
            for &child_id in &element.children {
                Self::collect_text(child_id, tree, texts);
            }
        }
    }
}

impl Drop for TestGpuixRenderer {
    fn drop(&mut self) {
        dispose_test_state(self.state_id);
    }
}
