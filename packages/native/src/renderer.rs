//! GPUIX retained renderer for napi desktop hosts and GPUI's browser platform.
//!
//! Mutation-based API: React's reconciler sends individual mutations
//! (createElement, appendChild, setStyle, etc.) instead of a full JSON tree.
//! Rust maintains a RetainedTree and rebuilds GPUI elements from it each frame.
//!
//! Desktop lifecycle:
//!   const renderer = new GpuixRenderer(eventCallback)
//!   renderer.init({ title: 'My App', width: 800, height: 600 })
//!   renderer.createElement(1, "div")     // mutations from React reconciler
//!   renderer.appendChild(0, 1)
//!   renderer.commitMutations()           // signal batch complete
//!   setTimeout(function loop() {         // drive AppKit on macOS
//!     if (!renderer.tick()) onTerminated()
//!     setTimeout(loop, 8)
//!   })
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use futures::{channel::mpsc, StreamExt as _};
use gpui::AppContext as _;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi::bindgen_prelude::*;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use std::time::Duration;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
use wasm_bindgen::JsCast as _;

use crate::custom_elements::{CustomElementRegistry, CustomRenderContext};
use crate::element_tree::EventPayload;
use crate::retained_tree::RetainedTree;
use crate::style::{
    GridTemplateValue, GridTrackMaxValue, GridTrackMinValue, GridTrackValue, ParsedStyle,
    StyleDesc, StyleProblem,
};
use crate::text::{selectable_text, selection_frame_reset, selection_key, SharedSelection};
use crate::theme::Theme;

#[derive(Debug, Clone)]
pub(crate) struct PendingStyleDiagnostic {
    element_id: u64,
    problem: StyleProblem,
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Debug, Clone)]
#[napi(object)]
pub struct GpuixStyleDiagnostic {
    pub message: String,
    pub element_id: f64,
    pub element_type: String,
    pub test_id: Option<String>,
    pub property: String,
    pub value: String,
}

pub(crate) fn parse_style_json(style_json: &str) -> ParsedStyle {
    match serde_json::from_str(style_json) {
        Ok(value) => crate::style::parse_style_value(&value),
        Err(error) => ParsedStyle {
            style: StyleDesc::default(),
            problems: vec![StyleProblem {
                property: "<style>".into(),
                value: serde_json::to_string(style_json)
                    .unwrap_or_else(|_| format!("{style_json:?}")),
                reason: format!("invalid style JSON: {error}"),
            }],
        },
    }
}

pub(crate) fn pending_style_diagnostics(
    element_id: u64,
    problems: Vec<StyleProblem>,
) -> impl Iterator<Item = PendingStyleDiagnostic> {
    problems
        .into_iter()
        .map(move |problem| PendingStyleDiagnostic {
            element_id,
            problem,
        })
}

fn style_diagnostic_context(
    diagnostic: &PendingStyleDiagnostic,
    tree: &RetainedTree,
) -> (String, String, Option<String>) {
    let element = tree.elements.get(&diagnostic.element_id);
    let element_type = element
        .map(|element| element.element_type.clone())
        .unwrap_or_else(|| "unknown".into());
    let test_id = element.and_then(|element| element.test_id.clone());
    let test_id_label = test_id
        .as_ref()
        .map(|test_id| format!(" testId={test_id:?}"))
        .unwrap_or_default();
    let message = format!(
        "[gpuix] Invalid style on <{element_type}{test_id_label}> (element {}): property {:?} rejected value {}: {}",
        diagnostic.element_id,
        diagnostic.problem.property,
        diagnostic.problem.value,
        diagnostic.problem.reason,
    );
    (message, element_type, test_id)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn drain_style_diagnostics(
    pending: &Mutex<Vec<PendingStyleDiagnostic>>,
    tree: &Mutex<RetainedTree>,
) -> Vec<GpuixStyleDiagnostic> {
    let pending = std::mem::take(&mut *pending.lock().unwrap());
    let tree = tree.lock().unwrap();
    pending
        .into_iter()
        .map(|diagnostic| {
            let (message, element_type, test_id) = style_diagnostic_context(&diagnostic, &tree);
            GpuixStyleDiagnostic {
                message,
                element_id: diagnostic.element_id as f64,
                element_type,
                test_id,
                property: diagnostic.problem.property,
                value: diagnostic.problem.value,
            }
        })
        .collect()
}

gpui::actions!(gpuix_focus, [FocusNext, FocusPrevious]);

#[derive(Clone, Debug, PartialEq, Eq, gpui::Action)]
#[action(namespace = gpuix, no_json)]
struct ApplicationMenuAction {
    generation: u64,
    instance: u64,
    id: Option<String>,
    quit: bool,
}

#[derive(Default)]
struct ApplicationMenuState {
    generation: u64,
    actions_by_id: HashMap<String, ApplicationMenuAction>,
    installed_menu_count: usize,
}

impl gpui::Global for ApplicationMenuState {}

/// One top-level application menu.
#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct MenuSpec {
    pub name: String,
    pub items: Vec<MenuItemSpec>,
    pub disabled: Option<bool>,
}

/// A cross-platform application menu item.
///
/// `kind` is `"action"`, `"separator"`, `"submenu"`, or `"system"`.
/// Action items require `label` and `id`; use `role: "quit"` for the
/// platform quit action. System items currently support `systemMenu:
/// "services"`.
#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct MenuItemSpec {
    pub kind: String,
    pub label: Option<String>,
    pub id: Option<String>,
    pub items: Option<Vec<MenuItemSpec>>,
    pub disabled: Option<bool>,
    pub checked: Option<bool>,
    pub key_equivalent: Option<String>,
    pub role: Option<String>,
    pub system_menu: Option<String>,
    pub os_action: Option<String>,
}

struct ApplicationMenuBuilder {
    generation: u64,
    next_instance: u64,
    actions_by_id: HashMap<String, ApplicationMenuAction>,
    bindings: Vec<gpui::KeyBinding>,
}

impl ApplicationMenuBuilder {
    fn new(generation: u64) -> Self {
        Self {
            generation,
            next_instance: 0,
            actions_by_id: HashMap::new(),
            bindings: Vec::new(),
        }
    }

    fn menu(&mut self, spec: MenuSpec) -> std::result::Result<gpui::Menu, String> {
        let items = spec
            .items
            .into_iter()
            .map(|item| self.item(item))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(gpui::Menu::new(spec.name)
            .items(items)
            .disabled(spec.disabled.unwrap_or(false)))
    }

    fn item(&mut self, spec: MenuItemSpec) -> std::result::Result<gpui::MenuItem, String> {
        match spec.kind.as_str() {
            "separator" => Ok(gpui::MenuItem::separator()),
            "submenu" => {
                let label = required_menu_field(spec.label, "submenu", "label")?;
                let items = spec.items.unwrap_or_default();
                let submenu = self.menu(MenuSpec {
                    name: label,
                    items,
                    disabled: spec.disabled,
                })?;
                Ok(gpui::MenuItem::submenu(submenu))
            }
            "system" => {
                let label = required_menu_field(spec.label, "system", "label")?;
                match spec.system_menu.as_deref() {
                    Some("services") => Ok(gpui::MenuItem::os_submenu(
                        label,
                        gpui::SystemMenuType::Services,
                    )),
                    Some(value) => Err(format!(
                        "Unknown system menu {value:?}. The supported value is \"services\"."
                    )),
                    None => Err("A system menu item requires systemMenu".to_string()),
                }
            }
            "action" => self.action(spec),
            value => Err(format!(
                "Unknown menu item kind {value:?}. Use action, separator, submenu, or system."
            )),
        }
    }

    fn action(&mut self, spec: MenuItemSpec) -> std::result::Result<gpui::MenuItem, String> {
        let label = required_menu_field(spec.label, "action", "label")?;
        let quit = match spec.role.as_deref() {
            None => false,
            Some("quit") => true,
            Some(value) => {
                return Err(format!(
                    "Unknown menu action role {value:?}. The supported role is \"quit\"."
                ));
            }
        };
        if !quit && spec.id.is_none() {
            return Err("A menu action requires id unless role is \"quit\"".to_string());
        }

        self.next_instance += 1;
        let action = ApplicationMenuAction {
            generation: self.generation,
            instance: self.next_instance,
            id: spec.id.clone(),
            quit,
        };

        if let Some(id) = spec.id {
            if id.is_empty() {
                return Err("A menu action id cannot be empty".to_string());
            }
            if self
                .actions_by_id
                .insert(id.clone(), action.clone())
                .is_some()
            {
                return Err(format!("Duplicate menu action id {id:?}"));
            }
        }

        let key_equivalent = spec
            .key_equivalent
            .or_else(|| quit.then(|| "cmd-q".to_string()));
        if let Some(key_equivalent) = key_equivalent {
            validate_menu_key_equivalent(&key_equivalent)?;
            self.bindings
                .push(gpui::KeyBinding::new(&key_equivalent, action.clone(), None));
        }

        let item = match spec.os_action.as_deref() {
            Some(value) => gpui::MenuItem::os_action(label, action, parse_menu_os_action(value)?),
            None => gpui::MenuItem::action(label, action),
        };
        Ok(item
            .checked(spec.checked.unwrap_or(false))
            .disabled(spec.disabled.unwrap_or(false)))
    }
}

fn required_menu_field(
    value: Option<String>,
    kind: &str,
    field: &str,
) -> std::result::Result<String, String> {
    value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("A {kind} menu item requires {field}"))
}

fn validate_menu_key_equivalent(value: &str) -> std::result::Result<(), String> {
    if value.split_whitespace().count() != 1 {
        return Err(format!(
            "Menu key equivalent {value:?} must contain exactly one keystroke"
        ));
    }
    gpui::Keystroke::parse(value)
        .map(|_| ())
        .map_err(|error| format!("Invalid menu key equivalent {value:?}: {error}"))
}

fn parse_menu_os_action(value: &str) -> std::result::Result<gpui::OsAction, String> {
    match value {
        "cut" => Ok(gpui::OsAction::Cut),
        "copy" => Ok(gpui::OsAction::Copy),
        "paste" => Ok(gpui::OsAction::Paste),
        "selectAll" => Ok(gpui::OsAction::SelectAll),
        "undo" => Ok(gpui::OsAction::Undo),
        "redo" => Ok(gpui::OsAction::Redo),
        _ => Err(format!(
            "Unknown menu OS action {value:?}. Use cut, copy, paste, selectAll, undo, or redo."
        )),
    }
}

pub(crate) fn default_application_menus(title: &str) -> Vec<MenuSpec> {
    vec![MenuSpec {
        name: title.to_string(),
        disabled: None,
        items: vec![MenuItemSpec {
            kind: "action".to_string(),
            label: Some(format!("Quit {title}")),
            id: None,
            items: None,
            disabled: None,
            checked: None,
            key_equivalent: Some("cmd-q".to_string()),
            role: Some("quit".to_string()),
            system_menu: None,
            os_action: None,
        }],
    }]
}

fn emit_application_event(
    callback: &Option<EventCallback>,
    event_type: &str,
    value: Option<String>,
) {
    if let Some(callback) = callback {
        callback(EventPayload {
            event_type: event_type.to_string(),
            value,
            ..EventPayload::default()
        });
    }
}

pub(crate) fn init_application_menu_support(cx: &mut gpui::App, callback: Option<EventCallback>) {
    cx.set_global(ApplicationMenuState::default());
    cx.on_action(move |action: &ApplicationMenuAction, cx| {
        let active = cx.global::<ApplicationMenuState>().generation == action.generation;
        if !active {
            return;
        }
        if let Some(id) = action.id.clone() {
            emit_application_event(&callback, "menuAction", Some(id));
        }
        if action.quit {
            cx.quit();
        }
    });
}

pub(crate) fn set_application_menus(
    cx: &mut gpui::App,
    specs: Vec<MenuSpec>,
) -> std::result::Result<(), String> {
    let generation = cx
        .global::<ApplicationMenuState>()
        .generation
        .wrapping_add(1);
    let mut builder = ApplicationMenuBuilder::new(generation);
    let menus = specs
        .into_iter()
        .map(|menu| builder.menu(menu))
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let state = cx.global_mut::<ApplicationMenuState>();
    state.generation = generation;
    state.actions_by_id = builder.actions_by_id;
    state.installed_menu_count = menus.len();
    cx.bind_keys(builder.bindings);
    cx.set_menus(menus);
    Ok(())
}

pub(crate) fn has_application_menus(cx: &gpui::App) -> bool {
    cx.global::<ApplicationMenuState>().installed_menu_count > 0
}

pub(crate) fn dispatch_application_menu_action(
    cx: &mut gpui::App,
    id: &str,
) -> std::result::Result<(), String> {
    let action = cx
        .global::<ApplicationMenuState>()
        .actions_by_id
        .get(id)
        .cloned()
        .ok_or_else(|| format!("Unknown menu action id {id:?}"))?;
    cx.dispatch_action(&action);
    Ok(())
}

pub(crate) fn init_key_bindings(cx: &mut gpui::App) {
    cx.bind_keys([
        gpui::KeyBinding::new("tab", FocusNext, None),
        gpui::KeyBinding::new("shift-tab", FocusPrevious, None),
    ]);
}

/// Parse a CSS font-weight value (string or number) into a GPUI FontWeight.
/// Accepts named keywords ("bold", "semibold"), numeric strings ("700"),
/// and raw numbers (700). Falls back to 400 (normal) for unrecognized values.
fn parse_font_weight(value: &crate::style::FontWeightValue) -> gpui::FontWeight {
    match value {
        crate::style::FontWeightValue::Num(n) => gpui::FontWeight((*n as f32).clamp(1.0, 1000.0)),
        crate::style::FontWeightValue::Str(s) => {
            let lower = s.trim().to_ascii_lowercase();
            match lower.as_str() {
                "100" | "thin" => gpui::FontWeight(100.0),
                "200" | "extralight" | "extra-light" => gpui::FontWeight(200.0),
                "300" | "light" => gpui::FontWeight(300.0),
                "400" | "normal" => gpui::FontWeight(400.0),
                "500" | "medium" => gpui::FontWeight(500.0),
                "600" | "semibold" | "semi-bold" => gpui::FontWeight(600.0),
                "700" | "bold" => gpui::FontWeight(700.0),
                "800" | "extrabold" | "extra-bold" => gpui::FontWeight(800.0),
                "900" | "black" => gpui::FontWeight(900.0),
                _ => lower
                    .parse::<f32>()
                    .map(|n| gpui::FontWeight(n.clamp(1.0, 1000.0)))
                    .unwrap_or(gpui::FontWeight(400.0)),
            }
        }
    }
}

/// Abstracted event callback shared by desktop, browser, and test renderers.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) type EventCallback = Arc<dyn Fn(EventPayload) + Send + Sync>;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub(crate) type EventCallback = Rc<dyn Fn(EventPayload)>;

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
type WindowEventCallback = Arc<Mutex<Option<EventCallback>>>;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
type WindowEventCallback = Rc<RefCell<Option<EventCallback>>>;

