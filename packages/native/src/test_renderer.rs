/// TestGpuixRenderer — GPU-backed GPUI test renderer exposed to Node.js via napi.
///
/// Uses gpui::VisualTestAppContext with a deterministic virtual display,
/// real Metal rendering on macOS, and TestDispatcher scheduling. Runs the
/// SAME GpuixView, build_element(), apply_styles(), and event handlers as
/// production without consulting the host display list.
///
/// Windows are positioned offscreen at (-10000, -10000) — invisible but
/// fully rendered by Metal. This enables capture_screenshot() for visual
/// test validation.
///
/// VisualTestAppContext is !Send, so it is stored in thread-local state.
/// All napi calls happen on the JS main thread.
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use gpui::AppContext as _;

use crate::element_tree::EventPayload;
use crate::renderer::{
    apply_batch_to_tree, catch_gpui_initialization, debug_frame_overlay_mode_name,
    debug_frame_overlay_stats_js, default_application_menus, default_http_client,
    dispatch_application_menu_action, drain_style_diagnostics, has_application_menus,
    init_application_menu_support, parse_debug_frame_overlay_mode, parse_style_json,
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

/// GPU-backed GPUI test renderer. Uses VisualTestAppContext (real Metal
/// rendering on macOS) with TestDispatcher for deterministic scheduling.
/// Same GpuixView and rendering pipeline as production.
///
/// Usage from JS:
///   const r = new TestGpuixRenderer()
///   r.createElement(1, "div")
///   r.setRoot(1)
///   r.commitMutations()
///   r.flush()                  // triggers GpuixView::render() via Metal
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
    pub fn new() -> Result<Self> {
        catch_gpui_initialization("GPUI test renderer initialization", Self::try_new)
    }

    fn try_new() -> Result<Self> {
        let state_id = NEXT_TEST_STATE_ID.fetch_add(1, Ordering::Relaxed);
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

        // Create VisualTestAppContext with real macOS Metal rendering +
        // TestDispatcher for deterministic scheduling.
        let mac_platform = gpui_macos::MacPlatform::new(false);
        let mut cx = gpui::VisualTestAppContext::new(Rc::new(mac_platform));
        cx.update(|cx| {
            cx.set_http_client(default_http_client());
            crate::renderer::init_key_bindings(cx);
            crate::custom_elements::input::init(cx);
            init_application_menu_support(cx, event_callback.clone());
            set_application_menus(cx, default_application_menus("GPUIX Test"))
                .expect("default test menu is valid");
        });

        // Open an offscreen window at (-10000, -10000) — invisible but fully
        // rendered by Metal. Uses the same GpuixView as production.
        let window_handle = cx
            .open_offscreen_window_default(|_window, app| {
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
        self.tree.lock().unwrap().set_style(id, parsed.style);
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
        let ops: Vec<serde_json::Value> = serde_json::from_str(&json)
            .map_err(|e| Error::from_reason(format!("Failed to parse batch: {}", e)))?;
        let mut tree = self.tree.lock().unwrap();
        let outcome = apply_batch_to_tree(&mut tree, &ops).map_err(Error::from_reason)?;
        drop(tree);
        if self.strict_styles.load(Ordering::Relaxed) {
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
    /// timers such as bounded image retry/revalidation deadlines.
    #[napi]
    pub fn advance_async_clock(&self, delta_ms: f64) -> Result<()> {
        if !delta_ms.is_finite() || delta_ms < 0.0 {
            return Err(Error::from_reason(
                "advanceAsyncClock delta must be a finite non-negative number",
            ));
        }
        with_test_state(self.state_id, |cx, _window, _view| {
            cx.advance_clock(std::time::Duration::from_secs_f64(delta_ms / 1000.0));
            cx.run_until_parked();
            Ok(())
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
    #[napi]
    pub fn simulate_click(&self, x: f64, y: f64) -> Result<()> {
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_click(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                gpui::Modifiers::default(),
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
            cx.simulate_keystrokes(window, &keystrokes);
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
    pub fn simulate_mouse_move(&self, x: f64, y: f64, pressed_button: Option<u32>) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            let button: Option<gpui::MouseButton> = pressed_button.map(u32_to_mouse_button);

            cx.simulate_mouse_move(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                button,
                gpui::Modifiers::default(),
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

    /// Simulate the platform deactivating the test window.
    #[napi]
    pub fn simulate_window_deactivation(&self) -> Result<()> {
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.update_window(window, |_, window, app| {
                window.simulate_active_status_change(false, app);
            })
            .map_err(|error| Error::from_reason(error.to_string()))?;
            cx.run_until_parked();
            Ok(())
        });
        *self.active_pointer_origin.lock().unwrap() = None;
        result
    }

    /// Simulate a mouse down event at the given window coordinates.
    /// Button: 0=left, 1=middle, 2=right. Defaults to left (0).
    #[napi]
    pub fn simulate_mouse_down(&self, x: f64, y: f64, button: Option<u32>) -> Result<()> {
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_mouse_down(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                u32_to_mouse_button(button.unwrap_or(0)),
                gpui::Modifiers::default(),
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
    pub fn simulate_mouse_up(&self, x: f64, y: f64, button: Option<u32>) -> Result<()> {
        let result = with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_mouse_up(
                window,
                gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                u32_to_mouse_button(button.unwrap_or(0)),
                gpui::Modifiers::default(),
            );
            Ok(())
        });
        *self.active_pointer_origin.lock().unwrap() = None;
        result
    }

    /// Simulate a scroll wheel event at the given position.
    /// delta_x and delta_y are in pixels (negative = scroll up/left).
    #[napi]
    pub fn simulate_scroll_wheel(&self, x: f64, y: f64, delta_x: f64, delta_y: f64) -> Result<()> {
        with_test_state(self.state_id, |cx, window, _view| {
            cx.simulate_event(
                window,
                gpui::ScrollWheelEvent {
                    position: gpui::point(gpui::px(x as f32), gpui::px(y as f32)),
                    delta: gpui::ScrollDelta::Pixels(gpui::point(
                        gpui::px(delta_x as f32),
                        gpui::px(delta_y as f32),
                    )),
                    modifiers: gpui::Modifiers::default(),
                    touch_phase: gpui::TouchPhase::Moved,
                },
            );
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

    /// Drag-select from one point to another: mouse down, move, up.
    ///
    /// A single helper rather than three calls because the listeners that drive
    /// selection are registered during **paint**, so a flush must sit between
    /// the down and the move. Getting that order wrong silently selects nothing,
    /// which is a miserable thing to debug from JS.
    #[napi]
    pub fn drag_select(&self, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<()> {
        self.flush()?;
        self.simulate_mouse_down(x1, y1, None)?;
        self.flush()?;
        self.simulate_mouse_move(x2, y2, Some(0))?;
        self.flush()?;
        self.simulate_mouse_up(x2, y2, None)?;
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
    /// macOS only — requires Metal GPU rendering via VisualTestAppContext.
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

            // Capture via GPUI's render_to_image (Metal texture → RgbaImage).
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

        let (pointer, focus, keyboard_input) =
            with_test_state(self.state_id, |cx, window, view| {
                let view = view.clone();
                cx.update_window(window, |_, window, app| {
                    let mouse = window.mouse_position();
                    let focus = view
                        .read(app)
                        .focus_handles
                        .get(&id)
                        .is_some_and(|handle| handle.is_focused(window));
                    let keyboard = window.last_input_was_keyboard();
                    (
                        (f64::from(f32::from(mouse.x)), f64::from(f32::from(mouse.y))),
                        focus,
                        keyboard,
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

        let mut resolved = style_object(&style)?;
        if focus {
            refine_style_object(&mut resolved, style.focus.as_deref())?;
        }
        if focus && keyboard_input {
            refine_style_object(&mut resolved, style.focus_visible.as_deref())?;
        }
        if hover_within {
            refine_style_object(&mut resolved, style.hover_within.as_deref())?;
        }
        if hovered {
            refine_style_object(&mut resolved, style.hover.as_deref())?;
        }
        if active {
            refine_style_object(&mut resolved, style.active.as_deref())?;
        }

        serde_json::to_string(&resolved)
            .map(Some)
            .map_err(|error| Error::from_reason(format!("Style serialization failed: {error}")))
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