/// Validate and convert a JS number (f64) to a u64 element ID.
/// JS numbers are f64 — lossless for integers up to 2^53.
fn raw_element_id(id: f64) -> std::result::Result<u64, String> {
    if !id.is_finite() || id < 0.0 || id.fract() != 0.0 || id > 9_007_199_254_740_991.0 {
        return Err(format!("Invalid element id: {id}"));
    }
    Ok(id as u64)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn to_element_id(id: f64) -> Result<u64> {
    raw_element_id(id).map_err(Error::from_reason)
}

thread_local! {
    #[cfg(target_os = "macos")]
    static MAC_PLATFORM: RefCell<Option<Rc<gpui_macos::MacPlatform>>> = const { RefCell::new(None) };
    #[cfg(target_os = "macos")]
    static GPUI_APP: RefCell<Option<gpui::ApplicationHandle>> = const { RefCell::new(None) };
    #[cfg(target_os = "macos")]
    static GPUI_WINDOW: RefCell<Option<gpui::WindowHandle<GpuixView>>> = const { RefCell::new(None) };
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    static WEB_APP: RefCell<Option<gpui::ApplicationHandle>> = const { RefCell::new(None) };
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    static WEB_WINDOW: RefCell<Option<gpui::WindowHandle<GpuixView>>> = const { RefCell::new(None) };
    /// Shared scroll handles — GpuixView writes here during render(),
    /// platform-local handlers read from here for programmatic scroll control.
    /// ScrollHandle is Rc<RefCell<...>> so its methods (set_offset, offset,
    /// scroll_to_item) work without an App context.
    ///
    /// NOTE: This is a singleton — if multiple renderers/windows coexist,
    /// the last one to render wins. Acceptable for now (single-window only).
    /// TODO: Scope by renderer/window ID when multi-window support is added.
    static SCROLL_HANDLES: RefCell<HashMap<u64, gpui::ScrollHandle>> = RefCell::new(HashMap::new());
    static VIRTUAL_LIST_STATES: RefCell<HashMap<u64, gpui::ListState>> = RefCell::new(HashMap::new());
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn parse_debug_frame_overlay_mode(mode: &str) -> Result<gpui::DebugFrameOverlayMode> {
    match mode {
        "hidden" => Ok(gpui::DebugFrameOverlayMode::Hidden),
        "minimal" => Ok(gpui::DebugFrameOverlayMode::Minimal),
        "full" => Ok(gpui::DebugFrameOverlayMode::Full),
        other => Err(Error::from_reason(format!(
            "Unknown debug frame overlay mode {other:?}. Use hidden, minimal, or full."
        ))),
    }
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn debug_frame_overlay_mode_name(mode: gpui::DebugFrameOverlayMode) -> &'static str {
    match mode {
        gpui::DebugFrameOverlayMode::Hidden => "hidden",
        gpui::DebugFrameOverlayMode::Minimal => "minimal",
        gpui::DebugFrameOverlayMode::Full => "full",
    }
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn debug_frame_overlay_stats_js(
    stats: gpui::DebugFrameOverlayStats,
) -> DebugFrameOverlayStats {
    DebugFrameOverlayStats {
        current_ms: stats.current_ms.map(|ms| ms as f64),
        p90_ms: stats.p90_ms.map(|ms| ms as f64),
        p99_ms: stats.p99_ms.map(|ms| ms as f64),
        max_ms: stats.max_ms.map(|ms| ms as f64),
        frames: stats.frames as f64,
        samples: stats.samples as f64,
    }
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
fn recv_ui_response<T>(receiver: std::sync::mpsc::Receiver<T>, operation: &str) -> Result<T> {
    match receiver.recv_timeout(Duration::from_secs(2)) {
        Ok(response) => Ok(response),
        Err(RecvTimeoutError::Timeout) => Err(Error::from_reason(format!(
            "Timed out after 2 seconds waiting for {operation}"
        ))),
        Err(RecvTimeoutError::Disconnected) => Err(Error::from_reason(format!(
            "The GPUI UI thread stopped during {operation}"
        ))),
    }
}

#[cfg(target_os = "macos")]
fn update_window<R>(
    update: impl FnOnce(&mut GpuixView, &mut gpui::Window, &mut gpui::Context<GpuixView>) -> R,
) -> Result<R> {
    let window = GPUI_WINDOW
        .with(|window| *window.borrow())
        .ok_or_else(|| Error::from_reason("GPUI window is not initialized"))?;

    GPUI_APP.with(|app| {
        let app = app.borrow();
        let app = app
            .as_ref()
            .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?;
        app.update(|cx| {
            window
                .update(cx, update)
                .map_err(|error| Error::from_reason(error.to_string()))
        })
    })
}

#[cfg(target_os = "macos")]
fn invalidate_window() -> Result<()> {
    update_window(|_view, window, cx| {
        cx.notify();
        window.refresh();
    })
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
enum MouseInput {
    Click {
        x: f64,
        y: f64,
        button: u32,
    },
    Down {
        x: f64,
        y: f64,
        button: u32,
    },
    Up {
        x: f64,
        y: f64,
        button: u32,
    },
    Move {
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
    },
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
enum ClockControl {
    Pause,
    Set(f64),
    FastForward(f64),
    Resume,
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
enum UiCommand {
    Invalidate,
    SetMenus {
        menus: Vec<MenuSpec>,
        response: SyncSender<std::result::Result<(), String>>,
    },
    DispatchMenuAction {
        id: String,
        response: SyncSender<std::result::Result<(), String>>,
    },
    Quit {
        response: SyncSender<()>,
    },
    SetWindowTitle(String),
    GetWindowSize {
        response: SyncSender<WindowSize>,
    },
    SetDebugFrameOverlay(gpui::DebugFrameOverlayMode),
    CycleDebugFrameOverlay {
        response: SyncSender<String>,
    },
    GetDebugFrameOverlay {
        response: SyncSender<String>,
    },
    GetDebugFrameOverlayStats {
        response: SyncSender<DebugFrameOverlayStats>,
    },
    ResetDebugFrameOverlayStats,
    ScrollTo {
        id: u64,
        x: f32,
        y: f32,
    },
    ScrollToItem {
        id: u64,
        index: usize,
    },
    GetScrollOffset {
        id: u64,
        response: SyncSender<Option<[f64; 2]>>,
    },
    GetAutomationBounds {
        response: SyncSender<HashMap<u64, crate::automation::ElementBounds>>,
    },
    GetElementBounds {
        id: u64,
        response: SyncSender<Option<crate::automation::ElementBounds>>,
    },
    FocusElement(u64),
    ControlClock {
        control: ClockControl,
        response: SyncSender<f64>,
    },
    DispatchMouse {
        input: MouseInput,
        response: SyncSender<std::result::Result<(), String>>,
    },
    Blur,
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
fn refresh_ui_window(
    window: gpui::WindowHandle<GpuixView>,
    cx: &mut gpui::AsyncApp,
) -> anyhow::Result<()> {
    window.update(cx, |_view, window, cx| {
        cx.notify();
        window.refresh();
    })
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
async fn run_ui_commands(
    mut commands: mpsc::UnboundedReceiver<UiCommand>,
    window: gpui::WindowHandle<GpuixView>,
    cx: &mut gpui::AsyncApp,
) {
    while let Some(command) = commands.next().await {
        let result = match command {
            UiCommand::Invalidate => refresh_ui_window(window, cx),
            UiCommand::SetMenus { menus, response } => {
                let result = cx.update(|cx| set_application_menus(cx, menus));
                let response_value = result
                    .as_ref()
                    .map(|value| value.clone())
                    .map_err(|error| error.to_string())
                    .and_then(|value| value);
                response.send(response_value).ok();
                result.and_then(|value| value.map_err(anyhow::Error::msg))
            }
            UiCommand::DispatchMenuAction { id, response } => {
                let result = cx.update(|cx| dispatch_application_menu_action(cx, &id));
                let response_value = result
                    .as_ref()
                    .map(|value| value.clone())
                    .map_err(|error| error.to_string())
                    .and_then(|value| value);
                response.send(response_value).ok();
                result.and_then(|value| value.map_err(anyhow::Error::msg))
            }
            UiCommand::Quit { response } => {
                let result = cx.update(|cx| cx.quit());
                response.send(()).ok();
                result
            }
            UiCommand::SetWindowTitle(title) => window.update(cx, move |view, window, cx| {
                view.window_title = title;
                cx.notify();
                window.refresh();
            }),
            UiCommand::GetWindowSize { response } => {
                window.update(cx, move |_view, window, _cx| {
                    response.send(window_size(window)).ok();
                })
            }
            UiCommand::SetDebugFrameOverlay(mode) => {
                window.update(cx, move |_view, window, _cx| {
                    window.set_debug_frame_overlay_mode(mode);
                })
            }
            UiCommand::CycleDebugFrameOverlay { response } => {
                window.update(cx, move |_view, window, _cx| {
                    window.cycle_debug_frame_overlay_mode();
                    response
                        .send(
                            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).into(),
                        )
                        .ok();
                })
            }
            UiCommand::GetDebugFrameOverlay { response } => {
                window.update(cx, move |_view, window, _cx| {
                    response
                        .send(
                            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).into(),
                        )
                        .ok();
                })
            }
            UiCommand::GetDebugFrameOverlayStats { response } => {
                window.update(cx, move |_view, window, _cx| {
                    response
                        .send(debug_frame_overlay_stats_js(
                            window.debug_frame_overlay_stats(),
                        ))
                        .ok();
                })
            }
            UiCommand::ResetDebugFrameOverlayStats => window.update(cx, |_view, window, _cx| {
                window.reset_debug_frame_overlay_stats();
            }),
            UiCommand::ScrollTo { id, x, y } => {
                if !VIRTUAL_LIST_STATES.with(|cell| {
                    let states = cell.borrow();
                    let Some(state) = states.get(&id) else {
                        return false;
                    };
                    state.set_offset_from_scrollbar(gpui::point(gpui::px(x), gpui::px(y)));
                    true
                }) {
                    SCROLL_HANDLES.with(|cell| {
                        if let Some(handle) = cell.borrow().get(&id) {
                            handle.set_offset(gpui::point(gpui::px(x), gpui::px(y)));
                        }
                    });
                }
                refresh_ui_window(window, cx)
            }
            UiCommand::ScrollToItem { id, index } => {
                if !VIRTUAL_LIST_STATES.with(|cell| {
                    let states = cell.borrow();
                    let Some(state) = states.get(&id) else {
                        return false;
                    };
                    state.scroll_to(gpui::ListOffset {
                        item_ix: index,
                        offset_in_item: gpui::px(0.0),
                    });
                    true
                }) {
                    SCROLL_HANDLES.with(|cell| {
                        if let Some(handle) = cell.borrow().get(&id) {
                            handle.scroll_to_item(index);
                        }
                    });
                }
                refresh_ui_window(window, cx)
            }
            UiCommand::GetScrollOffset { id, response } => {
                let offset = VIRTUAL_LIST_STATES
                    .with(|cell| {
                        cell.borrow().get(&id).map(|state| {
                            let offset = state.scroll_px_offset_for_scrollbar();
                            [
                                f64::from(f32::from(offset.x)),
                                f64::from(f32::from(offset.y)),
                            ]
                        })
                    })
                    .or_else(|| {
                        SCROLL_HANDLES.with(|cell| {
                            cell.borrow().get(&id).map(|handle| {
                                let offset = handle.offset();
                                [
                                    f64::from(f32::from(offset.x)),
                                    f64::from(f32::from(offset.y)),
                                ]
                            })
                        })
                    });
                response.send(offset).ok();
                Ok(())
            }
            UiCommand::GetAutomationBounds { response } => {
                window.update(cx, move |_view, window, cx| {
                    cx.notify();
                    window.refresh();
                    window.on_next_frame(move |_window, _cx| {
                        response.send(crate::automation::all_bounds()).ok();
                    });
                })
            }
            UiCommand::GetElementBounds { id, response } => {
                window.update(cx, move |_view, window, cx| {
                    cx.notify();
                    window.refresh();
                    window.on_next_frame(move |_window, _cx| {
                        response.send(crate::automation::get_bounds(id)).ok();
                    });
                })
            }
            UiCommand::FocusElement(id) => window.update(cx, move |view, window, cx| {
                view.reveal_virtual_list_ancestor(id);
                if let Some(handle) = view.focus_handles.get(&id) {
                    handle.focus(window, cx);
                }
                cx.notify();
                window.refresh();
            }),
            UiCommand::ControlClock { control, response } => {
                window.update(cx, move |view, _window, cx| {
                    let now_ms = match control {
                        ClockControl::Pause => view.clock.pause(),
                        ClockControl::Set(now_ms) => view.clock.set_ms(now_ms),
                        ClockControl::FastForward(delta_ms) => view.clock.fast_forward_ms(delta_ms),
                        ClockControl::Resume => view.clock.resume(),
                    };
                    cx.notify();
                    response.send(now_ms).ok();
                })
            }
            UiCommand::DispatchMouse { input, response } => {
                let result = window.update(cx, move |_view, window, cx| match input {
                    MouseInput::Click { x, y, button } => {
                        crate::automation::dispatch_click(window, cx, x, y, button);
                    }
                    MouseInput::Down { x, y, button } => {
                        crate::automation::dispatch_mouse_down(window, cx, x, y, button);
                    }
                    MouseInput::Up { x, y, button } => {
                        crate::automation::dispatch_mouse_up(window, cx, x, y, button);
                    }
                    MouseInput::Move {
                        x,
                        y,
                        pressed_button,
                    } => {
                        crate::automation::dispatch_mouse_move(window, cx, x, y, pressed_button);
                    }
                });
                response
                    .send(
                        result
                            .as_ref()
                            .map(|_| ())
                            .map_err(|error| format!("{error:#}")),
                    )
                    .ok();
                result
            }
            UiCommand::Blur => window.update(cx, |_view, window, _cx| window.blur()),
        };
        if let Err(error) = result {
            log::error!("Failed to handle GPUI UI command: {error:#}");
        }
    }
    cx.update(|cx| cx.quit());
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|message| (*message).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string())
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn catch_gpui_initialization<T>(
    operation: &str,
    initialize: impl FnOnce() -> Result<T>,
) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(initialize)) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(Error::new(
            error.status,
            format!("{operation} failed: {}", error.reason),
        )),
        Err(payload) => Err(Error::from_reason(format!(
            "{operation} panicked: {}",
            panic_message(payload)
        ))),
    }
}

#[cfg(all(target_os = "macos", feature = "display-discovery-fault-injection"))]
#[napi]
pub fn test_macos_autorelease_pool_drain_count() -> u32 {
    gpui_macos::test_autorelease_pool_drain_count()
        .try_into()
        .unwrap_or(u32::MAX)
}

#[cfg(all(target_os = "macos", feature = "display-discovery-fault-injection"))]
#[napi]
pub fn test_macos_native_window_allocation_count() -> u32 {
    gpui_macos::test_native_window_allocation_count()
        .try_into()
        .unwrap_or(u32::MAX)
}

/// Lifecycle states distinguish an invalid pre-init call from an idempotent
/// post-termination call after the native window has already been destroyed.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RendererLifecycle {
    Uninitialized,
    Running,
    Terminated,
}

/// The main GPUI renderer exposed to Node.js.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
pub struct GpuixRenderer {
    event_callback: Mutex<Option<Arc<ThreadsafeFunction<EventPayload>>>>,
    application_event_callback: Arc<Mutex<Option<EventCallback>>>,
    window_event_callback: WindowEventCallback,
    tree: Arc<Mutex<RetainedTree>>,
    lifecycle: Arc<Mutex<RendererLifecycle>>,
    /// Shared with GpuixView so napi methods can read the live selection
    /// without an App context. Paint and napi calls can use different threads.
    selection: SharedSelection,
    strict_styles: AtomicBool,
    style_diagnostics: Mutex<Vec<PendingStyleDiagnostic>>,
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    ui_commands: Mutex<Option<mpsc::UnboundedSender<UiCommand>>>,
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
impl GpuixRenderer {
    fn event_callback_for_view(&self) -> Option<EventCallback> {
        self.event_callback.lock().unwrap().clone().map(|tsf| {
            Arc::new(move |payload: EventPayload| {
                tsf.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
            }) as EventCallback
        })
    }

    fn application_event_callback(&self) -> EventCallback {
        let callback = self.application_event_callback.clone();
        Arc::new(move |payload: EventPayload| {
            let current = callback.lock().unwrap().clone();
            if let Some(current) = current {
                current(payload);
            }
        })
    }

    fn window_event_callback(&self) -> WindowEventCallback {
        self.window_event_callback.clone()
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn send_ui_command(&self, command: UiCommand) -> Result<()> {
        self.ui_commands
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?
            .unbounded_send(command)
            .map_err(|_| Error::from_reason("The GPUI UI thread is not running"))
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn dispatch_mouse_input(&self, input: MouseInput) -> Result<()> {
        let (response_sender, response_receiver) = sync_channel(1);
        self.send_ui_command(UiCommand::DispatchMouse {
            input,
            response: response_sender,
        })?;
        recv_ui_response(response_receiver, "the GPUI UI command")?.map_err(Error::from_reason)
    }

    fn automation_bounds(&self) -> Result<HashMap<u64, crate::automation::ElementBounds>> {
        #[cfg(target_os = "macos")]
        return Ok(crate::automation::all_bounds());

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetAutomationBounds { response })?;
            return recv_ui_response(receiver, "the automation bounds query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    fn element_bounds(&self, id: u64) -> Result<Option<crate::automation::ElementBounds>> {
        #[cfg(target_os = "macos")]
        return Ok(crate::automation::get_bounds(id));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetElementBounds { id, response })?;
            return recv_ui_response(receiver, "the element bounds query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = id;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn control_clock(&self, control: ClockControl) -> Result<f64> {
        let (response, receiver) = sync_channel(1);
        self.send_ui_command(UiCommand::ControlClock { control, response })?;
        recv_ui_response(receiver, "the automation clock command")
    }

    fn request_invalidate(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        return invalidate_window();

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::Invalidate);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason(
            "The production GPUIX renderer does not support this operating system",
        ))
    }

    #[napi(constructor)]
    pub fn new(event_callback: Option<ThreadsafeFunction<EventPayload>>) -> Self {
        let _ = env_logger::try_init();
        let event_callback = event_callback.map(Arc::new);
        let initial_application_event_callback = event_callback.clone().map(|tsf| {
            Arc::new(move |payload: EventPayload| {
                tsf.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
            }) as EventCallback
        });
        Self {
            event_callback: Mutex::new(event_callback),
            application_event_callback: Arc::new(Mutex::new(initial_application_event_callback)),
            window_event_callback: Arc::new(Mutex::new(None)),
            tree: Arc::new(Mutex::new(RetainedTree::new())),
            lifecycle: Arc::new(Mutex::new(RendererLifecycle::Uninitialized)),
            selection: SharedSelection::default(),
            strict_styles: AtomicBool::new(true),
            style_diagnostics: Mutex::new(Vec::new()),
            #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
            ui_commands: Mutex::new(None),
        }
    }

    /// Initialize GPUI using the native event-loop architecture for this OS.
    #[napi]
    pub fn init(&self, options: Option<WindowOptions>) -> Result<()> {
        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = options;
            return Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ));
        }

        #[cfg(target_os = "macos")]
        return self.init_macos(options);

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.init_threaded(options);
    }

    /// Replace the callback used for application-level events such as menu actions.
    #[napi]
    pub fn set_application_event_handler(
        &self,
        event_callback: Option<
            ThreadsafeFunction<EventPayload, Unknown<'static>, EventPayload, Status, false>,
        >,
    ) {
        let callback = event_callback.map(Arc::new).map(|tsf| {
            Arc::new(move |payload: EventPayload| {
                tsf.call(payload, ThreadsafeFunctionCallMode::NonBlocking);
            }) as EventCallback
        });
        *self.application_event_callback.lock().unwrap() = callback;
    }

    /// Install the renderer-level callback for native window events.
    ///
    /// Resize dimensions use logical GPUI pixels (points on macOS). Multiply
    /// them by `scaleFactor` to obtain device-pixel dimensions.
    #[napi]
    pub fn set_window_event_handler(
        &self,
        event_callback: Option<
            ThreadsafeFunction<EventPayload, Unknown<'static>, EventPayload, Status, false>,
        >,
    ) {
        let callback = event_callback.map(Arc::new).map(|tsf| {
            Arc::new(move |payload: EventPayload| {
                tsf.call(payload, ThreadsafeFunctionCallMode::NonBlocking);
            }) as EventCallback
        });
        *self.window_event_callback.lock().unwrap() = callback;
    }

    #[cfg(target_os = "macos")]
    fn init_macos(&self, options: Option<WindowOptions>) -> Result<()> {
        catch_gpui_initialization("GPUI macOS renderer initialization", || {
            self.init_macos_inner(options)
        })
    }

    #[cfg(target_os = "macos")]
    fn init_macos_inner(&self, options: Option<WindowOptions>) -> Result<()> {
        let options = options.unwrap_or_default();

        {
            let lifecycle = self.lifecycle.lock().unwrap();
            if *lifecycle != RendererLifecycle::Uninitialized {
                return Err(Error::from_reason("Renderer is already initialized"));
            }
        }
        if MAC_PLATFORM.with(|platform| platform.borrow().is_some()) {
            return Err(Error::from_reason(
                "A GPUI application already exists on this thread",
            ));
        }

        let width = options.width.unwrap_or(800.0);
        let height = options.height.unwrap_or(600.0);
        let title = options.title.clone().unwrap_or_else(|| "GPUIX".to_string());
        let menus = options
            .menus
            .clone()
            .unwrap_or_else(|| default_application_menus(&title));
        let window_options = options.clone();

        let platform = Rc::new(gpui_macos::MacPlatform::new_embedded());

        let tree = self.tree.clone();
        let callback = self.event_callback_for_view();
        let window_event_callback = self.window_event_callback();
        let application_callback = self.application_event_callback();

        let selection = self.selection.clone();
        let opened_window = Rc::new(RefCell::new(None));
        let startup_error = Rc::new(RefCell::new(None));
        let opened_window_for_app = opened_window.clone();
        let startup_error_for_app = startup_error.clone();
        // bun/node is not a .app. A Dock icon with no window cannot relaunch.
        // Last window close quits AppKit; tick() returns false and JS exits.
        let app = gpui::Application::with_platform(platform.clone())
            .with_quit_mode(gpui::QuitMode::LastWindowClosed);
        let app_handle = app.run_embedded(move |cx: &mut gpui::App| {
            init_key_bindings(cx);
            crate::custom_elements::input::init(cx);
            init_application_menu_support(cx, Some(application_callback.clone()));
            if let Err(error) = set_application_menus(cx, menus) {
                *startup_error_for_app.borrow_mut() = Some(error);
                return;
            }
            let window_size = gpui::size(gpui::px(width as f32), gpui::px(height as f32));
            #[cfg(feature = "display-discovery-fault-injection")]
            // Let the fault smoke reach MacWindow::open instead of failing during centering.
            let bounds = if std::env::var_os("GPUI_TEST_DISABLE_DISPLAY_DISCOVERY").is_some() {
                gpui::Bounds::new(gpui::Point::default(), window_size)
            } else {
                gpui::Bounds::centered(None, window_size, cx)
            };
            #[cfg(not(feature = "display-discovery-fault-injection"))]
            let bounds = gpui::Bounds::centered(None, window_size, cx);

            match cx.open_window(
                to_gpui_window_options(&window_options, bounds),
                |_window, cx| {
                    cx.new(|_view_cx| {
                        GpuixView::new(
                            tree.clone(),
                            callback.clone(),
                            window_event_callback.clone(),
                            title,
                            selection.clone(),
                        )
                    })
                },
            ) {
                Ok(window_handle) => {
                    *opened_window_for_app.borrow_mut() = Some(window_handle);
                    cx.activate(true);
                }
                Err(error) => {
                    *startup_error_for_app.borrow_mut() = Some(error.to_string());
                }
            }
        });

        let startup_result = match startup_error.borrow_mut().take() {
            Some(error) => Err(Error::from_reason(format!(
                "Failed to open the GPUI window: {error}"
            ))),
            None => opened_window
                .borrow_mut()
                .take()
                .ok_or_else(|| Error::from_reason("GPUI did not open the application window")),
        };
        let window_handle = match startup_result {
            Ok(window_handle) => window_handle,
            Err(error) => {
                app_handle.update(|cx| cx.quit());
                if platform.pump_events() {
                    MAC_PLATFORM.with(|stored| {
                        *stored.borrow_mut() = Some(platform.clone());
                    });
                }
                return Err(error);
            }
        };

        MAC_PLATFORM.with(|stored| {
            *stored.borrow_mut() = Some(platform);
        });
        GPUI_APP.with(|a| {
            *a.borrow_mut() = Some(app_handle);
        });
        GPUI_WINDOW.with(|w| {
            *w.borrow_mut() = Some(window_handle);
        });

        *self.lifecycle.lock().unwrap() = RendererLifecycle::Running;
        self.event_callback.lock().unwrap().take();
        Ok(())
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn init_threaded(&self, options: Option<WindowOptions>) -> Result<()> {
        let options = options.unwrap_or_default();
        if *self.lifecycle.lock().unwrap() != RendererLifecycle::Uninitialized {
            return Err(Error::from_reason("Renderer is already initialized"));
        }

        let width = options.width.unwrap_or(800.0);
        let height = options.height.unwrap_or(600.0);
        let title = options.title.clone().unwrap_or_else(|| "GPUIX".to_string());
        let menus = options
            .menus
            .clone()
            .unwrap_or_else(|| default_application_menus(&title));
        let window_options = options.clone();
        let tree = self.tree.clone();
        let selection = self.selection.clone();
        let callback = self.event_callback_for_view();
        let window_event_callback = self.window_event_callback();
        let application_callback = self.application_event_callback();
        let termination_callback = Some(application_callback.clone());
        let lifecycle = self.lifecycle.clone();
        let lifecycle_for_app = lifecycle.clone();
        let launched = Arc::new(AtomicBool::new(false));
        let launched_for_thread = launched.clone();
        let (command_sender, command_receiver) = mpsc::unbounded();
        let (startup_sender, startup_receiver) = sync_channel(1);
        let exit_startup_sender = startup_sender.clone();

        std::thread::Builder::new()
            .name("gpuix-ui".to_string())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    gpui_platform::application().run(move |cx| {
                        init_key_bindings(cx);
                        crate::custom_elements::input::init(cx);
                        init_application_menu_support(cx, Some(application_callback.clone()));
                        if let Err(error) = set_application_menus(cx, menus) {
                            startup_sender.send(Err(error)).ok();
                            cx.quit();
                            return;
                        }
                        let bounds = gpui::Bounds::centered(
                            None,
                            gpui::size(gpui::px(width as f32), gpui::px(height as f32)),
                            cx,
                        );
                        let window = match cx.open_window(
                            to_gpui_window_options(&window_options, bounds),
                            |_window, cx| {
                                cx.new(|_view_cx| {
                                    GpuixView::new(
                                        tree,
                                        callback,
                                        window_event_callback,
                                        title,
                                        selection,
                                    )
                                })
                            },
                        ) {
                            Ok(window) => window,
                            Err(error) => {
                                startup_sender
                                    .send(Err(format!("Failed to open the GPUI window: {error}")))
                                    .ok();
                                cx.quit();
                                return;
                            }
                        };

                        cx.spawn(async move |cx| {
                            run_ui_commands(command_receiver, window, cx).await;
                        })
                        .detach();
                        cx.activate(true);
                        *lifecycle_for_app.lock().unwrap() = RendererLifecycle::Running;
                        launched_for_thread.store(true, Ordering::Release);
                        startup_sender.send(Ok(())).ok();
                    });
                }));

                *lifecycle.lock().unwrap() = RendererLifecycle::Terminated;
                if launched.load(Ordering::Acquire) {
                    emit_application_event(&termination_callback, "terminated", None);
                }

                let error = match result {
                    Ok(()) => {
                        "The GPUI event loop exited before initialization completed".to_string()
                    }
                    Err(payload) => format!(
                        "The GPUI UI thread panicked during initialization: {}",
                        panic_message(payload)
                    ),
                };
                exit_startup_sender.try_send(Err(error)).ok();
            })
            .map_err(|error| {
                Error::from_reason(format!("Failed to spawn the GPUI UI thread: {error}"))
            })?;

        startup_receiver
            .recv()
            .map_err(|_| Error::from_reason("The GPUI UI thread stopped during initialization"))?
            .map_err(Error::from_reason)?;

        *self.ui_commands.lock().unwrap() = Some(command_sender);
        self.event_callback.lock().unwrap().take();
        Ok(())
    }

    // ── Mutation API ─────────────────────────────────────────────────

    #[napi]
    pub fn create_element(&self, id: f64, element_type: String) -> Result<()> {
        let id = to_element_id(id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.create_element(id, element_type);
        Ok(())
    }

    /// Destroy an element and all descendants. Returns array of destroyed IDs
    /// so JS can clean up event handlers for the entire subtree.
    #[napi]
    pub fn destroy_element(&self, id: f64) -> Result<Vec<f64>> {
        let id = to_element_id(id)?;
        let mut tree = self.tree.lock().unwrap();
        let destroyed = tree.destroy_element(id);
        Ok(destroyed.iter().map(|&id| id as f64).collect())
    }

    #[napi]
    pub fn append_child(&self, parent_id: f64, child_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.append_child(parent_id, child_id);
        Ok(())
    }

    #[napi]
    pub fn remove_child(&self, parent_id: f64, child_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.remove_child(parent_id, child_id);
        Ok(())
    }

    #[napi]
    pub fn insert_before(&self, parent_id: f64, child_id: f64, before_id: f64) -> Result<()> {
        let parent_id = to_element_id(parent_id)?;
        let child_id = to_element_id(child_id)?;
        let before_id = to_element_id(before_id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.insert_before(parent_id, child_id, before_id);
        Ok(())
    }

    #[napi]
    pub fn set_style(&self, id: f64, style_json: String) -> Result<()> {
        let id = to_element_id(id)?;
        let parsed = parse_style_json(&style_json);
        let mut tree = self.tree.lock().unwrap();
        tree.set_style(id, parsed.style);
        drop(tree);
        if self.strict_styles.load(Ordering::Relaxed) {
            self.style_diagnostics
                .lock()
                .unwrap()
                .extend(pending_style_diagnostics(id, parsed.problems));
        }
        Ok(())
    }

    /// Enable actionable diagnostics for rejected style fields. React enables this
    /// by default outside production builds.
    #[napi]
    pub fn set_strict_styles(&self, enabled: bool) {
        self.strict_styles.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.style_diagnostics.lock().unwrap().clear();
        }
    }

    /// Drain rejected style fields after a commit, once element type and testId are known.
    #[napi]
    pub fn drain_style_diagnostics(&self) -> Vec<GpuixStyleDiagnostic> {
        drain_style_diagnostics(&self.style_diagnostics, &self.tree)
    }

    #[napi]
    pub fn set_text(&self, id: f64, content: String) -> Result<()> {
        let id = to_element_id(id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.set_text(id, content);
        Ok(())
    }

    #[napi]
    pub fn set_event_listener(&self, id: f64, event_type: String, has_handler: bool) -> Result<()> {
        let id = to_element_id(id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.set_event_listener(id, event_type, has_handler);
        Ok(())
    }

    /// Set the root element (called from appendChildToContainer).
    #[napi]
    pub fn set_root(&self, id: f64) -> Result<()> {
        let id = to_element_id(id)?;
        let mut tree = self.tree.lock().unwrap();
        tree.root_id = Some(id);
        Ok(())
    }

    /// Set a custom prop on an element (for non-div/text elements like input, editor, diff).
    /// Key is the prop name, value is JSON-encoded.
    #[napi]
    pub fn set_custom_prop(&self, id: f64, key: String, value_json: String) -> Result<()> {
        let id = to_element_id(id)?;
        let value: serde_json::Value = serde_json::from_str(&value_json)
            .map_err(|e| Error::from_reason(format!("Failed to parse custom prop value: {}", e)))?;
        let mut tree = self.tree.lock().unwrap();
        tree.set_custom_prop(id, key, value);
        Ok(())
    }

    /// Get a custom prop value from an element. Returns JSON string or null.
    #[napi]
    pub fn get_custom_prop(&self, id: f64, key: String) -> Result<Option<String>> {
        let id = to_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        Ok(tree
            .get_custom_prop(id, &key)
            .map(|v| serde_json::to_string(v).unwrap_or_default()))
    }

    /// Signal that a batch of mutations is complete. Triggers re-render.
    #[napi]
    pub fn commit_mutations(&self) -> Result<()> {
        if *self.lifecycle.lock().unwrap() == RendererLifecycle::Terminated {
            return Ok(());
        }
        self.request_invalidate()
    }

    /// Apply a batch of mutations in a single FFI call.
    ///
    /// Accepts a JSON array of mutation tuples. Each tuple is an array where
    /// the first element is the operation name (string) and remaining elements
    /// are the arguments:
    ///
    ///   ["createElement",    id, "type"]
    ///   ["destroyElement",   id]
    ///   ["appendChild",      parentId, childId]
    ///   ["removeChild",      parentId, childId]
    ///   ["insertBefore",     parentId, childId, beforeId]
    ///   ["setStyle",         id, { ...style } | "{styleJson}"]
    ///   ["setText",          id, "content"]
    ///   ["setEventListener", id, "eventType", true|false]
    ///   ["setRoot",          id]
    ///   ["setCustomProp",      id, "key", value | "{valueJson}"]
    ///   ["setCustomPropValue", id, "key", value]
    ///
    /// Returns accumulated destroyed IDs from all destroyElement ops.
    /// Acquires the tree mutex ONCE for the entire batch.
    #[napi]
    pub fn apply_batch(&self, json: String) -> Result<Vec<f64>> {
        if *self.lifecycle.lock().unwrap() == RendererLifecycle::Terminated {
            return Ok(Vec::new());
        }
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
        self.request_invalidate()?;
        Ok(outcome.destroyed_ids)
    }

    // ── Frame loop ───────────────────────────────────────────────────

    /// Replace the application menu bar. Pass an empty array to remove it.
    #[napi]
    pub fn set_menus(&self, menus: Vec<MenuSpec>) -> Result<()> {
        if *self.lifecycle.lock().unwrap() != RendererLifecycle::Running {
            return Err(Error::from_reason(
                "Renderer not initialized. Call init() first.",
            ));
        }

        #[cfg(target_os = "macos")]
        return GPUI_APP.with(|app| {
            let app = app.borrow();
            let app = app
                .as_ref()
                .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?;
            app.update(|cx| set_application_menus(cx, menus))
                .map_err(Error::from_reason)
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::SetMenus { menus, response })?;
            return recv_ui_response(receiver, "the application menu update")?
                .map_err(Error::from_reason);
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Dispatch a configured menu action through the production GPUI application.
    #[napi]
    pub fn simulate_menu_action(&self, id: String) -> Result<()> {
        if *self.lifecycle.lock().unwrap() != RendererLifecycle::Running {
            return Err(Error::from_reason(
                "Renderer not initialized. Call init() first.",
            ));
        }

        #[cfg(target_os = "macos")]
        return GPUI_APP.with(|app| {
            let app = app.borrow();
            let app = app
                .as_ref()
                .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?;
            app.update(|cx| dispatch_application_menu_action(cx, &id))
                .map_err(Error::from_reason)
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::DispatchMenuAction { id, response })?;
            return recv_ui_response(receiver, "the application menu action")?
                .map_err(Error::from_reason);
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Gracefully terminate the native application through GPUI's platform abstraction.
    #[napi]
    pub fn quit(&self) -> Result<()> {
        if *self.lifecycle.lock().unwrap() != RendererLifecycle::Running {
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            GPUI_APP.with(|app| {
                let app = app.borrow();
                let app = app
                    .as_ref()
                    .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?;
                app.update(|cx| cx.quit());
                Ok::<(), Error>(())
            })?;

            for _ in 0..64 {
                let running = MAC_PLATFORM.with(|platform| {
                    platform
                        .borrow()
                        .as_ref()
                        .map(|platform| platform.pump_events())
                        .unwrap_or(false)
                });
                if !running {
                    *self.lifecycle.lock().unwrap() = RendererLifecycle::Terminated;
                    return Ok(());
                }
            }
            return Err(Error::from_reason(
                "GPUI did not finish quitting after 64 AppKit pump iterations",
            ));
        }

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::Quit { response })?;
            recv_ui_response(receiver, "the application quit request")?;
            return Ok(());
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Pump the native event loop. Returns false after the last window closes.
    #[napi]
    pub fn tick(&self) -> Result<bool> {
        match *self.lifecycle.lock().unwrap() {
            RendererLifecycle::Uninitialized => {
                return Err(Error::from_reason(
                    "Renderer not initialized. Call init() first.",
                ));
            }
            RendererLifecycle::Terminated => return Ok(false),
            RendererLifecycle::Running => {}
        }

        #[cfg(target_os = "macos")]
        {
            let running = MAC_PLATFORM.with(|p| {
                p.borrow()
                    .as_ref()
                    .map(|platform| platform.pump_events())
                    .unwrap_or(false)
            });
            if !running {
                *self.lifecycle.lock().unwrap() = RendererLifecycle::Terminated;
            }
            return Ok(running);
        }

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return Ok(true);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason(
            "The production GPUIX renderer does not support this operating system",
        ))
    }

    #[napi]
    pub fn is_initialized(&self) -> bool {
        *self.lifecycle.lock().unwrap() == RendererLifecycle::Running
    }

    /// Whether JavaScript must drive the native event loop with tick().
    #[napi]
    pub fn requires_tick(&self) -> bool {
        cfg!(target_os = "macos")
    }

    #[napi]
    pub fn get_window_size(&self) -> Result<WindowSize> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| window_size(window));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetWindowSize { response })?;
            return recv_ui_response(receiver, "the window size query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// `"hidden"` | `"minimal"` | `"full"`. Paints into the scene after layout.
    #[napi]
    pub fn set_debug_frame_overlay(&self, mode: String) -> Result<String> {
        let mode = parse_debug_frame_overlay_mode(&mode)?;
        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, _cx| {
            window.set_debug_frame_overlay_mode(mode);
            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            self.send_ui_command(UiCommand::SetDebugFrameOverlay(mode))?;
            return self.debug_frame_overlay_mode();
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Hidden → minimal → full → hidden.
    #[napi]
    pub fn cycle_debug_frame_overlay(&self) -> Result<String> {
        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, _cx| {
            window.cycle_debug_frame_overlay_mode();
            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::CycleDebugFrameOverlay { response })?;
            return recv_ui_response(receiver, "the debug frame overlay query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn get_debug_frame_overlay(&self) -> Result<String> {
        self.debug_frame_overlay_mode()
    }

    fn debug_frame_overlay_mode(&self) -> Result<String> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| {
            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetDebugFrameOverlay { response })?;
            recv_ui_response(receiver, "the debug frame overlay query")
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Clears the last 1000 draw samples. Frame count stays.
    #[napi]
    pub fn reset_debug_frame_overlay_stats(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| {
            window.reset_debug_frame_overlay_stats();
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ResetDebugFrameOverlayStats);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Same numbers as the on-screen overlay: current, p90, p99, max, frames.
    #[napi]
    pub fn get_debug_frame_overlay_stats(&self) -> Result<DebugFrameOverlayStats> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| {
            debug_frame_overlay_stats_js(window.debug_frame_overlay_stats())
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetDebugFrameOverlayStats { response })?;
            match receiver.recv_timeout(Duration::from_secs(2)) {
                Ok(stats) => Ok(stats),
                Err(RecvTimeoutError::Timeout) => Err(Error::from_reason(
                    "Timed out after 2 seconds waiting for debug frame overlay stats",
                )),
                Err(RecvTimeoutError::Disconnected) => Err(Error::from_reason(
                    "The GPUI UI thread stopped during the debug frame overlay stats query",
                )),
            }
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn set_window_title(&self, title: String) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.window_title = title;
            cx.notify();
            window.refresh();
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::SetWindowTitle(title));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason(
            "The production GPUIX renderer does not support this operating system",
        ))
    }

    #[napi]
    pub fn focus_element(&self, element_id: f64) -> Result<()> {
        let id = to_element_id(element_id)?;
        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.reveal_virtual_list_ancestor(id);
            if let Some(handle) = view.focus_handles.get(&id) {
                handle.focus(window, cx);
            }
            cx.notify();
            window.refresh();
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::FocusElement(id));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn blur(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, _cx| window.blur());

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::Blur);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    // ── Selection API ────────────────────────────────────────────────

    /// The current text selection joined in document order, or null.
    #[napi]
    pub fn get_selected_text(&self) -> Option<String> {
        self.selection.lock().selected_text()
    }

    /// Drop the current selection and request a repaint.
    #[napi]
    pub fn clear_selection(&self) -> Result<()> {
        self.selection.lock().clear();
        self.request_invalidate()
    }

    // ── Scroll API ───────────────────────────────────────────────────
    // GpuixView syncs scroll handles and virtual list states to thread-local maps.

    /// Set the scroll offset of a scrollable element.
    /// x and y are negative pixel values (scroll down = more negative y).
    #[napi]
    pub fn scroll_to(&self, element_id: f64, x: f64, y: f64) -> Result<()> {
        let id = to_element_id(element_id)?;
        #[cfg(target_os = "macos")]
        if !VIRTUAL_LIST_STATES.with(|cell| {
            let states = cell.borrow();
            let Some(state) = states.get(&id) else {
                return false;
            };
            state.set_offset_from_scrollbar(gpui::point(gpui::px(x as f32), gpui::px(y as f32)));
            true
        }) {
            SCROLL_HANDLES.with(|cell| {
                let handles = cell.borrow();
                if let Some(handle) = handles.get(&id) {
                    handle.set_offset(gpui::point(gpui::px(x as f32), gpui::px(y as f32)));
                }
            });
        }
        #[cfg(target_os = "macos")]
        return invalidate_window();

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ScrollTo {
            id,
            x: x as f32,
            y: y as f32,
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Scroll a child into view by its index in the children list.
    #[napi]
    pub fn scroll_to_item(&self, element_id: f64, index: f64) -> Result<()> {
        let id = to_element_id(element_id)?;
        let index = index as usize;
        #[cfg(target_os = "macos")]
        if !VIRTUAL_LIST_STATES.with(|cell| {
            let states = cell.borrow();
            let Some(state) = states.get(&id) else {
                return false;
            };
            state.scroll_to(gpui::ListOffset {
                item_ix: index,
                offset_in_item: gpui::px(0.0),
            });
            true
        }) {
            SCROLL_HANDLES.with(|cell| {
                let handles = cell.borrow();
                if let Some(handle) = handles.get(&id) {
                    handle.scroll_to_item(index);
                }
            });
        }
        #[cfg(target_os = "macos")]
        return invalidate_window();

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ScrollToItem { id, index });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Get the current scroll offset of a scrollable element.
    /// Returns [x, y] or null if the element has no scroll handle.
    #[napi]
    pub fn get_scroll_offset(&self, element_id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(element_id)?;
        #[cfg(target_os = "macos")]
        return Ok(VIRTUAL_LIST_STATES
            .with(|cell| {
                cell.borrow().get(&id).map(|state| {
                    let offset = state.scroll_px_offset_for_scrollbar();
                    vec![
                        f64::from(f32::from(offset.x)),
                        f64::from(f32::from(offset.y)),
                    ]
                })
            })
            .or_else(|| {
                SCROLL_HANDLES.with(|cell| {
                    let handles = cell.borrow();
                    handles.get(&id).map(|handle| {
                        let offset = handle.offset();
                        vec![
                            f64::from(f32::from(offset.x)),
                            f64::from(f32::from(offset.y)),
                        ]
                    })
                })
            }));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetScrollOffset { id, response })?;
            return Ok(
                recv_ui_response(receiver, "the GPUI scroll query")?.map(|[x, y]| vec![x, y])
            );
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn get_automation_tree(&self) -> Result<String> {
        self.request_invalidate()?;
        let bounds = self.automation_bounds()?;
        let tree = self.tree.lock().unwrap();
        let json = tree.to_automation_json(&bounds);
        serde_json::to_string(&json)
            .map_err(|e| Error::from_reason(format!("JSON serialization failed: {}", e)))
    }

    #[napi]
    pub fn get_element_bounds(&self, id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(id)?;
        Ok(self
            .element_bounds(id)?
            .map(|bounds| vec![bounds.x, bounds.y, bounds.width, bounds.height]))
    }

    #[napi]
    pub fn get_all_text(&self) -> Vec<String> {
        let tree = self.tree.lock().unwrap();
        let mut texts = Vec::new();
        if let Some(root_id) = tree.root_id {
            collect_text(root_id, &tree, &mut texts);
        }
        texts
    }

    #[napi]
    pub fn get_painted_text(&self) -> Vec<String> {
        crate::text::painted_text()
    }

    #[napi]
    pub fn simulate_click(&self, x: f64, y: f64, button: Option<u32>) -> Result<()> {
        let button = button.unwrap_or(0);

        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, cx| {
            crate::automation::dispatch_click(window, cx, x, y, button);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Click { x, y, button });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (x, y, button);
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    #[napi]
    pub fn simulate_mouse_down(&self, x: f64, y: f64, button: Option<u32>) -> Result<()> {
        let button = button.unwrap_or(0);

        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_down(window, cx, x, y, button);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Down { x, y, button });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (x, y, button);
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    #[napi]
    pub fn simulate_mouse_up(&self, x: f64, y: f64, button: Option<u32>) -> Result<()> {
        let button = button.unwrap_or(0);

        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_up(window, cx, x, y, button);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Up { x, y, button });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (x, y, button);
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    #[napi]
    pub fn simulate_mouse_move(&self, x: f64, y: f64, pressed_button: Option<u32>) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_move(window, cx, x, y, pressed_button);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Move {
            x,
            y,
            pressed_button,
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (x, y, pressed_button);
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    #[napi]
    pub fn clock_pause(&self) -> Result<f64> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            let now_ms = view.clock.pause();
            cx.notify();
            now_ms
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.control_clock(ClockControl::Pause);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn clock_set(&self, now_ms: f64) -> Result<f64> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            let now_ms = view.clock.set_ms(now_ms);
            cx.notify();
            now_ms
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.control_clock(ClockControl::Set(now_ms));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = now_ms;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    #[napi]
    pub fn clock_fast_forward(&self, delta_ms: f64) -> Result<f64> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            let now_ms = view.clock.fast_forward_ms(delta_ms);
            cx.notify();
            now_ms
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.control_clock(ClockControl::FastForward(delta_ms));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = delta_ms;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    #[napi]
    pub fn clock_resume(&self) -> Result<f64> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            let now_ms = view.clock.resume();
            cx.notify();
            now_ms
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.control_clock(ClockControl::Resume);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    #[napi]
    pub fn capture_screenshot(&self, path: String) -> Result<()> {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        {
            let image = update_window(move |_view, window, cx| {
                cx.notify();
                window.refresh();
                window.render_to_image()
            })?
            .map_err(|e| Error::from_reason(format!("Screenshot capture failed: {}", e)))?;
            image
                .save(&path)
                .map_err(|e| Error::from_reason(format!("Failed to save screenshot: {}", e)))?;
            Ok(())
        }

        #[cfg(not(all(target_os = "macos", feature = "test-support")))]
        {
            let _ = path;
            Err(Error::from_reason(
                "captureScreenshot needs the test-support build on macOS",
            ))
        }
    }
}

#[cfg(all(test, not(all(target_arch = "wasm32", target_os = "unknown"))))]
mod initialization_tests {
    use super::*;

    #[test]
    fn initialization_panics_preserve_observed_messages() {
        let observed = [
            "window.rs:366:57: called Option::unwrap() on a None value",
            "Can't spawn on main thread after on_app_quit",
            "The GPUI UI thread panicked during initialization",
        ];

        for message in observed {
            let error =
                catch_gpui_initialization("GPUI test renderer initialization", || -> Result<()> {
                    panic!("{message}")
                })
                .expect_err("the initialization panic should become an error");

            assert!(error
                .reason
                .contains("GPUI test renderer initialization panicked"));
            assert!(error.reason.contains(message));
        }
    }

    #[test]
    fn window_resize_emits_logical_dimensions_and_scale_factor() {
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_callback = emitted.clone();
        let callback: WindowEventCallback = Arc::new(Mutex::new(Some(Arc::new(move |payload| {
            emitted_for_callback.lock().unwrap().push(payload);
        }))));

        emit_window_resize_payload(
            &callback,
            WindowSize {
                width: 960.0,
                height: 540.0,
                scale_factor: 2.0,
            },
        );

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        let payload = &emitted[0];
        assert_eq!(payload.event_type, "windowResize");
        assert_eq!(payload.width, Some(960.0));
        assert_eq!(payload.height, Some(540.0));
        assert_eq!(payload.scale_factor, Some(2.0));
    }

    #[test]
    fn browser_window_resize_contract_includes_dpr_and_event_fields() {
        let size = window_size_from_metrics(1280.0, 720.0, 2.0);
        let payload = window_resize_payload(size);

        assert_eq!(payload.event_type, "windowResize");
        assert_eq!(payload.width, Some(1280.0));
        assert_eq!(payload.height, Some(720.0));
        assert_eq!(payload.scale_factor, Some(2.0));
    }
}

fn collect_text(id: u64, tree: &RetainedTree, texts: &mut Vec<String>) {
    if let Some(element) = tree.elements.get(&id) {
        if let Some(ref content) = element.content {
            texts.push(content.clone());
        }
        for &child_id in &element.children {
            collect_text(child_id, tree, texts);
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn start_web_app(
    tree: Arc<Mutex<RetainedTree>>,
    selection: SharedSelection,
    event_callback: EventCallback,
    window_event_callback: WindowEventCallback,
) -> Result<(), wasm_bindgen::JsValue> {
    if WEB_APP.with(|stored| stored.borrow().is_some()) {
        return Err(wasm_bindgen::JsValue::from_str(
            "GPUIX web is already running",
        ));
    }
    gpui_platform::web_init();
    let app = gpui_platform::single_threaded_web().run_embedded(move |cx| {
        init_key_bindings(cx);
        crate::custom_elements::input::init(cx);
        let window = cx.open_window(Default::default(), |_window, cx| {
            cx.new(|_view_cx| {
                GpuixView::new(
                    tree,
                    Some(event_callback),
                    window_event_callback,
                    "GPUIX Web".to_string(),
                    selection,
                )
            })
        });
        match window {
            Ok(window) => WEB_WINDOW.with(|stored| *stored.borrow_mut() = Some(window)),
            Err(error) => log::error!("Failed to open the GPUIX web window: {error:#}"),
        }
        cx.activate(true);
    });
    WEB_APP.with(|stored| *stored.borrow_mut() = Some(app));
    Ok(())
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_element_id(id: f64) -> Result<u64, wasm_bindgen::JsValue> {
    raw_element_id(id).map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_number_array(values: impl IntoIterator<Item = f64>) -> wasm_bindgen::JsValue {
    let result = js_sys::Array::new();
    for value in values {
        result.push(&value.into());
    }
    result.into()
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_string_array(values: impl IntoIterator<Item = String>) -> wasm_bindgen::JsValue {
    let result = js_sys::Array::new();
    for value in values {
        result.push(&value.into());
    }
    result.into()
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn update_web_window<R>(
    update: impl FnOnce(&mut GpuixView, &mut gpui::Window, &mut gpui::Context<GpuixView>) -> R,
) -> Result<R, wasm_bindgen::JsValue> {
    WEB_APP.with(|app| {
        let app = app.borrow();
        let app = app
            .as_ref()
            .ok_or_else(|| wasm_bindgen::JsValue::from_str("GPUIX web is not initialized"))?;
        app.update(|cx| {
            WEB_WINDOW.with(|window| {
                let window = (*window.borrow()).ok_or_else(|| {
                    wasm_bindgen::JsValue::from_str("GPUIX web window is not ready")
                })?;
                window
                    .update(cx, update)
                    .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
            })
        })
    })
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn notify_web() {
    if let Err(error) = update_web_window(|_view, _window, cx| cx.notify()) {
        if WEB_WINDOW.with(|window| window.borrow().is_some()) {
            log::error!("Failed to invalidate the GPUIX web window: {error:?}");
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_event_callback(callback: js_sys::Function) -> EventCallback {
    web_callback(callback, true)
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_window_event_callback(callback: js_sys::Function) -> EventCallback {
    web_callback(callback, false)
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_callback(callback: js_sys::Function, includes_error_argument: bool) -> EventCallback {
    Rc::new(move |payload| {
        let Ok(json) = serde_json::to_string(&payload) else {
            log::error!("Failed to serialize GPUIX browser event");
            return;
        };
        let Ok(payload) = js_sys::JSON::parse(&json) else {
            log::error!("Failed to create GPUIX browser event object");
            return;
        };
        let callback = callback.clone();
        let task = wasm_bindgen::closure::Closure::once_into_js(move || {
            let result = if includes_error_argument {
                callback.call2(
                    &wasm_bindgen::JsValue::UNDEFINED,
                    &wasm_bindgen::JsValue::NULL,
                    &payload,
                )
            } else {
                callback.call1(&wasm_bindgen::JsValue::UNDEFINED, &payload)
            };
            if let Err(error) = result {
                log::error!("GPUIX browser event callback failed: {error:?}");
            }
        });
        let task: js_sys::Function = task.unchecked_into();
        if let Some(window) = web_sys::window() {
            window.queue_microtask(&task);
        }
    })
}

#[cfg(any(test, all(target_arch = "wasm32", target_os = "unknown")))]
fn window_size_from_metrics(width: f64, height: f64, scale_factor: f64) -> WindowSize {
    WindowSize {
        width,
        height,
        scale_factor,
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_window_size(window: &web_sys::Window) -> Result<WindowSize, wasm_bindgen::JsValue> {
    let width = window
        .inner_width()?
        .as_f64()
        .ok_or_else(|| wasm_bindgen::JsValue::from_str("Browser innerWidth is not a number"))?;
    let height = window
        .inner_height()?
        .as_f64()
        .ok_or_else(|| wasm_bindgen::JsValue::from_str("Browser innerHeight is not a number"))?;

    Ok(window_size_from_metrics(
        width,
        height,
        window.device_pixel_ratio(),
    ))
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_window_size_value(size: WindowSize) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
    let value = js_sys::Object::new();
    js_sys::Reflect::set(&value, &"width".into(), &size.width.into())?;
    js_sys::Reflect::set(&value, &"height".into(), &size.height.into())?;
    js_sys::Reflect::set(&value, &"scaleFactor".into(), &size.scale_factor.into())?;
    Ok(value.into())
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = GpuixRenderer)]
pub struct WebGpuixRenderer {
    tree: Arc<Mutex<RetainedTree>>,
    selection: SharedSelection,
    event_callback: EventCallback,
    window_event_callback: WindowEventCallback,
    window_resize_listener: wasm_bindgen::closure::Closure<dyn FnMut(web_sys::Event)>,
    strict_styles: AtomicBool,
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[wasm_bindgen::prelude::wasm_bindgen(js_class = GpuixRenderer)]
impl WebGpuixRenderer {
    #[wasm_bindgen::prelude::wasm_bindgen(constructor)]
    pub fn new(event_callback: js_sys::Function) -> Self {
        let window_event_callback = Rc::new(RefCell::new(None));
        let callback = window_event_callback.clone();
        let window_resize_listener = wasm_bindgen::closure::Closure::new(move |_event| {
            let Some(window) = web_sys::window() else {
                return;
            };

            match web_window_size(&window) {
                Ok(size) => emit_window_resize_payload(&callback, size),
                Err(error) => log::error!("Failed to read GPUIX browser window size: {error:?}"),
            }
        });
        if let Some(window) = web_sys::window() {
            if let Err(error) = window.add_event_listener_with_callback(
                "resize",
                window_resize_listener.as_ref().unchecked_ref(),
            ) {
                log::error!("Failed to observe GPUIX browser window resizes: {error:?}");
            }
        }

        Self {
            tree: Arc::new(Mutex::new(RetainedTree::new())),
            selection: SharedSelection::default(),
            event_callback: web_event_callback(event_callback),
            window_event_callback,
            window_resize_listener,
            strict_styles: AtomicBool::new(true),
        }
    }

    pub fn init(&self, _options: wasm_bindgen::JsValue) -> Result<(), wasm_bindgen::JsValue> {
        start_web_app(
            self.tree.clone(),
            self.selection.clone(),
            self.event_callback.clone(),
            self.window_event_callback.clone(),
        )
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = createElement)]
    pub fn create_element(
        &self,
        id: f64,
        element_type: String,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.tree
            .lock()
            .unwrap()
            .create_element(web_element_id(id)?, element_type);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = destroyElement)]
    pub fn destroy_element(&self, id: f64) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let destroyed = self
            .tree
            .lock()
            .unwrap()
            .destroy_element(web_element_id(id)?)
            .into_iter()
            .map(|id| id as f64);
        Ok(web_number_array(destroyed))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = appendChild)]
    pub fn append_child(&self, parent_id: f64, child_id: f64) -> Result<(), wasm_bindgen::JsValue> {
        self.tree
            .lock()
            .unwrap()
            .append_child(web_element_id(parent_id)?, web_element_id(child_id)?);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = removeChild)]
    pub fn remove_child(&self, parent_id: f64, child_id: f64) -> Result<(), wasm_bindgen::JsValue> {
        self.tree
            .lock()
            .unwrap()
            .remove_child(web_element_id(parent_id)?, web_element_id(child_id)?);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = insertBefore)]
    pub fn insert_before(
        &self,
        parent_id: f64,
        child_id: f64,
        before_id: f64,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.tree.lock().unwrap().insert_before(
            web_element_id(parent_id)?,
            web_element_id(child_id)?,
            web_element_id(before_id)?,
        );
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setStyle)]
    pub fn set_style(&self, id: f64, style_json: String) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(id)?;
        let parsed = parse_style_json(&style_json);
        let mut tree = self.tree.lock().unwrap();
        tree.set_style(id, parsed.style);
        if self.strict_styles.load(Ordering::Relaxed) {
            for diagnostic in pending_style_diagnostics(id, parsed.problems) {
                let (message, _, _) = style_diagnostic_context(&diagnostic, &tree);
                web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&message));
            }
        }
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setStrictStyles)]
    pub fn set_strict_styles(&self, enabled: bool) {
        self.strict_styles.store(enabled, Ordering::Relaxed);
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setText)]
    pub fn set_text(&self, id: f64, content: String) -> Result<(), wasm_bindgen::JsValue> {
        self.tree
            .lock()
            .unwrap()
            .set_text(web_element_id(id)?, content);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setEventListener)]
    pub fn set_event_listener(
        &self,
        id: f64,
        event_type: String,
        has_handler: bool,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.tree
            .lock()
            .unwrap()
            .set_event_listener(web_element_id(id)?, event_type, has_handler);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setRoot)]
    pub fn set_root(&self, id: f64) -> Result<(), wasm_bindgen::JsValue> {
        self.tree.lock().unwrap().root_id = Some(web_element_id(id)?);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setCustomProp)]
    pub fn set_custom_prop(
        &self,
        id: f64,
        key: String,
        value_json: String,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let value = serde_json::from_str(&value_json).map_err(|error| {
            wasm_bindgen::JsValue::from_str(&format!("Failed to parse custom prop: {error}"))
        })?;
        self.tree
            .lock()
            .unwrap()
            .set_custom_prop(web_element_id(id)?, key, value);
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getCustomProp)]
    pub fn get_custom_prop(
        &self,
        id: f64,
        key: String,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let value = self
            .tree
            .lock()
            .unwrap()
            .get_custom_prop(web_element_id(id)?, &key)
            .map(serde_json::Value::to_string);
        Ok(value.map_or(wasm_bindgen::JsValue::NULL, |value| {
            wasm_bindgen::JsValue::from_str(&value)
        }))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = applyBatch)]
    pub fn apply_batch(
        &self,
        json: String,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let ops: Vec<serde_json::Value> = serde_json::from_str(&json).map_err(|error| {
            wasm_bindgen::JsValue::from_str(&format!("Failed to parse batch: {error}"))
        })?;
        let mut tree = self.tree.lock().unwrap();
        let outcome = apply_batch_to_tree(&mut tree, &ops)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error))?;
        if self.strict_styles.load(Ordering::Relaxed) {
            for diagnostic in outcome.diagnostics {
                let (message, _, _) = style_diagnostic_context(&diagnostic, &tree);
                web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&message));
            }
        }
        let destroyed = outcome.destroyed_ids;
        drop(tree);
        notify_web();
        Ok(web_number_array(destroyed))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = commitMutations)]
    pub fn commit_mutations(&self) {
        notify_web();
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = isInitialized)]
    pub fn is_initialized(&self) -> bool {
        WEB_APP.with(|app| app.borrow().is_some())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = requiresTick)]
    pub fn requires_tick(&self) -> bool {
        false
    }

    pub fn tick(&self) {}

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getWindowSize)]
    pub fn get_window_size(&self) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let window = web_sys::window()
            .ok_or_else(|| wasm_bindgen::JsValue::from_str("Browser window is unavailable"))?;
        web_window_size_value(web_window_size(&window)?)
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setWindowEventHandler)]
    pub fn set_window_event_handler(&self, event_callback: Option<js_sys::Function>) {
        *self.window_event_callback.borrow_mut() = event_callback.map(web_window_event_callback);
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setWindowTitle)]
    pub fn set_window_title(&self, title: String) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |view, _window, cx| {
            view.window_title = title;
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = focusElement)]
    pub fn focus_element(&self, element_id: f64) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        update_web_window(move |view, window, cx| {
            view.reveal_virtual_list_ancestor(id);
            if let Some(handle) = view.focus_handles.get(&id) {
                handle.focus(window, cx);
            }
            cx.notify();
        })
    }

    pub fn blur(&self) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(|_view, window, _cx| window.blur())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getSelectedText)]
    pub fn get_selected_text(&self) -> wasm_bindgen::JsValue {
        self.selection
            .lock()
            .selected_text()
            .map_or(wasm_bindgen::JsValue::NULL, |value| {
                wasm_bindgen::JsValue::from_str(&value)
            })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clearSelection)]
    pub fn clear_selection(&self) {
        self.selection.lock().clear();
        notify_web();
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = scrollTo)]
    pub fn scroll_to(&self, element_id: f64, x: f64, y: f64) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        if !VIRTUAL_LIST_STATES.with(|states| {
            let states = states.borrow();
            let Some(state) = states.get(&id) else {
                return false;
            };
            state.set_offset_from_scrollbar(gpui::point(gpui::px(x as f32), gpui::px(y as f32)));
            true
        }) {
            SCROLL_HANDLES.with(|handles| {
                if let Some(handle) = handles.borrow().get(&id) {
                    handle.set_offset(gpui::point(gpui::px(x as f32), gpui::px(y as f32)));
                }
            });
        }
        notify_web();
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = scrollToItem)]
    pub fn scroll_to_item(&self, element_id: f64, index: f64) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let index = index as usize;
        if !VIRTUAL_LIST_STATES.with(|states| {
            let states = states.borrow();
            let Some(state) = states.get(&id) else {
                return false;
            };
            state.scroll_to(gpui::ListOffset {
                item_ix: index,
                offset_in_item: gpui::px(0.0),
            });
            true
        }) {
            SCROLL_HANDLES.with(|handles| {
                if let Some(handle) = handles.borrow().get(&id) {
                    handle.scroll_to_item(index);
                }
            });
        }
        notify_web();
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getScrollOffset)]
    pub fn get_scroll_offset(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let offset = VIRTUAL_LIST_STATES
            .with(|states| {
                states.borrow().get(&id).map(|state| {
                    let offset = state.scroll_px_offset_for_scrollbar();
                    [
                        f64::from(f32::from(offset.x)),
                        f64::from(f32::from(offset.y)),
                    ]
                })
            })
            .or_else(|| {
                SCROLL_HANDLES.with(|handles| {
                    handles.borrow().get(&id).map(|handle| {
                        let offset = handle.offset();
                        [
                            f64::from(f32::from(offset.x)),
                            f64::from(f32::from(offset.y)),
                        ]
                    })
                })
            });
        let Some([x, y]) = offset else {
            return Ok(wasm_bindgen::JsValue::NULL);
        };
        Ok(web_number_array([x, y]))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getAutomationTree)]
    pub fn get_automation_tree(&self) -> Result<String, wasm_bindgen::JsValue> {
        notify_web();
        let bounds = crate::automation::all_bounds();
        let tree = self.tree.lock().unwrap();
        serde_json::to_string(&tree.to_automation_json(&bounds)).map_err(|error| {
            wasm_bindgen::JsValue::from_str(&format!("JSON serialization failed: {error}"))
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getElementBounds)]
    pub fn get_element_bounds(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let Some(bounds) = crate::automation::get_bounds(web_element_id(element_id)?) else {
            return Ok(wasm_bindgen::JsValue::NULL);
        };
        Ok(web_number_array([
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
        ]))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getAllText)]
    pub fn get_all_text(&self) -> wasm_bindgen::JsValue {
        let tree = self.tree.lock().unwrap();
        let mut texts = Vec::new();
        if let Some(root_id) = tree.root_id {
            collect_text(root_id, &tree, &mut texts);
        }
        web_string_array(texts)
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getPaintedText)]
    pub fn get_painted_text(&self) -> wasm_bindgen::JsValue {
        web_string_array(crate::text::painted_text())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateClick)]
    pub fn simulate_click(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |_view, window, cx| {
            crate::automation::dispatch_click(window, cx, x, y, button.unwrap_or(0));
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseDown)]
    pub fn simulate_mouse_down(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_down(window, cx, x, y, button.unwrap_or(0));
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseUp)]
    pub fn simulate_mouse_up(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_up(window, cx, x, y, button.unwrap_or(0));
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseMove)]
    pub fn simulate_mouse_move(
        &self,
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |_view, window, cx| {
            crate::automation::dispatch_mouse_move(window, cx, x, y, pressed_button);
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateScrollWheel)]
    pub fn simulate_scroll_wheel(
        &self,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(move |_view, window, cx| {
            crate::automation::dispatch_scroll_wheel(window, cx, x, y, delta_x, delta_y);
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockPause)]
    pub fn clock_pause(&self) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_window(|view, _window, cx| {
            let now_ms = view.clock.pause();
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockSet)]
    pub fn clock_set(&self, now_ms: f64) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_window(move |view, _window, cx| {
            let now_ms = view.clock.set_ms(now_ms);
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockFastForward)]
    pub fn clock_fast_forward(&self, delta_ms: f64) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_window(move |view, _window, cx| {
            let now_ms = view.clock.fast_forward_ms(delta_ms);
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockResume)]
    pub fn clock_resume(&self) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_window(|view, _window, cx| {
            let now_ms = view.clock.resume();
            cx.notify();
            now_ms
        })
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
impl Drop for WebGpuixRenderer {
    fn drop(&mut self) {
        if let Some(window) = web_sys::window() {
            let _ = window.remove_event_listener_with_callback(
                "resize",
                self.window_resize_listener.as_ref().unchecked_ref(),
            );
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
impl Drop for GpuixRenderer {
    fn drop(&mut self) {
        self.ui_commands.lock().unwrap().take();
    }
}

// ── GPUI View ────────────────────────────────────────────────────────

pub(crate) struct GpuixView {
    pub(crate) tree: Arc<Mutex<RetainedTree>>,
    pub(crate) event_callback: Option<EventCallback>,
    window_event_callback: WindowEventCallback,
    window_bounds_subscription: Option<gpui::Subscription>,
    pub(crate) window_title: String,
    /// Persistent FocusHandles keyed by element ID.
    /// Created lazily for elements with keyboard or focus/blur listeners.
    /// Handles persist across renders so GPUI maintains focus state.
    pub(crate) focus_handles: HashMap<u64, gpui::FocusHandle>,
    /// Active focus/blur subscriptions keyed by element and event type.
    pub(crate) focus_subscriptions: HashMap<(u64, String), gpui::Subscription>,
    /// Registry for custom element types (input, editor, diff, etc.).
    /// Stores factories (one per type) and live instances (one per element ID).
    pub(crate) custom_registry: CustomElementRegistry,
    /// Persistent ScrollHandles keyed by element ID.
    /// Created lazily for elements with overflow: "scroll" (or per-axis scroll).
    /// Handles persist across renders so GPUI maintains scroll offset state.
    pub(crate) scroll_handles: HashMap<u64, gpui::ScrollHandle>,
    /// Native animation clocks keyed by retained element ID.
    pub(crate) motion_states: HashMap<u64, crate::motion::MotionState>,
    /// Live text selection, shared with the paint closures and the napi methods.
    pub(crate) selection: SharedSelection,
    /// Persistent measurement and scroll state for React-backed virtual lists.
    virtual_lists: HashMap<u64, VirtualListEntry>,
    /// Motion / review clock. Live wall time unless automation freezes it.
    pub(crate) clock: crate::automation::AutomationClock,
}

impl GpuixView {
    pub(crate) fn new(
        tree: Arc<Mutex<RetainedTree>>,
        event_callback: Option<EventCallback>,
        window_event_callback: WindowEventCallback,
        window_title: String,
        selection: SharedSelection,
    ) -> Self {
        Self {
            tree,
            event_callback,
            window_event_callback,
            window_bounds_subscription: None,
            window_title,
            focus_handles: HashMap::new(),
            focus_subscriptions: HashMap::new(),
            custom_registry: CustomElementRegistry::with_defaults(),
            scroll_handles: HashMap::new(),
            motion_states: HashMap::new(),
            selection,
            virtual_lists: HashMap::new(),
            clock: crate::automation::AutomationClock::new(),
        }
    }

    fn observe_window_resize(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.window_bounds_subscription.is_none() {
            self.window_bounds_subscription =
                Some(cx.observe_window_bounds(window, |view, window, _cx| {
                    emit_window_resize(&view.window_event_callback, window)
                }));
        }
    }

    fn build_virtual_child(
        &mut self,
        list_id: u64,
        index: usize,
        expected_child_id: u64,
        inherited: Inherited,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let row_focus_handle = self.virtual_lists.get_mut(&list_id).and_then(|entry| {
            entry.seen_rows.insert(expected_child_id);
            (entry.child_at(index) == Some(expected_child_id))
                .then(|| {
                    index
                        .checked_sub(entry.window_start)
                        .and_then(|offset| entry.row_focus_handles.get(offset).cloned())
                })
                .flatten()
                .flatten()
        });

        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let window_start = self
            .virtual_lists
            .get(&list_id)
            .map(|entry| entry.window_start)
            .unwrap_or(0);
        let child_matches = tree.elements.get(&list_id).and_then(|list| {
            index
                .checked_sub(window_start)
                .and_then(|offset| list.children.get(offset))
        }) == Some(&expected_child_id);
        if !child_matches {
            return gpui::Empty.into_any_element();
        }

        let callback = self.event_callback.clone();
        let now = self.clock.now();
        let mut motion_active = false;
        let mut build_ctx = BuildCtx {
            tree: &tree,
            event_callback: &callback,
            focus_handles: &self.focus_handles,
            scroll_handles: &mut self.scroll_handles,
            custom_registry: &mut self.custom_registry,
            virtual_lists: &mut self.virtual_lists,
            motion_states: &mut self.motion_states,
            now,
            motion_active: &mut motion_active,
            selection: self.selection.clone(),
            inherited,
        };
        let child = build_element(expected_child_id, &mut build_ctx, window, cx);
        if motion_active {
            window.request_animation_frame();
        }
        let row = gpui::div()
            .id(gpui::SharedString::from(format!(
                "__gpuix_virtual_row_{}_{}",
                list_id, expected_child_id
            )))
            .w_full();
        let row = if let Some(focus_handle) = row_focus_handle {
            row.track_focus(&focus_handle)
        } else {
            row
        };
        row.child(child).into_any_element()
    }

    pub(crate) fn scroll_virtual_list_to_item(&self, id: u64, index: usize) -> bool {
        let Some(entry) = self.virtual_lists.get(&id) else {
            return false;
        };
        entry.state.scroll_to(gpui::ListOffset {
            item_ix: index,
            offset_in_item: gpui::px(0.0),
        });
        emit_event_full(&self.event_callback, id, "visibleRange", |payload| {
            payload.start_index = Some(index as f64);
            payload.end_index = Some((index + 1) as f64);
        });
        true
    }

    pub(crate) fn set_virtual_list_offset(&self, id: u64, x: f32, y: f32) -> bool {
        let Some(entry) = self.virtual_lists.get(&id) else {
            return false;
        };
        entry
            .state
            .set_offset_from_scrollbar(gpui::point(gpui::px(x), gpui::px(y)));
        true
    }

    pub(crate) fn virtual_list_offset(&self, id: u64) -> Option<[f64; 2]> {
        let offset = self
            .virtual_lists
            .get(&id)?
            .state
            .scroll_px_offset_for_scrollbar();
        Some([
            f64::from(f32::from(offset.x)),
            f64::from(f32::from(offset.y)),
        ])
    }

    pub(crate) fn reveal_virtual_list_ancestor(&self, id: u64) -> bool {
        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let mut current = id;
        let location = loop {
            let Some(parent_id) = tree
                .elements
                .get(&current)
                .and_then(|element| element.parent)
            else {
                break None;
            };
            if self.virtual_lists.contains_key(&parent_id) {
                let index = tree
                    .elements
                    .get(&parent_id)
                    .and_then(|parent| parent.children.iter().position(|child| *child == current));
                break index.map(|index| (parent_id, index));
            }
            current = parent_id;
        };
        drop(tree);

        let Some((list_id, index)) = location else {
            return false;
        };
        self.scroll_virtual_list_to_item(list_id, index)
    }
}

/// Everything `build_element` threads through the tree.
///
/// Split into a struct because the recursion needs eight-plus shared references
/// and adding one more to every call site is how this file rots. `window` and
/// `cx` stay separate parameters: they are `&mut` and gpui reborrows them.
pub(crate) struct BuildCtx<'a> {
    pub tree: &'a RetainedTree,
    pub event_callback: &'a Option<EventCallback>,
    pub focus_handles: &'a HashMap<u64, gpui::FocusHandle>,
    pub scroll_handles: &'a mut HashMap<u64, gpui::ScrollHandle>,
    pub custom_registry: &'a mut CustomElementRegistry,
    virtual_lists: &'a mut HashMap<u64, VirtualListEntry>,
    pub motion_states: &'a mut HashMap<u64, crate::motion::MotionState>,
    pub now: web_time::Instant,
    pub motion_active: &'a mut bool,
    pub selection: SharedSelection,
    /// Inherited text state, resolved the way CSS inherits it. The renderer's
    /// own theme only seeds the root selection wash; custom elements resolve
    /// their own theme from their `theme` prop.
    pub inherited: Inherited,
}

/// Style properties that cascade into descendants.
#[derive(Clone, Copy)]
pub(crate) struct Inherited {
    /// False once an ancestor sets `userSelect: "none"`.
    pub selectable: bool,
    /// Selection wash colour for this subtree.
    pub selection_wash: gpui::Hsla,
    /// Text case transformation inherited by plain text descendants.
    pub text_transform: TextTransform,
}

#[derive(Clone, Copy, Default)]
pub(crate) enum TextTransform {
    #[default]
    None,
    Uppercase,
    Lowercase,
}

impl Inherited {
    fn root(theme: &Theme) -> Self {
        let mut wash = theme.accent;
        wash.a = 0.35;
        Self {
            selectable: true,
            selection_wash: wash,
            text_transform: TextTransform::None,
        }
    }

    /// Apply the inheritable parts of `style` for the subtree below it.
    fn descend(mut self, style: Option<&StyleDesc>) -> Self {
        let Some(style) = style else { return self };
        match style.user_select.as_deref() {
            Some("none") => self.selectable = false,
            Some("text") | Some("auto") => self.selectable = true,
            _ => {}
        }
        if let Some(color) = style
            .selection_color
            .as_deref()
            .and_then(crate::color::parse_color_rgba)
        {
            self.selection_wash = color.into();
        }
        match style.text_transform.as_deref() {
            Some("none") => self.text_transform = TextTransform::None,
            Some("uppercase") => self.text_transform = TextTransform::Uppercase,
            Some("lowercase") => self.text_transform = TextTransform::Lowercase,
            _ => {}
        }
        self
    }
}

fn json_usize(value: &serde_json::Value) -> Option<usize> {
    value
        .as_u64()
        .map(|n| n as usize)
        .or_else(|| {
            value
                .as_f64()
                .filter(|n| *n >= 0.0 && n.is_finite())
                .map(|n| n as usize)
        })
        .or_else(|| value.as_i64().filter(|n| *n >= 0).map(|n| n as usize))
}

fn window_start_from_element(element: &crate::retained_tree::RetainedElement) -> usize {
    element
        .custom_props
        .get("windowStart")
        .and_then(json_usize)
        .unwrap_or(0)
}

#[derive(Clone, Copy, PartialEq)]
struct VirtualListConfig {
    alignment: gpui::ListAlignment,
    follow_tail: bool,
    overdraw: f32,
    estimated_item_height: Option<f32>,
    item_count: Option<usize>,
}

impl VirtualListConfig {
    fn from_element(element: &crate::retained_tree::RetainedElement) -> Self {
        let prop = |key: &str| element.custom_props.get(key);
        let alignment = match prop("alignment").and_then(serde_json::Value::as_str) {
            Some("bottom") => gpui::ListAlignment::Bottom,
            _ => gpui::ListAlignment::Top,
        };
        let follow_tail = prop("followTail")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let overdraw = prop("overdraw")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(512.0)
            .max(0.0) as f32;
        let estimated_item_height = prop("estimatedItemHeight")
            .and_then(serde_json::Value::as_f64)
            .filter(|height| *height > 0.0)
            .map(|height| height as f32);
        let item_count = prop("itemCount").and_then(json_usize);
        Self {
            alignment,
            follow_tail,
            overdraw,
            estimated_item_height,
            item_count,
        }
    }

    fn logical_count(self, child_len: usize) -> usize {
        self.item_count.unwrap_or(child_len)
    }

    fn make_state(
        self,
        item_count: usize,
        focus_handles: &[Option<gpui::FocusHandle>],
    ) -> gpui::ListState {
        let mut state = gpui::ListState::new(item_count, self.alignment, gpui::px(self.overdraw));
        if focus_handles.len() == item_count {
            state.splice_focusable(0..item_count, focus_handles.iter().cloned());
        } else {
            state.splice_focusable(0..item_count, (0..item_count).map(|_| None));
        }
        if let Some(height) = self.estimated_item_height {
            state = state.with_uniform_item_height(gpui::px(height));
        }
        if self.follow_tail {
            state.set_follow_mode(gpui::FollowMode::Tail);
        }
        state
    }
}

struct VirtualListEntry {
    state: gpui::ListState,
    config: VirtualListConfig,
    window_start: usize,
    child_ids: Vec<u64>,
    child_revisions: Vec<u64>,
    row_focus_handles: Vec<Option<gpui::FocusHandle>>,
    seen_rows: HashSet<u64>,
}

impl VirtualListEntry {
    fn new(
        config: VirtualListConfig,
        window_start: usize,
        child_ids: Vec<u64>,
        child_revisions: Vec<u64>,
        row_focus_handles: Vec<Option<gpui::FocusHandle>>,
    ) -> Self {
        let item_count = config.logical_count(child_ids.len());
        let state = config.make_state(item_count, &row_focus_handles);
        if row_focus_handles.len() != item_count {
            for (offset, handle) in row_focus_handles.iter().enumerate() {
                if handle.is_some() {
                    let logical = window_start + offset;
                    if logical < item_count {
                        state.splice_focusable(
                            logical..logical + 1,
                            std::iter::once(handle.clone()),
                        );
                    }
                }
            }
        }
        Self {
            state,
            config,
            window_start,
            child_ids,
            child_revisions,
            row_focus_handles,
            seen_rows: HashSet::new(),
        }
    }

    fn child_at(&self, logical_index: usize) -> Option<u64> {
        logical_index
            .checked_sub(self.window_start)
            .and_then(|offset| self.child_ids.get(offset).copied())
    }

    fn logical_index_of(&self, child_id: u64) -> Option<usize> {
        self.child_ids
            .iter()
            .position(|id| *id == child_id)
            .map(|offset| self.window_start + offset)
    }

    fn sync(
        &mut self,
        config: VirtualListConfig,
        window_start: usize,
        child_ids: Vec<u64>,
        child_revisions: Vec<u64>,
        focusable_rows: &HashSet<u64>,
        cx: &mut gpui::Context<GpuixView>,
    ) {
        let focus_unchanged = self.child_ids == child_ids
            && self.row_focus_handles.len() == child_ids.len()
            && self
                .child_ids
                .iter()
                .zip(&self.row_focus_handles)
                .all(|(id, handle)| handle.is_some() == focusable_rows.contains(id));
        if self.config == config
            && self.window_start == window_start
            && focus_unchanged
            && self.child_revisions == child_revisions
        {
            return;
        }

        let old_rows: HashMap<u64, (u64, Option<gpui::FocusHandle>)> = self
            .child_ids
            .iter()
            .copied()
            .zip(self.child_revisions.iter().copied())
            .zip(self.row_focus_handles.iter().cloned())
            .map(|((id, revision), focus_handle)| (id, (revision, focus_handle)))
            .collect();
        let row_focus_handles: Vec<Option<gpui::FocusHandle>> = child_ids
            .iter()
            .map(|id| {
                focusable_rows.contains(id).then(|| {
                    old_rows
                        .get(id)
                        .and_then(|(_, focus_handle)| focus_handle.clone())
                        .unwrap_or_else(|| cx.focus_handle())
                })
            })
            .collect();
        if self.config != config {
            let scroll_top = self.state.logical_scroll_top();
            let should_follow =
                config.follow_tail && (!self.config.follow_tail || self.state.is_following_tail());
            let mut replacement = Self::new(
                config,
                window_start,
                child_ids,
                child_revisions,
                row_focus_handles,
            );
            replacement.seen_rows = std::mem::take(&mut self.seen_rows);
            replacement
                .seen_rows
                .retain(|id| replacement.child_ids.contains(id));
            if !should_follow {
                replacement.state.scroll_to(scroll_top);
            }
            *self = replacement;
            return;
        }

        // A windowed list's children are a sliding viewport. Splicing by
        // child position would treat a scroll as a rewrite of items 0..N.
        if config.item_count.is_none() && self.child_ids != child_ids {
            let prefix = self
                .child_ids
                .iter()
                .zip(&child_ids)
                .take_while(|(old, new)| old == new)
                .count();
            let suffix = self.child_ids[prefix..]
                .iter()
                .rev()
                .zip(child_ids[prefix..].iter().rev())
                .take_while(|(old, new)| old == new)
                .count();
            self.state.splice_focusable(
                prefix..self.child_ids.len().saturating_sub(suffix),
                row_focus_handles[prefix..row_focus_handles.len().saturating_sub(suffix)]
                    .iter()
                    .cloned(),
            );
            if let Some(height) = config.estimated_item_height {
                self.state = self
                    .state
                    .clone()
                    .with_uniform_item_height(gpui::px(height));
            }
        }

        for (offset, (&id, focus_handle)) in child_ids.iter().zip(&row_focus_handles).enumerate() {
            let logical = window_start + offset;
            let focusability_changed = old_rows
                .get(&id)
                .is_some_and(|(_, old_handle)| old_handle.is_some() != focus_handle.is_some());
            if focusability_changed {
                self.state
                    .splice_focusable(logical..logical + 1, std::iter::once(focus_handle.clone()));
            }
        }

        let mut changed_start = None;
        for (offset, (&id, &revision)) in child_ids.iter().zip(&child_revisions).enumerate() {
            let logical = window_start + offset;
            let changed = old_rows
                .get(&id)
                .is_some_and(|(old_revision, _)| *old_revision != revision);
            match (changed_start, changed) {
                (None, true) => changed_start = Some(logical),
                (Some(start), false) => {
                    self.state.remeasure_items(start..logical);
                    changed_start = None;
                }
                _ => {}
            }
        }
        if let Some(start) = changed_start {
            self.state
                .remeasure_items(start..window_start + child_ids.len());
        }

        self.window_start = window_start;
        self.child_ids = child_ids;
        self.child_revisions = child_revisions;
        self.row_focus_handles = row_focus_handles;
    }
}

impl GpuixView {
    /// Sync focus handles with the current element tree.
    /// Creates handles for new focusable elements, subscribes on_focus/on_blur,
    /// and cleans up handles for destroyed elements.
    fn sync_focus_handles(
        &mut self,
        tree: &RetainedTree,
        callback: &Option<EventCallback>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let tab_index = |element: &crate::retained_tree::RetainedElement| {
            element
                .custom_props
                .get("tabIndex")
                .and_then(|value| value.as_i64())
                .and_then(|index| isize::try_from(index).ok())
        };
        let needs_focus = |element: &crate::retained_tree::RetainedElement| {
            matches!(element.element_type.as_str(), "input" | "textarea")
                || tab_index(element).is_some()
                || element.events.contains("keyDown")
                || element.events.contains("keyUp")
                || element.events.contains("focus")
                || element.events.contains("blur")
        };
        // Create handles for elements that need focus but don't have one yet.
        for (&id, element) in &tree.elements {
            let tab_index = tab_index(element).or_else(|| {
                matches!(element.element_type.as_str(), "input" | "textarea").then_some(0)
            });

            if needs_focus(element) && !self.focus_handles.contains_key(&id) {
                let handle = match tab_index {
                    Some(index) => cx.focus_handle().tab_index(index).tab_stop(index >= 0),
                    None => cx.focus_handle(),
                };
                // Focus once, at creation. Re-focusing every frame would
                // steal focus back from whatever the user clicked next.
                if element.auto_focus {
                    handle.focus(window, cx);
                }
                self.focus_handles.insert(id, handle);
            } else if let (Some(handle), Some(index)) =
                (self.focus_handles.get(&id).cloned(), tab_index)
            {
                self.focus_handles
                    .insert(id, handle.tab_index(index).tab_stop(index >= 0));
            } else if let Some(handle) = self.focus_handles.get(&id).cloned() {
                self.focus_handles.insert(id, handle.tab_stop(false));
            }
        }

        self.focus_subscriptions.retain(|(id, event), _| {
            tree.elements
                .get(id)
                .is_some_and(|element| element.events.contains(event))
        });
        for (&id, element) in &tree.elements {
            let Some(handle) = self.focus_handles.get(&id).cloned() else {
                continue;
            };
            let focus_key = (id, "focus".to_string());
            if element.events.contains("focus")
                && !self.focus_subscriptions.contains_key(&focus_key)
            {
                let callback = callback.clone();
                let subscription = cx.on_focus(&handle, window, move |_this, _window, _cx| {
                    emit_event_full(&callback, id, "focus", |_| {});
                });
                self.focus_subscriptions.insert(focus_key, subscription);
            }
            let blur_key = (id, "blur".to_string());
            if element.events.contains("blur") && !self.focus_subscriptions.contains_key(&blur_key)
            {
                let callback = callback.clone();
                let subscription = cx.on_blur(&handle, window, move |_this, _window, _cx| {
                    emit_event_full(&callback, id, "blur", |_| {});
                });
                self.focus_subscriptions.insert(blur_key, subscription);
            }
        }

        // Clean up handles for elements that no longer exist.
        self.focus_handles
            .retain(|id, _| tree.elements.get(id).is_some_and(&needs_focus));
    }
}

impl gpui::Render for GpuixView {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        use gpui::IntoElement;

        window.set_window_title(&self.window_title);
        self.observe_window_resize(window, cx);

        // Clone Arc so we don't borrow self.tree — frees self for focus_handles access.
        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let callback = self.event_callback.clone();

        // Sync focus handles before building elements.
        self.sync_focus_handles(&tree, &callback, window, cx);

        // Ensure custom element instances are destroyed when their IDs disappear.
        self.custom_registry
            .prune_missing(|id| tree.elements.contains_key(&id));

        // Clean up scroll handles for destroyed elements (IDs removed from tree).
        // Scrollability-based cleanup (element still exists but style changed
        // from scroll to non-scroll) is handled inside build_div().
        self.scroll_handles
            .retain(|id, _| tree.elements.contains_key(id));
        self.virtual_lists
            .retain(|id, _| tree.elements.contains_key(id));
        self.motion_states
            .retain(|id, _| tree.elements.contains_key(id));

        // Build the element tree. custom_registry, focus_handles, and scroll_handles
        // are different fields of self, so Rust allows borrowing all simultaneously.
        let theme = Theme::dark();
        let now = self.clock.now();
        let mut motion_active = false;
        let result = match tree.root_id {
            Some(root_id) => {
                let mut ctx = BuildCtx {
                    tree: &tree,
                    event_callback: &callback,
                    focus_handles: &self.focus_handles,
                    scroll_handles: &mut self.scroll_handles,
                    custom_registry: &mut self.custom_registry,
                    virtual_lists: &mut self.virtual_lists,
                    motion_states: &mut self.motion_states,
                    now,
                    motion_active: &mut motion_active,
                    selection: self.selection.clone(),
                    inherited: Inherited::root(&theme),
                };
                build_element(root_id, &mut ctx, window, cx)
            }
            None => gpui::Empty.into_any_element(),
        };

        // The frame reset must paint BEFORE any text, so it is the first child of
        // the root wrapper. Without it the selection registry accumulates stale
        // entries across frames and a drag resolves against elements that are no
        // longer on screen.
        let result = {
            use gpui::prelude::*;
            gpui::div()
                .size_full()
                .on_action(|_: &FocusNext, window, cx| window.focus_next(cx))
                .on_action(|_: &FocusPrevious, window, cx| window.focus_prev(cx))
                .child(selection_frame_reset(self.selection.clone()))
                .child(crate::automation::bounds_frame_reset())
                .child(result)
                .into_any_element()
        };

        // Sync scroll handles to thread_local so napi methods (scrollTo,
        // getScrollOffset) can access them without an App context.
        SCROLL_HANDLES.with(|cell| {
            let mut handles = cell.borrow_mut();
            handles.clear();
            for (&id, handle) in &self.scroll_handles {
                handles.insert(id, handle.clone());
            }
        });
        VIRTUAL_LIST_STATES.with(|cell| {
            let mut states = cell.borrow_mut();
            states.clear();
            for (&id, entry) in &self.virtual_lists {
                states.insert(id, entry.state.clone());
            }
        });

        if motion_active {
            window.request_animation_frame();
        }

        result
    }
}

// ── Element builders ─────────────────────────────────────────────────

pub(crate) fn build_element(
    id: u64,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::IntoElement;

    let Some(element) = ctx.tree.elements.get(&id) else {
        return gpui::Empty.into_any_element();
    };

    let animated_style = if let Some(source) = element.custom_props.get("motion") {
        let state = match ctx.motion_states.entry(id) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                match crate::motion::MotionState::new(source, ctx.now) {
                    Ok(state) => entry.insert(state),
                    Err(error) => {
                        log::warn!("Invalid motion description for element {id}: {error}");
                        entry.insert(crate::motion::MotionState::invalid(source, ctx.now))
                    }
                }
            }
        };
        if let Err(error) = state.sync(source, ctx.now) {
            log::warn!("Invalid motion update for element {id}: {error}");
        }
        state.is_valid().then(|| {
            let frame = state.frame(ctx.now);
            *ctx.motion_active |= frame.active;
            let mut resolved = element.style.clone().unwrap_or_default();
            frame.style.apply_to(&mut resolved);
            resolved
        })
    } else {
        ctx.motion_states.remove(&id);
        None
    };
    let style = animated_style.as_ref().or(element.style.as_ref());

    // Inheritable style resolves once here so both built-ins and custom
    // elements see the same cascade.
    let parent_inherited = ctx.inherited;
    ctx.inherited = parent_inherited.descend(style);

    let built = match element.element_type.as_str() {
        "div" => {
            ctx.custom_registry.destroy(id);
            build_div(element, style, ctx, window, cx)
        }
        "text" => {
            ctx.custom_registry.destroy(id);
            build_text(element, style, ctx, window, cx)
        }
        "virtual-list" => {
            ctx.custom_registry.destroy(id);
            build_virtual_list(element, ctx, window, cx)
        }

        // Polymorphic dispatch for all custom elements.
        custom_type => {
            let custom_children: Vec<gpui::AnyElement> = element
                .children
                .iter()
                .copied()
                .filter(|child_id| ctx.tree.elements.contains_key(child_id))
                .map(|child_id| build_element(child_id, ctx, window, cx))
                .collect();
            let inherited = ctx.inherited;
            let render_ctx = CustomRenderContext {
                id,
                events: &element.events,
                event_callback: ctx.event_callback,
                focus_handle: ctx.focus_handles.get(&id),
                style,
                children: custom_children,
                selection: ctx.selection.clone(),
                selectable: inherited.selectable,
                selection_wash: inherited.selection_wash,
            };
            ctx.custom_registry
                .render(custom_type, &element.custom_props, render_ctx, window, cx)
        }
    };

    ctx.inherited = parent_inherited;
    built
}

fn build_virtual_list(
    element: &crate::retained_tree::RetainedElement,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    let child_ids: Vec<u64> = element
        .children
        .iter()
        .copied()
        .filter(|child_id| ctx.tree.elements.contains_key(child_id))
        .collect();
    let child_revisions: Vec<u64> = child_ids
        .iter()
        .filter_map(|child_id| {
            ctx.tree
                .elements
                .get(child_id)
                .map(|child| child.subtree_revision)
        })
        .collect();
    let focusable_rows: HashSet<u64> = ctx
        .focus_handles
        .keys()
        .filter_map(|element_id| virtual_row_ancestor(ctx.tree, element.id, *element_id))
        .collect();
    let focused_row = ctx
        .focus_handles
        .iter()
        .find_map(|(element_id, handle)| {
            handle
                .is_focused(window)
                .then(|| virtual_row_ancestor(ctx.tree, element.id, *element_id))
                .flatten()
        })
        .or_else(|| {
            ctx.focus_handles.keys().find_map(|element_id| {
                ctx.tree
                    .elements
                    .get(element_id)
                    .is_some_and(|element| element.auto_focus)
                    .then(|| virtual_row_ancestor(ctx.tree, element.id, *element_id))
                    .flatten()
            })
        });
    let config = VirtualListConfig::from_element(element);
    let window_start = window_start_from_element(element);
    let list_state = match ctx.virtual_lists.entry(element.id) {
        std::collections::hash_map::Entry::Occupied(mut entry) => {
            entry.get_mut().sync(
                config,
                window_start,
                child_ids.clone(),
                child_revisions,
                &focusable_rows,
                cx,
            );
            let entry = entry.into_mut();
            if let Some(row_id) = focused_row.filter(|row_id| !entry.seen_rows.contains(row_id)) {
                if let Some(index) = entry.logical_index_of(row_id) {
                    entry.state.scroll_to(gpui::ListOffset {
                        item_ix: index,
                        offset_in_item: gpui::px(0.0),
                    });
                }
            }
            entry.state.clone()
        }
        std::collections::hash_map::Entry::Vacant(entry) => {
            let row_focus_handles = child_ids
                .iter()
                .map(|id| focusable_rows.contains(id).then(|| cx.focus_handle()))
                .collect();
            let entry = entry.insert(VirtualListEntry::new(
                config,
                window_start,
                child_ids.clone(),
                child_revisions,
                row_focus_handles,
            ));
            if let Some(row_id) = focused_row {
                if let Some(index) = entry.logical_index_of(row_id) {
                    entry.state.scroll_to(gpui::ListOffset {
                        item_ix: index,
                        offset_in_item: gpui::px(0.0),
                    });
                }
            }
            entry.state.clone()
        }
    };

    if element.events.contains("visibleRange") {
        let callback = ctx.event_callback.clone();
        let list_id = element.id;
        list_state.set_scroll_handler(move |event, _window, _cx| {
            emit_event_full(&callback, list_id, "visibleRange", |payload| {
                payload.start_index = Some(event.visible_range.start as f64);
                payload.end_index = Some(event.visible_range.end as f64);
            });
        });
    }

    let list_id = element.id;
    let inherited = ctx.inherited;
    let render_item = cx.processor(move |view, index: usize, window, cx| {
        let Some(child_id) = view
            .virtual_lists
            .get(&list_id)
            .and_then(|entry| entry.child_at(index))
        else {
            return gpui::Empty.into_any_element();
        };
        view.build_virtual_child(list_id, index, child_id, inherited, window, cx)
    });
    let mut list =
        gpui::list(list_state, render_item).with_sizing_behavior(gpui::ListSizingBehavior::Auto);
    if let Some(style) = element.style.as_ref() {
        list = apply_styles(list, style);
    }
    list.into_any_element()
}

fn virtual_row_ancestor(tree: &RetainedTree, list_id: u64, element_id: u64) -> Option<u64> {
    let mut current = element_id;
    loop {
        let parent = tree.elements.get(&current)?.parent?;
        if parent == list_id {
            return Some(current);
        }
        current = parent;
    }
}

pub(crate) fn build_div(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&StyleDesc>,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    let element_id_str = format!("__gpuix_{}", element.id);
    let mut el = gpui::div().id(gpui::SharedString::from(element_id_str));

    if let Some(style) = style {
        el = apply_styles(el, style);

        // ── Pseudo-selector styles (hover / active) ──────────────────
        // GPUI's .hover() and .active() take a closure that receives a
        // StyleRefinement and returns it with modifications. Since
        // StyleRefinement implements Styled, we can reuse apply_styles().
        if let Some(ref hover_style) = style.hover {
            el = el.hover(|refinement| apply_styles(refinement, hover_style));
        }
        if let Some(ref active_style) = style.active {
            el = el.active(|refinement| apply_styles(refinement, active_style));
        }
        el = apply_focus_styles(el, style);

        if crate::style::should_occlude(style) {
            // BlockMouse (occlude) stops the hit test. The parent scroller
            // then never sees the wheel. In-flow fills must use
            // BlockMouseExceptScroll. Keep occlude for overlays that steal
            // the pointer: absolute, fixed, or pointerEvents: "auto".
            let steal_scroll =
                matches!(style.position.as_deref(), Some("absolute") | Some("fixed"))
                    || style.pointer_events.as_deref() == Some("auto");
            el = if steal_scroll {
                el.occlude()
            } else {
                el.block_mouse_except_scroll()
            };
        }
    }

    // ── Overflow: scroll ─────────────────────────────────────────────
    // overflow_scroll() requires StatefulInteractiveElement (only on Stateful<Div>),
    // so we handle it here rather than in apply_styles (which takes E: Styled).
    //
    // CSS precedence: axis-specific props (overflowX/Y) override the shorthand
    // (overflow). E.g. { overflow: "scroll", overflowY: "hidden" } → scroll X only.
    //
    // overflow-x only works as a flex viewport. Default display is Block, so a
    // wide child fills the parent instead of overflowing. Zed's code-block path:
    // flex + min_w_0 on the scroller, flex_none on the child.
    let mut overflow_x_only = false;
    if let Some(style) = style {
        // Resolve each axis: axis-specific overrides shorthand.
        let resolved_x = style.overflow_x.as_deref().or(style.overflow.as_deref());
        let resolved_y = style.overflow_y.as_deref().or(style.overflow.as_deref());

        let needs_scroll_x = resolved_x == Some("scroll");
        let needs_scroll_y = resolved_y == Some("scroll");

        if needs_scroll_x && needs_scroll_y {
            el = el.overflow_scroll();
        } else if needs_scroll_x {
            overflow_x_only = true;
            el = el
                .flex()
                .min_w_0()
                .overflow_x_scroll()
                .restrict_scroll_to_axis();
        } else if needs_scroll_y {
            el = el.overflow_y_scroll();
        }

        // Attach a persistent ScrollHandle when scrolling is enabled.
        // The handle persists across renders (stored in GpuixView::scroll_handles)
        // so GPUI maintains the scroll offset between frames.
        if needs_scroll_x || needs_scroll_y {
            let handle = ctx
                .scroll_handles
                .entry(element.id)
                .or_insert_with(gpui::ScrollHandle::new);
            el = el.track_scroll(handle);
        } else {
            // Element is no longer scrollable — remove stale handle.
            ctx.scroll_handles.remove(&element.id);
        }
    } else {
        // No style at all — remove stale handle if it existed.
        ctx.scroll_handles.remove(&element.id);
    }

    // If a FocusHandle was pre-created for this element (by sync_focus_handles),
    // attach it via track_focus. This makes the element focusable — clicking it
    // or tabbing to it gives it keyboard focus. The handle persists across renders
    // because it's stored in GpuixView::focus_handles.
    if style.and_then(|style| style.position.as_deref()).is_none() {
        el = el.relative();
    }
    el = el.child(crate::automation::bounds_tracker(
        element.id,
        selection_start_flag(style),
    ));

    if let Some(handle) = ctx.focus_handles.get(&element.id) {
        el = el.track_focus(handle);
    }
    if let Some(tab_index) = element
        .custom_props
        .get("tabIndex")
        .and_then(|value| value.as_i64())
        .and_then(|index| isize::try_from(index).ok())
    {
        el = el.tab_index(tab_index).tab_stop(tab_index >= 0);
    }

    // Wire up events.
    // Some events (on_hover, on_click) require a stateful element (.id()),
    // which we already set above. Others (on_mouse_down, on_key_down) work
    // on any InteractiveElement.
    for event_type in &element.events {
        let id = element.id;
        let callback = ctx.event_callback.clone();
        match event_type.as_str() {
            // ── Click ────────────────────────────────────────────
            "click" => {
                el = el.on_click(move |click_event, _window, cx| {
                    let stop_native_propagation =
                        !matches!(click_event, gpui::ClickEvent::Keyboard(_));
                    emit_event_full(&callback, id, "click", |p| {
                        let (x, y) = point_to_xy(click_event.position());
                        p.x = Some(x);
                        p.y = Some(y);
                        p.modifiers = Some(click_event.modifiers().into());
                        p.click_count = Some(click_event.click_count() as u32);
                        p.is_right_click = Some(click_event.is_right_click());
                        p.button = Some(match click_event {
                            gpui::ClickEvent::Mouse(event) => {
                                mouse_button_to_u32(event.down.button)
                            }
                            gpui::ClickEvent::Keyboard(_) | gpui::ClickEvent::Touch(_) => 0,
                        });
                        p.input_source = Some(
                            match click_event {
                                gpui::ClickEvent::Mouse(_) => "mouse",
                                gpui::ClickEvent::Keyboard(_) => "keyboard",
                                gpui::ClickEvent::Touch(_) => "touch",
                            }
                            .to_string(),
                        );
                    });
                    if stop_native_propagation {
                        // React owns propagation from this native target onward. A keyboard
                        // click fires within key-up dispatch, so it must leave propagation
                        // active for this element's key-up listener to run afterward.
                        cx.stop_propagation();
                    }
                });
            }

            // ── Mouse down (all buttons) ─────────────────────────
            "mouseDown" => {
                // Wire all three buttons so JS gets right-click, middle-click, etc.
                for &button in &[
                    gpui::MouseButton::Left,
                    gpui::MouseButton::Middle,
                    gpui::MouseButton::Right,
                ] {
                    let callback = callback.clone();
                    el = el.on_mouse_down(button, move |mouse_event, _window, _cx| {
                        emit_event_full(&callback, id, "mouseDown", |p| {
                            let (x, y) = point_to_xy(mouse_event.position);
                            p.x = Some(x);
                            p.y = Some(y);
                            p.button = Some(mouse_button_to_u32(mouse_event.button));
                            p.click_count = Some(mouse_event.click_count as u32);
                            p.modifiers = Some(mouse_event.modifiers.into());
                        });
                    });
                }
            }

            // ── Mouse up (all buttons) ───────────────────────────
            "mouseUp" => {
                for &button in &[
                    gpui::MouseButton::Left,
                    gpui::MouseButton::Middle,
                    gpui::MouseButton::Right,
                ] {
                    let callback = callback.clone();
                    el = el.on_mouse_up(button, move |mouse_event, _window, _cx| {
                        emit_event_full(&callback, id, "mouseUp", |p| {
                            let (x, y) = point_to_xy(mouse_event.position);
                            p.x = Some(x);
                            p.y = Some(y);
                            p.button = Some(mouse_button_to_u32(mouse_event.button));
                            p.click_count = Some(mouse_event.click_count as u32);
                            p.modifiers = Some(mouse_event.modifiers.into());
                        });
                    });
                }
            }

            // ── Mouse move ───────────────────────────────────────
            "mouseMove" => {
                el = el.on_mouse_move(move |mouse_event, _window, _cx| {
                    emit_event_full(&callback, id, "mouseMove", |p| {
                        let (x, y) = point_to_xy(mouse_event.position);
                        p.x = Some(x);
                        p.y = Some(y);
                        p.modifiers = Some(mouse_event.modifiers.into());
                        p.pressed_button = mouse_event.pressed_button.map(mouse_button_to_u32);
                    });
                });
            }

            // ── Hover (mouseEnter + mouseLeave) ──────────────────
            // GPUI's on_hover fires with true on enter, false on leave.
            // We split into two distinct event types for the React side.
            "mouseEnter" | "mouseLeave" => {
                // Only wire once even if both mouseEnter and mouseLeave are registered.
                // Check if we already wired on_hover via the other event.
                let has_enter = element.events.contains("mouseEnter");
                let has_leave = element.events.contains("mouseLeave");
                // Wire on first encounter (mouseEnter sorts before mouseLeave).
                if event_type.as_str() == "mouseEnter" || !has_enter {
                    let callback_enter = if has_enter {
                        ctx.event_callback.clone()
                    } else {
                        None
                    };
                    let callback_leave = if has_leave {
                        ctx.event_callback.clone()
                    } else {
                        None
                    };
                    el = el.on_hover(move |&is_hovered, _window, _cx| {
                        if is_hovered {
                            emit_event_full(&callback_enter, id, "mouseEnter", |p| {
                                p.hovered = Some(true);
                            });
                        } else {
                            emit_event_full(&callback_leave, id, "mouseLeave", |p| {
                                p.hovered = Some(false);
                            });
                        }
                    });
                }
            }

            // ── Mouse down outside ───────────────────────────────
            // Fires when the user clicks OUTSIDE this element.
            // Critical for "click outside to close" pattern (dropdowns, modals).
            "mouseDownOutside" => {
                el = el.on_mouse_down_out(move |mouse_event, _window, _cx| {
                    emit_event_full(&callback, id, "mouseDownOutside", |p| {
                        let (x, y) = point_to_xy(mouse_event.position);
                        p.x = Some(x);
                        p.y = Some(y);
                        p.button = Some(mouse_button_to_u32(mouse_event.button));
                        p.modifiers = Some(mouse_event.modifiers.into());
                    });
                });
            }

            // ── Scroll wheel ─────────────────────────────────────
            "scroll" => {
                el = el.on_scroll_wheel(move |scroll_event, _window, _cx| {
                    emit_event_full(&callback, id, "scroll", |p| {
                        let (x, y) = point_to_xy(scroll_event.position);
                        p.x = Some(x);
                        p.y = Some(y);
                        p.modifiers = Some(scroll_event.modifiers.into());
                        p.precise = Some(scroll_event.delta.precise());

                        // Convert ScrollDelta to pixel values.
                        // For Lines delta, we use a default line height of 20px.
                        let line_height = gpui::px(20.0);
                        let pixel_delta = scroll_event.delta.pixel_delta(line_height);
                        p.delta_x = Some(f64::from(f32::from(pixel_delta.x)));
                        p.delta_y = Some(f64::from(f32::from(pixel_delta.y)));

                        p.touch_phase = Some(match scroll_event.touch_phase {
                            gpui::TouchPhase::Started => "started".to_string(),
                            gpui::TouchPhase::Moved => "moved".to_string(),
                            gpui::TouchPhase::Ended => "ended".to_string(),
                            gpui::TouchPhase::Cancelled => "cancelled".to_string(),
                        });
                    });
                });
            }

            // ── Key down ─────────────────────────────────────────
            // Requires .focusable() (set above). Element must be focused
            // (clicked or tabbed to) for these to fire.
            "keyDown" => {
                el = el.on_key_down(move |key_event, _window, _cx| {
                    emit_event_full(&callback, id, "keyDown", |p| {
                        p.key = Some(key_event.keystroke.key.clone());
                        p.key_char = key_event.keystroke.key_char.clone();
                        p.is_held = Some(key_event.is_held);
                        p.modifiers = Some(key_event.keystroke.modifiers.into());
                    });
                });
            }

            // ── Key up ───────────────────────────────────────────
            "keyUp" => {
                el = el.on_key_up(move |key_event, _window, _cx| {
                    emit_event_full(&callback, id, "keyUp", |p| {
                        p.key = Some(key_event.keystroke.key.clone());
                        p.key_char = key_event.keystroke.key_char.clone();
                        p.modifiers = Some(key_event.keystroke.modifiers.into());
                    });
                });
            }

            // ── Focus / Blur ─────────────────────────────────────
            // Event emission is handled by FocusHandle subscriptions
            // set up in GpuixView::sync_focus_handles(). The handle is
            // attached to this element via .track_focus() above.
            "focus" | "blur" => {}

            _ => {}
        }
    }

    // Text content — selectable, same as a <text> leaf.
    if let Some(ref content) = element.content {
        el = el.child(text_content(element.id, content, ctx));
    }

    // Children
    let child_ids: Vec<u64> = element.children.clone();
    for child_id in child_ids {
        let child = build_element(child_id, ctx, window, cx);
        el = if overflow_x_only {
            el.child(gpui::div().flex_none().child(child))
        } else {
            el.child(child)
        };
    }

    el.into_any_element()
}

/// A selectable text run owned by `element_id`. Runs are left to gpui so the
/// text keeps inheriting colour, weight and family from ancestor styles.
fn text_content(element_id: u64, content: &str, ctx: &BuildCtx) -> gpui::AnyElement {
    let content = match ctx.inherited.text_transform {
        TextTransform::None => content.to_string(),
        TextTransform::Uppercase => content.to_uppercase(),
        TextTransform::Lowercase => content.to_lowercase(),
    };
    if !ctx.inherited.selectable {
        // Still logged: `getPaintedText()` promises every painted string, and a
        // `userSelect: "none"` label is exactly the chrome tests want to assert.
        return crate::text::chrome_text(gpui::SharedString::from(content), None);
    }
    selectable_text(crate::text::SelectableText::new(
        gpui::SharedString::from(content),
        None,
        selection_key(element_id, 0),
        ctx.selection.clone(),
        ctx.inherited.selection_wash,
    ))
}

pub(crate) fn build_text(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&StyleDesc>,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    // Fast path: plain text leaf without style. It still goes through
    // `text_content` so the glyphs land in the selection registry — the old
    // raw-string return was the reason text was not selectable.
    if style.is_none() && element.children.is_empty() {
        let content = element.content.clone().unwrap_or_default();
        return gpui::div()
            .relative()
            .child(crate::automation::bounds_tracker(element.id, None))
            .child(text_content(element.id, &content, ctx))
            .into_any_element();
    }

    // The full style set, exactly as `<div>` gets it. `<text>` used to apply a
    // text-only subset, so `padding`, `width` and every layout prop on a text
    // node were silently dropped — a hole with no error and no warning.
    let mut el = gpui::div();
    if let Some(style) = style {
        el = apply_styles(el, style);
    }
    if style.and_then(|style| style.position.as_deref()).is_none() {
        el = el.relative();
    }
    el = el.child(crate::automation::bounds_tracker(
        element.id,
        selection_start_flag(style),
    ));

    if let Some(ref content) = element.content {
        el = el.child(text_content(element.id, content, ctx));
    }

    let child_ids: Vec<u64> = element.children.clone();
    for child_id in child_ids {
        el = el.child(build_element(child_id, ctx, window, cx));
    }

    el.into_any_element()
}

/// Explicit `userSelect` on this node. `None` means inherit; the ancestor
/// that set the value already owns the start region.
fn selection_start_flag(style: Option<&StyleDesc>) -> Option<bool> {
    match style.and_then(|style| style.user_select.as_deref()) {
        Some("none") => Some(false),
        Some("text") | Some("auto") => Some(true),
        _ => None,
    }
}

// ── Style application ────────────────────────────────────────────────

pub(crate) fn apply_width<E: gpui::Styled>(el: E, dim: &crate::style::DimensionValue) -> E {
    match dim {
        crate::style::DimensionValue::Pixels(v) => el.w(gpui::px(*v as f32)),
        crate::style::DimensionValue::Percentage(v) if *v >= 0.999 => el.w_full(),
        crate::style::DimensionValue::Percentage(v) => el.w(gpui::relative(*v as f32)),
        crate::style::DimensionValue::Auto => el,
    }
}

pub(crate) fn apply_height<E: gpui::Styled>(el: E, dim: &crate::style::DimensionValue) -> E {
    match dim {
        crate::style::DimensionValue::Pixels(v) => el.h(gpui::px(*v as f32)),
        crate::style::DimensionValue::Percentage(v) if *v >= 0.999 => el.h_full(),
        crate::style::DimensionValue::Percentage(v) => el.h(gpui::relative(*v as f32)),
        crate::style::DimensionValue::Auto => el,
    }
}

pub(crate) fn apply_focus_styles<E: gpui::StatefulInteractiveElement>(
    mut el: E,
    style: &StyleDesc,
) -> E {
    if let Some(ref focus_style) = style.focus {
        el = el.focus(|refinement| apply_styles(refinement, focus_style));
    }
    if let Some(ref focus_visible_style) = style.focus_visible {
        el = el.focus_visible(|refinement| apply_styles(refinement, focus_visible_style));
    }
    el
}

fn to_gpui_grid_track(track: &GridTrackValue) -> gpui::GridTrack {
    match track {
        GridTrackValue::Px { value } => gpui::GridTrack::Px(gpui::px(*value as f32)),
        GridTrackValue::Fr { value } => gpui::GridTrack::Fr(*value as f32),
        GridTrackValue::Auto => gpui::GridTrack::Auto,
        GridTrackValue::MinContent => gpui::GridTrack::MinContent,
        GridTrackValue::MaxContent => gpui::GridTrack::MaxContent,
        GridTrackValue::Minmax { min, max } => gpui::GridTrack::MinMax {
            min: match min {
                GridTrackMinValue::Px { value } => gpui::GridTrackMin::Px(gpui::px(*value as f32)),
                GridTrackMinValue::Auto => gpui::GridTrackMin::Auto,
                GridTrackMinValue::MinContent => gpui::GridTrackMin::MinContent,
                GridTrackMinValue::MaxContent => gpui::GridTrackMin::MaxContent,
            },
            max: match max {
                GridTrackMaxValue::Px { value } => gpui::GridTrackMax::Px(gpui::px(*value as f32)),
                GridTrackMaxValue::Fr { value } => gpui::GridTrackMax::Fr(*value as f32),
                GridTrackMaxValue::Auto => gpui::GridTrackMax::Auto,
                GridTrackMaxValue::MinContent => gpui::GridTrackMax::MinContent,
                GridTrackMaxValue::MaxContent => gpui::GridTrackMax::MaxContent,
            },
        },
        GridTrackValue::Repeat { .. } => {
            unreachable!("repeat is only valid as a grid template component")
        }
    }
}

fn legacy_grid_track(minimum: Option<&str>) -> gpui::GridTrack {
    match minimum {
        Some("min-content") => gpui::GridTrack::MinMax {
            min: gpui::GridTrackMin::MinContent,
            max: gpui::GridTrackMax::Fr(1.),
        },
        Some("max-content") => gpui::GridTrack::MinMax {
            min: gpui::GridTrackMin::Px(gpui::px(0.)),
            max: gpui::GridTrackMax::MaxContent,
        },
        _ => gpui::GridTrack::MinMax {
            min: gpui::GridTrackMin::Px(gpui::px(0.)),
            max: gpui::GridTrackMax::Fr(1.),
        },
    }
}

fn to_gpui_grid_template(
    template: &GridTemplateValue,
    legacy_minimum: Option<&str>,
) -> gpui::GridTemplate {
    let tracks = match template {
        GridTemplateValue::LegacyCount(count) => vec![gpui::GridTemplateComponent::Repeat {
            count: *count as u16,
            tracks: vec![legacy_grid_track(legacy_minimum)],
        }],
        GridTemplateValue::Tracks(tracks) => tracks
            .iter()
            .map(|track| match track {
                GridTrackValue::Repeat { count, tracks } => gpui::GridTemplateComponent::Repeat {
                    count: *count,
                    tracks: tracks.iter().map(to_gpui_grid_track).collect(),
                },
                track => gpui::GridTemplateComponent::Track(to_gpui_grid_track(track)),
            })
            .collect(),
    };
    gpui::GridTemplate { tracks }
}

pub(crate) fn apply_styles<E: gpui::Styled>(mut el: E, style: &StyleDesc) -> E {
    match style.visibility.as_deref() {
        Some("hidden") => el = el.invisible(),
        Some("visible") => el = el.visible(),
        _ => {}
    }
    match style.display.as_deref() {
        Some("flex") => el = el.flex(),
        Some("grid") => el = el.grid(),
        _ => {}
    }
    if let Some(cols) = &style.grid_template_columns {
        el = el.grid_template_columns(to_gpui_grid_template(
            cols,
            style.grid_column_min.as_deref(),
        ));
    }
    if let Some(rows) = &style.grid_template_rows {
        el = el.grid_template_rows(to_gpui_grid_template(rows, style.grid_row_min.as_deref()));
    }
    if style.flex_direction.as_deref() == Some("column") {
        el = el.flex_col();
    }
    if style.flex_direction.as_deref() == Some("row") {
        el = el.flex_row();
    }
    match style.flex_wrap.as_deref() {
        Some("wrap") => el = el.flex_wrap(),
        Some("wrap-reverse") => el = el.flex_wrap_reverse(),
        Some("nowrap") => el = el.flex_nowrap(),
        _ => {}
    }
    if let Some(grow) = style.flex_grow {
        el.style().flex_grow = Some(grow as f32);
    }
    if let Some(shrink) = style.flex_shrink {
        el.style().flex_shrink = Some(shrink as f32);
    }
    if let Some(basis) = style.flex_basis {
        el = el.flex_basis(gpui::px(basis as f32));
    }
    match style.align_items.as_deref() {
        Some("center") => el = el.items_center(),
        Some("start") | Some("flex-start") => el = el.items_start(),
        Some("end") | Some("flex-end") => el = el.items_end(),
        Some("stretch") => el = el.items_stretch(),
        _ => {}
    }
    match style.align_content.as_deref() {
        Some("center") => el = el.content_center(),
        Some("start") | Some("flex-start") => el = el.content_start(),
        Some("end") | Some("flex-end") => el = el.content_end(),
        Some("between") | Some("space-between") => el = el.content_between(),
        Some("around") | Some("space-around") => el = el.content_around(),
        Some("evenly") | Some("space-evenly") => el = el.content_evenly(),
        Some("stretch") => el = el.content_stretch(),
        Some("normal") => el = el.content_normal(),
        _ => {}
    }
    match style.justify_content.as_deref() {
        Some("center") => el = el.justify_center(),
        Some("start") | Some("flex-start") => el = el.justify_start(),
        Some("end") | Some("flex-end") => el = el.justify_end(),
        Some("between") | Some("space-between") => el = el.justify_between(),
        Some("around") | Some("space-around") => el = el.justify_around(),
        Some("evenly") | Some("space-evenly") => el = el.justify_evenly(),
        _ => {}
    }
    match style.align_self.as_deref() {
        Some("center") => {
            el.style().align_self = Some(gpui::AlignItems::Center);
        }
        Some("start") | Some("flex-start") => {
            el.style().align_self = Some(gpui::AlignItems::FlexStart);
        }
        Some("end") | Some("flex-end") => {
            el.style().align_self = Some(gpui::AlignItems::FlexEnd);
        }
        Some("stretch") => {
            el.style().align_self = Some(gpui::AlignItems::Stretch);
        }
        Some("baseline") => {
            el.style().align_self = Some(gpui::AlignItems::Baseline);
        }
        _ => {}
    }
    if let Some(gap) = style.gap {
        el = el.gap(gpui::px(gap as f32));
    }
    // Per-axis gaps were in the style type and implemented nowhere. They come
    // after `gap` so the axis value wins, matching CSS shorthand order.
    if let Some(gap) = style.row_gap {
        el = el.gap_y(gpui::px(gap as f32));
    }
    if let Some(gap) = style.column_gap {
        el = el.gap_x(gpui::px(gap as f32));
    }
    if let Some(ref w) = style.width {
        el = apply_width(el, w);
    }
    if let Some(ref h) = style.height {
        el = apply_height(el, h);
    }
    if let Some(ref min_w) = style.min_width {
        match min_w {
            crate::style::DimensionValue::Pixels(v) => el = el.min_w(gpui::px(*v as f32)),
            crate::style::DimensionValue::Percentage(v) => el = el.min_w(gpui::relative(*v as f32)),
            crate::style::DimensionValue::Auto => {}
        }
    }
    if let Some(ref min_h) = style.min_height {
        match min_h {
            crate::style::DimensionValue::Pixels(v) => el = el.min_h(gpui::px(*v as f32)),
            crate::style::DimensionValue::Percentage(v) => el = el.min_h(gpui::relative(*v as f32)),
            crate::style::DimensionValue::Auto => {}
        }
    }
    if let Some(ref max_w) = style.max_width {
        match max_w {
            crate::style::DimensionValue::Pixels(v) => el = el.max_w(gpui::px(*v as f32)),
            crate::style::DimensionValue::Percentage(v) => el = el.max_w(gpui::relative(*v as f32)),
            crate::style::DimensionValue::Auto => {}
        }
    }
    if let Some(ref max_h) = style.max_height {
        match max_h {
            crate::style::DimensionValue::Pixels(v) => el = el.max_h(gpui::px(*v as f32)),
            crate::style::DimensionValue::Percentage(v) => el = el.max_h(gpui::relative(*v as f32)),
            crate::style::DimensionValue::Auto => {}
        }
    }
    if let Some(p) = style.padding {
        el = el.p(gpui::px(p as f32));
    }
    if let Some(pt) = style.padding_top {
        el = el.pt(gpui::px(pt as f32));
    }
    if let Some(pr) = style.padding_right {
        el = el.pr(gpui::px(pr as f32));
    }
    if let Some(pb) = style.padding_bottom {
        el = el.pb(gpui::px(pb as f32));
    }
    if let Some(pl) = style.padding_left {
        el = el.pl(gpui::px(pl as f32));
    }
    if let Some(m) = style.margin {
        el = el.m(gpui::px(m as f32));
    }
    if let Some(mt) = style.margin_top {
        el = el.mt(gpui::px(mt as f32));
    }
    if let Some(mr) = style.margin_right {
        el = el.mr(gpui::px(mr as f32));
    }
    if let Some(mb) = style.margin_bottom {
        el = el.mb(gpui::px(mb as f32));
    }
    if let Some(ml) = style.margin_left {
        el = el.ml(gpui::px(ml as f32));
    }
    match style.position.as_deref() {
        Some("absolute") => el = el.absolute(),
        Some("relative") => el = el.relative(),
        _ => {}
    }
    if let Some(top) = style.top {
        el = el.top(gpui::px(top as f32));
    }
    if let Some(right) = style.right {
        el = el.right(gpui::px(right as f32));
    }
    if let Some(bottom) = style.bottom {
        el = el.bottom(gpui::px(bottom as f32));
    }
    if let Some(left) = style.left {
        el = el.left(gpui::px(left as f32));
    }
    if let Some(background_color) = style.background_color.as_deref() {
        if let Some(color) = crate::color::parse_color_rgba(background_color) {
            el = el.bg(color);
        }
    } else if let Some(background) = style.background.as_ref() {
        if let Ok(background) = crate::style::parse_background(background) {
            el = el.bg(background);
        }
    }
    if let Some(ref color) = style.color {
        if let Some(color) = crate::color::parse_color_rgba(color) {
            el = el.text_color(color);
        }
    }
    if let Some(size) = style.font_size {
        el = el.text_size(gpui::px(size as f32));
    }
    if let Some(ref family) = style.font_family {
        el = el.font_family(family.clone());
    }
    if let Some(ref weight) = style.font_weight {
        el = el.font_weight(parse_font_weight(weight));
    }
    if let Some(letter_spacing) = style.letter_spacing {
        el = el.letter_spacing(gpui::px(letter_spacing as f32));
    }
    // `textAlign` was in the style type but implemented nowhere.
    match style.text_align.as_deref() {
        Some("center") => el = el.text_center(),
        Some("right") => el = el.text_right(),
        Some("left") | Some("start") => el = el.text_left(),
        _ => {}
    }
    match style.white_space.as_deref() {
        Some("nowrap") => el = el.whitespace_nowrap(),
        Some("normal") => el = el.whitespace_normal(),
        _ => {}
    }
    match style.text_wrap.as_deref() {
        Some("nowrap") => el = el.whitespace_nowrap(),
        Some("wrap") => el = el.whitespace_normal(),
        _ => {}
    }
    match style.text_overflow.as_deref() {
        Some("ellipsis") => el = el.text_ellipsis(),
        Some("ellipsis-start") => el = el.text_ellipsis_start(),
        _ => {}
    }
    if let Some(clamp) = style.line_clamp {
        if clamp >= 1.0 {
            el = el.line_clamp(clamp as usize);
        }
    }
    // `line_height` was accepted by the style type but never applied, so
    // multi-line text always used gpui's default leading.
    if let Some(line_height) = style.line_height {
        if line_height > 0.0 {
            el = el.line_height(gpui::px(line_height as f32));
        }
    }
    if let Some(radius) = style.border_radius {
        el = el.rounded(gpui::px(radius as f32));
    }
    // Apply corner longhands after the shorthand so the explicit corner wins.
    if let Some(radius) = style.border_top_left_radius {
        el = el.rounded_tl(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_top_right_radius {
        el = el.rounded_tr(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_bottom_left_radius {
        el = el.rounded_bl(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_bottom_right_radius {
        el = el.rounded_br(gpui::px(radius as f32));
    }
    // `borderWidth: 0` must clear a border, not be ignored: an element that
    // draws its own border needs a way for the caller to remove it.
    if let Some(width) = style.border_width {
        el = el.border(gpui::px(width.max(0.0) as f32));
    }
    if let Some(width) = style.border_top_width {
        el = el.border_t(gpui::px(width.max(0.0) as f32));
    }
    if let Some(width) = style.border_right_width {
        el = el.border_r(gpui::px(width.max(0.0) as f32));
    }
    if let Some(width) = style.border_bottom_width {
        el = el.border_b(gpui::px(width.max(0.0) as f32));
    }
    if let Some(width) = style.border_left_width {
        el = el.border_l(gpui::px(width.max(0.0) as f32));
    }
    if let Some(ref color) = style.border_color {
        if let Some(color) = crate::color::parse_color_rgba(color) {
            el = el.border_color(color);
        }
    }
    if let Some(ref shadow) = style.box_shadow {
        if let Some(color) = crate::color::parse_color_rgba(&shadow.color) {
            let shadow = gpui::BoxShadow::new(
                gpui::px(shadow.offset_x as f32),
                gpui::px(shadow.offset_y as f32),
                color.into(),
            )
            .blur_radius(gpui::px(shadow.blur_radius.max(0.0) as f32))
            .spread_radius(gpui::px(shadow.spread_radius as f32));
            el = el.shadow(vec![shadow]);
        }
    }
    if let Some(ref color) = style.outline_color {
        if let Some(color) = crate::color::parse_color_rgba(color) {
            el = el.outline_color(color);
        }
    }
    if let Some(width) = style.outline_width {
        el = el.outline_width(gpui::px(width.max(0.0) as f32));
    }
    if let Some(offset) = style.outline_offset {
        el = el.outline_offset(gpui::px(offset as f32));
    }
    if let Some(opacity) = style.opacity {
        el = el.opacity(opacity as f32);
    }
    match style.cursor.as_deref() {
        Some("pointer") => el = el.cursor_pointer(),
        Some("default") => el = el.cursor_default(),
        _ => {}
    }
    // Overflow: hidden is on the Styled trait, so we handle it here.
    // overflow: "scroll" requires StatefulInteractiveElement — handled in build_div().
    // CSS precedence: axis-specific (overflowX/Y) overrides the shorthand (overflow).
    {
        let resolved_x = style.overflow_x.as_deref().or(style.overflow.as_deref());
        let resolved_y = style.overflow_y.as_deref().or(style.overflow.as_deref());
        // Only apply hidden here — scroll is handled in build_div.
        if resolved_x == Some("hidden") && resolved_y == Some("hidden") {
            el = el.overflow_hidden();
        } else if resolved_x == Some("hidden") {
            el = el.overflow_x_hidden();
        } else if resolved_y == Some("hidden") {
            el = el.overflow_y_hidden();
        }
    }

    el
}

// ── Event emission ───────────────────────────────────────────────────

/// Helper to convert a GPUI Point<Pixels> to (f64, f64).
pub(crate) fn point_to_xy(p: gpui::Point<gpui::Pixels>) -> (f64, f64) {
    (f64::from(f32::from(p.x)), f64::from(f32::from(p.y)))
}

/// Convert GPUI MouseButton to our u32 encoding: 0=left, 1=middle, 2=right.
pub(crate) fn mouse_button_to_u32(button: gpui::MouseButton) -> u32 {
    match button {
        gpui::MouseButton::Left => 0,
        gpui::MouseButton::Middle => 1,
        gpui::MouseButton::Right => 2,
        gpui::MouseButton::Navigate(_) => 3,
    }
}

/// General-purpose event emitter. Builds a default EventPayload, lets the
/// caller customize it via a closure, then sends it through the callback.
/// Production: queues on Node.js event loop via ThreadsafeFunction.
/// Tests: pushes to a synchronous Vec for drainEvents().
pub(crate) fn emit_event_full(
    callback: &Option<EventCallback>,
    element_id: u64,
    event_type: &str,
    build: impl FnOnce(&mut EventPayload),
) {
    if let Some(cb) = callback {
        let mut payload = EventPayload {
            element_id: element_id as f64,
            event_type: event_type.to_string(),
            ..Default::default()
        };
        build(&mut payload);
        cb(payload);
    }
}

fn window_size(window: &gpui::Window) -> WindowSize {
    let viewport_size = window.viewport_size();
    WindowSize {
        width: f64::from(f32::from(viewport_size.width)),
        height: f64::from(f32::from(viewport_size.height)),
        scale_factor: f64::from(window.scale_factor()),
    }
}

fn emit_window_resize(callback: &WindowEventCallback, window: &gpui::Window) {
    emit_window_resize_payload(callback, window_size(window));
}

fn emit_window_resize_payload(callback: &WindowEventCallback, size: WindowSize) {
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    let callback = callback.lock().unwrap().clone();
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    let callback = callback.borrow().clone();
    if let Some(callback) = callback {
        callback(window_resize_payload(size));
    }
}

fn window_resize_payload(size: WindowSize) -> EventPayload {
    EventPayload {
        event_type: "windowResize".to_string(),
        width: Some(size.width),
        height: Some(size.height),
        scale_factor: Some(size.scale_factor),
        ..EventPayload::default()
    }
}

// ── Batch processing ─────────────────────────────────────────────

/// Parsed batch operation — typed enum for atomic validation.
/// All ops are parsed and validated BEFORE any tree mutation occurs.
/// This prevents partial application on malformed batches.
enum BatchOp {
    CreateElement {
        id: u64,
        element_type: String,
    },
    DestroyElement {
        id: u64,
    },
    AppendChild {
        parent_id: u64,
        child_id: u64,
    },
    RemoveChild {
        parent_id: u64,
        child_id: u64,
    },
    InsertBefore {
        parent_id: u64,
        child_id: u64,
        before_id: u64,
    },
    SetStyle {
        id: u64,
        style: StyleDesc,
        problems: Vec<StyleProblem>,
    },
    SetText {
        id: u64,
        content: String,
    },
    SetEventListener {
        id: u64,
        event_type: String,
        has_handler: bool,
    },
    SetRoot {
        id: u64,
    },
    SetCustomProp {
        id: u64,
        key: String,
        value: serde_json::Value,
    },
}

/// Parse all batch ops from JSON into typed enums.
/// Returns Err on the first invalid op — no tree mutation has occurred yet.
type BatchResult<T> = std::result::Result<T, String>;

fn parse_batch_ops(ops: &[serde_json::Value]) -> BatchResult<Vec<BatchOp>> {
    let mut parsed = Vec::with_capacity(ops.len());

    for (i, op) in ops.iter().enumerate() {
        let arr = op
            .as_array()
            .ok_or_else(|| format!("Batch op {i} is not an array"))?;
        let op_name = arr
            .first()
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Batch op {i} missing op name string"))?;

        let batch_op = match op_name {
            "createElement" => BatchOp::CreateElement {
                id: batch_id(arr, 1, i)?,
                element_type: batch_str(arr, 2, i)?,
            },
            "destroyElement" => BatchOp::DestroyElement {
                id: batch_id(arr, 1, i)?,
            },
            "appendChild" => BatchOp::AppendChild {
                parent_id: batch_id(arr, 1, i)?,
                child_id: batch_id(arr, 2, i)?,
            },
            "removeChild" => BatchOp::RemoveChild {
                parent_id: batch_id(arr, 1, i)?,
                child_id: batch_id(arr, 2, i)?,
            },
            "insertBefore" => BatchOp::InsertBefore {
                parent_id: batch_id(arr, 1, i)?,
                child_id: batch_id(arr, 2, i)?,
                before_id: batch_id(arr, 3, i)?,
            },
            "setStyle" => {
                let id = batch_id(arr, 1, i)?;
                let value = batch_payload(arr, 2, i)?;
                let parsed = crate::style::parse_style_value(&value);
                BatchOp::SetStyle {
                    id,
                    style: parsed.style,
                    problems: parsed.problems,
                }
            }
            "setText" => BatchOp::SetText {
                id: batch_id(arr, 1, i)?,
                content: batch_str(arr, 2, i)?,
            },
            "setEventListener" => {
                let has_handler = arr
                    .get(3)
                    .and_then(|v| v.as_bool().or_else(|| v.as_u64().map(|n| n != 0)))
                    .ok_or_else(|| {
                        format!(
                            "Batch op {i} setEventListener missing/invalid hasHandler at index 3"
                        )
                    })?;
                BatchOp::SetEventListener {
                    id: batch_id(arr, 1, i)?,
                    event_type: batch_str(arr, 2, i)?,
                    has_handler,
                }
            }
            "setRoot" => BatchOp::SetRoot {
                id: batch_id(arr, 1, i)?,
            },
            "setCustomProp" => BatchOp::SetCustomProp {
                id: batch_id(arr, 1, i)?,
                key: batch_str(arr, 2, i)?,
                value: batch_payload(arr, 3, i)?,
            },
            "setCustomPropValue" => BatchOp::SetCustomProp {
                id: batch_id(arr, 1, i)?,
                key: batch_str(arr, 2, i)?,
                value: arr
                    .get(3)
                    .cloned()
                    .ok_or_else(|| format!("Batch op {i} missing custom prop value"))?,
            },
            _ => {
                return Err(format!("Batch op {i} unknown operation: {op_name:?}"));
            }
        };
        parsed.push(batch_op);
    }

    Ok(parsed)
}

/// Apply a batch of mutation tuples to a RetainedTree.
/// Shared between GpuixRenderer::apply_batch and TestGpuixRenderer::apply_batch.
/// Returns accumulated destroyed IDs (as f64) from all destroyElement ops.
///
/// ATOMIC: all ops are parsed and validated first. If any op is malformed,
/// the tree is left unchanged and an error is returned. This prevents
/// partial application that could desync JS and Rust state.
///
/// Batch format: JSON array of tuples [opcode, ...args].
/// See GpuixRenderer::apply_batch for opcode documentation.
pub(crate) struct BatchOutcome {
    pub destroyed_ids: Vec<f64>,
    pub diagnostics: Vec<PendingStyleDiagnostic>,
}

pub(crate) fn apply_batch_to_tree(
    tree: &mut RetainedTree,
    ops: &[serde_json::Value],
) -> BatchResult<BatchOutcome> {
    // Phase 1: parse and validate all ops (no mutation).
    let parsed = parse_batch_ops(ops)?;

    // Phase 2: apply all validated ops to the tree.
    let mut destroyed_ids: Vec<f64> = Vec::new();
    let mut diagnostics = Vec::new();
    for batch_op in parsed {
        match batch_op {
            BatchOp::CreateElement { id, element_type } => {
                tree.create_element(id, element_type);
            }
            BatchOp::DestroyElement { id } => {
                let destroyed = tree.destroy_element(id);
                destroyed_ids.extend(destroyed.iter().map(|&id| id as f64));
            }
            BatchOp::AppendChild {
                parent_id,
                child_id,
            } => {
                tree.append_child(parent_id, child_id);
            }
            BatchOp::RemoveChild {
                parent_id,
                child_id,
            } => {
                tree.remove_child(parent_id, child_id);
            }
            BatchOp::InsertBefore {
                parent_id,
                child_id,
                before_id,
            } => {
                tree.insert_before(parent_id, child_id, before_id);
            }
            BatchOp::SetStyle {
                id,
                style,
                problems,
            } => {
                tree.set_style(id, style);
                diagnostics.extend(pending_style_diagnostics(id, problems));
            }
            BatchOp::SetText { id, content } => {
                tree.set_text(id, content);
            }
            BatchOp::SetEventListener {
                id,
                event_type,
                has_handler,
            } => {
                tree.set_event_listener(id, event_type, has_handler);
            }
            BatchOp::SetRoot { id } => {
                tree.root_id = Some(id);
            }
            BatchOp::SetCustomProp { id, key, value } => {
                tree.set_custom_prop(id, key, value);
            }
        }
    }

    Ok(BatchOutcome {
        destroyed_ids,
        diagnostics,
    })
}

/// Extract a u64 element ID from a batch tuple at the given index.
fn batch_id(arr: &[serde_json::Value], idx: usize, op_idx: usize) -> BatchResult<u64> {
    let value = arr
        .get(idx)
        .and_then(|value| value.as_f64())
        .ok_or_else(|| format!("Batch op {op_idx} missing id at index {idx}"))?;
    raw_element_id(value)
}

/// A style or custom-prop payload. Objects land as JSON. Legacy batches
/// still send a JSON string and get decoded here.
fn batch_payload(
    arr: &[serde_json::Value],
    idx: usize,
    op_idx: usize,
) -> BatchResult<serde_json::Value> {
    let value = arr
        .get(idx)
        .ok_or_else(|| format!("Batch op {op_idx} missing value at index {idx}"))?;
    if let Some(encoded) = value.as_str() {
        match serde_json::from_str(encoded) {
            Ok(parsed) => Ok(parsed),
            Err(_) => Ok(serde_json::Value::String(encoded.to_string())),
        }
    } else {
        Ok(value.clone())
    }
}

/// Extract a String from a batch tuple at the given index.
fn batch_str(arr: &[serde_json::Value], idx: usize, op_idx: usize) -> BatchResult<String> {
    arr.get(idx)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Batch op {op_idx} missing string at index {idx}"))
}

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

/// Recorded draw times from the debug frame overlay.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Debug, Clone)]
#[napi(object)]
pub struct DebugFrameOverlayStats {
    pub current_ms: Option<f64>,
    pub p90_ms: Option<f64>,
    pub p99_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub frames: f64,
    pub samples: f64,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowOptions {
    pub title: Option<String>,
    /// Application menus. Omit for a minimal Quit menu; pass `[]` to opt out.
    pub menus: Option<Vec<MenuSpec>>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub resizable: Option<bool>,
    pub fullscreen: Option<bool>,
    /// Plain alpha transparency. Prefer `window_background` when you need blur.
    pub transparent: Option<bool>,
    /// Hide the native titlebar so the app can draw chrome under the traffic lights.
    pub titlebar_transparent: Option<bool>,
    /// `"opaque"` | `"transparent"` | `"blurred"`. `transparent: true` is the
    /// same as `"transparent"` when this is unset.
    pub window_background: Option<String>,
    pub traffic_light_x: Option<f64>,
    pub traffic_light_y: Option<f64>,
}

impl Default for WindowOptions {
    fn default() -> Self {
        Self {
            title: Some("GPUIX".to_string()),
            menus: None,
            width: Some(800.0),
            height: Some(600.0),
            min_width: None,
            min_height: None,
            resizable: Some(true),
            fullscreen: Some(false),
            transparent: Some(false),
            titlebar_transparent: Some(false),
            window_background: None,
            traffic_light_x: None,
            traffic_light_y: None,
        }
    }
}

fn to_gpui_window_options(
    options: &WindowOptions,
    bounds: gpui::Bounds<gpui::Pixels>,
) -> gpui::WindowOptions {
    let title = options.title.clone().unwrap_or_else(|| "GPUIX".to_string());
    let titlebar_transparent = options.titlebar_transparent.unwrap_or(false);
    let traffic_light_position = match (options.traffic_light_x, options.traffic_light_y) {
        (Some(x), Some(y)) => Some(gpui::point(gpui::px(x as f32), gpui::px(y as f32))),
        _ => None,
    };
    let window_background = match options.window_background.as_deref() {
        Some("transparent") => gpui::WindowBackgroundAppearance::Transparent,
        Some("blurred") => gpui::WindowBackgroundAppearance::Blurred,
        Some("opaque") => gpui::WindowBackgroundAppearance::Opaque,
        _ if options.transparent.unwrap_or(false) => gpui::WindowBackgroundAppearance::Transparent,
        _ => gpui::WindowBackgroundAppearance::Opaque,
    };
    let window_min_size = match (options.min_width, options.min_height) {
        (Some(width), Some(height)) => {
            Some(gpui::size(gpui::px(width as f32), gpui::px(height as f32)))
        }
        _ => None,
    };
    let window_bounds = if options.fullscreen.unwrap_or(false) {
        gpui::WindowBounds::Fullscreen(bounds)
    } else {
        gpui::WindowBounds::Windowed(bounds)
    };
    gpui::WindowOptions {
        window_bounds: Some(window_bounds),
        titlebar: Some(gpui::TitlebarOptions {
            title: Some(title.into()),
            appears_transparent: titlebar_transparent,
            traffic_light_position,
        }),
        is_resizable: options.resizable.unwrap_or(true),
        window_background,
        window_min_size,
        ..Default::default()
    }
}
