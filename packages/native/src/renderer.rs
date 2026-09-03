//! GPUIX retained renderer for napi desktop hosts and GPUI's browser platform.
//!
//! Mutation-based API: React's reconciler sends individual mutations
//! (createElement, appendChild, setStyle, etc.) instead of a full JSON tree.
//! Rust maintains a RetainedTree and rebuilds GPUI elements from it each frame.
//!
//! Desktop lifecycle:
//!   const renderer = new GpuixRenderer(eventCallback)
//!   renderer.init({ title: 'My App', width: 800, height: 600 })
//!   renderer.applyBatch(json)             // one atomic React commit
//!   setTimeout(function loop() {         // drive AppKit on macOS
//!     if (!renderer.tick()) process.exit(0)
//!     setTimeout(loop, 8)
//!   })
#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType},
    base::{id, nil, NO},
    foundation::{NSInteger, NSPoint, NSRect},
};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use futures::{channel::mpsc, StreamExt as _};
use gpui::AppContext as _;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi::bindgen_prelude::*;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash as _, Hasher as _};
#[cfg(any(target_os = "macos", target_family = "wasm"))]
use std::rc::Rc;
#[cfg(all(target_os = "macos", feature = "test-support"))]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
use wasm_bindgen::JsCast as _;

use crate::canvas::{CanvasDiagnostic, SharedDisplayLists};
use crate::custom_elements::input::TextEditingState;
use crate::custom_elements::{CustomElementRegistry, CustomRenderContext};
use crate::element_tree::EventPayload;
use crate::retained_tree::{RetainedTree, StyleTable};
use crate::style::{
    parse_font_weight, GridTemplateValue, GridTrackMaxValue, GridTrackMinValue, GridTrackValue,
    StyleDesc, StyleProblem,
};
use crate::text::{selectable_text, selection_frame_reset, SharedSelection, TextTransform};
use crate::theme::Theme;

#[cfg(not(target_family = "wasm"))]
pub(crate) fn default_http_client() -> Arc<dyn gpui::http_client::HttpClient> {
    Arc::new(
        reqwest_client::ReqwestClient::user_agent(concat!("GPUIX/", env!("CARGO_PKG_VERSION")))
            .unwrap_or_else(|_| reqwest_client::ReqwestClient::new()),
    )
}

#[derive(Debug, Clone)]
pub(crate) struct PendingStyleDiagnostic {
    element_id: u64,
    problem: StyleProblem,
    kind: DiagnosticKind,
}

#[derive(Debug, Default)]
pub(crate) struct PendingStyleDiagnostics {
    diagnostics: Vec<PendingStyleDiagnostic>,
    reported: usize,
}

impl PendingStyleDiagnostics {
    pub(crate) fn extend(&mut self, diagnostics: impl IntoIterator<Item = PendingStyleDiagnostic>) {
        self.diagnostics.extend(diagnostics);
    }

    pub(crate) fn clear(&mut self) {
        self.diagnostics.clear();
        self.reported = 0;
    }

    fn drain(&mut self) -> Vec<PendingStyleDiagnostic> {
        self.reported = 0;
        std::mem::take(&mut self.diagnostics)
    }

    fn take_unreported(&mut self) -> Vec<PendingStyleDiagnostic> {
        let diagnostics = self.diagnostics[self.reported..].to_vec();
        self.reported = self.diagnostics.len();
        diagnostics
    }
}

#[derive(Debug, Clone, Copy)]
enum DiagnosticKind {
    Style,
    Property,
    IgnoredProperty,
    AppliedProperty,
    AppliedPropertyAs(&'static str),
    Canvas,
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Debug, Clone)]
#[napi(object)]
pub struct GpuixStyleDiagnostic {
    pub message: String,
    pub element_id: f64,
    pub element_type: String,
    pub author_id: Option<String>,
    pub data_test_id: Option<String>,
    pub test_id: Option<String>,
    pub property: String,
    pub value: String,
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
            kind: DiagnosticKind::Style,
        })
}

pub(crate) fn pending_custom_prop_diagnostic(
    tree: &RetainedTree,
    element_id: u64,
    key: &str,
    value: &serde_json::Value,
) -> Option<PendingStyleDiagnostic> {
    let element_type = tree.elements.get(&element_id)?.element_type.as_str();
    let problem = crate::custom_elements::img::image_prop_problem(element_type, key, value)?;
    Some(PendingStyleDiagnostic {
        element_id,
        problem,
        kind: DiagnosticKind::Property,
    })
}

pub(crate) fn pending_accessibility_diagnostics(
    tree: &RetainedTree,
    element_id: u64,
) -> Vec<PendingStyleDiagnostic> {
    tree.elements
        .get(&element_id)
        .map(|element| crate::accessibility::element_problems(tree, element))
        .unwrap_or_default()
        .into_iter()
        .map(|accessibility_problem| PendingStyleDiagnostic {
            element_id,
            problem: accessibility_problem.problem,
            kind: match accessibility_problem.effect {
                crate::accessibility::AccessibilityProblemEffect::Rejected => {
                    DiagnosticKind::Property
                }
                crate::accessibility::AccessibilityProblemEffect::Ignored => {
                    DiagnosticKind::IgnoredProperty
                }
                crate::accessibility::AccessibilityProblemEffect::Applied => {
                    DiagnosticKind::AppliedProperty
                }
                crate::accessibility::AccessibilityProblemEffect::AppliedAs(computed_value) => {
                    DiagnosticKind::AppliedPropertyAs(computed_value)
                }
            },
        })
        .collect()
}

pub(crate) fn pending_canvas_diagnostics(
    element_id: u64,
    diagnostics: Vec<CanvasDiagnostic>,
) -> impl Iterator<Item = PendingStyleDiagnostic> {
    diagnostics
        .into_iter()
        .map(move |diagnostic| PendingStyleDiagnostic {
            element_id,
            problem: StyleProblem {
                property: diagnostic.op_name,
                value: format!("op[{}]", diagnostic.op_index),
                reason: diagnostic.reason,
            },
            kind: DiagnosticKind::Canvas,
        })
}

pub(crate) fn validate_canvas_target(
    tree: &RetainedTree,
    element_id: u64,
) -> std::result::Result<(), String> {
    let Some(element) = tree.elements.get(&element_id) else {
        return Err(format!(
            "Cannot apply canvas commands to missing element {element_id}"
        ));
    };
    if element.element_type != "canvas" {
        return Err(format!(
            "Cannot apply canvas commands to element {element_id}: <{}> is not a <canvas>",
            element.element_type
        ));
    }
    Ok(())
}

pub(crate) fn canvas_size(tree: &RetainedTree, element_id: u64) -> crate::canvas::CanvasSize {
    let element = tree
        .elements
        .get(&element_id)
        .expect("validated canvas target remains in the retained tree");
    let dimension = |name: &str, fallback: f64| {
        element
            .custom_props
            .get(name)
            .and_then(serde_json::Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(fallback)
    };
    crate::canvas::CanvasSize {
        width: dimension("width", crate::canvas::DEFAULT_CANVAS_WIDTH),
        height: dimension("height", crate::canvas::DEFAULT_CANVAS_HEIGHT),
    }
}

pub(crate) fn fresh_canvas_diagnostics(
    element_id: u64,
    diagnostics: Vec<CanvasDiagnostic>,
    seen: &Mutex<HashSet<(u64, String)>>,
) -> Vec<PendingStyleDiagnostic> {
    let mut seen = seen.lock().unwrap();
    pending_canvas_diagnostics(element_id, diagnostics)
        .filter(|diagnostic| seen.insert((element_id, diagnostic.problem.property.clone())))
        .collect()
}

pub(crate) fn forget_canvas_diagnostics(seen: &Mutex<HashSet<(u64, String)>>, element_ids: &[u64]) {
    if element_ids.is_empty() {
        return;
    }
    let ids: HashSet<u64> = element_ids.iter().copied().collect();
    seen.lock().unwrap().retain(|(id, _)| !ids.contains(id));
}

pub(crate) fn first_canvas_diagnostic_message(
    tree: &RetainedTree,
    element_id: u64,
    diagnostics: &[CanvasDiagnostic],
) -> Option<String> {
    pending_canvas_diagnostics(element_id, diagnostics.to_vec())
        .next()
        .map(|diagnostic| style_diagnostic_context(&diagnostic, tree).0)
}

pub(crate) fn take_canvas_preparation_diagnostics(
    display_lists: &SharedDisplayLists,
    strict: bool,
    tree: &Mutex<RetainedTree>,
    seen: &Mutex<HashSet<(u64, String)>>,
) -> std::result::Result<Vec<PendingStyleDiagnostic>, String> {
    let diagnostics = display_lists.take_preparation_diagnostics();
    if diagnostics.is_empty() {
        return Ok(Vec::new());
    }

    if strict {
        let first = &diagnostics[0];
        let tree = tree.lock().unwrap();
        return Err(first_canvas_diagnostic_message(
            &tree,
            first.element_id,
            &[first.diagnostic.clone()],
        )
        .expect("one canvas preparation diagnostic has a first item"));
    }

    let mut pending = Vec::new();
    for diagnostic in diagnostics {
        pending.extend(fresh_canvas_diagnostics(
            diagnostic.element_id,
            vec![diagnostic.diagnostic],
            seen,
        ));
    }
    Ok(pending)
}

#[cfg(test)]
mod canvas_preparation_diagnostic_tests {
    use super::*;

    fn diagnostic() -> CanvasDiagnostic {
        CanvasDiagnostic {
            op_index: 4,
            op_name: "fill".to_string(),
            reason: "path preparation failed".to_string(),
        }
    }

    fn tree() -> Mutex<RetainedTree> {
        let mut tree = RetainedTree::new();
        tree.create_element(7, "canvas".to_string());
        Mutex::new(tree)
    }

    #[test]
    fn strict_preparation_diagnostic_is_returned_as_the_canvas_error() {
        let display_lists = SharedDisplayLists::default();
        display_lists.report_preparation_diagnostics(7, &[diagnostic()]);

        let error = take_canvas_preparation_diagnostics(
            &display_lists,
            true,
            &tree(),
            &Mutex::new(HashSet::new()),
        )
        .unwrap_err();

        assert!(error.contains("Invalid canvas command on <canvas>"));
        assert!(error.contains("property \"fill\""));
        assert!(error.contains("path preparation failed"));
    }

    #[test]
    fn non_strict_preparation_diagnostic_uses_member_deduplication() {
        let display_lists = SharedDisplayLists::default();
        let seen = Mutex::new(HashSet::new());
        display_lists.report_preparation_diagnostics(7, &[diagnostic(), diagnostic()]);

        let first = take_canvas_preparation_diagnostics(&display_lists, false, &tree(), &seen)
            .expect("non-strict diagnostics do not throw");
        assert_eq!(first.len(), 1);

        display_lists.report_preparation_diagnostics(7, &[diagnostic()]);
        let repeated = take_canvas_preparation_diagnostics(&display_lists, false, &tree(), &seen)
            .expect("non-strict diagnostics do not throw");
        assert!(repeated.is_empty());
    }
}

fn style_diagnostic_context(
    diagnostic: &PendingStyleDiagnostic,
    tree: &RetainedTree,
) -> (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let element = tree.elements.get(&diagnostic.element_id);
    let element_type = element
        .map(|element| element.element_type.clone())
        .unwrap_or_else(|| "unknown".into());
    let test_id = element.and_then(|element| element.test_id.clone());
    let author_id = element.and_then(|element| element.author_id.clone());
    let data_test_id = element.and_then(|element| {
        element
            .custom_props
            .get("data-testid")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    });
    let author_id_label = author_id
        .as_ref()
        .map(|author_id| format!(" id={author_id:?}"))
        .unwrap_or_default();
    let test_id_label = test_id
        .as_ref()
        .map(|test_id| format!(" testId={test_id:?}"))
        .unwrap_or_default();
    let subject = match diagnostic.kind {
        DiagnosticKind::Style => "style",
        DiagnosticKind::Property
        | DiagnosticKind::IgnoredProperty
        | DiagnosticKind::AppliedProperty
        | DiagnosticKind::AppliedPropertyAs(_) => "property",
        DiagnosticKind::Canvas => "canvas command",
    };
    let data_test_id_label = data_test_id
        .as_ref()
        .map(|data_test_id| format!(" data-testid={data_test_id:?}"))
        .unwrap_or_default();
    let accessibility_subject = format!(
        "[gpuix] Accessibility issue on <{element_type}{author_id_label}{data_test_id_label}{test_id_label}> (element {}): property {:?}",
        diagnostic.element_id, diagnostic.problem.property,
    );
    let message = match diagnostic.kind {
        DiagnosticKind::IgnoredProperty => format!(
            "{accessibility_subject} ignored value {}: {}",
            diagnostic.problem.value, diagnostic.problem.reason,
        ),
        DiagnosticKind::AppliedProperty => format!(
            "{accessibility_subject} applied value {}: {}",
            diagnostic.problem.value, diagnostic.problem.reason,
        ),
        DiagnosticKind::AppliedPropertyAs(computed_value) => format!(
            "{accessibility_subject} applied value {} as {computed_value}: {}",
            diagnostic.problem.value, diagnostic.problem.reason,
        ),
        _ => format!(
            "[gpuix] Invalid {subject} on <{element_type}{author_id_label}{data_test_id_label}{test_id_label}> (element {}): property {:?} rejected value {}: {}",
            diagnostic.element_id,
            diagnostic.problem.property,
            diagnostic.problem.value,
            diagnostic.problem.reason,
        ),
    };
    (message, element_type, author_id, data_test_id, test_id)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn drain_style_diagnostics(
    pending: &Mutex<PendingStyleDiagnostics>,
    tree: &Mutex<RetainedTree>,
) -> Vec<GpuixStyleDiagnostic> {
    let pending = pending.lock().unwrap().drain();
    style_diagnostics(pending, tree)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn take_style_diagnostics_for_reporting(
    pending: &Mutex<PendingStyleDiagnostics>,
    tree: &Mutex<RetainedTree>,
) -> Vec<GpuixStyleDiagnostic> {
    let pending = pending.lock().unwrap().take_unreported();
    style_diagnostics(pending, tree)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn style_diagnostics(
    pending: Vec<PendingStyleDiagnostic>,
    tree: &Mutex<RetainedTree>,
) -> Vec<GpuixStyleDiagnostic> {
    let tree = tree.lock().unwrap();
    pending
        .into_iter()
        .map(|diagnostic| {
            let (message, element_type, author_id, data_test_id, test_id) =
                style_diagnostic_context(&diagnostic, &tree);
            GpuixStyleDiagnostic {
                message,
                element_id: diagnostic.element_id as f64,
                element_type,
                author_id,
                data_test_id,
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

pub(crate) fn install_application_menus(
    cx: &mut gpui::App,
    app_name: &str,
    menus: Option<Vec<MenuSpec>>,
) -> std::result::Result<(), String> {
    #[cfg(target_os = "macos")]
    if menus.is_none() {
        crate::app_menu::init(app_name, cx);
        cx.global_mut::<ApplicationMenuState>().installed_menu_count = 2;
        return Ok(());
    }

    set_application_menus(
        cx,
        menus.unwrap_or_else(|| default_application_menus(app_name)),
    )
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

/// The Window menu items act on the focused window, and the root element is the
/// only place in GPUIX that has one. `crate::app_menu` owns everything else.
#[cfg(target_os = "macos")]
fn with_window_menu_actions(root: gpui::Div) -> gpui::Div {
    use crate::app_menu::{CloseWindow, MinimizeWindow, ZoomWindow};
    use gpui::prelude::*;

    root.on_action(|_: &MinimizeWindow, window, _cx| window.minimize_window())
        .on_action(|_: &ZoomWindow, window, _cx| window.zoom_window())
        .on_action(|_: &CloseWindow, window, _cx| window.remove_window())
}

#[cfg(not(target_os = "macos"))]
fn with_window_menu_actions(root: gpui::Div) -> gpui::Div {
    root
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

/// Clamp a selection offset arriving from JS. `setSelectionRange()` takes
/// WebIDL `unsigned long`s, so JavaScript has already folded every value into
/// 0..2^32-1 before it gets here; this only keeps a hand-rolled caller from
/// turning a stray float into an out-of-range `usize`.
pub(crate) fn to_selection_offset(offset: f64) -> usize {
    if !offset.is_finite() || offset <= 0.0 {
        return 0;
    }
    offset.min(u32::MAX as f64) as usize
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn parse_canvas_image_source(
    source_json: String,
) -> Result<crate::custom_elements::img::CanvasImageSource> {
    let value: serde_json::Value = serde_json::from_str(&source_json).map_err(|error| {
        Error::from_reason(format!("Invalid canvas image source JSON: {error}"))
    })?;
    let source = crate::custom_elements::img::ImageSource::parse(&value)
        .map_err(|error| Error::from_reason(format!("Invalid canvas image source: {error}")))?;
    Ok(crate::custom_elements::img::CanvasImageSource {
        key: source_json,
        source,
    })
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn canvas_image_load_state_js(
    state: Option<crate::custom_elements::img::CanvasImageLoadState>,
) -> Option<CanvasImageLoadState> {
    state.map(|state| match state {
        crate::custom_elements::img::CanvasImageLoadState::Loading => CanvasImageLoadState {
            status: "loading".to_string(),
            width: None,
            height: None,
            error: None,
        },
        crate::custom_elements::img::CanvasImageLoadState::Loaded { width, height } => {
            CanvasImageLoadState {
                status: "loaded".to_string(),
                width: Some(width as f64),
                height: Some(height as f64),
                error: None,
            }
        }
        crate::custom_elements::img::CanvasImageLoadState::Error { message } => {
            CanvasImageLoadState {
                status: "error".to_string(),
                width: None,
                height: None,
                error: Some(message),
            }
        }
    })
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
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    static PENDING_DEBUG_OVERLAY: RefCell<Option<gpui::DebugFrameOverlayMode>> =
        const { RefCell::new(None) };
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
    /// Virtual-list scrolls queued for the next `GpuixView::render`, applied
    /// AFTER `VirtualListEntry::sync` splices that frame's child changes.
    ///
    /// Never applied eagerly: JS computes row indices against the child list it
    /// just committed, but that commit only reaches `gpui::ListState` when the
    /// next render splices it in. An eager `scroll_to` would be shifted a
    /// second time by `splice_focusable` and land on the wrong row.
    static PENDING_VIRTUAL_LIST_SCROLLS: RefCell<HashMap<u64, gpui::ListOffset>> =
        RefCell::new(HashMap::new());
}

const SELECTION_SCROLL_TICK_MS: u64 = 24;
const SELECTION_SCROLL_EDGE_PX: f32 = 36.0;
const SELECTION_SCROLL_MAX_STEP_PX: f32 = 24.0;

/// Signed list scroll step for a pointer near a viewport edge.
fn selection_scroll_step(
    bounds: gpui::Bounds<gpui::Pixels>,
    position: gpui::Point<gpui::Pixels>,
) -> f32 {
    let height = f32::from(bounds.size.height);
    if height <= 0.0 {
        return 0.0;
    }
    let edge = SELECTION_SCROLL_EDGE_PX.min(height / 6.0);
    if edge <= 0.0 {
        return 0.0;
    }
    let y = f32::from(position.y);
    let top = f32::from(bounds.top());
    let bottom = f32::from(bounds.bottom());
    let scaled = |penetration: f32| {
        let progress = (penetration / edge).clamp(0.0, 1.0);
        SELECTION_SCROLL_MAX_STEP_PX * progress * progress
    };
    if y < top + edge {
        -scaled(top + edge - y)
    } else if y > bottom - edge {
        scaled(y - (bottom - edge))
    } else {
        0.0
    }
}

/// Queue a virtual-list scroll for the next render. `offset_in_item` may be
/// negative: gpui then anchors the viewport top above the item, which is what
/// keeps a row pixel-stable while unmeasured rows are spliced in above it.
pub(crate) fn queue_virtual_list_scroll(id: u64, index: usize, offset_in_item: f32) {
    PENDING_VIRTUAL_LIST_SCROLLS.with(|cell| {
        cell.borrow_mut().insert(
            id,
            gpui::ListOffset {
                item_ix: index,
                offset_in_item: gpui::px(offset_in_item),
            },
        );
    });
}

fn parse_debug_frame_overlay_mode_str(
    mode: &str,
) -> std::result::Result<gpui::DebugFrameOverlayMode, String> {
    match mode {
        "hidden" => Ok(gpui::DebugFrameOverlayMode::Hidden),
        "minimal" => Ok(gpui::DebugFrameOverlayMode::Minimal),
        "full" => Ok(gpui::DebugFrameOverlayMode::Full),
        other => Err(format!(
            "Unknown debug frame overlay mode {other:?}. Use hidden, minimal, or full."
        )),
    }
}

#[cfg(test)]
mod selection_scroll_tests {
    use super::*;

    #[test]
    fn selection_scroll_ramps_at_viewport_edges() {
        let bounds = gpui::Bounds::new(
            gpui::point(gpui::px(10.0), gpui::px(20.0)),
            gpui::size(gpui::px(300.0), gpui::px(200.0)),
        );
        assert_eq!(
            selection_scroll_step(bounds, gpui::point(gpui::px(20.0), gpui::px(120.0))),
            0.0
        );
        assert!(selection_scroll_step(bounds, gpui::point(gpui::px(20.0), gpui::px(20.0))) < 0.0);
        assert!(selection_scroll_step(bounds, gpui::point(gpui::px(20.0), gpui::px(220.0))) > 0.0);
        assert!(
            selection_scroll_step(bounds, gpui::point(gpui::px(20.0), gpui::px(220.0)))
                > selection_scroll_step(bounds, gpui::point(gpui::px(20.0), gpui::px(200.0)))
        );
    }

    #[test]
    fn selection_offsets_survive_values_javascript_can_still_produce() {
        assert_eq!(to_selection_offset(0.0), 0);
        assert_eq!(to_selection_offset(7.0), 7);
        // `ToUint32` already turns each of these into 0 on the JavaScript side.
        assert_eq!(to_selection_offset(-1.0), 0);
        assert_eq!(to_selection_offset(f64::NAN), 0);
        assert_eq!(to_selection_offset(f64::INFINITY), 0);
        assert_eq!(to_selection_offset(u32::MAX as f64), u32::MAX as usize);
        assert_eq!(to_selection_offset(1e300), u32::MAX as usize);
    }
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn parse_debug_frame_overlay_mode(mode: &str) -> Result<gpui::DebugFrameOverlayMode> {
    parse_debug_frame_overlay_mode_str(mode).map_err(Error::from_reason)
}

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
// Keyboard handlers can update GpuixView, so dispatch without leasing the root view.
fn update_window_without_view<R>(
    update: impl FnOnce(&mut gpui::Window, &mut gpui::App) -> R,
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
            gpui::AnyWindowHandle::from(window)
                .update(cx, move |_view, window, cx| update(window, cx))
                .map_err(|error| Error::from_reason(error.to_string()))
        })
    })
}

#[cfg(target_os = "macos")]
fn draw_window_for_automation_read() -> Result<()> {
    update_window_without_view(|window, cx| {
        // Automation reads must be fresh even when the window is occluded and
        // the platform never services its pending frame request.
        window.draw(cx).clear(cx);
    })
}

/// Queue a real AppKit mouse click. This is deliberately distinct from the
/// deterministic `simulate_click` test helper: live smoke tests need to cover
/// the NSEvent → GPUI platform ingress before the renderer's callback bridge.
#[cfg(target_os = "macos")]
// cocoa's Objective-C message macros still probe its removed cargo-clippy cfg.
#[allow(unexpected_cfgs)]
fn post_appkit_click(x: f64, y: f64) -> Result<()> {
    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let mut window: id = msg_send![app, keyWindow];
        if window == nil {
            window = msg_send![app, mainWindow];
        }
        if window == nil {
            let windows: id = msg_send![app, windows];
            let count: usize = msg_send![windows, count];
            if count > 0 {
                window = msg_send![windows, objectAtIndex: 0usize];
            }
        }
        if window == nil {
            return Err(Error::from_reason(
                "No AppKit window is available for click automation",
            ));
        }

        let content_view: id = msg_send![window, contentView];
        let bounds: NSRect = msg_send![content_view, bounds];
        let window_number: NSInteger = msg_send![window, windowNumber];
        let location = NSPoint::new(x, bounds.size.height - y);
        for event_type in [NSEventType::NSLeftMouseDown, NSEventType::NSLeftMouseUp] {
            let event = <id as NSEvent>::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
                nil,
                event_type,
                location,
                NSEventModifierFlags::empty(),
                0.0,
                window_number,
                nil,
                0,
                1,
                1.0,
            );
            if event == nil {
                return Err(Error::from_reason("Failed to create an AppKit click event"));
            }
            app.postEvent_atStart_(event, NO);
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn invalidate_window() -> Result<()> {
    update_window(|_view, window, cx| {
        cx.notify();
        window.refresh();
    })
}

#[cfg(target_os = "macos")]
fn should_defer_idle_pump(dispatch_frame_request: bool, frame_request_outstanding: bool) -> bool {
    !dispatch_frame_request && frame_request_outstanding
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
enum MouseInput {
    Click {
        x: f64,
        y: f64,
        button: u32,
        modifiers: gpui::Modifiers,
        click_count: usize,
    },
    Down {
        x: f64,
        y: f64,
        button: u32,
        modifiers: gpui::Modifiers,
        click_count: usize,
    },
    Up {
        x: f64,
        y: f64,
        button: u32,
        modifiers: gpui::Modifiers,
        click_count: usize,
    },
    Move {
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
        modifiers: gpui::Modifiers,
    },
    ScrollWheel {
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        options: Option<crate::automation::ScrollWheelOptions>,
    },
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
enum KeyInput {
    Keystrokes(String),
    Down { keystroke: String, is_held: bool },
    Up(String),
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
    ObserveCanvasImage {
        observer_id: u64,
        source: crate::custom_elements::img::CanvasImageSource,
        policy: crate::custom_elements::img::ImageNetworkPolicy,
    },
    ReleaseCanvasImageObserver(u64),
    GetCanvasImageLoadState {
        observer_id: u64,
        response: SyncSender<Option<CanvasImageLoadState>>,
    },
    RequestFrame {
        callback: AnimationFrameCallback,
        timestamp_origin: FrameTimestampOrigin,
    },
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
    ActivateWindow,
    SetWindowTitle(String),
    GetWindowSize {
        response: SyncSender<WindowSize>,
    },
    IsWindowActive {
        response: SyncSender<bool>,
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
        offset: f32,
    },
    GetScrollOffset {
        id: u64,
        response: SyncSender<Option<[f64; 2]>>,
    },
    GetListScrollTop {
        id: u64,
        response: SyncSender<Option<[f64; 3]>>,
    },
    GetScrollMetrics {
        id: u64,
        response: SyncSender<Option<[f64; 6]>>,
    },
    ScrollElementIntoView {
        id: u64,
        align_to_top: bool,
    },
    GetAutomationBounds {
        response: SyncSender<HashMap<u64, crate::automation::ElementBounds>>,
    },
    GetElementBounds {
        id: u64,
        response: SyncSender<Option<crate::automation::ElementBounds>>,
    },
    FocusElement {
        id: u64,
        reveal: bool,
    },
    FocusNext,
    FocusPrevious,
    ResolveTabKeyDown {
        default_prevented: bool,
    },
    GetActiveElement {
        response: SyncSender<Option<u64>>,
    },
    SetPointerCapture {
        id: u64,
        response: SyncSender<std::result::Result<(), String>>,
    },
    ReleasePointerCapture {
        id: u64,
        response: SyncSender<()>,
    },
    GetTextEditingState {
        id: u64,
        response: SyncSender<Option<TextEditingState>>,
    },
    SetTextSelection {
        id: u64,
        start: usize,
        end: usize,
        backward: bool,
    },
    SetTextValue {
        id: u64,
        value: String,
    },
    ControlClock {
        control: ClockControl,
        response: SyncSender<f64>,
    },
    DispatchMouse {
        input: MouseInput,
        response: SyncSender<std::result::Result<(), String>>,
    },
    DispatchKey {
        input: KeyInput,
        response: SyncSender<std::result::Result<(), String>>,
    },
    #[cfg(all(target_os = "windows", feature = "test-support"))]
    CaptureScreenshot {
        path: String,
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

/// Draw the committed tree from inside the UI thread's command pump: the
/// non-macOS counterpart of `draw_window_for_automation_read`.
///
/// Takes the same `(WindowHandle<GpuixView>, &mut AsyncApp) -> anyhow::Result<()>`
/// shape as `refresh_ui_window` above, because the pump hands every helper the
/// async context and folds each arm's `Result` into one shared error log.
///
/// Leases the window untyped, as the macOS helper does. Drawing renders
/// `GpuixView`, so holding a typed lease on it across the draw would panic.
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
fn draw_ui_window_for_read(
    window: gpui::WindowHandle<GpuixView>,
    cx: &mut gpui::AsyncApp,
) -> anyhow::Result<()> {
    gpui::AnyWindowHandle::from(window).update(cx, |_view, window, cx| {
        window.draw(cx).clear(cx);
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
            UiCommand::ObserveCanvasImage {
                observer_id,
                source,
                policy,
            } => window.update(cx, move |view, window, cx| {
                view.canvas_image_store
                    .observe(observer_id, source, policy, window, cx);
            }),
            UiCommand::ReleaseCanvasImageObserver(observer_id) => {
                window.update(cx, move |view, window, _cx| {
                    view.canvas_image_store
                        .release_observer(observer_id, window);
                })
            }
            UiCommand::GetCanvasImageLoadState {
                observer_id,
                response,
            } => window.update(cx, move |view, _window, _cx| {
                response
                    .send(canvas_image_load_state_js(
                        view.canvas_image_store.observer_state(observer_id),
                    ))
                    .ok();
            }),
            UiCommand::RequestFrame {
                callback,
                timestamp_origin,
            } => window.update(cx, move |_view, window, cx| {
                let origin =
                    animation_frame_origin(&timestamp_origin, cx.background_executor().now());
                window.on_next_frame(move |_window, cx| {
                    dispatch_animation_frame_callback(
                        callback,
                        animation_frame_timestamp_ms(origin, cx.background_executor().now()),
                    );
                });
            }),
            UiCommand::SetMenus { menus, response } => {
                let result = cx.update(|cx| set_application_menus(cx, menus));
                response.send(result.clone()).ok();
                result.map_err(anyhow::Error::msg)
            }
            UiCommand::DispatchMenuAction { id, response } => {
                let result = cx.update(|cx| dispatch_application_menu_action(cx, &id));
                response.send(result.clone()).ok();
                result.map_err(anyhow::Error::msg)
            }
            UiCommand::Quit { response } => {
                cx.update(|cx| cx.quit());
                response.send(()).ok();
                Ok(())
            }
            UiCommand::ActivateWindow => window.update(cx, |_view, window, cx| {
                cx.activate(true);
                window.activate_window();
            }),
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
            UiCommand::IsWindowActive { response } => {
                window.update(cx, move |_view, window, _cx| {
                    response.send(window.is_window_active()).ok();
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
            UiCommand::ScrollToItem { id, index, offset } => {
                let queued = VIRTUAL_LIST_STATES.with(|cell| {
                    if !cell.borrow().contains_key(&id) {
                        return false;
                    }
                    queue_virtual_list_scroll(id, index, offset);
                    true
                });
                let revealed = if queued {
                    Ok(())
                } else {
                    // The retained child index has to be mapped against the
                    // tree the view holds, so the reveal runs on the UI thread.
                    window.update(cx, |view, _window, _cx| {
                        let tree = view.tree.clone();
                        let tree = tree.lock().unwrap();
                        SCROLL_HANDLES.with(|cell| {
                            if let Some(handle) = cell.borrow().get(&id) {
                                scroll_handle_to_child(handle, &tree, id, index);
                            }
                        });
                    })
                };
                revealed.and_then(|()| refresh_ui_window(window, cx))
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
            UiCommand::GetListScrollTop { id, response } => {
                let top = VIRTUAL_LIST_STATES.with(|cell| {
                    cell.borrow().get(&id).map(|state| {
                        let top = state.logical_scroll_top();
                        [
                            top.item_ix as f64,
                            f64::from(f32::from(top.offset_in_item)),
                            f64::from(f32::from(state.viewport_bounds().size.height)),
                        ]
                    })
                });
                response.send(top).ok();
                Ok(())
            }
            // Force layout before sampling, the way GetElementBounds does: a
            // read from a mount effect must not report an unscrollable element.
            UiCommand::GetScrollMetrics { id, response } => {
                window.update(cx, move |_view, window, cx| {
                    cx.notify();
                    window.refresh();
                    window.on_next_frame(move |_window, _cx| {
                        let metrics = VIRTUAL_LIST_STATES
                            .with(|cell| cell.borrow().get(&id).map(virtual_list_metrics))
                            .or_else(|| {
                                SCROLL_HANDLES
                                    .with(|cell| cell.borrow().get(&id).map(scroll_handle_metrics))
                            });
                        response.send(metrics).ok();
                    });
                })
            }
            UiCommand::ScrollElementIntoView { id, align_to_top } => {
                window.update(cx, move |view, window, cx| {
                    view.scroll_element_into_view(id, align_to_top, cx);
                    window.refresh();
                })
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
            UiCommand::FocusElement { id, reveal } => {
                window.update(cx, move |view, window, cx| {
                    view.focus_element(id, reveal, window, cx);
                    window.refresh();
                })
            }
            UiCommand::FocusNext => window.update(cx, |view, window, cx| {
                view.move_focus(FocusDirection::Next, window, cx)
            }),
            UiCommand::FocusPrevious => window.update(cx, |view, window, cx| {
                view.move_focus(FocusDirection::Previous, window, cx)
            }),
            UiCommand::ResolveTabKeyDown { default_prevented } => {
                window.update(cx, move |view, window, cx| {
                    view.resolve_tab_key_down(default_prevented, window, cx);
                })
            }
            UiCommand::GetActiveElement { response } => {
                window.update(cx, move |view, window, _cx| {
                    response.send(view.active_element_id(window)).ok();
                })
            }
            UiCommand::SetPointerCapture { id, response } => {
                let result = window.update(cx, move |view, window, _cx| {
                    view.set_pointer_capture(id, window)
                });
                let response_value = result
                    .as_ref()
                    .map_err(|error| error.to_string())
                    .and_then(|value| value.clone());
                response.send(response_value).ok();
                result.and_then(|value| value.map_err(anyhow::Error::msg))
            }
            UiCommand::ReleasePointerCapture { id, response } => {
                let result = window.update(cx, move |view, window, _cx| {
                    view.release_pointer_capture(id, window);
                });
                response.send(()).ok();
                result
            }
            // Each of these draws the committed tree first, as the macOS arms
            // do. The frame is what syncs a changed `value` prop into the
            // editor, and that sync parks the caret at the end of the new text:
            // a caret written before it would be overwritten moments later.
            UiCommand::GetTextEditingState { id, response } => {
                draw_ui_window_for_read(window, cx).and_then(|()| {
                    window.update(cx, move |view, _window, cx| {
                        response
                            .send(view.custom_registry.text_editing_state(id, cx))
                            .ok();
                    })
                })
            }
            UiCommand::SetTextSelection {
                id,
                start,
                end,
                backward,
            } => draw_ui_window_for_read(window, cx).and_then(|()| {
                window.update(cx, move |view, _window, cx| {
                    view.custom_registry
                        .set_text_selection(id, start, end, backward, cx);
                })
            }),
            UiCommand::SetTextValue { id, value } => {
                draw_ui_window_for_read(window, cx).and_then(|()| {
                    window.update(cx, move |view, _window, cx| {
                        view.custom_registry.set_text_value(id, value, cx);
                    })
                })
            }
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
                let result = gpui::AnyWindowHandle::from(window)
                    .update(cx, move |_view, window, cx| match input {
                        MouseInput::Click {
                            x,
                            y,
                            button,
                            modifiers,
                            click_count,
                        } => {
                            crate::automation::dispatch_click(
                                window,
                                cx,
                                x,
                                y,
                                button,
                                modifiers,
                                click_count,
                            );
                            Ok(())
                        }
                        MouseInput::Down {
                            x,
                            y,
                            button,
                            modifiers,
                            click_count,
                        } => {
                            crate::automation::dispatch_mouse_down(
                                window,
                                cx,
                                x,
                                y,
                                button,
                                modifiers,
                                click_count,
                            );
                            Ok(())
                        }
                        MouseInput::Up {
                            x,
                            y,
                            button,
                            modifiers,
                            click_count,
                        } => {
                            crate::automation::dispatch_mouse_up(
                                window,
                                cx,
                                x,
                                y,
                                button,
                                modifiers,
                                click_count,
                            );
                            Ok(())
                        }
                        MouseInput::Move {
                            x,
                            y,
                            pressed_button,
                            modifiers,
                        } => {
                            crate::automation::dispatch_mouse_move(
                                window,
                                cx,
                                x,
                                y,
                                pressed_button,
                                modifiers,
                            );
                            Ok(())
                        }
                        MouseInput::ScrollWheel {
                            x,
                            y,
                            delta_x,
                            delta_y,
                            options,
                        } => crate::automation::dispatch_scroll_wheel(
                            window, cx, x, y, delta_x, delta_y, options,
                        )
                        .map_err(Error::from_reason),
                    })
                    .and_then(|result| result.map_err(|error| anyhow::anyhow!("{}", error.reason)));
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
            UiCommand::DispatchKey { input, response } => {
                let result = gpui::AnyWindowHandle::from(window)
                    .update(cx, move |_view, window, cx| match input {
                        KeyInput::Keystrokes(keystrokes) => {
                            crate::automation::dispatch_keystrokes(window, cx, &keystrokes)
                        }
                        KeyInput::Down { keystroke, is_held } => {
                            crate::automation::dispatch_key_down(window, cx, &keystroke, is_held)
                        }
                        KeyInput::Up(keystroke) => {
                            crate::automation::dispatch_key_up(window, cx, &keystroke)
                        }
                    })
                    .and_then(|result| result.map_err(anyhow::Error::msg));
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
            #[cfg(all(target_os = "windows", feature = "test-support"))]
            UiCommand::CaptureScreenshot { path, response } => {
                let error_response = response.clone();
                let result = window.update(cx, move |_view, window, cx| {
                    cx.notify();
                    window.refresh();
                    window.on_next_frame(move |window, _cx| {
                        let result = window
                            .render_to_image()
                            .map_err(|error| format!("Screenshot capture failed: {error}"))
                            .and_then(|image| {
                                image
                                    .save(&path)
                                    .map_err(|error| format!("Failed to save screenshot: {error}"))
                            });
                        response.send(result).ok();
                    });
                });
                if let Err(error) = &result {
                    error_response.send(Err(format!("{error:#}"))).ok();
                }
                result
            }
            UiCommand::Blur => window.update(cx, |_view, window, _cx| window.blur()),
        };
        if let Err(error) = result {
            if cx.update(|cx| cx.windows().is_empty()) {
                break;
            }
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

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveFrameClockKind {
    DisplayLink,
    Timer,
}

#[cfg(target_os = "macos")]
impl ActiveFrameClockKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::DisplayLink => "display-link",
            Self::Timer => "timer",
        }
    }
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn unsupported_capability(env: Env, capability: &str) -> Result<()> {
    let mut error = env.create_error(Error::new(
        Status::GenericFailure,
        format!("{capability} is not supported by this renderer"),
    ))?;
    error.set_named_property("name", "UnsupportedCapabilityError")?;
    error.set_named_property("code", "ERR_GPUX_UNSUPPORTED_CAPABILITY")?;
    error.set_named_property("capability", capability)?;
    Err(error.into_unknown(&env)?.into())
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) type FrameRequestCallback =
    ThreadsafeFunction<(), Unknown<'static>, (), Status, false, false, 1>;

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) type AnimationFrameCallback =
    ThreadsafeFunction<f64, Unknown<'static>, f64, Status, false, false, 1>;

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) type FrameTimestampOrigin = Arc<Mutex<Option<web_time::Instant>>>;

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn animation_frame_origin(
    timestamp_origin: &FrameTimestampOrigin,
    now: web_time::Instant,
) -> web_time::Instant {
    let mut timestamp_origin = timestamp_origin
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *timestamp_origin.get_or_insert(now)
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn animation_frame_timestamp_ms(
    timestamp_origin: web_time::Instant,
    frame_time: web_time::Instant,
) -> f64 {
    frame_time
        .saturating_duration_since(timestamp_origin)
        .as_secs_f64()
        * 1_000.0
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) fn dispatch_animation_frame_callback(callback: AnimationFrameCallback, timestamp: f64) {
    let _ = callback.call_with_return_value(
        timestamp,
        ThreadsafeFunctionCallMode::NonBlocking,
        |_result, _env| Ok(()),
    );
}

#[cfg(target_os = "macos")]
struct PresentTimingCapture {
    collector: gpui::FrameTimingCollector,
    window_id: gpui::WindowId,
    disable_trace_when_done: bool,
}

/// The main GPUI renderer exposed to Node.js.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
pub struct GpuixRenderer {
    event_callback: Mutex<Option<Arc<ThreadsafeFunction<EventPayload>>>>,
    application_event_callback: Arc<Mutex<Option<EventCallback>>>,
    window_event_callback: WindowEventCallback,
    tree: Arc<Mutex<RetainedTree>>,
    canvas_display_lists: SharedDisplayLists,
    lifecycle: Arc<Mutex<RendererLifecycle>>,
    animation_frame_timestamp_origin: FrameTimestampOrigin,
    #[cfg(target_os = "macos")]
    frame_request_callback: Arc<Mutex<Option<Arc<FrameRequestCallback>>>>,
    #[cfg(target_os = "macos")]
    active_frame_clock_kind: Arc<Mutex<ActiveFrameClockKind>>,
    #[cfg(target_os = "macos")]
    frame_request_outstanding: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    pending_frame_request: Arc<Mutex<Option<gpui_macos::FrameRequest>>>,
    #[cfg(target_os = "macos")]
    present_timing_capture: Mutex<Option<PresentTimingCapture>>,
    #[cfg(all(target_os = "macos", feature = "test-support"))]
    synchronous_scroll_draw_count: AtomicU64,
    /// Shared with GpuixView so napi methods can read the live selection
    /// without an App context. Paint and napi calls can use different threads.
    selection: SharedSelection,
    image_network_policy: crate::custom_elements::img::ImageNetworkPolicy,
    strict_styles: AtomicBool,
    style_diagnostics: Mutex<PendingStyleDiagnostics>,
    canvas_diagnostic_members: Mutex<HashSet<(u64, String)>>,
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    ui_commands: Mutex<Option<mpsc::UnboundedSender<UiCommand>>>,
}

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
impl GpuixRenderer {
    fn active_frame_clock_kind(&self) -> &'static str {
        #[cfg(target_os = "macos")]
        return self
            .active_frame_clock_kind
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_str();

        #[cfg(not(target_os = "macos"))]
        "timer"
    }

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

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn dispatch_key_input(&self, input: KeyInput) -> Result<()> {
        let (response_sender, response_receiver) = sync_channel(1);
        self.send_ui_command(UiCommand::DispatchKey {
            input,
            response: response_sender,
        })?;
        recv_ui_response(response_receiver, "the GPUI key command")?.map_err(Error::from_reason)
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

    fn surface_canvas_preparation_diagnostics(&self) -> Result<()> {
        let pending = take_canvas_preparation_diagnostics(
            &self.canvas_display_lists,
            self.strict_styles.load(Ordering::Relaxed),
            &self.tree,
            &self.canvas_diagnostic_members,
        )
        .map_err(Error::from_reason)?;
        self.style_diagnostics.lock().unwrap().extend(pending);
        Ok(())
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
            canvas_display_lists: SharedDisplayLists::default(),
            lifecycle: Arc::new(Mutex::new(RendererLifecycle::Uninitialized)),
            animation_frame_timestamp_origin: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            frame_request_callback: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            active_frame_clock_kind: Arc::new(Mutex::new(ActiveFrameClockKind::Timer)),
            #[cfg(target_os = "macos")]
            frame_request_outstanding: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            pending_frame_request: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            present_timing_capture: Mutex::new(None),
            #[cfg(all(target_os = "macos", feature = "test-support"))]
            synchronous_scroll_draw_count: AtomicU64::new(0),
            selection: SharedSelection::default(),
            image_network_policy: crate::custom_elements::img::ImageNetworkPolicy::default(),
            strict_styles: AtomicBool::new(true),
            style_diagnostics: Mutex::new(PendingStyleDiagnostics::default()),
            canvas_diagnostic_members: Mutex::new(HashSet::new()),
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
        let reduced_motion_override = options.as_ref().and_then(|options| options.reduced_motion);
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
        self.image_network_policy
            .set_allow_private(options.allow_private_network_images.unwrap_or(false));

        let width = options.width.unwrap_or(800.0);
        let height = options.height.unwrap_or(600.0);
        let title = options.title.clone().unwrap_or_else(|| "GPUIX".to_string());
        let app_name = options.app_name.clone().unwrap_or_else(|| title.clone());
        let menus = options.menus.clone();
        // `focus: false` must also skip `cx.activate`: the window flag only
        // decides key status inside the app, activation is what steals focus.
        let activate = options.focus.unwrap_or(true);
        let window_options = options.clone();

        let platform = Rc::new(gpui_macos::MacPlatform::new_embedded());
        let frame_request_callback = self.frame_request_callback.clone();
        let frame_request_outstanding = self.frame_request_outstanding.clone();
        let pending_frame_request = self.pending_frame_request.clone();
        platform.on_request_frame(move |frame_request| {
            let callback = frame_request_callback
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            let Some(callback) = callback else {
                frame_request.dispatch();
                return;
            };

            if frame_request_outstanding
                .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                .is_err()
            {
                return;
            }

            *pending_frame_request
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(frame_request);

            let completed = frame_request_outstanding.clone();
            let pending_on_completion = pending_frame_request.clone();
            let status = callback.call_with_return_value(
                (),
                ThreadsafeFunctionCallMode::NonBlocking,
                move |_result, _env| {
                    if let Some(frame_request) = pending_on_completion
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .take()
                    {
                        frame_request.dispatch();
                    }
                    completed.store(false, Ordering::Release);
                    Ok(())
                },
            );
            if status != Status::Ok {
                if let Some(frame_request) = pending_frame_request
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    frame_request.dispatch();
                }
                frame_request_outstanding.store(false, Ordering::Release);
            }
        });

        let tree = self.tree.clone();
        let canvas_display_lists = self.canvas_display_lists.clone();
        let callback = self.event_callback_for_view();
        let window_event_callback = self.window_event_callback();
        let application_callback = self.application_event_callback();

        let selection = self.selection.clone();
        let image_network_policy = self.image_network_policy.clone();
        let opened_window = Rc::new(RefCell::new(None));
        let startup_error = Rc::new(RefCell::new(None));
        let opened_window_for_app = opened_window.clone();
        let startup_error_for_app = startup_error.clone();
        // bun/node is not a .app. A Dock icon with no window cannot relaunch.
        // Last window close quits AppKit; tick() returns false and JS exits.
        let app = gpui::Application::with_platform(platform.clone())
            .with_http_client(default_http_client())
            .with_quit_mode(gpui::QuitMode::LastWindowClosed);
        let app_handle = app.run_embedded(move |cx: &mut gpui::App| {
            let reduced_motion = effective_reduced_motion(reduced_motion_override, || {
                Some(cx.should_reduce_motion())
            });
            cx.set_reduce_motion(reduced_motion);
            if reduced_motion_override.is_none() {
                cx.on_reduce_motion_change(|cx| {
                    cx.set_reduce_motion(cx.should_reduce_motion());
                })
                .detach();
            }
            init_key_bindings(cx);
            crate::custom_elements::input::init(cx);
            init_application_menu_support(cx, Some(application_callback.clone()));
            if let Err(error) = install_application_menus(cx, &app_name, menus) {
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
                    cx.new(|view_cx| {
                        GpuixView::new(
                            tree.clone(),
                            canvas_display_lists.clone(),
                            callback.clone(),
                            window_event_callback.clone(),
                            title,
                            selection.clone(),
                            image_network_policy.clone(),
                            view_cx,
                        )
                    })
                },
            ) {
                Ok(window_handle) => {
                    *opened_window_for_app.borrow_mut() = Some(window_handle);
                    if activate {
                        cx.activate(true);
                    }
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

    // GPUI declares PerMonitorV2 only in the host exe manifest (zed#8936).
    // A napi .node is loaded by node.exe/bun.exe, so that manifest never applies.
    // Call on gpuix-ui only, before WindowsPlatform::new. Never on the Node thread:
    // the V2 fallback is SetThreadDpiAwarenessContext, which would change bun itself.
    #[cfg(target_os = "windows")]
    fn enable_per_monitor_dpi() {
        use windows::Win32::UI::HiDpi::{
            AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
            SetProcessDpiAwarenessContext, SetThreadDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };

        // SAFETY: All functions are process/thread DPI configuration calls. This
        // runs before this thread creates a window, as required by Win32.
        unsafe {
            let current = GetThreadDpiAwarenessContext();
            if AreDpiAwarenessContextsEqual(current, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
                .as_bool()
            {
                return;
            }
            if SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).is_ok() {
                return;
            }
            if SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE).is_ok() {
                return;
            }
            // Process awareness is already locked (node/bun manifest). This thread has no HWND yet.
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
    }

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
    fn init_threaded(&self, options: Option<WindowOptions>) -> Result<()> {
        let options = options.unwrap_or_default();
        if *self.lifecycle.lock().unwrap() != RendererLifecycle::Uninitialized {
            return Err(Error::from_reason("Renderer is already initialized"));
        }
        self.image_network_policy
            .set_allow_private(options.allow_private_network_images.unwrap_or(false));

        let width = options.width.unwrap_or(800.0);
        let height = options.height.unwrap_or(600.0);
        let title = options.title.clone().unwrap_or_else(|| "GPUIX".to_string());
        let app_name = options.app_name.clone().unwrap_or_else(|| title.clone());
        let menus = options.menus.clone();
        let reduced_motion = effective_reduced_motion(options.reduced_motion, || None);
        // `focus: false` must also skip `cx.activate`: the window flag only
        // decides key status inside the app, activation is what steals focus.
        let activate = options.focus.unwrap_or(true);
        let window_options = options.clone();
        let tree = self.tree.clone();
        let canvas_display_lists = self.canvas_display_lists.clone();
        let selection = self.selection.clone();
        let image_network_policy = self.image_network_policy.clone();
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
                #[cfg(target_os = "windows")]
                Self::enable_per_monitor_dpi();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let app = gpui_platform::application()
                        .with_http_client(default_http_client())
                        .with_quit_mode(gpui::QuitMode::LastWindowClosed);
                    app.run(move |cx| {
                        cx.set_reduce_motion(reduced_motion);
                        init_key_bindings(cx);
                        crate::custom_elements::input::init(cx);
                        init_application_menu_support(cx, Some(application_callback.clone()));
                        if let Err(error) = install_application_menus(cx, &app_name, menus) {
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
                                cx.new(|view_cx| {
                                    GpuixView::new(
                                        tree,
                                        canvas_display_lists,
                                        callback,
                                        window_event_callback,
                                        title,
                                        selection,
                                        image_network_policy,
                                        view_cx,
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
                        if activate {
                            cx.activate(true);
                        }
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

    /// Enable actionable diagnostics for rejected style fields. React enables this
    /// by default outside production builds.
    #[napi]
    pub fn set_strict_styles(&self, enabled: bool) {
        self.strict_styles.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.style_diagnostics.lock().unwrap().clear();
        }
    }

    /// Opt in to loopback and private-network URL image sources.
    /// Link-local and cloud-metadata addresses remain blocked.
    #[napi]
    pub fn set_allow_private_network_images(&self, enabled: bool) {
        self.image_network_policy.set_allow_private(enabled);
    }

    /// Drain rejected style fields after a commit, once element type and testId are known.
    #[napi]
    pub fn drain_style_diagnostics(&self) -> Vec<GpuixStyleDiagnostic> {
        if !self.strict_styles.load(Ordering::Relaxed) {
            self.surface_canvas_preparation_diagnostics()
                .expect("non-strict canvas preparation diagnostics cannot throw");
        }
        drain_style_diagnostics(&self.style_diagnostics, &self.tree)
    }

    /// Return diagnostics not yet sent to stderr without consuming assertion evidence.
    #[napi]
    pub fn take_style_diagnostics_for_reporting(&self) -> Vec<GpuixStyleDiagnostic> {
        if !self.strict_styles.load(Ordering::Relaxed) {
            self.surface_canvas_preparation_diagnostics()
                .expect("non-strict canvas preparation diagnostics cannot throw");
        }
        take_style_diagnostics_for_reporting(&self.style_diagnostics, &self.tree)
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

    /// Replace one canvas element's retained display list and repaint without
    /// requiring a React commit.
    #[napi]
    pub fn apply_canvas_commands(
        &self,
        id: f64,
        ops: Uint32Array,
        operands: Float64Array,
        strings: Vec<String>,
    ) -> Result<()> {
        self.surface_canvas_preparation_diagnostics()?;
        let id = to_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        validate_canvas_target(&tree, id).map_err(Error::from_reason)?;
        let decoded = crate::canvas::decode(
            ops.as_ref(),
            operands.as_ref(),
            &strings,
            canvas_size(&tree, id),
        )
        .map_err(|error| Error::from_reason(format!("<canvas> element {id}: {error}")))?;
        let strict = self.strict_styles.load(Ordering::Relaxed);
        if strict && !decoded.diagnostics.is_empty() {
            let message = first_canvas_diagnostic_message(&tree, id, &decoded.diagnostics)
                .expect("non-empty canvas diagnostics has a first item");
            return Err(Error::from_reason(message));
        }
        let outcome =
            crate::canvas::install_decoded_display_list(&self.canvas_display_lists, id, decoded);
        drop(tree);
        if !strict {
            self.style_diagnostics
                .lock()
                .unwrap()
                .extend(fresh_canvas_diagnostics(
                    id,
                    outcome.diagnostics,
                    &self.canvas_diagnostic_members,
                ));
        }
        if outcome.invalidates {
            self.request_invalidate()?;
        }
        Ok(())
    }

    /// Start or join one renderer-local canvas image load. The observer keeps
    /// the decoded entry alive until JavaScript changes or releases the source.
    #[napi]
    pub fn load_canvas_image(&self, observer_id: f64, source_json: String) -> Result<()> {
        let observer_id = to_element_id(observer_id)?;
        let source = parse_canvas_image_source(source_json)?;
        let policy = self.image_network_policy.clone();

        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.canvas_image_store
                .observe(observer_id, source, policy, window, cx);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ObserveCanvasImage {
            observer_id,
            source,
            policy,
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason(
            "Canvas image loading is not supported by this renderer",
        ))
    }

    #[napi]
    pub fn get_canvas_image_load_state(
        &self,
        observer_id: f64,
    ) -> Result<Option<CanvasImageLoadState>> {
        let observer_id = to_element_id(observer_id)?;

        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, _cx| {
            canvas_image_load_state_js(view.canvas_image_store.observer_state(observer_id))
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetCanvasImageLoadState {
                observer_id,
                response,
            })?;
            return recv_ui_response(receiver, "the canvas image state query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Ok(None)
    }

    #[napi]
    pub fn release_canvas_image(&self, observer_id: f64) -> Result<()> {
        let observer_id = to_element_id(observer_id)?;

        #[cfg(target_os = "macos")]
        return update_window(move |view, window, _cx| {
            view.canvas_image_store
                .release_observer(observer_id, window);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ReleaseCanvasImageObserver(observer_id));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Ok(())
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
    ///   ["insertBefore",     parentId, childId, beforeId]
    ///   ["setStyle",         id, { ...style }]
    ///   ["setText",          id, "content"]
    ///   ["setEventListener", id, "eventType", true|false]
    ///   ["setRoot",          id]
    ///   ["setCustomPropValue", id, "key", value]
    ///
    /// Returns accumulated destroyed IDs from all destroyElement ops.
    /// Acquires the tree mutex ONCE for the entire batch.
    #[napi]
    pub fn apply_batch(&self, json: String) -> Result<Vec<f64>> {
        if *self.lifecycle.lock().unwrap() == RendererLifecycle::Terminated {
            return Ok(Vec::new());
        }
        let mut tree = self.tree.lock().unwrap();
        let outcome = apply_batch_to_tree_with_diagnostics(
            &mut tree,
            json.as_bytes(),
            self.strict_styles.load(Ordering::Relaxed),
        )
        .map_err(Error::from_reason)?;
        drop(tree);
        if self.strict_styles.load(Ordering::Relaxed) {
            self.style_diagnostics
                .lock()
                .unwrap()
                .extend(outcome.diagnostics);
        }
        let destroyed_canvas_ids: Vec<u64> =
            outcome.destroyed_ids.iter().map(|id| *id as u64).collect();
        crate::canvas::remove_display_lists(&self.canvas_display_lists, &destroyed_canvas_ids);
        forget_canvas_diagnostics(&self.canvas_diagnostic_members, &destroyed_canvas_ids);
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
                    self.finish_macos_termination();
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

    fn pump_native_event_loop(&self, dispatch_frame_request: bool) -> Result<bool> {
        self.pump_native_event_loop_after_precheck(dispatch_frame_request, || {})
    }

    fn pump_native_event_loop_after_precheck(
        &self,
        dispatch_frame_request: bool,
        after_precheck: impl FnOnce(),
    ) -> Result<bool> {
        match *self.lifecycle.lock().unwrap() {
            RendererLifecycle::Uninitialized => {
                return Err(Error::from_reason(
                    "Renderer not initialized. Call init() first.",
                ));
            }
            RendererLifecycle::Terminated => {
                #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
                self.ui_commands.lock().unwrap().take();
                return Ok(false);
            }
            RendererLifecycle::Running => {}
        }

        #[cfg(target_os = "macos")]
        {
            // Avoid an extra idle pump when a native callback is already queued.
            // This is only a latency optimization: a request can race this load,
            // so MacPlatform::pump_events itself must always return before waiting.
            if should_defer_idle_pump(
                dispatch_frame_request,
                self.frame_request_outstanding.load(Ordering::Acquire),
            ) {
                return Ok(true);
            }
            after_precheck();
            if dispatch_frame_request {
                if let Some(frame_request) = self
                    .pending_frame_request
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    frame_request.dispatch();
                }
            }
            let running = MAC_PLATFORM.with(|p| {
                p.borrow()
                    .as_ref()
                    .map(|platform| platform.pump_events())
                    .unwrap_or(false)
            });
            if !running {
                self.finish_macos_termination();
            }
            return Ok(running);
        }

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let _ = (dispatch_frame_request, after_precheck);
            let running = *self.lifecycle.lock().unwrap() == RendererLifecycle::Running;
            if !running {
                self.ui_commands.lock().unwrap().take();
            }
            return Ok(running);
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = after_precheck;
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    /// Pump the native event loop. Returns false after the last window closes.
    /// A pending display-link token is dispatched immediately before this pump.
    #[napi]
    pub fn tick(&self) -> Result<bool> {
        let running = self.pump_native_event_loop(true)?;
        self.surface_canvas_preparation_diagnostics()?;
        Ok(running)
    }

    /// Pump idle platform work without dispatching a pending frame token.
    /// This keeps input and application lifecycle events responsive between frames.
    #[napi]
    pub fn tick_idle(&self) -> Result<bool> {
        let running = self.pump_native_event_loop(false)?;
        self.surface_canvas_preparation_diagnostics()?;
        Ok(running)
    }

    #[cfg(target_os = "macos")]
    fn finish_macos_termination(&self) {
        GPUI_WINDOW.with(|window| {
            window.borrow_mut().take();
        });
        GPUI_APP.with(|app| {
            app.borrow_mut().take();
        });
        MAC_PLATFORM.with(|platform| {
            platform.borrow_mut().take();
        });
        *self.lifecycle.lock().unwrap() = RendererLifecycle::Terminated;
    }

    /// Test seam that posts the real macOS accessibility-display notification.
    #[napi]
    pub fn test_set_platform_reduced_motion(&self, enabled: bool) -> Result<()> {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        {
            if *self.lifecycle.lock().unwrap() != RendererLifecycle::Running {
                return Err(Error::from_reason(
                    "Renderer not initialized. Call init() first.",
                ));
            }
            MAC_PLATFORM.with(|platform| {
                let platform = platform.borrow();
                let platform = platform
                    .as_ref()
                    .ok_or_else(|| Error::from_reason("GPUI platform is not initialized"))?;
                platform.test_set_reduce_motion_and_post_notification(enabled);
                Ok(())
            })
        }

        #[cfg(not(all(target_os = "macos", feature = "test-support")))]
        {
            let _ = enabled;
            Err(Error::from_reason(
                "Platform reduced-motion test seam requires macOS test support",
            ))
        }
    }

    /// Whether the embedded macOS runtime is still retained by thread-local handles.
    #[napi]
    pub fn test_has_embedded_runtime(&self) -> bool {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        {
            GPUI_WINDOW.with(|window| window.borrow().is_some())
                || GPUI_APP.with(|app| app.borrow().is_some())
                || MAC_PLATFORM.with(|platform| platform.borrow().is_some())
        }

        #[cfg(not(all(target_os = "macos", feature = "test-support")))]
        false
    }

    #[napi]
    pub fn is_initialized(&self) -> bool {
        *self.lifecycle.lock().unwrap() == RendererLifecycle::Running
    }

    /// Stable platform and renderer feature read.
    ///
    /// `frameClock.requiresTick` is how JavaScript learns it must call tick()
    /// until it returns false. macOS: tick() pumps AppKit. Windows/Linux:
    /// tick() reports whether the UI thread is still inside `Platform::run`.
    /// Both return false after the last window closes so the JS frame loop can
    /// finish termination.
    #[napi]
    pub fn capabilities(&self) -> RendererCapabilities {
        renderer_capabilities(self.active_frame_clock_kind())
    }

    /// Registers a coalesced display-link frame request callback when supported.
    /// Returns false when this renderer must be timer-driven instead.
    #[napi]
    pub fn set_frame_request_handler(
        &self,
        callback: Option<ThreadsafeFunction<(), Unknown<'static>, (), Status, false, false, 1>>,
    ) -> bool {
        #[cfg(target_os = "macos")]
        {
            let unregistering = callback.is_none();
            *self
                .frame_request_callback
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = callback.map(Arc::new);
            if unregistering {
                if let Some(frame_request) = self
                    .pending_frame_request
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    frame_request.dispatch();
                }
            }
            *self
                .active_frame_clock_kind
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = if unregistering {
                ActiveFrameClockKind::Timer
            } else {
                ActiveFrameClockKind::DisplayLink
            };
            return true;
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = callback;
            false
        }
    }

    /// Queue one callback on GPUI's next display-paced frame. `on_next_frame`
    /// creates frame demand without dirtying the window, so an otherwise idle
    /// callback does not force a draw.
    #[napi]
    pub fn request_frame(
        &self,
        #[napi(ts_arg_type = "(timestamp: number) => void")] callback: AnimationFrameCallback,
    ) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let timestamp_origin = self.animation_frame_timestamp_origin.clone();
            return update_window_without_view(move |window, cx| {
                let origin =
                    animation_frame_origin(&timestamp_origin, cx.background_executor().now());
                window.on_next_frame(move |_window, cx| {
                    dispatch_animation_frame_callback(
                        callback,
                        animation_frame_timestamp_ms(origin, cx.background_executor().now()),
                    );
                });
            });
        }

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::RequestFrame {
            callback,
            timestamp_origin: self.animation_frame_timestamp_origin.clone(),
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = callback;
            Err(Error::from_reason(
                "The production GPUIX renderer does not support animation frames",
            ))
        }
    }

    /// Whether this native window is active and receiving key events.
    #[napi]
    pub fn is_active(&self, _env: Env) -> Result<bool> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| window.is_window_active());

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::IsWindowActive { response })?;
            return recv_ui_response(receiver, "the window activation query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        unsupported_capability(_env, "window.activation")
    }

    /// Bring the native window and application to the foreground.
    #[napi]
    pub fn activate_window(&self, _env: Env) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            GPUI_APP.with(|app| {
                let app = app.borrow();
                let app = app
                    .as_ref()
                    .ok_or_else(|| Error::from_reason("GPUI application is not initialized"))?;
                app.update(|cx| cx.activate(true));
                Ok::<(), Error>(())
            })?;
            return update_window(|_view, window, _cx| window.activate_window());
        }

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ActivateWindow);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        unsupported_capability(_env, "window.activate")
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
        Err(Error::from_reason(
            "The production GPUIX renderer does not support this operating system",
        ))
    }

    #[napi]
    pub fn get_window_insets(&self) -> Result<WindowInsets> {
        #[cfg(target_os = "macos")]
        return update_window(|_view, window, _cx| WindowInsets::from_gpui(window.insets()));

        #[cfg(not(target_os = "macos"))]
        Ok(WindowInsets::default())
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

    /// Move focus to an element. `preventScroll` mirrors the `FocusOptions`
    /// member of `HTMLElement.focus()`: focus without revealing the element
    /// inside its scroll ancestors.
    #[napi]
    pub fn focus_element(&self, element_id: f64, prevent_scroll: Option<bool>) -> Result<()> {
        let id = to_element_id(element_id)?;
        let reveal = !prevent_scroll.unwrap_or(false);
        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.focus_element(id, reveal, window, cx);
            window.refresh();
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::FocusElement { id, reveal });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Move focus to the next GPUIX tab stop without dispatching a key event.
    #[napi]
    pub fn focus_next(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(|view, window, cx| view.move_focus(FocusDirection::Next, window, cx));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::FocusNext);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Move focus to the previous GPUIX tab stop without dispatching a key event.
    #[napi]
    pub fn focus_previous(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(|view, window, cx| {
            view.move_focus(FocusDirection::Previous, window, cx)
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::FocusPrevious);

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Complete the DOM default for a Tab keydown after React capture and
    /// bubble handlers have had a chance to call preventDefault().
    #[napi]
    pub fn resolve_tab_key_down(&self, default_prevented: bool) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.resolve_tab_key_down(default_prevented, window, cx);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ResolveTabKeyDown { default_prevented });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// The focused host element id, analogous to `document.activeElement`, or null.
    /// This reads GPUI focus directly, so role-less focusable elements are included.
    #[napi]
    pub fn get_active_element(&self) -> Result<Option<f64>> {
        #[cfg(target_os = "macos")]
        return update_window(|view, window, _cx| {
            view.active_element_id(window).map(|id| id as f64)
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetActiveElement { response })?;
            return Ok(recv_ui_response(receiver, "the active element query")?.map(|id| id as f64));
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Route the active pressed-pointer sequence to this retained element.
    #[napi]
    pub fn set_pointer_capture(&self, element_id: f64) -> Result<()> {
        let id = to_element_id(element_id)?;

        #[cfg(target_os = "macos")]
        return update_window(|view, window, _cx| view.set_pointer_capture(id, window))?
            .map_err(Error::from_reason);

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::SetPointerCapture { id, response })?;
            return recv_ui_response(receiver, "pointer capture")?.map_err(Error::from_reason);
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Release capture only when this retained element currently owns it.
    #[napi]
    pub fn release_pointer_capture(&self, element_id: f64) -> Result<()> {
        let id = to_element_id(element_id)?;

        #[cfg(target_os = "macos")]
        return update_window(|view, window, _cx| {
            view.release_pointer_capture(id, window);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::ReleasePointerCapture { id, response })?;
            return recv_ui_response(receiver, "pointer capture release");
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

    // ── Text editing API ─────────────────────────────────────────────
    // `<input>` and `<textarea>` own an editor whose text and caret live in a
    // GPUI entity, not in the retained tree. These read and write it the way
    // `HTMLInputElement` does, in UTF-16 code units.
    //
    // Every one of them draws the committed tree first, exactly as
    // `getElementBounds` does. A React commit only reaches the editor when the
    // frame syncs the `value` prop into it, and that sync parks the caret at
    // the end of the new text. Writing a caret without flushing first would let
    // the next frame overwrite it — which is precisely the caret restoration an
    // effect after a reformatting `onChange` is trying to perform.

    /// One editor's API value, or null for any element that does not edit text.
    #[napi]
    pub fn get_input_value(&self, element_id: f64) -> Result<Option<String>> {
        Ok(self
            .text_editing_state(to_element_id(element_id)?)?
            .map(|state| state.value))
    }

    /// `[selectionStart, selectionEnd, backward]` in UTF-16 code units, where
    /// `backward` is 1 for `selectionDirection == "backward"`. Null for any
    /// element that does not edit text.
    #[napi]
    pub fn get_input_selection(&self, element_id: f64) -> Result<Option<Vec<f64>>> {
        Ok(self
            .text_editing_state(to_element_id(element_id)?)?
            .map(|state| {
                vec![
                    state.selection_start as f64,
                    state.selection_end as f64,
                    if state.selection_backward { 1.0 } else { 0.0 },
                ]
            }))
    }

    /// Write one editor's value, as assigning `HTMLInputElement.value` does:
    /// no `change` event, and the caret moves to the end when the value differs.
    #[napi]
    pub fn set_input_value(&self, element_id: f64, value: String) -> Result<()> {
        let id = to_element_id(element_id)?;

        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            view.custom_registry.set_text_value(id, value, cx);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::SetTextValue { id, value });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// `HTMLInputElement.setSelectionRange()` in UTF-16 code units.
    #[napi]
    pub fn set_input_selection(
        &self,
        element_id: f64,
        start: f64,
        end: f64,
        backward: bool,
    ) -> Result<()> {
        let id = to_element_id(element_id)?;
        let start = to_selection_offset(start);
        let end = to_selection_offset(end);

        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            view.custom_registry
                .set_text_selection(id, start, end, backward, cx);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::SetTextSelection {
            id,
            start,
            end,
            backward,
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    fn text_editing_state(&self, id: u64) -> Result<Option<TextEditingState>> {
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        #[cfg(target_os = "macos")]
        return update_window(move |view, _window, cx| {
            view.custom_registry.text_editing_state(id, cx)
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetTextEditingState { id, response })?;
            return recv_ui_response(receiver, "the text editing state query");
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
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
    ///
    /// For a `<virtual-list>` the scroll is queued and applied on the next
    /// render, after that frame's child splice, so indices computed against a
    /// just-committed child list are never shifted twice. `offsetInItem` is in
    /// pixels and may be negative, which anchors the viewport top above the
    /// item and resolves against measured heights at layout time.
    #[napi]
    pub fn scroll_to_item(
        &self,
        element_id: f64,
        index: f64,
        offset_in_item: Option<f64>,
    ) -> Result<()> {
        let id = to_element_id(element_id)?;
        let index = index as usize;
        let offset = offset_in_item.unwrap_or(0.0) as f32;
        #[cfg(target_os = "macos")]
        if !VIRTUAL_LIST_STATES.with(|cell| {
            if !cell.borrow().contains_key(&id) {
                return false;
            }
            queue_virtual_list_scroll(id, index, offset);
            true
        }) {
            let tree = self.tree.lock().unwrap();
            SCROLL_HANDLES.with(|cell| {
                let handles = cell.borrow();
                if let Some(handle) = handles.get(&id) {
                    scroll_handle_to_child(handle, &tree, id, index);
                }
            });
        }
        #[cfg(target_os = "macos")]
        return invalidate_window();

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ScrollToItem { id, index, offset });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = offset;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    /// The logical scroll anchor of a `<virtual-list>`:
    /// `[itemIndex, offsetInItemPx, viewportHeightPx]`, or null for anything
    /// else. `itemIndex == item count` is gpui's at-end sentinel.
    ///
    /// Unlike `getScrollOffset` this is exact even while row heights are still
    /// estimates, because it is the anchor gpui itself scrolls by.
    #[napi]
    pub fn get_list_scroll_top(&self, element_id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(element_id)?;
        #[cfg(target_os = "macos")]
        return Ok(VIRTUAL_LIST_STATES.with(|cell| {
            cell.borrow().get(&id).map(|state| {
                let top = state.logical_scroll_top();
                vec![
                    top.item_ix as f64,
                    f64::from(f32::from(top.offset_in_item)),
                    f64::from(f32::from(state.viewport_bounds().size.height)),
                ]
            })
        }));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetListScrollTop { id, response })?;
            return Ok(
                recv_ui_response(receiver, "the GPUI list scroll query")?.map(|top| top.to_vec())
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

    /// Starts a macOS profiler capture at GPUI's post-platform-submit present boundary.
    #[napi]
    pub fn start_present_timing_capture(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let window_id = GPUI_WINDOW.with(|window| {
                window
                    .borrow()
                    .as_ref()
                    .map(|window| window.window_id())
                    .ok_or_else(|| Error::from_reason("Window not initialized"))
            })?;
            let mut capture = self
                .present_timing_capture
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let disable_trace_when_done = capture
                .as_ref()
                .is_some_and(|capture| capture.disable_trace_when_done)
                || gpui::set_trace_enabled(true);
            *capture = Some(PresentTimingCapture {
                collector: gpui::FrameTimingCollector::new(),
                window_id,
                disable_trace_when_done,
            });
            return Ok(());
        }

        #[cfg(not(target_os = "macos"))]
        Err(Error::from_reason(
            "Present timing capture is only available on macOS",
        ))
    }

    /// Ends the capture and returns ordered millisecond offsets for submitted frames.
    #[napi]
    pub fn take_present_timestamps(&self) -> Result<Vec<f64>> {
        #[cfg(target_os = "macos")]
        {
            let mut capture = self
                .present_timing_capture
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
                .ok_or_else(|| Error::from_reason("Present timing capture has not started"))?;
            let present_ends = capture
                .collector
                .collect_unseen()
                .into_iter()
                .filter_map(|event| match event {
                    gpui::FrameEvent::Present(timing) if timing.window_id == capture.window_id => {
                        Some(timing.present_end)
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            if capture.disable_trace_when_done {
                gpui::set_trace_enabled(false);
            }
            let Some(first) = present_ends.first().copied() else {
                return Ok(Vec::new());
            };
            return Ok(present_ends
                .into_iter()
                .map(|presented_at| presented_at.duration_since(first).as_secs_f64() * 1_000.0)
                .collect());
        }

        #[cfg(not(target_os = "macos"))]
        Err(Error::from_reason(
            "Present timing capture is only available on macOS",
        ))
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

    /// Web-shaped scroll geometry for a scrollable element, as
    /// `[scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight]`,
    /// or null when the element is not a scroll container. Unlike
    /// `getScrollOffset` the offsets use the DOM's positive convention.
    ///
    /// Forces layout first, like `Element.scrollHeight` does: without it a read
    /// from a mount effect, before the first frame, sees no scroll geometry at
    /// all and reports the element as unscrollable.
    #[napi]
    pub fn get_scroll_metrics(&self, element_id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(element_id)?;
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        #[cfg(target_os = "macos")]
        return Ok(VIRTUAL_LIST_STATES
            .with(|cell| cell.borrow().get(&id).map(virtual_list_metrics))
            .or_else(|| {
                SCROLL_HANDLES.with(|cell| cell.borrow().get(&id).map(scroll_handle_metrics))
            })
            .map(|metrics| metrics.to_vec()));

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::GetScrollMetrics { id, response })?;
            return Ok(recv_ui_response(receiver, "the GPUI scroll metrics query")?
                .map(|metrics| metrics.to_vec()));
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        Err(Error::from_reason("Unsupported operating system"))
    }

    /// Reveal one element inside every scrollable ancestor, as
    /// `Element.scrollIntoView()` does, without moving focus. `alignToTop` is
    /// the DOM's `block: "start"` and defaults to it; `false` is
    /// `block: "nearest"`.
    ///
    /// Forces layout first: the reveal reads painted child geometry, which a
    /// caller running before the first frame would not have.
    #[napi]
    pub fn scroll_element_into_view(
        &self,
        element_id: f64,
        align_to_top: Option<bool>,
    ) -> Result<()> {
        let id = to_element_id(element_id)?;
        let align_to_top = align_to_top.unwrap_or(true);
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        #[cfg(target_os = "macos")]
        return update_window(move |view, window, cx| {
            view.scroll_element_into_view(id, align_to_top, cx);
            window.refresh();
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.send_ui_command(UiCommand::ScrollElementIntoView { id, align_to_top });

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
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        let bounds = self.automation_bounds()?;
        let tree = self.tree.lock().unwrap();
        let json = tree.to_automation_json(&bounds);
        serde_json::to_string(&json)
            .map_err(|e| Error::from_reason(format!("JSON serialization failed: {}", e)))
    }

    #[napi]
    pub fn get_element_bounds(&self, id: f64) -> Result<Option<Vec<f64>>> {
        let id = to_element_id(id)?;
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
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
    pub fn get_painted_text(&self) -> Result<Vec<String>> {
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        Ok(crate::text::painted_text())
    }

    /// Every highlight wash painted in the last frame, in paint order.
    ///
    /// A quad is invisible to `getPaintedText()`, so this is the only way to
    /// assert on `highlight` without a screenshot.
    #[napi]
    pub fn get_painted_highlights(&self) -> Result<Vec<crate::element_tree::HighlightMatch>> {
        #[cfg(target_os = "macos")]
        draw_window_for_automation_read()?;
        Ok(crate::text::painted_highlights()
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Simulate space-separated keystrokes through the focused element's input pipeline.
    #[napi]
    pub fn simulate_keystrokes(&self, keystrokes: String) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_keystrokes(window, cx, &keystrokes)
        })?
        .map_err(Error::from_reason);

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_key_input(KeyInput::Keystrokes(keystrokes));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = keystrokes;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    #[napi]
    pub fn simulate_key_down(&self, keystroke: String, is_held: Option<bool>) -> Result<()> {
        let is_held = is_held.unwrap_or(false);

        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_key_down(window, cx, &keystroke, is_held)
        })?
        .map_err(Error::from_reason);

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_key_input(KeyInput::Down { keystroke, is_held });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (keystroke, is_held);
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    #[napi]
    pub fn simulate_key_up(&self, keystroke: String) -> Result<()> {
        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_key_up(window, cx, &keystroke)
        })?
        .map_err(Error::from_reason);

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_key_input(KeyInput::Up(keystroke));

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = keystroke;
            Err(Error::from_reason("Unsupported operating system"))
        }
    }

    /// `modifiers` uses the `press()` syntax: "cmd", "cmd-shift", "alt".
    /// `clickCount` is the platform's repeat count: 2 for the second click of
    /// a double click (default 1).
    #[napi]
    pub fn simulate_click(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<()> {
        let button = button.unwrap_or(0);
        let modifiers =
            crate::automation::parse_modifiers(modifiers.as_deref()).map_err(Error::from_reason)?;
        let click_count =
            crate::automation::click_count(click_count).map_err(Error::from_reason)?;

        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_click(window, cx, x, y, button, modifiers, click_count);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Click {
            x,
            y,
            button,
            modifiers,
            click_count,
        });

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

    /// macOS-only automation seam that posts NSEvents through the production
    /// AppKit → GPUI event path instead of calling the direct test dispatcher.
    #[napi(js_name = "postAppKitClick")]
    pub fn post_appkit_click(&self, x: f64, y: f64) -> Result<()> {
        #[cfg(target_os = "macos")]
        return post_appkit_click(x, y);

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (x, y);
            Err(Error::from_reason(
                "AppKit click automation is only available on macOS",
            ))
        }
    }

    #[napi]
    pub fn simulate_mouse_down(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<()> {
        let button = button.unwrap_or(0);
        let modifiers =
            crate::automation::parse_modifiers(modifiers.as_deref()).map_err(Error::from_reason)?;
        let click_count =
            crate::automation::click_count(click_count).map_err(Error::from_reason)?;

        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_mouse_down(window, cx, x, y, button, modifiers, click_count);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Down {
            x,
            y,
            button,
            modifiers,
            click_count,
        });

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
    pub fn simulate_mouse_up(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<()> {
        let button = button.unwrap_or(0);
        let modifiers =
            crate::automation::parse_modifiers(modifiers.as_deref()).map_err(Error::from_reason)?;
        let click_count =
            crate::automation::click_count(click_count).map_err(Error::from_reason)?;

        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_mouse_up(window, cx, x, y, button, modifiers, click_count);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Up {
            x,
            y,
            button,
            modifiers,
            click_count,
        });

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
    pub fn simulate_mouse_move(
        &self,
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<()> {
        let modifiers =
            crate::automation::parse_modifiers(modifiers.as_deref()).map_err(Error::from_reason)?;

        #[cfg(target_os = "macos")]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_mouse_move(window, cx, x, y, pressed_button, modifiers);
        });

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::Move {
            x,
            y,
            pressed_button,
            modifiers,
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

    /// Dispatch a wheel event through the same GPUI hit test the trackpad uses.
    /// The options preserve gesture phase, line/pixel units, and modifiers.
    #[napi]
    pub fn simulate_scroll_wheel(
        &self,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        options: Option<crate::automation::ScrollWheelOptions>,
    ) -> Result<()> {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        {
            let window_id = GPUI_WINDOW.with(|window| {
                window
                    .borrow()
                    .as_ref()
                    .map(|window| window.window_id())
                    .ok_or_else(|| Error::from_reason("Window not initialized"))
            })?;
            let mut collector = gpui::FrameTimingCollector::default();
            let disable_trace_when_done = gpui::set_trace_enabled(true);
            let result = update_window_without_view(move |window, cx| {
                crate::automation::dispatch_scroll_wheel(
                    window, cx, x, y, delta_x, delta_y, options,
                )
                .map_err(Error::from_reason)
            });
            let synchronous_draws = collector
                .collect_unseen()
                .into_iter()
                .filter(|event| {
                    matches!(event, gpui::FrameEvent::Draw(timing) if timing.window_id == window_id)
                })
                .count() as u64;
            if disable_trace_when_done {
                gpui::set_trace_enabled(false);
            }
            self.synchronous_scroll_draw_count
                .fetch_add(synchronous_draws, Ordering::Relaxed);
            return result?;
        }

        #[cfg(all(target_os = "macos", not(feature = "test-support")))]
        return update_window_without_view(move |window, cx| {
            crate::automation::dispatch_scroll_wheel(window, cx, x, y, delta_x, delta_y, options)
                .map_err(Error::from_reason)
        })?;

        #[cfg(any(target_os = "windows", target_os = "linux", target_os = "freebsd"))]
        return self.dispatch_mouse_input(MouseInput::ScrollWheel {
            x,
            y,
            delta_x,
            delta_y,
            options,
        });

        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux",
            target_os = "freebsd"
        )))]
        {
            let _ = (x, y, delta_x, delta_y, options);
            Err(Error::from_reason(
                "The production GPUIX renderer does not support this operating system",
            ))
        }
    }

    /// Draws completed inline while live automation dispatched scroll input.
    #[napi]
    pub fn get_synchronous_scroll_draw_count(&self) -> Result<f64> {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        return Ok(self.synchronous_scroll_draw_count.load(Ordering::Relaxed) as f64);

        #[cfg(not(all(target_os = "macos", feature = "test-support")))]
        Err(Error::from_reason(
            "Synchronous scroll draw diagnostics require macOS test-support",
        ))
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
    pub fn capture_screenshot(&self, _env: Env, path: String) -> Result<()> {
        #[cfg(all(target_os = "macos", feature = "test-support"))]
        {
            // Leases the window untyped, as `draw_window_for_automation_read`
            // does. Drawing renders `GpuixView`, so holding a typed lease on it
            // across the draw aborts the process with an entity reentrancy
            // panic instead of answering the automation request.
            let image = update_window_without_view(move |window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.render_to_image()
            })?
            .map_err(|e| Error::from_reason(format!("Screenshot capture failed: {}", e)))?;
            image
                .save(&path)
                .map_err(|e| Error::from_reason(format!("Failed to save screenshot: {}", e)))?;
            Ok(())
        }

        #[cfg(all(target_os = "windows", feature = "test-support"))]
        {
            let (response, receiver) = sync_channel(1);
            self.send_ui_command(UiCommand::CaptureScreenshot { path, response })?;
            return recv_ui_response(receiver, "screenshot capture")?.map_err(Error::from_reason);
        }

        #[cfg(not(all(
            feature = "test-support",
            any(target_os = "macos", target_os = "windows")
        )))]
        {
            let _ = path;
            unsupported_capability(_env, "automation.screenshot")
        }
    }
}

#[cfg(all(target_os = "macos", feature = "test-support"))]
#[napi]
impl GpuixRenderer {
    /// Test seam for a native frame callback that arrives after tickIdle's
    /// outstanding-work precheck. The callback is queued from a background
    /// thread while the embedded AppKit pump owns the JavaScript thread.
    #[napi]
    pub fn test_idle_pump_frame_request_race(
        &self,
        callback: FrameRequestCallback,
    ) -> Result<bool> {
        self.pump_native_event_loop_after_precheck(false, move || {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2));
                let _ = callback.call_with_return_value(
                    (),
                    ThreadsafeFunctionCallMode::NonBlocking,
                    |_result, _env| Ok(()),
                );
            });
        })
    }
}

#[cfg(all(test, target_os = "macos"))]
mod frame_loop_tests {
    use super::*;

    #[test]
    fn idle_pump_skips_when_a_frame_callback_is_already_outstanding() {
        assert!(should_defer_idle_pump(false, true));
        assert!(!should_defer_idle_pump(false, false));
        assert!(!should_defer_idle_pump(true, true));
    }
}

#[cfg(all(test, not(all(target_arch = "wasm32", target_os = "unknown"))))]
mod initialization_tests {
    use super::*;

    #[test]
    fn inherited_image_colour_keeps_the_light_on_dark_fallback() {
        assert_eq!(
            u32::from(Inherited::root(&Theme::dark()).current_color),
            0xe2e2e2ff
        );
    }

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

    #[test]
    fn window_activation_emits_active_state() {
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_callback = emitted.clone();
        let callback: WindowEventCallback = Arc::new(Mutex::new(Some(Arc::new(move |payload| {
            emitted_for_callback.lock().unwrap().push(payload);
        }))));

        emit_window_activation_payload(&callback, false);

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        let payload = &emitted[0];
        assert_eq!(payload.event_type, "windowActivation");
        assert_eq!(payload.is_active, Some(false));
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
    canvas_display_lists: SharedDisplayLists,
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
        let window = cx.open_window(Default::default(), |window, cx| {
            if let Some(mode) = PENDING_DEBUG_OVERLAY.with(|pending| pending.borrow_mut().take()) {
                window.set_debug_frame_overlay_mode(mode);
            }
            cx.new(|view_cx| {
                GpuixView::new(
                    tree,
                    canvas_display_lists,
                    Some(event_callback),
                    window_event_callback,
                    "GPUIX Web".to_string(),
                    selection,
                    crate::custom_elements::img::ImageNetworkPolicy::default(),
                    view_cx,
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
fn update_web_view<R>(
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

/// The same modifier parse as every other surface, surfaced to JS as a thrown
/// error rather than a silently weakened gesture.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn parse_web_modifiers(
    modifiers: Option<&str>,
) -> Result<gpui::Modifiers, wasm_bindgen::JsValue> {
    crate::automation::parse_modifiers(modifiers)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

/// The same click-count check as every other surface, for the same reason.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn parse_web_click_count(click_count: Option<u32>) -> Result<usize, wasm_bindgen::JsValue> {
    crate::automation::click_count(click_count)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn update_web_window<R>(
    update: impl FnOnce(&mut gpui::Window, &mut gpui::App) -> R,
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
                gpui::AnyWindowHandle::from(window)
                    .update(cx, move |_view, window, cx| update(window, cx))
                    .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
            })
        })
    })
}

/// Draw the committed tree before reading or writing state a frame owns: the
/// browser counterpart of `draw_window_for_automation_read`.
///
/// The browser's own rAF loop would get there eventually, but "eventually" is
/// after the caller returns, and a caret written before that sync would be
/// overwritten by it.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn draw_web_window_for_read() -> Result<(), wasm_bindgen::JsValue> {
    update_web_window(|window, cx| {
        window.draw(cx).clear(cx);
    })
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn notify_web() {
    if let Err(error) = update_web_window(|window, _cx| window.refresh()) {
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
    canvas_display_lists: SharedDisplayLists,
    selection: SharedSelection,
    event_callback: EventCallback,
    window_event_callback: WindowEventCallback,
    window_resize_listener: wasm_bindgen::closure::Closure<dyn FnMut(web_sys::Event)>,
    strict_styles: AtomicBool,
    canvas_diagnostic_members: Mutex<HashSet<(u64, String)>>,
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[wasm_bindgen::prelude::wasm_bindgen(js_class = GpuixRenderer)]
impl WebGpuixRenderer {
    fn surface_canvas_preparation_diagnostics(&self) -> Result<(), wasm_bindgen::JsValue> {
        let pending = take_canvas_preparation_diagnostics(
            &self.canvas_display_lists,
            self.strict_styles.load(Ordering::Relaxed),
            &self.tree,
            &self.canvas_diagnostic_members,
        )
        .map_err(|message| wasm_bindgen::JsValue::from_str(&message))?;
        let tree = self.tree.lock().unwrap();
        for diagnostic in pending {
            let message = style_diagnostic_context(&diagnostic, &tree).0;
            web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&message));
        }
        Ok(())
    }

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
            canvas_display_lists: SharedDisplayLists::default(),
            selection: SharedSelection::default(),
            event_callback: web_event_callback(event_callback),
            window_event_callback,
            window_resize_listener,
            strict_styles: AtomicBool::new(true),
            canvas_diagnostic_members: Mutex::new(HashSet::new()),
        }
    }

    pub fn init(&self, _options: wasm_bindgen::JsValue) -> Result<(), wasm_bindgen::JsValue> {
        start_web_app(
            self.tree.clone(),
            self.canvas_display_lists.clone(),
            self.selection.clone(),
            self.event_callback.clone(),
            self.window_event_callback.clone(),
        )
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setStrictStyles)]
    pub fn set_strict_styles(&self, enabled: bool) {
        self.strict_styles.store(enabled, Ordering::Relaxed);
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
        let mut tree = self.tree.lock().unwrap();
        let outcome = apply_batch_to_tree_with_diagnostics(
            &mut tree,
            json.as_bytes(),
            self.strict_styles.load(Ordering::Relaxed),
        )
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))?;
        if self.strict_styles.load(Ordering::Relaxed) {
            for diagnostic in outcome.diagnostics {
                let (message, _, _, _, _) = style_diagnostic_context(&diagnostic, &tree);
                web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&message));
            }
        }
        let destroyed = outcome.destroyed_ids;
        drop(tree);
        let destroyed_canvas_ids: Vec<u64> = destroyed.iter().map(|id| *id as u64).collect();
        crate::canvas::remove_display_lists(&self.canvas_display_lists, &destroyed_canvas_ids);
        forget_canvas_diagnostics(&self.canvas_diagnostic_members, &destroyed_canvas_ids);
        notify_web();
        Ok(web_number_array(destroyed))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = applyCanvasCommands)]
    pub fn apply_canvas_commands(
        &self,
        id: f64,
        ops: js_sys::Uint32Array,
        operands: js_sys::Float64Array,
        strings: js_sys::Array,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.surface_canvas_preparation_diagnostics()?;
        let id = web_element_id(id)?;
        let tree = self.tree.lock().unwrap();
        validate_canvas_target(&tree, id)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error))?;
        let mut op_values = vec![0; ops.length() as usize];
        ops.copy_to(&mut op_values);
        let mut operand_values = vec![0.0; operands.length() as usize];
        operands.copy_to(&mut operand_values);
        let strings = strings
            .iter()
            .enumerate()
            .map(|(index, value)| {
                value.as_string().ok_or_else(|| {
                    wasm_bindgen::JsValue::from_str(&format!(
                        "<canvas> element {id}: side-table entry {index} is not a string"
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let decoded = crate::canvas::decode(
            &op_values,
            &operand_values,
            &strings,
            canvas_size(&tree, id),
        )
        .map_err(|error| {
            wasm_bindgen::JsValue::from_str(&format!("<canvas> element {id}: {error}"))
        })?;
        let strict = self.strict_styles.load(Ordering::Relaxed);
        if strict && !decoded.diagnostics.is_empty() {
            let message = first_canvas_diagnostic_message(&tree, id, &decoded.diagnostics)
                .expect("non-empty canvas diagnostics has a first item");
            return Err(wasm_bindgen::JsValue::from_str(&message));
        }
        let outcome =
            crate::canvas::install_decoded_display_list(&self.canvas_display_lists, id, decoded);
        if !strict {
            for diagnostic in
                fresh_canvas_diagnostics(id, outcome.diagnostics, &self.canvas_diagnostic_members)
            {
                let message = style_diagnostic_context(&diagnostic, &tree).0;
                web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&message));
            }
        }
        drop(tree);
        if outcome.invalidates {
            notify_web();
        }
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = isInitialized)]
    pub fn is_initialized(&self) -> bool {
        WEB_APP.with(|app| app.borrow().is_some())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = capabilities)]
    pub fn capabilities(&self) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        web_renderer_capabilities()
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

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getWindowInsets)]
    pub fn get_window_insets(&self) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let insets = update_web_window(|window, _cx| window.insets())?;
        window_insets_js(insets)
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setWindowTitle)]
    pub fn set_window_title(&self, title: String) -> Result<(), wasm_bindgen::JsValue> {
        update_web_view(move |view, _window, cx| {
            view.window_title = title;
            cx.notify();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = focusElement)]
    pub fn focus_element(
        &self,
        element_id: f64,
        prevent_scroll: Option<bool>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let reveal = !prevent_scroll.unwrap_or(false);
        update_web_view(move |view, window, cx| {
            view.focus_element(id, reveal, window, cx);
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = focusNext)]
    pub fn focus_next(&self) -> Result<(), wasm_bindgen::JsValue> {
        update_web_view(|view, window, cx| view.move_focus(FocusDirection::Next, window, cx))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = focusPrevious)]
    pub fn focus_previous(&self) -> Result<(), wasm_bindgen::JsValue> {
        update_web_view(|view, window, cx| view.move_focus(FocusDirection::Previous, window, cx))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = resolveTabKeyDown)]
    pub fn resolve_tab_key_down(
        &self,
        default_prevented: bool,
    ) -> Result<(), wasm_bindgen::JsValue> {
        update_web_view(move |view, window, cx| {
            view.resolve_tab_key_down(default_prevented, window, cx);
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getActiveElement)]
    pub fn get_active_element(&self) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let active = update_web_view(|view, window, _cx| view.active_element_id(window))?;
        Ok(active.map_or(wasm_bindgen::JsValue::NULL, |id| {
            wasm_bindgen::JsValue::from_f64(id as f64)
        }))
    }

    pub fn blur(&self) -> Result<(), wasm_bindgen::JsValue> {
        update_web_window(|window, _cx| window.blur())
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

    // ── Text editing API ─────────────────────────────────────────────

    /// One editor's API value, or null for any element that does not edit text.
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getInputValue)]
    pub fn get_input_value(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        draw_web_window_for_read()?;
        let state = update_web_view(move |view, _window, cx| {
            view.custom_registry.text_editing_state(id, cx)
        })?;
        Ok(state.map_or(wasm_bindgen::JsValue::NULL, |state| {
            wasm_bindgen::JsValue::from_str(&state.value)
        }))
    }

    /// `[selectionStart, selectionEnd, backward]` in UTF-16 code units, or null.
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getInputSelection)]
    pub fn get_input_selection(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        draw_web_window_for_read()?;
        let state = update_web_view(move |view, _window, cx| {
            view.custom_registry.text_editing_state(id, cx)
        })?;
        Ok(state.map_or(wasm_bindgen::JsValue::NULL, |state| {
            web_number_array([
                state.selection_start as f64,
                state.selection_end as f64,
                if state.selection_backward { 1.0 } else { 0.0 },
            ])
        }))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setInputValue)]
    pub fn set_input_value(
        &self,
        element_id: f64,
        value: String,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        draw_web_window_for_read()?;
        update_web_view(move |view, _window, cx| {
            view.custom_registry.set_text_value(id, value, cx);
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setInputSelection)]
    pub fn set_input_selection(
        &self,
        element_id: f64,
        start: f64,
        end: f64,
        backward: bool,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let start = to_selection_offset(start);
        let end = to_selection_offset(end);
        draw_web_window_for_read()?;
        update_web_view(move |view, _window, cx| {
            view.custom_registry
                .set_text_selection(id, start, end, backward, cx);
        })
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
    pub fn scroll_to_item(
        &self,
        element_id: f64,
        index: f64,
        offset_in_item: Option<f64>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let index = index as usize;
        let offset = offset_in_item.unwrap_or(0.0) as f32;
        if !VIRTUAL_LIST_STATES.with(|states| {
            if !states.borrow().contains_key(&id) {
                return false;
            }
            queue_virtual_list_scroll(id, index, offset);
            true
        }) {
            let tree = self.tree.lock().unwrap();
            SCROLL_HANDLES.with(|handles| {
                if let Some(handle) = handles.borrow().get(&id) {
                    scroll_handle_to_child(handle, &tree, id, index);
                }
            });
        }
        notify_web();
        Ok(())
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getListScrollTop)]
    pub fn get_list_scroll_top(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let top = VIRTUAL_LIST_STATES.with(|states| {
            states.borrow().get(&id).map(|state| {
                let top = state.logical_scroll_top();
                [
                    top.item_ix as f64,
                    f64::from(f32::from(top.offset_in_item)),
                    f64::from(f32::from(state.viewport_bounds().size.height)),
                ]
            })
        });
        let Some(top) = top else {
            return Ok(wasm_bindgen::JsValue::NULL);
        };
        Ok(web_number_array(top))
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

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getScrollMetrics)]
    pub fn get_scroll_metrics(
        &self,
        element_id: f64,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let metrics = VIRTUAL_LIST_STATES
            .with(|states| states.borrow().get(&id).map(virtual_list_metrics))
            .or_else(|| {
                SCROLL_HANDLES.with(|handles| handles.borrow().get(&id).map(scroll_handle_metrics))
            });
        let Some(metrics) = metrics else {
            return Ok(wasm_bindgen::JsValue::NULL);
        };
        Ok(web_number_array(metrics))
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = scrollElementIntoView)]
    pub fn scroll_element_into_view(
        &self,
        element_id: f64,
        align_to_top: Option<bool>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let id = web_element_id(element_id)?;
        let align_to_top = align_to_top.unwrap_or(true);
        update_web_view(move |view, _window, cx| {
            view.scroll_element_into_view(id, align_to_top, cx);
        })
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

    /// The same array of objects the napi build returns.
    ///
    /// Through `serde_json` and `JSON.parse`, not `serde-wasm-bindgen`: this is
    /// a test-only API, and both crates here are already dependencies. Building
    /// the nested value by hand with `js_sys` is 20 lines of noise.
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getPaintedHighlights)]
    pub fn get_painted_highlights(&self) -> wasm_bindgen::JsValue {
        let matches: Vec<crate::element_tree::HighlightMatch> = crate::text::painted_highlights()
            .into_iter()
            .map(Into::into)
            .collect();
        serde_json::to_string(&matches)
            .ok()
            .and_then(|json| js_sys::JSON::parse(&json).ok())
            .unwrap_or(wasm_bindgen::JsValue::NULL)
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateClick)]
    pub fn simulate_click(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let modifiers = parse_web_modifiers(modifiers.as_deref())?;
        let click_count = parse_web_click_count(click_count)?;
        update_web_window(move |window, cx| {
            crate::automation::dispatch_click(
                window,
                cx,
                x,
                y,
                button.unwrap_or(0),
                modifiers,
                click_count,
            );
            window.refresh();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseDown)]
    pub fn simulate_mouse_down(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let modifiers = parse_web_modifiers(modifiers.as_deref())?;
        let click_count = parse_web_click_count(click_count)?;
        update_web_window(move |window, cx| {
            crate::automation::dispatch_mouse_down(
                window,
                cx,
                x,
                y,
                button.unwrap_or(0),
                modifiers,
                click_count,
            );
            window.refresh();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseUp)]
    pub fn simulate_mouse_up(
        &self,
        x: f64,
        y: f64,
        button: Option<u32>,
        modifiers: Option<String>,
        click_count: Option<u32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let modifiers = parse_web_modifiers(modifiers.as_deref())?;
        let click_count = parse_web_click_count(click_count)?;
        update_web_window(move |window, cx| {
            crate::automation::dispatch_mouse_up(
                window,
                cx,
                x,
                y,
                button.unwrap_or(0),
                modifiers,
                click_count,
            );
            window.refresh();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateMouseMove)]
    pub fn simulate_mouse_move(
        &self,
        x: f64,
        y: f64,
        pressed_button: Option<u32>,
        modifiers: Option<String>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let modifiers = parse_web_modifiers(modifiers.as_deref())?;
        update_web_window(move |window, cx| {
            crate::automation::dispatch_mouse_move(window, cx, x, y, pressed_button, modifiers);
            window.refresh();
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = simulateScrollWheel)]
    pub fn simulate_scroll_wheel(
        &self,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        modifiers: Option<String>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        let modifiers = parse_web_modifiers(modifiers.as_deref())?;
        update_web_window(move |window, cx| {
            let options = crate::automation::ScrollWheelOptions {
                phase: None,
                momentum_phase: None,
                delta_unit: None,
                modifiers: Some(crate::automation::ScrollWheelModifiers {
                    shift: Some(modifiers.shift),
                    ctrl: Some(modifiers.control),
                    alt: Some(modifiers.alt),
                    cmd: Some(modifiers.platform),
                    function: Some(modifiers.function),
                }),
            };
            crate::automation::dispatch_scroll_wheel(
                window,
                cx,
                x,
                y,
                delta_x,
                delta_y,
                Some(options),
            )
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error))?;
            window.refresh();
            Ok(())
        })?
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockPause)]
    pub fn clock_pause(&self) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_view(|view, _window, cx| {
            let now_ms = view.clock.pause();
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockSet)]
    pub fn clock_set(&self, now_ms: f64) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_view(move |view, _window, cx| {
            let now_ms = view.clock.set_ms(now_ms);
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockFastForward)]
    pub fn clock_fast_forward(&self, delta_ms: f64) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_view(move |view, _window, cx| {
            let now_ms = view.clock.fast_forward_ms(delta_ms);
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = clockResume)]
    pub fn clock_resume(&self) -> Result<f64, wasm_bindgen::JsValue> {
        update_web_view(|view, _window, cx| {
            let now_ms = view.clock.resume();
            cx.notify();
            now_ms
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = setDebugFrameOverlay)]
    pub fn set_debug_frame_overlay(&self, mode: String) -> Result<String, wasm_bindgen::JsValue> {
        let mode = parse_debug_frame_overlay_mode_str(&mode)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error))?;
        // Graphics init is async. render() sets the overlay before WEB_WINDOW exists.
        if WEB_WINDOW.with(|window| window.borrow().is_none()) {
            PENDING_DEBUG_OVERLAY.with(|pending| *pending.borrow_mut() = Some(mode));
            return Ok(debug_frame_overlay_mode_name(mode).to_string());
        }
        update_web_view(move |_view, window, cx| {
            window.set_debug_frame_overlay_mode(mode);
            cx.notify();
            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
        })
    }

    #[wasm_bindgen::prelude::wasm_bindgen(js_name = getDebugFrameOverlay)]
    pub fn get_debug_frame_overlay(&self) -> Result<String, wasm_bindgen::JsValue> {
        if WEB_WINDOW.with(|window| window.borrow().is_none()) {
            let pending = PENDING_DEBUG_OVERLAY.with(|pending| *pending.borrow());
            return Ok(debug_frame_overlay_mode_name(
                pending.unwrap_or(gpui::DebugFrameOverlayMode::Hidden),
            )
            .to_string());
        }
        update_web_view(|_view, window, _cx| {
            debug_frame_overlay_mode_name(window.debug_frame_overlay_mode()).to_string()
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
    pub(crate) canvas_display_lists: SharedDisplayLists,
    pub(crate) canvas_image_store: crate::custom_elements::img::SharedCanvasImageStore,
    pub(crate) event_callback: Option<EventCallback>,
    window_event_callback: WindowEventCallback,
    window_bounds_subscription: Option<gpui::Subscription>,
    pub(crate) window_title: String,
    /// Non-tab-stop focus target that keeps root actions reachable when no
    /// retained element is focused.
    root_focus_handle: gpui::FocusHandle,
    focus_lost_subscription: Option<gpui::Subscription>,
    /// Persistent FocusHandles keyed by element ID.
    /// Created lazily for elements with keyboard or focus/blur listeners.
    /// Handles persist across renders so GPUI maintains focus state.
    pub(crate) focus_handles: HashMap<u64, gpui::FocusHandle>,
    /// Tab defaults wait for the matching React keydown dispatch. Serializing
    /// them keeps each queued keypress targeted at the focus left by the one
    /// before it, just like a browser event loop.
    pending_tab_key_down: Option<FocusDirection>,
    queued_tab_key_downs: VecDeque<FocusDirection>,
    /// Active focus/blur subscriptions keyed by element and event type.
    pub(crate) focus_subscriptions: HashMap<(u64, String), gpui::Subscription>,
    /// Registry for custom element types (input, editor, diff, etc.).
    /// Stores factories (one per type) and live instances (one per element ID).
    pub(crate) custom_registry: CustomElementRegistry,
    /// Persistent ScrollHandles keyed by element ID.
    /// Created lazily for elements with overflow: "scroll" (or per-axis scroll).
    /// Handles persist across renders so GPUI maintains scroll offset state.
    pub(crate) scroll_handles: HashMap<u64, gpui::ScrollHandle>,
    /// Last painted offsets for scrollable elements with `onScroll`.
    /// Paint is the first point after GPUI has clamped and applied a wheel or
    /// programmatic position change, so comparing here reports position changes.
    scroll_event_offsets: Arc<Mutex<HashMap<u64, gpui::Point<gpui::Pixels>>>>,
    /// Minimal-scroll anchors for focusable elements and nested scrollers.
    /// Each anchor targets the nearest ordinary overflow ancestor; virtual
    /// lists use their item-aware `ListState` path instead.
    focus_scroll_anchors: HashMap<u64, FocusScrollAnchor>,
    /// Native animation clocks keyed by retained element ID.
    pub(crate) motion_states: HashMap<u64, crate::motion::MotionState>,
    /// Hit-test state reported by GPUI's interactive-element callbacks.
    ///
    /// Test-only resolved-style reads use this instead of reconstructing hover
    /// from automation bounds, which cannot account for occlusion or capture.
    pub(crate) interactive_style_states: HashMap<u64, InteractiveStyleState>,
    /// The painted element currently winning hover hit testing. Native records
    /// it once per mouse event; the React bridge expands its ancestry into DOM
    /// mouseenter/mouseleave transitions.
    hover_target: Option<u64>,
    reported_hover_target: Option<u64>,
    hover_target_dispatch_pending: bool,
    /// CSS-like style transition tracks keyed by retained element ID.
    pub(crate) transition_states: HashMap<u64, crate::motion::StyleTransitionState>,
    /// Frame requests emitted while at least one style transition is active.
    /// Kept separately from imperative motion so offscreen tests can prove a
    /// snapping element never enters the transition frame loop.
    pub(crate) style_transition_frame_requests: u32,
    /// Live text selection, shared with the paint closures and the napi methods.
    pub(crate) selection: SharedSelection,
    pub(crate) image_network_policy: crate::custom_elements::img::ImageNetworkPolicy,
    /// Retained owner and pressed-button lifetime for mouse pointer capture.
    pointer_router: crate::pointer::SharedPointerRouter,
    /// Cancels the pressed-pointer sequence when the platform deactivates this window.
    window_activation_subscription: Option<gpui::Subscription>,
    /// Persistent measurement and scroll state for React-backed virtual lists.
    virtual_lists: HashMap<u64, VirtualListEntry>,
    /// Latest pointer sample and list during selection edge scrolling.
    selection_drag_position: Option<gpui::Point<gpui::Pixels>>,
    selection_scroll_list: Option<u64>,
    selection_scroll_task: Option<gpui::Task<()>>,
    /// Motion / review clock. Live wall time unless automation freezes it.
    pub(crate) clock: crate::automation::AutomationClock,
    /// Resolved `highlight` state, keyed by the element that declared it.
    /// Empty in every app that does not use search.
    highlights: HashMap<u64, HighlightCacheEntry>,
    /// AccessKit node hashes resolved back to retained host ids for the native
    /// test snapshot. The accessibility snapshot remains the semantic source;
    /// this map contributes identity only.
    pub(crate) accessibility_host_ids: Option<HashMap<u64, u64>>,
}

/// The interaction state GPUI has actually delivered for one retained element.
///
/// These values are written only by GPUI callbacks, whose `Hitbox::is_hovered`
/// checks use the same hit-test result as style painting.
#[derive(Clone, Copy, Default)]
pub(crate) struct InteractiveStyleState {
    pub hovered: bool,
    pub active: bool,
}

#[derive(Clone, Copy)]
struct VirtualFocusBounds {
    /// Window-space top with the list's scroll translation removed.
    content_top: gpui::Pixels,
    height: gpui::Pixels,
}

enum FocusScrollAnchor {
    Overflow {
        scroller_id: u64,
        anchor: gpui::ScrollAnchor,
    },
    VirtualList {
        list_id: u64,
        bounds: Arc<Mutex<Option<VirtualFocusBounds>>>,
        /// List offset before a row-only reveal mounts an unpainted target.
        pending_reveal_origin: Arc<Mutex<Option<gpui::Pixels>>>,
    },
}

impl FocusScrollAnchor {
    fn overflow_anchor(&self) -> Option<&gpui::ScrollAnchor> {
        match self {
            Self::Overflow { anchor, .. } => Some(anchor),
            Self::VirtualList { .. } => None,
        }
    }
}

impl InteractiveStyleState {
    pub(crate) fn set_hovered(&mut self, hovered: bool) -> bool {
        if self.hovered == hovered {
            return false;
        }
        self.hovered = hovered;
        true
    }

    fn set_active(&mut self, active: bool) -> bool {
        if self.active == active {
            return false;
        }
        self.active = active;
        true
    }
}

/// Two-level cache for one element's `highlight`.
///
/// The group list is keyed by `search_revision`, which a query change does NOT
/// move, so typing in a find bar never re-walks or re-folds text. The matches
/// are additionally keyed by the matcher hash, which excludes `activeIndex` and
/// the colours, so moving the find cursor only re-colours what it already found.
///
/// Do not key the group list on `subtree_revision`: `highlight` is a custom
/// prop, so every keystroke moves that revision and the cache would do nothing.
/// `highlight_cache_tests` at the bottom of this file compares `Arc` identity
/// and fails if either level regresses. A timing budget does not catch it: on
/// the 1000-turn chat the broken version is 2.7ms against 1.9ms.
struct HighlightCacheEntry {
    revision: u64,
    groups: Arc<crate::text::GroupList>,
    matcher_hash: u64,
    /// The spec plus the located matches. Ordinals and colours are decided at
    /// paint, so a colour or `activeIndex` change reuses this whole value.
    context: Arc<crate::text::HighlightContext>,
    /// Last identity delivered through `onHighlight`. Only written once an
    /// event is really queued, so adding the listener later still reports.
    reported: Option<u64>,
}

fn emit_highlight_events(callback: &Option<EventCallback>, events: &[(u64, usize)]) {
    for &(id, total) in events {
        emit_event_full(callback, id, "highlight", |payload| {
            payload.match_count = Some(total as f64);
        });
    }
}

/// Resolve one element's `highlight` prop, reusing both cache levels.
///
/// Returns the context, plus the match count when `has_listener` and the result
/// differs from the last one this element reported. Identity, not count:
/// swapping a query for a different one with the same number of hits is still a
/// new result.
fn resolve_highlight(
    cache: &mut HashMap<u64, HighlightCacheEntry>,
    tree: &RetainedTree,
    id: u64,
    value: &serde_json::Value,
    theme: &Theme,
    has_listener: bool,
) -> Option<(Arc<crate::text::HighlightContext>, Option<usize>)> {
    let set = crate::text::HighlightSet::parse(value, theme)?;
    // `search_revision`, NOT `subtree_revision`: `highlight` is a custom prop,
    // so the general revision moves on every keystroke and this cache would
    // never hit for the one case it exists for.
    let revision = tree.elements.get(&id)?.search_revision;
    let matcher_hash = set.matcher_hash();

    let cached = cache
        .get(&id)
        .filter(|entry| entry.revision == revision && entry.matcher_hash == matcher_hash);
    let context = match cached {
        // Nothing moved at all. Returning the same `Arc` keeps the whole
        // subtree's inherited value identical, which the cache tests assert.
        Some(entry) if entry.context.set == set => entry.context.clone(),
        // Same matches, different colours or find cursor: reuse the located
        // matches and swap only the spec. No text is scanned.
        Some(entry) => {
            let context = Arc::new(crate::text::HighlightContext {
                declaration: id,
                set,
                matches: entry.context.matches.clone(),
            });
            cache.get_mut(&id)?.context = context.clone();
            context
        }
        None => {
            let groups = match cache.get(&id) {
                Some(entry) if entry.revision == revision => entry.groups.clone(),
                _ => Arc::new(crate::text::GroupList::collect(tree, id)),
            };
            let context = Arc::new(crate::text::HighlightContext {
                declaration: id,
                matches: Arc::new(crate::text::search::resolve(&groups, &set)),
                set,
            });
            let reported = cache.get(&id).and_then(|entry| entry.reported);
            cache.insert(
                id,
                HighlightCacheEntry {
                    revision,
                    groups,
                    matcher_hash,
                    context: context.clone(),
                    reported,
                },
            );
            context
        }
    };

    if !has_listener {
        return Some((context, None));
    }
    let identity = context.matches.identity();
    let entry = cache.get_mut(&id)?;
    if entry.reported == Some(identity) {
        return Some((context, None));
    }
    entry.reported = Some(identity);
    let total = context.matches.total;
    Some((context, Some(total)))
}

impl GpuixView {
    pub(crate) fn new(
        tree: Arc<Mutex<RetainedTree>>,
        canvas_display_lists: SharedDisplayLists,
        event_callback: Option<EventCallback>,
        window_event_callback: WindowEventCallback,
        window_title: String,
        selection: SharedSelection,
        image_network_policy: crate::custom_elements::img::ImageNetworkPolicy,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        Self {
            tree,
            canvas_display_lists,
            canvas_image_store: Default::default(),
            event_callback,
            window_event_callback,
            window_bounds_subscription: None,
            window_title,
            root_focus_handle: cx.focus_handle().tab_stop(false),
            focus_lost_subscription: None,
            focus_handles: HashMap::new(),
            pending_tab_key_down: None,
            queued_tab_key_downs: VecDeque::new(),
            focus_subscriptions: HashMap::new(),
            custom_registry: CustomElementRegistry::with_defaults(),
            scroll_handles: HashMap::new(),
            scroll_event_offsets: Arc::new(Mutex::new(HashMap::new())),
            focus_scroll_anchors: HashMap::new(),
            motion_states: HashMap::new(),
            interactive_style_states: HashMap::new(),
            hover_target: None,
            reported_hover_target: None,
            hover_target_dispatch_pending: false,
            transition_states: HashMap::new(),
            style_transition_frame_requests: 0,
            selection,
            image_network_policy,
            pointer_router: Default::default(),
            window_activation_subscription: None,
            virtual_lists: HashMap::new(),
            selection_drag_position: None,
            selection_scroll_list: None,
            selection_scroll_task: None,
            clock: crate::automation::AutomationClock::new(),
            highlights: HashMap::new(),
            accessibility_host_ids: None,
        }
    }

    pub(crate) fn update_hover_target(
        &mut self,
        id: u64,
        is_hovered: bool,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if is_hovered {
            let keep_more_specific_target = self.hover_target.is_some_and(|target| {
                is_hover_target_descendant(&self.tree.lock().unwrap(), target, id)
            });
            if !keep_more_specific_target {
                self.hover_target = Some(id);
            }
        } else if self.hover_target == Some(id) {
            self.hover_target = None;
        }

        if self.hover_target_dispatch_pending {
            return;
        }
        self.hover_target_dispatch_pending = true;
        cx.defer_in(window, |view, _window, _cx| {
            view.hover_target_dispatch_pending = false;
            view.dispatch_hover_target_change();
        });
    }

    /// Publish the target implied by a GPUI mouse-move callback before the
    /// move itself. GPUI defers `on_hover` until paint, while the DOM delivers
    /// the entered ancestry before the first `mousemove`. `on_mouse_move`
    /// runs only for the winning hovered or captured hitbox, so its host id is
    /// safe to use here; the later GPUI hover callback reconciles to the same
    /// target and becomes a no-op.
    pub(crate) fn update_hover_target_before_mouse_move(&mut self, id: u64) {
        self.hover_target = Some(id);
        self.dispatch_hover_target_change();
    }

    fn dispatch_hover_target_change(&mut self) {
        if self.hover_target == self.reported_hover_target {
            return;
        }

        let event_id = self.hover_target.or(self.reported_hover_target);
        self.reported_hover_target = self.hover_target;
        if let Some(event_id) = event_id {
            emit_event_full(&self.event_callback, event_id, "hoverTarget", |payload| {
                payload.hovered = Some(self.hover_target.is_some());
            });
        }
    }

    pub(crate) fn set_pointer_capture(
        &mut self,
        id: u64,
        window: &mut gpui::Window,
    ) -> std::result::Result<(), String> {
        if !self.tree.lock().unwrap().elements.contains_key(&id) {
            return Err(format!("Cannot capture pointer for missing element {id}"));
        }
        if !self.pointer_router.borrow_mut().capture(id) {
            return Err("Cannot capture pointer without an active mouse-down sequence".into());
        }

        // Upstream host surfaces use the retained integer id. Fork-native
        // surfaces such as <canvas> predate that identity scheme and still use
        // the original namespaced string; accept both during reconciliation.
        let captured = window.capture_pointer_for_element(&gpui::ElementId::Integer(id))
            || window.capture_pointer_for_element(&gpui::ElementId::from(format!("__gpuix_{id}")));
        if !captured {
            self.pointer_router.borrow_mut().release(id);
            return Err(format!(
                "Cannot capture pointer for element {id} before it has painted a hitbox"
            ));
        }
        Ok(())
    }

    pub(crate) fn release_pointer_capture(&mut self, id: u64, window: &mut gpui::Window) {
        if self.pointer_router.borrow_mut().release(id) {
            window.release_pointer();
        }
    }

    fn cancel_pointer_sequence(&mut self, window: &mut gpui::Window) -> bool {
        if self.pointer_router.borrow_mut().cancel() {
            window.release_pointer();
        }
        let interactive_changed = self
            .interactive_style_states
            .values_mut()
            .fold(false, |changed, state| state.set_active(false) || changed);
        let transition_changed = self
            .transition_states
            .values_mut()
            .fold(false, |changed, state| state.set_active(false) || changed);
        interactive_changed || transition_changed
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
            let height = self
                .virtual_lists
                .get(&list_id)
                .and_then(|entry| entry.config.estimated_item_height)
                .unwrap_or(1.0);
            return unmounted_virtual_row(height);
        }

        let callback = self.event_callback.clone();
        let now = self.clock.now();
        let mut animation_active = false;
        let mut style_transition_active = false;
        let reduce_motion = cx.reduce_motion();
        let mut highlight_events = Vec::new();

        // Re-resolve against the tree as it is NOW. gpui calls this during
        // layout and prepaint, after the root render returned, and on Windows
        // and Linux the Node thread can commit new text in between. Reusing the
        // captured ranges would paint a wash over the wrong glyphs, or at a byte
        // offset that is no longer a character boundary.
        let mut inherited = inherited;
        if let Some(declaration) = inherited.highlight.as_ref().map(|ctx| ctx.declaration) {
            inherited.highlight = tree
                .elements
                .get(&declaration)
                .and_then(|element| element.custom_props.get("highlight"))
                .and_then(|value| {
                    resolve_highlight(
                        &mut self.highlights,
                        &tree,
                        declaration,
                        value,
                        &Theme::dark(),
                        false,
                    )
                })
                .map(|(context, _)| context);
        }

        let accessibility_host_ids = self.accessibility_host_ids.as_mut();
        let gpui_element_path = accessibility_host_ids.as_ref().map(|_| {
            vec![
                gpui::ElementId::View(window.current_view()),
                gpui::ElementId::Name(
                    format!("__gpuix_virtual_row_{}_{}", list_id, expected_child_id).into(),
                ),
            ]
        });
        let mut build_ctx = BuildCtx {
            tree: &tree,
            canvas_display_lists: &self.canvas_display_lists,
            canvas_image_store: &self.canvas_image_store,
            event_callback: &callback,
            focus_handles: &self.focus_handles,
            focus_scroll_anchors: &self.focus_scroll_anchors,
            scroll_handles: &mut self.scroll_handles,
            scroll_event_offsets: &self.scroll_event_offsets,
            custom_registry: &mut self.custom_registry,
            virtual_lists: &mut self.virtual_lists,
            motion_states: &mut self.motion_states,
            transition_states: &mut self.transition_states,
            interactive_style_states: &self.interactive_style_states,
            now,
            animation_active: &mut animation_active,
            style_transition_active: &mut style_transition_active,
            reduce_motion,
            selection: self.selection.clone(),
            image_network_policy: &self.image_network_policy,
            inherited,
            highlights: &mut self.highlights,
            highlight_events: &mut highlight_events,
            accessibility_host_ids,
            gpui_element_path,
            measuring: false,
            intrinsic_probe: None,
        };
        let child = build_element(expected_child_id, &mut build_ctx, window, cx);
        emit_highlight_events(&callback, &highlight_events);
        if style_transition_active {
            self.style_transition_frame_requests =
                self.style_transition_frame_requests.saturating_add(1);
        }
        if animation_active {
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

    pub(crate) fn scroll_virtual_list_to_item(
        &self,
        id: u64,
        index: usize,
        offset_in_item: f32,
    ) -> bool {
        if !self.virtual_lists.contains_key(&id) {
            return false;
        }
        queue_virtual_list_scroll(id, index, offset_in_item);
        emit_event_full(&self.event_callback, id, "visibleRange", |payload| {
            payload.start_index = Some(index as f64);
            payload.end_index = Some((index + 1) as f64);
        });
        true
    }

    /// Reveal the `index`th retained child of an overflow scroller.
    pub(crate) fn scroll_handle_to_child(&self, scroller_id: u64, index: usize) {
        let Some(handle) = self.scroll_handles.get(&scroller_id) else {
            return;
        };
        let tree = self.tree.clone();
        let tree = tree.lock().unwrap();
        scroll_handle_to_child(handle, &tree, scroller_id, index);
    }

    /// The list's logical scroll anchor as
    /// `[item_ix, offset_in_item_px, viewport_height_px]`.
    ///
    /// `item_ix == item count` is gpui's at-end sentinel (a bottom-aligned
    /// list resting at its very end); the viewport height is what lets a
    /// caller convert that into a position relative to the trailing rows.
    pub(crate) fn virtual_list_scroll_top(&self, id: u64) -> Option<[f64; 3]> {
        let state = &self.virtual_lists.get(&id)?.state;
        let top = state.logical_scroll_top();
        Some([
            top.item_ix as f64,
            f64::from(f32::from(top.offset_in_item)),
            f64::from(f32::from(state.viewport_bounds().size.height)),
        ])
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

    /// Web-shaped scroll geometry for a scrollable element, or `None` when the
    /// element is not a scroll container. See [`scroll_handle_metrics`].
    pub(crate) fn scroll_metrics(&self, id: u64) -> Option<[f64; 6]> {
        if let Some(entry) = self.virtual_lists.get(&id) {
            return Some(virtual_list_metrics(&entry.state));
        }
        self.scroll_handles.get(&id).map(scroll_handle_metrics)
    }

    /// Reveal one element inside every scrollable ancestor, as
    /// `Element.scrollIntoView()` does, without moving focus. `align_to_top` is
    /// the DOM's `block: "start"` (its default); `false` is `block: "nearest"`,
    /// the alignment programmatic focus reveals with.
    pub(crate) fn scroll_element_into_view(
        &mut self,
        id: u64,
        align_to_top: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let alignment = if align_to_top {
            RevealAlignment::Start
        } else {
            RevealAlignment::Nearest
        };
        self.reveal_element(id, alignment, cx);
    }

    pub(crate) fn active_element_id(&self, window: &gpui::Window) -> Option<u64> {
        self.focus_handles
            .iter()
            .find_map(|(id, handle)| handle.is_focused(window).then_some(*id))
    }

    /// Move focus to `id`, revealing it inside its scroll ancestors unless the
    /// caller passed `HTMLElement.focus({ preventScroll: true })`.
    pub(crate) fn focus_element(
        &mut self,
        id: u64,
        reveal: bool,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(handle) = self.focus_handles.get(&id) {
            handle.focus(window, cx);
            if reveal {
                self.scroll_focused_element_into_view(id, cx);
            }
        }
        cx.notify();
    }
}

/// Everything `build_element` threads through the tree.
///
/// Split into a struct because the recursion needs eight-plus shared references
/// and adding one more to every call site is how this file rots. `window` and
/// `cx` stay separate parameters: they are `&mut` and gpui reborrows them.
pub(crate) struct BuildCtx<'a> {
    pub tree: &'a RetainedTree,
    pub canvas_display_lists: &'a SharedDisplayLists,
    pub canvas_image_store: &'a crate::custom_elements::img::SharedCanvasImageStore,
    pub event_callback: &'a Option<EventCallback>,
    pub focus_handles: &'a HashMap<u64, gpui::FocusHandle>,
    focus_scroll_anchors: &'a HashMap<u64, FocusScrollAnchor>,
    pub scroll_handles: &'a mut HashMap<u64, gpui::ScrollHandle>,
    scroll_event_offsets: &'a Arc<Mutex<HashMap<u64, gpui::Point<gpui::Pixels>>>>,
    pub custom_registry: &'a mut CustomElementRegistry,
    virtual_lists: &'a mut HashMap<u64, VirtualListEntry>,
    pub motion_states: &'a mut HashMap<u64, crate::motion::MotionState>,
    pub transition_states: &'a mut HashMap<u64, crate::motion::StyleTransitionState>,
    pub interactive_style_states: &'a HashMap<u64, InteractiveStyleState>,
    pub now: web_time::Instant,
    pub animation_active: &'a mut bool,
    pub style_transition_active: &'a mut bool,
    pub reduce_motion: bool,
    pub selection: SharedSelection,
    pub image_network_policy: &'a crate::custom_elements::img::ImageNetworkPolicy,
    /// Inherited text state, resolved the way CSS inherits it. The renderer's
    /// own theme only seeds the root selection wash; custom elements resolve
    /// their own theme from their `theme` prop.
    pub inherited: Inherited,
    /// Persistent `highlight` caches, keyed by the declaring element.
    highlights: &'a mut HashMap<u64, HighlightCacheEntry>,
    /// `onHighlight` payloads queued during the build.
    ///
    /// Never emitted inline: a handler that calls `setState` repaints, which
    /// would re-enter the build and emit again. They are flushed once the root
    /// build has returned.
    highlight_events: &'a mut Vec<(u64, usize)>,
    accessibility_host_ids: Option<&'a mut HashMap<u64, u64>>,
    gpui_element_path: Option<Vec<gpui::ElementId>>,
    /// Set while an `interpolateSize: "allow-keywords"` endpoint is being laid
    /// out. The subtree built under it is measured and dropped, never painted,
    /// so this build must not advance any retained track or register anything
    /// the real build is about to register itself.
    measuring: bool,
    /// The element whose intrinsic size is being measured, with the style to
    /// measure it at: the transition's target with the intrinsic axes forced
    /// back to `auto`.
    intrinsic_probe: Option<(u64, StyleDesc)>,
}

/// Style properties that cascade into descendants.
///
/// Not `Copy`: `highlight` holds an `Arc`. Every call site must clone
/// explicitly, including the deferred `build_virtual_child` callback, which gpui
/// may run more than once per frame.
#[derive(Clone)]
pub(crate) struct Inherited {
    /// False once an ancestor sets `userSelect: "none"`.
    pub selectable: bool,
    /// True for an `ariaHidden` element and every descendant. Semantics are
    /// omitted at build time so AccessKit never receives a partial hidden tree.
    pub accessibility_hidden: bool,
    /// True once this element or an ancestor has a role whose name comes from
    /// contents. Descendant text contributes to that name instead of emitting
    /// a separate `Label` node.
    pub text_accessibility_owned_by_role: bool,
    /// Selection wash colour for this subtree.
    pub selection_wash: gpui::Hsla,
    /// Text case transformation inherited by plain text descendants.
    pub text_transform: TextTransform,
    /// True once this element or an ancestor sets
    /// `interpolateSize: "allow-keywords"`. CSS inherits `interpolate-size`,
    /// so a lane can opt its whole subtree in from one declaration.
    pub interpolate_size_keywords: bool,
    /// Resolved CSS currentColor value for custom image elements.
    pub current_color: gpui::Rgba,
    /// Every marked ancestor that can activate descendant `hoverWithin`
    /// styles, in outer-to-inner order. CSS ancestor-hover selectors match any
    /// hovered ancestor; a nested marker does not shadow an outer one.
    hover_groups: Vec<InheritedHoverGroup>,
    /// The nearest ancestor's `highlight`, resolved. `None` in every app that
    /// does not use search. It carries the declaring element id, which is what
    /// a virtual-list row re-resolves against: that row is built after the root
    /// render returns, and on Windows and Linux the Node thread can edit text
    /// in between, so a stale range would paint over the wrong glyphs.
    pub highlight: Option<Arc<crate::text::HighlightContext>>,
    /// Font state is retained separately from GPUI's build-time text stack so
    /// `ch` sees the same inherited family, weight, and size as descendants.
    font: Option<InheritedFont>,
}

#[derive(Clone)]
struct InheritedHoverGroup {
    /// GPUI group name used for the paint-time refinement.
    name: gpui::SharedString,
    /// Retained ID used for the exact hit-test state reported by GPUI.
    id: u64,
}

#[derive(Clone)]
struct InheritedFont {
    font: gpui::Font,
    size: gpui::Pixels,
}

impl Inherited {
    fn root(theme: &Theme) -> Self {
        let mut wash = theme.accent;
        wash.a = 0.35;
        Self {
            selectable: true,
            accessibility_hidden: false,
            text_accessibility_owned_by_role: false,
            selection_wash: wash,
            text_transform: TextTransform::None,
            interpolate_size_keywords: false,
            current_color: gpui::rgba(0xe2e2e2ff),
            hover_groups: Vec::new(),
            highlight: None,
            font: None,
        }
    }

    fn font_for(&self, style: Option<&StyleDesc>, window: &gpui::Window) -> InheritedFont {
        let inherited = self.font.clone().unwrap_or_else(|| {
            let text_style = window.text_style();
            InheritedFont {
                font: text_style.font(),
                size: text_style.font_size.to_pixels(window.rem_size()),
            }
        });
        font_with_overrides(inherited, style)
    }

    /// Apply the inheritable parts of `style` for the subtree below it.
    fn descend(
        mut self,
        style: Option<&StyleDesc>,
        hover_group: Option<&str>,
        hover_group_id: u64,
        resolved_current_color: Option<gpui::Rgba>,
        font: InheritedFont,
    ) -> Self {
        if let Some(style) = style {
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
            self.interpolate_size_keywords =
                interpolate_size_keywords(Some(style), self.interpolate_size_keywords);
            if let Some(color) = style
                .color
                .as_deref()
                .and_then(crate::color::parse_color_rgba)
            {
                self.current_color = color;
            }
        }
        if let Some(hover_group) = hover_group {
            self.hover_groups.push(InheritedHoverGroup {
                name: gpui::SharedString::from(hover_group.to_owned()),
                id: hover_group_id,
            });
        }
        if let Some(color) = resolved_current_color {
            self.current_color = color;
        }
        self.font = Some(font);
        self
    }
}

/// Resolve `interpolate-size` the way CSS does: an own declaration wins for
/// this element and its subtree, otherwise the inherited value stands.
fn interpolate_size_keywords(style: Option<&StyleDesc>, inherited: bool) -> bool {
    match style.and_then(|style| style.interpolate_size.as_deref()) {
        Some("allow-keywords") => true,
        Some("numeric-only") => false,
        _ => inherited,
    }
}

fn font_with_overrides(mut font: InheritedFont, style: Option<&StyleDesc>) -> InheritedFont {
    if let Some(style) = style {
        if let Some(family) = &style.font_family {
            font.font.family = gpui::SharedString::from(family.clone());
        }
        if let Some(weight) = &style.font_weight {
            font.font.weight = parse_font_weight(weight);
        }
        if let Some(size) = style.font_size {
            font.size = gpui::px(size as f32);
        }
    }
    font
}

/// Resolve the inheritable colour from the same layered style that GPUI paints.
///
/// Custom SVGs rasterize `currentColor` during build, before GPUI applies its
/// `hover`, `group_hover`, and `active` paint refinements. Carrying this one
/// resolved value through `Inherited` keeps their raster source aligned with
/// the parent div's painted text colour.
fn resolved_current_color(
    style: Option<&StyleDesc>,
    focused: bool,
    keyboard_input: bool,
    hover_within: bool,
    hovered: bool,
    active: bool,
) -> Option<gpui::Rgba> {
    let style = style?;
    let mut color = style
        .color
        .as_deref()
        .and_then(crate::color::parse_color_rgba);
    let mut refine = |refinement: Option<&StyleDesc>| {
        if let Some(candidate) = refinement
            .and_then(|style| style.color.as_deref())
            .and_then(crate::color::parse_color_rgba)
        {
            color = Some(candidate);
        }
    };
    if focused {
        refine(style.focus.as_deref());
    }
    if focused && keyboard_input {
        refine(style.focus_visible.as_deref());
    }
    if hover_within {
        refine(style.hover_within.as_deref());
    }
    if hovered {
        refine(style.hover.as_deref());
    }
    if active {
        refine(style.active.as_deref());
    }
    color
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
        let item_count = estimated_item_height.and_then(|_| prop("itemCount").and_then(json_usize));
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

        // gpui anchors a list on a logical item, so splicing rows in at the
        // front keeps the rows already on screen and pushes the new ones above
        // the viewport. A browser anchors too, but suppresses it at scrollTop 0,
        // so a prepend is visible. Match the browser: remember a list pinned to
        // the top and put it back after the splice.
        //
        // While the content is shorter than the viewport gpui re-anchors to
        // item 0 every layout, so the drift only appears once the list
        // overflows. That is why `example-app` looked stuck at two rows.
        //
        // The guard is `is_following_tail()`, not `config.follow_tail`: a
        // following list that does not fill its viewport also ends layout
        // anchored at {0, 0}, and `scroll_to` would call `stop_following` on it.
        // Once the user scrolls up to the top, following is already stopped, so
        // a top-aligned `followTail` list still gets the browser behaviour.
        let top = self.state.logical_scroll_top();
        let was_pinned_to_top = matches!(config.alignment, gpui::ListAlignment::Top)
            && !self.state.is_following_tail()
            && top.item_ix == 0
            && top.offset_in_item <= gpui::px(0.0);

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
        self.remeasure_unknown_rows(window_start, &child_ids, &old_rows);
        if was_pinned_to_top {
            self.state.scroll_to(gpui::ListOffset::default());
        }

        self.window_start = window_start;
        self.child_ids = child_ids;
        self.child_revisions = child_revisions;
        self.row_focus_handles = row_focus_handles;
    }

    fn remeasure_unknown_rows(
        &mut self,
        window_start: usize,
        child_ids: &[u64],
        known: &HashMap<u64, (u64, Option<gpui::FocusHandle>)>,
    ) {
        let mut range_start = None;
        for (offset, id) in child_ids.iter().enumerate() {
            let logical = window_start + offset;
            let is_new = !known.contains_key(id);
            match (range_start, is_new) {
                (None, true) => range_start = Some(logical),
                (Some(start), false) => {
                    self.state.remeasure_items(start..logical);
                    range_start = None;
                }
                _ => {}
            }
        }
        if let Some(start) = range_start {
            self.state
                .remeasure_items(start..window_start + child_ids.len());
        }
    }
}

impl GpuixView {
    fn focus_next_action(
        &mut self,
        _: &FocusNext,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.enqueue_tab_key_down(FocusDirection::Next, window, cx);
    }

    fn focus_previous_action(
        &mut self,
        _: &FocusPrevious,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.enqueue_tab_key_down(FocusDirection::Previous, window, cx);
    }

    fn enqueue_tab_key_down(
        &mut self,
        direction: FocusDirection,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.queued_tab_key_downs.push_back(direction);
        self.dispatch_next_tab_key_down(window, cx);
    }

    fn dispatch_next_tab_key_down(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending_tab_key_down.is_some() {
            return;
        }
        let Some(direction) = self.queued_tab_key_downs.pop_front() else {
            return;
        };
        let target_id = self
            .active_element_id(window)
            .or_else(|| self.tree.lock().unwrap().root_id);
        let Some(target_id) = target_id else {
            self.move_focus(direction, window, cx);
            return;
        };
        if self.event_callback.is_none() {
            self.move_focus(direction, window, cx);
            return;
        }

        self.pending_tab_key_down = Some(direction);
        let shift = matches!(direction, FocusDirection::Previous);
        emit_event_full(&self.event_callback, target_id, "keyDown", |payload| {
            payload.key = Some("tab".to_string());
            payload.is_held = Some(false);
            payload.modifiers = Some(crate::element_tree::EventModifiers {
                shift,
                ..Default::default()
            });
        });
    }

    /// The DOM's body fallback: a key pressed with nothing focused still has a
    /// target — `document.body` there, the root element here — so a root
    /// listener hears it, which is how a global shortcut works before the user
    /// has focused anything. It is the same target the synthesized Tab key down
    /// already falls back to.
    ///
    /// GPUI delivers key events along the focus path, and `render` focuses the
    /// root wrapper whenever nothing else holds focus, so this listener is the
    /// no-focus case. Requiring the wrapper itself to be focused is what keeps
    /// delivery single: while a retained element (or a text editor's own handle)
    /// has focus, that element's handler is the one that fires, even though this
    /// wrapper is still an ancestor on the dispatch path.
    ///
    /// Tab never arrives here — its key binding dispatches `FocusNext` /
    /// `FocusPrevious`, and a bubbled action consumes the key event before GPUI
    /// reaches any key listener.
    fn dispatch_unfocused_key_event(
        &self,
        event_type: &str,
        keystroke: &gpui::Keystroke,
        is_held: Option<bool>,
        window: &gpui::Window,
    ) {
        if !self.root_focus_handle.is_focused(window) {
            return;
        }
        let tree = self.tree.lock().unwrap();
        let Some(root_id) = tree.root_id else {
            return;
        };
        // As on the focused path, a key event is only carried across to JS for
        // an element that listens for it.
        if !tree
            .elements
            .get(&root_id)
            .is_some_and(|element| element.events.contains(event_type))
        {
            return;
        }
        drop(tree);
        emit_event_full(&self.event_callback, root_id, event_type, |payload| {
            payload.key = Some(keystroke.key.clone());
            payload.key_char = keystroke.key_char.clone();
            payload.is_held = is_held;
            payload.modifiers = Some(keystroke.modifiers.into());
        });
    }

    pub(crate) fn resolve_tab_key_down(
        &mut self,
        default_prevented: bool,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(direction) = self.pending_tab_key_down.take() else {
            return;
        };
        if !default_prevented {
            self.move_focus(direction, window, cx);
        }
        self.dispatch_next_tab_key_down(window, cx);
    }

    pub(crate) fn move_focus(
        &mut self,
        direction: FocusDirection,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.focus_unrendered_virtual_target(direction, window, cx) {
            return;
        }
        match direction {
            FocusDirection::Next => window.focus_next(cx),
            FocusDirection::Previous => window.focus_prev(cx),
        }
        self.scroll_current_focus_into_view(window, cx);
    }

    fn scroll_current_focus_into_view(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(id) = self
            .focus_handles
            .iter()
            .find_map(|(id, handle)| handle.is_focused(window).then_some(*id))
        {
            self.scroll_focused_element_into_view(id, cx);
        }
    }

    fn focus_unrendered_virtual_target(
        &mut self,
        direction: FocusDirection,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(current_id) = self
            .focus_handles
            .iter()
            .find_map(|(id, handle)| handle.is_focused(window).then_some(*id))
        else {
            return false;
        };

        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let Some(list_id) = virtual_list_ancestor_id(&tree, current_id) else {
            return false;
        };

        let Some(root_id) = tree.root_id else {
            return false;
        };
        let mut stack = vec![root_id];
        let mut order = 0usize;
        let mut focusable = Vec::new();
        while let Some(id) = stack.pop() {
            let is_focusable = self
                .focus_handles
                .get(&id)
                .is_some_and(|handle| handle.tab_stop && handle.tab_index >= 0);
            if is_focusable {
                focusable.push((id, order));
                order += 1;
            }
            if let Some(element) = tree.elements.get(&id) {
                stack.extend(element.children.iter().rev().copied());
            }
        }
        focusable.sort_by_key(|(id, document_order)| {
            let tab_index = self.focus_handles[id].tab_index;
            if tab_index > 0 {
                (0, tab_index, *document_order)
            } else {
                (1, 0, *document_order)
            }
        });

        let Some(current_index) = focusable.iter().position(|(id, _)| *id == current_id) else {
            return false;
        };
        let target_index = match direction {
            FocusDirection::Next => current_index.checked_add(1),
            FocusDirection::Previous => current_index.checked_sub(1),
        };
        let Some(target_id) = target_index
            .and_then(|index| focusable.get(index))
            .map(|(id, _)| *id)
        else {
            return false;
        };
        if virtual_list_ancestor_id(&tree, target_id) != Some(list_id) {
            return false;
        }
        let Some(row_id) = virtual_row_ancestor(&tree, list_id, target_id) else {
            return false;
        };
        let Some(entry) = self.virtual_lists.get(&list_id) else {
            return false;
        };
        let Some(row_index) = entry.logical_index_of(row_id) else {
            return false;
        };
        let outside_viewport = entry
            .state
            .item_is_above_viewport(row_index)
            .unwrap_or(true)
            || entry
                .state
                .item_is_below_viewport(row_index)
                .unwrap_or(true);
        if !outside_viewport {
            return false;
        }

        let Some(handle) = self.focus_handles.get(&target_id).cloned() else {
            return false;
        };
        drop(tree);
        handle.focus(window, cx);
        self.scroll_current_focus_into_view(window, cx);
        cx.notify();
        true
    }

    fn on_selection_mouse_move(
        &mut self,
        position: gpui::Point<gpui::Pixels>,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.selection.lock().is_dragging() {
            self.stop_selection_scroll();
            return;
        }
        let list_id = self
            .selection_scroll_list
            .filter(|id| {
                self.virtual_lists.get(id).is_some_and(|entry| {
                    let bounds = entry.state.viewport_bounds();
                    position.x >= bounds.left() && position.x <= bounds.right()
                })
            })
            .or_else(|| {
                self.virtual_lists
                    .iter()
                    .find(|(_, entry)| entry.state.viewport_bounds().contains(&position))
                    .map(|(id, _)| *id)
            });
        let Some(list_id) = list_id else {
            self.stop_selection_scroll();
            return;
        };
        self.selection_drag_position = Some(position);
        self.selection_scroll_list = Some(list_id);
        self.schedule_selection_scroll(cx);
    }

    fn stop_selection_scroll(&mut self) {
        self.selection_drag_position = None;
        self.selection_scroll_list = None;
        self.selection_scroll_task = None;
    }

    fn schedule_selection_scroll(&mut self, cx: &mut gpui::Context<Self>) {
        if self.selection_scroll_task.is_some() || !self.selection.lock().is_dragging() {
            return;
        }
        let (Some(position), Some(list_id)) =
            (self.selection_drag_position, self.selection_scroll_list)
        else {
            return;
        };
        let Some(entry) = self.virtual_lists.get(&list_id) else {
            return;
        };
        if selection_scroll_step(entry.state.viewport_bounds(), position) == 0.0 {
            return;
        }
        self.selection_scroll_task = Some(cx.spawn(async move |view, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(SELECTION_SCROLL_TICK_MS))
                .await;
            if let Err(error) = view.update(cx, |view, cx| {
                view.selection_scroll_task = None;
                view.step_selection_scroll(cx);
            }) {
                log::debug!("selection scroll stopped after view teardown: {error}");
            }
        }));
    }

    fn step_selection_scroll(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.selection.lock().is_dragging() {
            self.stop_selection_scroll();
            return;
        }
        let (Some(position), Some(list_id)) =
            (self.selection_drag_position, self.selection_scroll_list)
        else {
            return;
        };
        let Some(entry) = self.virtual_lists.get(&list_id) else {
            self.stop_selection_scroll();
            return;
        };
        let step = selection_scroll_step(entry.state.viewport_bounds(), position);
        if step == 0.0 {
            return;
        }

        let before = entry.state.logical_scroll_top();
        let selection_moved = crate::text::paint::update_drag_at(&self.selection, position);
        entry.state.scroll_by(gpui::px(step));
        let after = entry.state.logical_scroll_top();
        let list_moved =
            after.item_ix != before.item_ix || after.offset_in_item != before.offset_in_item;
        if !selection_moved && !list_moved {
            self.stop_selection_scroll();
            return;
        }
        cx.notify();
        self.schedule_selection_scroll(cx);
    }

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
            if crate::accessibility::is_native_disabled(element)
                || accessibility_hidden_in_ancestry(tree, element.id)
            {
                return None;
            }
            element
                .custom_props
                .get("tabIndex")
                .and_then(|value| value.as_i64())
                .and_then(|index| isize::try_from(index).ok())
        };
        let needs_focus = |element: &crate::retained_tree::RetainedElement| {
            matches!(element.element_type.as_str(), "input" | "textarea")
                || tab_index(element).is_some()
                || element.events.contains("accessibilityAction")
                || element.events.contains("keyDown")
                || element.events.contains("keyUp")
                || element.events.contains("focus")
                || element.events.contains("blur")
        };
        let mut pending_auto_focus = Vec::new();
        // Create handles for elements that need focus but don't have one yet.
        for (&id, element) in &tree.elements {
            let tab_index = tab_index(element).or_else(|| {
                matches!(element.element_type.as_str(), "input" | "textarea").then_some(0)
            });

            let native_disabled = crate::accessibility::is_native_disabled(element)
                || accessibility_hidden_in_ancestry(tree, id);
            if needs_focus(element) && !self.focus_handles.contains_key(&id) {
                let handle = match tab_index {
                    Some(index) => cx.focus_handle().tab_index(index).tab_stop(index >= 0),
                    None => cx.focus_handle(),
                };
                // Focus once, at creation. Re-focusing every frame would
                // steal focus back from whatever the user clicked next.
                if element.auto_focus && !native_disabled {
                    pending_auto_focus.push((id, handle.clone()));
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

        // Clean up handles for elements that no longer exist before deriving
        // scroll anchors and subscriptions from the live focus set.
        self.focus_handles
            .retain(|id, _| tree.elements.get(id).is_some_and(&needs_focus));
        self.sync_focus_scroll_anchors(tree);

        self.focus_subscriptions.retain(|(id, event), _| {
            self.focus_handles.contains_key(id)
                && tree
                    .elements
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
                let subscription = cx.on_focus(&handle, window, move |_this, _window, cx| {
                    let callback = callback.clone();
                    // GPUI notifies all listeners for one focus transition in
                    // subscription order. Defer focus until that listener pass
                    // ends so the old target's blur is always emitted first,
                    // matching the DOM focus event order.
                    cx.defer(move |_| {
                        emit_event_full(&callback, id, "focus", |_| {});
                    });
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

        // Subscribe before applying autoFocus so its public focus event is not
        // missed during the initial render.
        for (id, handle) in pending_auto_focus {
            handle.focus(window, cx);
            let view = cx.weak_entity();
            window.on_next_frame(move |window, app| {
                view.update(app, |view, cx| {
                    if handle.is_focused(window) {
                        view.scroll_focused_element_into_view(id, cx);
                    }
                })
                .ok();
            });
        }
    }

    fn sync_focus_scroll_anchors(&mut self, tree: &RetainedTree) {
        let mut targets: HashSet<u64> = self.focus_handles.keys().copied().collect();
        targets.extend(
            tree.elements
                .values()
                .filter(|element| is_overflow_scroller(element))
                .map(|element| element.id),
        );

        let mut previous = std::mem::take(&mut self.focus_scroll_anchors);
        for id in targets {
            let Some(ancestor) = nearest_scroll_ancestor(tree, id) else {
                continue;
            };
            let entry = match ancestor {
                ScrollAncestor::Overflow(scroller_id) => previous
                    .remove(&id)
                    .and_then(|entry| match entry {
                        FocusScrollAnchor::Overflow {
                            scroller_id: previous_id,
                            anchor,
                        } if previous_id == scroller_id => Some(FocusScrollAnchor::Overflow {
                            scroller_id,
                            anchor,
                        }),
                        _ => None,
                    })
                    .unwrap_or_else(|| {
                        let handle = self.scroll_handles.entry(scroller_id).or_default().clone();
                        FocusScrollAnchor::Overflow {
                            scroller_id,
                            anchor: gpui::ScrollAnchor::for_handle(handle),
                        }
                    }),
                ScrollAncestor::VirtualList(list_id) => previous
                    .remove(&id)
                    .and_then(|entry| match entry {
                        FocusScrollAnchor::VirtualList {
                            list_id: previous_id,
                            bounds,
                            pending_reveal_origin,
                        } if previous_id == list_id => Some(FocusScrollAnchor::VirtualList {
                            list_id,
                            bounds,
                            pending_reveal_origin,
                        }),
                        _ => None,
                    })
                    .unwrap_or_else(|| FocusScrollAnchor::VirtualList {
                        list_id,
                        bounds: Arc::new(Mutex::new(None)),
                        pending_reveal_origin: Arc::new(Mutex::new(None)),
                    }),
            };
            self.focus_scroll_anchors.insert(id, entry);
        }
    }

    fn scroll_focused_element_into_view(&mut self, id: u64, cx: &mut gpui::Context<Self>) {
        // Focus reveal is the DOM's `block: "nearest"`: scroll no further than
        // needed to show the element that just took focus.
        self.reveal_element(id, RevealAlignment::Nearest, cx);
    }

    fn reveal_element(
        &mut self,
        id: u64,
        alignment: RevealAlignment,
        cx: &mut gpui::Context<Self>,
    ) {
        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let mut current = id;
        let mut requested = false;

        for anchor in self.focus_scroll_anchors.values() {
            if let FocusScrollAnchor::VirtualList {
                pending_reveal_origin,
                ..
            } = anchor
            {
                *pending_reveal_origin.lock().unwrap() = None;
            }
        }

        while let Some(ancestor) = nearest_scroll_ancestor(&tree, current) {
            match ancestor {
                ScrollAncestor::Overflow(scroller_id) => {
                    // The element-precise anchor only knows how to reveal by the
                    // nearest edge, so top alignment goes through the scroller's
                    // own child index instead.
                    let anchor = (alignment == RevealAlignment::Nearest)
                        .then(|| {
                            self.focus_scroll_anchors
                                .get(&current)
                                .and_then(|entry| match entry {
                                    FocusScrollAnchor::Overflow {
                                        scroller_id: anchor_scroller_id,
                                        anchor,
                                    } if *anchor_scroller_id == scroller_id => Some(anchor),
                                    _ => None,
                                })
                        })
                        .flatten();
                    if let Some(anchor) = anchor {
                        anchor.scroll_to_reveal();
                        requested = true;
                    } else if let Some(index) = painted_child_index(&tree, scroller_id, current) {
                        if let Some(handle) = self.scroll_handles.get(&scroller_id) {
                            let scrolls_y = tree
                                .elements
                                .get(&scroller_id)
                                .is_some_and(scrolls_vertically);
                            match alignment {
                                // gpui's `Top` strategy writes the vertical
                                // offset whether or not the scroller has a
                                // vertical viewport, unlike the per-axis gate
                                // its nearest-edge strategy applies
                                // (`ScrollHandle::scroll_to_active_item`). A
                                // handle registers for `overflowX` alone, and
                                // there `block: "start"` has no vertical
                                // component to honor.
                                RevealAlignment::Start if scrolls_y => {
                                    handle.scroll_to_top_of_item(index)
                                }
                                RevealAlignment::Nearest | RevealAlignment::Start => {
                                    handle.scroll_to_item(index)
                                }
                            }
                            requested = true;
                        }
                    }
                    current = scroller_id;
                }
                ScrollAncestor::VirtualList(list_id) => {
                    if alignment == RevealAlignment::Start {
                        // `block: "start"` is exactly a logical scroll top of
                        // (row, 0), which needs no painted geometry at all.
                        if let Some(entry) = self.virtual_lists.get(&list_id) {
                            if let Some(index) = virtual_row_ancestor(&tree, list_id, current)
                                .and_then(|row_id| entry.logical_index_of(row_id))
                            {
                                entry.state.scroll_to(gpui::ListOffset {
                                    item_ix: index,
                                    offset_in_item: gpui::px(0.),
                                });
                                requested = true;
                            }
                        }
                        current = list_id;
                        continue;
                    }
                    if let Some(entry) = self.virtual_lists.get(&list_id) {
                        let exact =
                            self.focus_scroll_anchors.get(&current).and_then(
                                |anchor| match anchor {
                                    FocusScrollAnchor::VirtualList {
                                        list_id: anchor_list_id,
                                        bounds,
                                        pending_reveal_origin,
                                    } if *anchor_list_id == list_id => {
                                        Some((bounds, pending_reveal_origin))
                                    }
                                    _ => None,
                                },
                            );
                        let tracked_bounds = exact.and_then(|(bounds, _)| *bounds.lock().unwrap());

                        if let Some(bounds) = tracked_bounds {
                            let distance = virtual_focus_scroll_distance(&entry.state, bounds);
                            if distance != gpui::px(0.) {
                                entry.state.scroll_by(distance);
                                requested = true;
                            }
                        } else if let Some(row_id) = virtual_row_ancestor(&tree, list_id, current) {
                            if let Some((_, pending_reveal_origin)) = exact {
                                *pending_reveal_origin.lock().unwrap() =
                                    Some(entry.state.scroll_px_offset_for_scrollbar().y);
                            }
                            if let Some(index) = entry.logical_index_of(row_id) {
                                // An unpainted target has no exact geometry yet. Reveal its row
                                // only to mount it; the paint listener then applies the element-
                                // precise nearest-edge correction on the next frame.
                                entry.state.scroll_to_reveal_item(index);
                                requested = true;
                            }
                        }
                    }
                    current = list_id;
                }
            }
        }
        drop(tree);

        if requested {
            cx.notify();
        }
    }
}

fn virtual_focus_scroll_distance(
    state: &gpui::ListState,
    target: VirtualFocusBounds,
) -> gpui::Pixels {
    virtual_focus_scroll_distance_at_offset(
        state.viewport_bounds(),
        target,
        state.scroll_px_offset_for_scrollbar().y,
    )
}

fn virtual_focus_scroll_distance_at_offset(
    viewport: gpui::Bounds<gpui::Pixels>,
    target: VirtualFocusBounds,
    scroll_offset: gpui::Pixels,
) -> gpui::Pixels {
    // Mirror gpui::ScrollAnchor::scroll_to_reveal, with the sign translated
    // for ListState::scroll_by. ListState exposes item reveal but no element
    // anchor, so paint supplies the target geometry its public scroll API needs.
    let target_top = target.content_top + scroll_offset;
    let target_bottom = target_top + target.height;

    if target_top < viewport.top() && target_bottom > viewport.bottom() {
        gpui::px(0.)
    } else if target_top < viewport.top() {
        target_top - viewport.top()
    } else if target_bottom > viewport.bottom() {
        target_bottom - viewport.bottom()
    } else {
        gpui::px(0.)
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

        if self.window_activation_subscription.is_none() {
            self.window_activation_subscription =
                Some(cx.observe_window_activation(window, |view, window, cx| {
                    let is_active = window.is_window_active();
                    emit_window_activation(&view.window_event_callback, is_active);
                    if !is_active && view.cancel_pointer_sequence(window) {
                        cx.notify();
                    }
                }));
        }

        // Clone Arc so we don't borrow self.tree — frees self for focus_handles access.
        let tree_arc = self.tree.clone();
        let tree = tree_arc.lock().unwrap();
        let callback = self.event_callback.clone();

        // Sync focus handles before building elements.
        self.sync_focus_handles(&tree, &callback, window, cx);

        if self.focus_lost_subscription.is_none() {
            self.focus_lost_subscription = Some(cx.on_focus_lost(window, |view, window, cx| {
                if window.focused(cx).is_none() {
                    view.root_focus_handle.focus(window, cx);
                }
            }));
        }
        // autoFocus is resolved above, before the fallback root can claim an
        // otherwise empty focus path. Once a retained element has focus this
        // check remains inert, including across ordinary React re-renders.
        if window.focused(cx).is_none() {
            self.root_focus_handle.focus(window, cx);
        }

        // Ensure custom element instances are destroyed when their IDs disappear.
        self.custom_registry
            .prune_missing(|id| tree.elements.contains_key(&id));
        self.canvas_image_store
            .prune_missing(|id| tree.elements.contains_key(&id), window);

        // Clean up scroll handles for destroyed elements (IDs removed from tree).
        // Scrollability-based cleanup (element still exists but style changed
        // from scroll to non-scroll) is handled inside build_host_container().
        self.scroll_handles
            .retain(|id, _| tree.elements.contains_key(id));
        self.scroll_event_offsets
            .lock()
            .unwrap()
            .retain(|id, _| tree.elements.contains_key(id));
        self.virtual_lists
            .retain(|id, _| tree.elements.contains_key(id));
        self.motion_states
            .retain(|id, _| tree.elements.contains_key(id));
        self.interactive_style_states
            .retain(|id, _| tree.elements.contains_key(id));
        self.transition_states.retain(|id, _| tree.is_attached(*id));

        // Build the element tree. custom_registry, focus_handles, and scroll_handles
        // are different fields of self, so Rust allows borrowing all simultaneously.
        let theme = Theme::dark();
        let now = self.clock.now();
        let mut animation_active = false;
        let mut style_transition_active = false;
        let reduce_motion = cx.reduce_motion();
        // Pruned by DECLARATION, not existence: an element that drops its
        // `highlight` prop keeps living, and its cached group list holds a copy
        // of every string in its subtree.
        self.highlights.retain(|id, _| {
            tree.elements
                .get(id)
                .is_some_and(|element| element.custom_props.contains_key("highlight"))
        });
        let mut highlight_events = Vec::new();
        if let Some(host_ids) = self.accessibility_host_ids.as_mut() {
            host_ids.clear();
        }
        let result = match tree.root_id {
            Some(root_id) => {
                let accessibility_host_ids = self.accessibility_host_ids.as_mut();
                let gpui_element_path = accessibility_host_ids
                    .as_ref()
                    .map(|_| vec![gpui::ElementId::View(window.current_view())]);
                let mut ctx = BuildCtx {
                    tree: &tree,
                    canvas_display_lists: &self.canvas_display_lists,
                    canvas_image_store: &self.canvas_image_store,
                    event_callback: &callback,
                    focus_handles: &self.focus_handles,
                    focus_scroll_anchors: &self.focus_scroll_anchors,
                    scroll_handles: &mut self.scroll_handles,
                    scroll_event_offsets: &self.scroll_event_offsets,
                    custom_registry: &mut self.custom_registry,
                    virtual_lists: &mut self.virtual_lists,
                    motion_states: &mut self.motion_states,
                    transition_states: &mut self.transition_states,
                    interactive_style_states: &self.interactive_style_states,
                    now,
                    animation_active: &mut animation_active,
                    style_transition_active: &mut style_transition_active,
                    reduce_motion,
                    selection: self.selection.clone(),
                    image_network_policy: &self.image_network_policy,
                    inherited: Inherited::root(&theme),
                    highlights: &mut self.highlights,
                    highlight_events: &mut highlight_events,
                    accessibility_host_ids,
                    gpui_element_path,
                    measuring: false,
                    intrinsic_probe: None,
                };
                build_element(root_id, &mut ctx, window, cx)
            }
            None => gpui::Empty.into_any_element(),
        };
        // Flushed after the root build so a `setState` in the handler cannot
        // re-enter this build.
        emit_highlight_events(&callback, &highlight_events);

        // The frame reset must paint BEFORE any text, so it is the first child of
        // the root wrapper. Without it the selection registry accumulates stale
        // entries across frames and a drag resolves against elements that are no
        // longer on screen.
        let result = {
            use gpui::prelude::*;
            let drag_move_view = cx.weak_entity();
            let drag_end_view = drag_move_view.clone();
            let root = gpui::div()
                .size_full()
                .text_color(gpui::rgba(0xe2e2e2ff))
                .track_focus(&self.root_focus_handle)
                .on_action(cx.listener(Self::focus_next_action))
                .on_action(cx.listener(Self::focus_previous_action))
                .on_key_down(cx.listener(|view, event: &gpui::KeyDownEvent, window, _cx| {
                    view.dispatch_unfocused_key_event(
                        "keyDown",
                        &event.keystroke,
                        Some(event.is_held),
                        window,
                    );
                }))
                .on_key_up(cx.listener(|view, event: &gpui::KeyUpEvent, window, _cx| {
                    view.dispatch_unfocused_key_event("keyUp", &event.keystroke, None, window);
                }));
            with_window_menu_actions(root)
                .child(selection_frame_reset(
                    self.selection.clone(),
                    move |position, app| {
                        drag_move_view
                            .update(app, |view, cx| view.on_selection_mouse_move(position, cx))
                            .ok();
                    },
                    move |app| {
                        drag_end_view
                            .update(app, |view, _cx| view.stop_selection_scroll())
                            .ok();
                    },
                ))
                .child(crate::automation::bounds_frame_reset())
                .child(crate::pointer::pointer_router_frame(
                    self.pointer_router.clone(),
                ))
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
        // One-shot: a queued scroll for a list that did not build this frame
        // would otherwise fire on some later frame, against child indices that
        // no longer match what JS meant.
        PENDING_VIRTUAL_LIST_SCROLLS.with(|cell| cell.borrow_mut().clear());

        if style_transition_active {
            self.style_transition_frame_requests =
                self.style_transition_frame_requests.saturating_add(1);
        }
        if animation_active {
            window.request_animation_frame();
        }

        result
    }
}

// ── Element builders ─────────────────────────────────────────────────

fn focus_paint_bounds_listener(
    id: u64,
    ctx: &BuildCtx,
) -> Option<crate::automation::PaintBoundsListener> {
    let FocusScrollAnchor::VirtualList {
        list_id,
        bounds,
        pending_reveal_origin,
    } = ctx.focus_scroll_anchors.get(&id)?
    else {
        return None;
    };
    let state = ctx.virtual_lists.get(list_id)?.state.clone();
    let bounds = bounds.clone();
    let pending_reveal_origin = pending_reveal_origin.clone();

    Some(std::rc::Rc::new(move |painted_bounds, window, _cx| {
        let tracked = VirtualFocusBounds {
            content_top: painted_bounds.top() - state.scroll_px_offset_for_scrollbar().y,
            height: painted_bounds.size.height,
        };
        *bounds.lock().unwrap() = Some(tracked);

        let reveal_origin = pending_reveal_origin.lock().unwrap().take();
        if let Some(origin_offset) = reveal_origin {
            let desired_distance = virtual_focus_scroll_distance_at_offset(
                state.viewport_bounds(),
                tracked,
                origin_offset,
            );
            // The row reveal already changed the list offset. Move from that
            // temporary position to the offset the exact target would have
            // produced from the original viewport.
            let correction =
                state.scroll_px_offset_for_scrollbar().y - origin_offset + desired_distance;
            if correction != gpui::px(0.) {
                state.scroll_by(correction);
                window.refresh();
            }
        }
    }))
}

pub(crate) fn build_element(
    id: u64,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    build_element_with_parent_layout(id, false, ctx, window, cx)
}

fn retained_gpui_element_id(
    element: &crate::retained_tree::RetainedElement,
) -> Option<gpui::ElementId> {
    let id = element.id;
    match element.element_type.as_str() {
        "div" | "text" => Some(gpui::ElementId::Integer(id)),
        "img" => Some(gpui::ElementId::Name(format!("__gpuix_img_{id}").into())),
        "svg" => Some(gpui::ElementId::Name(format!("__gpuix_svg_{id}").into())),
        "input" | "textarea" => Some(gpui::ElementId::Name(format!("__gpuix_editor_{id}").into())),
        "anchored" => Some(gpui::ElementId::Name(
            format!("__gpuix_anchored_{id}").into(),
        )),
        "code" => Some(gpui::ElementId::Name(format!("__gpuix_code_{id}").into())),
        "diff" => Some(gpui::ElementId::Name(format!("__gpuix_diff_{id}").into())),
        "markdown" => Some(gpui::ElementId::Name(
            format!("__gpuix_markdown_{id}").into(),
        )),
        "canvas" => Some(gpui::ElementId::Name(format!("__gpuix_{id}").into())),
        _ => None,
    }
}

fn record_accessibility_host_identity(
    host_id: u64,
    path: &[gpui::ElementId],
    identities: &mut HashMap<u64, u64>,
) {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    identities.insert(hasher.finish(), host_id);
}

/// Records test-snapshot provenance only when the test renderer opted in.
///
/// Keeping element-id resolution inside this gate matters: custom element ids
/// allocate formatted names, and production renderers never consume this map.
fn track_accessibility_host_identity(
    host_id: u64,
    path: Option<&mut Vec<gpui::ElementId>>,
    identities: Option<&mut HashMap<u64, u64>>,
    element_id: impl FnOnce() -> Option<gpui::ElementId>,
) -> bool {
    let Some(path) = path else {
        return false;
    };
    let Some(identities) = identities else {
        return false;
    };
    let Some(element_id) = element_id() else {
        return false;
    };

    path.push(element_id);
    record_accessibility_host_identity(host_id, path, identities);
    true
}

#[cfg(test)]
mod accessibility_host_identity_tests {
    use super::*;

    #[test]
    fn disabled_snapshot_provenance_skips_element_id_resolution() {
        let mut path = None;
        let mut resolved_element_id = false;

        let tracked = track_accessibility_host_identity(7, path.as_mut(), None, || {
            resolved_element_id = true;
            Some(gpui::ElementId::Integer(7))
        });

        assert!(!tracked);
        assert!(!resolved_element_id);
        assert!(path.is_none());
    }
}

fn build_element_with_parent_layout(
    id: u64,
    default_flex_none: bool,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::IntoElement;

    let Some(element) = ctx.tree.elements.get(&id) else {
        return gpui::Empty.into_any_element();
    };

    // A measured subtree is dropped before prepaint, so its GPUI element path
    // is not the one the painted element gets. Recording it would overwrite the
    // real identity with a path no frame ever drew.
    let tracks_accessibility_host_identity = !ctx.measuring
        && track_accessibility_host_identity(
            element.id,
            ctx.gpui_element_path.as_mut(),
            ctx.accessibility_host_ids.as_deref_mut(),
            || retained_gpui_element_id(element),
        );

    if crate::accessibility::is_visually_hidden(ctx.tree, element) {
        ctx.custom_registry.destroy(id);
        ctx.motion_states.remove(&id);
        ctx.transition_states.remove(&id);
        ctx.scroll_handles.remove(&id);
        let built = build_visually_hidden_element(element, ctx);
        if tracks_accessibility_host_identity {
            ctx.gpui_element_path
                .as_mut()
                .expect("tracked accessibility identity has a path")
                .pop();
        }
        return built;
    }

    // An intrinsic-size probe replaces this element's declared style with the
    // transition target it is being measured at. Taken, not borrowed, so the
    // descendants below build from their own styles.
    let probe_style = match ctx.intrinsic_probe.as_ref() {
        Some((probe_id, _)) if *probe_id == id => {
            ctx.intrinsic_probe.take().map(|(_, style)| style)
        }
        _ => None,
    };
    let declared_style = probe_style.as_ref().or(element.style.as_deref());
    let parent_inherited = ctx.inherited.clone();
    let hover_within = parent_inherited.hover_groups.iter().any(|group| {
        ctx.interactive_style_states
            .get(&group.id)
            .is_some_and(|state| state.hovered)
    });
    let supports_style_transitions = matches!(
        element.element_type.as_str(),
        "div"
            | "text"
            | "img"
            | "canvas"
            | "code"
            | "diff"
            | "input"
            | "textarea"
            | "markdown"
            | "anchored"
    );
    let transitioned_style = if !supports_style_transitions {
        // Virtual lists and custom renderers outside the supported surface
        // family receive the declared target immediately and retain no track.
        if !ctx.measuring {
            ctx.transition_states.remove(&id);
        }
        None
    } else if ctx.measuring {
        // The probe element is measured at the style it was handed, which is
        // already the transition's target. Descendants keep the frame they are
        // painting, read-only: a second `sync` on this clock would retarget
        // their retained tracks against a style this frame never paints.
        if probe_style.is_some() {
            None
        } else {
            ctx.transition_states
                .get(&id)
                .map(|state| state.frame(ctx.now, ctx.reduce_motion).style)
        }
    } else if let Some(style) = declared_style.filter(|style| style.transition.is_some()) {
        let focused = ctx
            .focus_handles
            .get(&id)
            .is_some_and(|handle| handle.is_focused(window));
        let focus_state = crate::motion::StyleState {
            focused,
            focus_visible: focused && window.last_input_was_keyboard(),
        };
        // Intrinsic endpoints are measured on the shared host container only.
        // Measuring a custom surface means re-entering its own `render` inside
        // the frame that is already rendering it, and a custom renderer is not
        // required to be idempotent under that.
        let measurable = matches!(element.element_type.as_str(), "div" | "text")
            && interpolate_size_keywords(declared_style, parent_inherited.interpolate_size_keywords);
        // Both questions are about the style the transition is aiming at, not
        // the base declaration: `hover: { width: "auto" }` or an inset
        // refinement changes the answer. Layout-mode properties (`alignSelf`,
        // `position`, `flexGrow`, `flexBasis`) are not transitionable and so
        // are still read from the base declaration. Resolved once here, and
        // only for an element that opted in.
        let intrinsic_target = measurable.then(|| {
            crate::motion::transition_target_style(
                style,
                focus_state,
                hover_within,
                ctx.transition_states.get(&id),
            )
        });
        let content_sized = intrinsic_target.as_ref().map_or_else(
            crate::motion::IntrinsicAxes::default,
            |target| {
                let parent = element
                    .parent
                    .and_then(|parent_id| ctx.tree.elements.get(&parent_id));
                content_sized_intrinsic_axes(parent, Some(target))
            },
        );
        let intrinsic = crate::motion::IntrinsicInput {
            content_sized,
            measured: match intrinsic_target.as_ref() {
                Some(target) => intrinsic_transition_size(
                    id,
                    target,
                    style.transition.as_ref().expect("a declared transition"),
                    content_sized,
                    ctx,
                    window,
                    cx,
                ),
                None => crate::motion::IntrinsicSize::default(),
            },
        };
        let state = ctx.transition_states.entry(id).or_insert_with(|| {
            crate::motion::StyleTransitionState::new(style, focus_state, hover_within, ctx.now)
        });
        state.sync(
            style,
            focus_state,
            hover_within,
            ctx.now,
            ctx.reduce_motion,
            intrinsic,
        );
        let frame = state.frame(ctx.now, ctx.reduce_motion);
        *ctx.animation_active |= frame.active;
        *ctx.style_transition_active |= frame.active;
        Some(frame.style)
    } else {
        ctx.transition_states.remove(&id);
        None
    };

    let motion_style = if ctx.measuring {
        // `MotionState::sync` advances a retained track, and the real build of
        // this same element is still to come this frame. Measure against the
        // frame the track is already on instead.
        element
            .custom_props
            .get("motion")
            .and_then(|_| ctx.motion_states.get(&id))
            .filter(|state| state.is_valid())
            .map(|state| {
                let frame = state.frame(ctx.now, ctx.reduce_motion);
                let mut resolved = transitioned_style
                    .clone()
                    .or_else(|| declared_style.cloned())
                    .unwrap_or_default();
                // `MotionStyle` carries width and height, and the probe exists
                // for the `auto` forced onto the measured axis. Let motion
                // decide everything else it animates.
                let probe_sizes = probe_style
                    .as_ref()
                    .map(|style| (style.width.clone(), style.height.clone()));
                frame.style.apply_to(&mut resolved);
                if let Some((width, height)) = probe_sizes {
                    resolved.width = width;
                    resolved.height = height;
                }
                resolved
            })
    } else if let Some(source) = element.custom_props.get("motion") {
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
        if let Err(error) = state.sync(source, ctx.now, ctx.reduce_motion) {
            log::warn!("Invalid motion update for element {id}: {error}");
        }
        state.is_valid().then(|| {
            let frame = state.frame(ctx.now, ctx.reduce_motion);
            *ctx.animation_active |= frame.active;
            // `Arc<StyleDesc>` is shared, so the animated frame is applied to a
            // copy. Mutating through the pointer would restyle every element
            // that declared the same style.
            let mut resolved = transitioned_style
                .clone()
                .or_else(|| declared_style.cloned())
                .unwrap_or_default();
            frame.style.apply_to(&mut resolved);
            resolved
        })
    } else {
        ctx.motion_states.remove(&id);
        None
    };
    // Resolve expressions against the exact style this frame will paint. Motion
    // and style transitions both retain a copy-on-write frame style, while an
    // unanimated element may still borrow its declared `Arc<StyleDesc>`.
    let layered_style = motion_style
        .as_ref()
        .or(transitioned_style.as_ref())
        .or(declared_style);

    // Inheritable style resolves once here so both built-ins and custom
    // elements see the same cascade.
    let font = parent_inherited.font_for(layered_style, window);
    // Percentage terms stay deferred through GPUI/Taffy, where the layout
    // algorithm supplies the containing block's content size. Only `ch`, `vw`,
    // and `vh` are reduced here, using the inherited font chain above.
    let mut resolved_style =
        layered_style.map(|style| resolve_length_expressions(style, window, &font));
    if let Some(style) = resolved_style.as_mut() {
        resolve_intrinsic_keywords(id, style, &element.element_type, ctx, window, cx);
    }
    if default_flex_none {
        default_flex_none_for_parent_layout(resolved_style.get_or_insert_default());
    }
    if let Some(style) = resolved_style.as_mut() {
        // GPUI stores one group-hover refinement per element. The outermost
        // marked ancestor is sufficient for the CSS OR: hovering any nested
        // marked ancestor also hovers every ancestor containing it, while the
        // outer group's own padding remains independently hoverable.
        style.hover_within_group = parent_inherited
            .hover_groups
            .first()
            .map(|group| group.name.clone());
    }
    let style = resolved_style.as_ref();
    let hover_group = style.and_then(|style| style.hover_group.as_deref());
    let focused = ctx
        .focus_handles
        .get(&id)
        .is_some_and(|handle| handle.is_focused(window));
    let interaction = ctx
        .interactive_style_states
        .get(&id)
        .copied()
        .unwrap_or_default();
    let current_color = resolved_current_color(
        style,
        focused,
        focused && window.last_input_was_keyboard(),
        hover_within,
        interaction.hovered,
        interaction.active,
    );
    ctx.inherited = parent_inherited
        .clone()
        .descend(style, hover_group, id, current_color, font);
    ctx.inherited.accessibility_hidden |= crate::accessibility::is_hidden(element);
    ctx.inherited.text_accessibility_owned_by_role |=
        crate::accessibility::role_supports_name_from_contents(element);

    // A `highlight` here replaces any ancestor's: the nearest declaration wins,
    // and `GroupList::collect` skips nested declarations so an ancestor never
    // resolves or counts matches that will not paint.
    if let Some(value) = element.custom_props.get("highlight") {
        let has_listener = element.events.contains("highlight");
        let resolved = resolve_highlight(
            ctx.highlights,
            ctx.tree,
            id,
            value,
            &Theme::dark(),
            has_listener,
        );
        if let Some((_, Some(total))) = &resolved {
            // `onHighlight` is reported once per frame by the painted build.
            // Queueing from a measurement would fire the handler twice.
            if !ctx.measuring {
                ctx.highlight_events.push((id, *total));
            }
        }
        ctx.inherited.highlight = resolved.map(|(context, _)| context);
    }

    let built = match element.element_type.as_str() {
        // `<text>` is a `<div>` that happens to carry a string. Giving it its
        // own builder meant every interaction prop on the shared `Props` type
        // (onClick, hover, focus, tabIndex) type-checked, registered a JS
        // listener, and then silently did nothing.
        "div" | "text" => {
            ctx.custom_registry.destroy(id);
            build_host_container(element, style, ctx, window, cx)
        }
        "virtual-list" => {
            ctx.custom_registry.destroy(id);
            build_virtual_list(element, style, hover_within, ctx, window, cx)
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
            let inherited = ctx.inherited.clone();
            let paint_bounds_listener = focus_paint_bounds_listener(id, ctx);
            let render_ctx = CustomRenderContext {
                id,
                retained_element: element,
                tree: ctx.tree,
                events: &element.events,
                tracks_mouse_hover: tracks_mouse_hover_events(element, ctx.tree),
                event_callback: ctx.event_callback,
                focus_handle: ctx.focus_handles.get(&id),
                scroll_anchor: ctx
                    .focus_scroll_anchors
                    .get(&id)
                    .and_then(FocusScrollAnchor::overflow_anchor),
                paint_bounds_listener,
                style,
                children: custom_children,
                selection: ctx.selection.clone(),
                selectable: inherited.selectable,
                accessibility_hidden: inherited.accessibility_hidden,
                selection_wash: inherited.selection_wash,
                current_color: inherited.current_color,
                image_network_policy: ctx.image_network_policy,
                canvas_image_store: ctx.canvas_image_store,
                canvas_display_lists: ctx.canvas_display_lists,
                highlight_set: inherited.highlight.clone(),
            };
            ctx.custom_registry
                .render(custom_type, &element.custom_props, render_ctx, window, cx)
        }
    };

    if tracks_accessibility_host_identity {
        ctx.gpui_element_path
            .as_mut()
            .expect("tracked accessibility identity has a path")
            .pop();
    }
    ctx.inherited = parent_inherited;
    built
}

/// The pixel size of this element's intrinsic (`auto`) transition endpoint, or
/// nothing when no axis needs one.
///
/// GPUI owns layout, so the number comes from GPUI rather than from a JS
/// measurement: the element is built once more at its intrinsic style and
/// handed to `gpui::AnyElement::layout_as_root`, which runs taffy on it as its
/// own root through `gpui::Window::compute_layout`. `build_element` runs inside
/// `GpuixView::render`, i.e. during GPUI's prepaint phase, which is the phase
/// `Window::request_layout` and `Window::compute_layout` both assert on.
fn intrinsic_transition_size(
    id: u64,
    target: &StyleDesc,
    transition: &crate::style::StyleTransition,
    content_sized: crate::motion::IntrinsicAxes,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> crate::motion::IntrinsicSize {
    // Reduced motion snaps to the target style, so the measurement would be
    // paid for and thrown away.
    if ctx.reduce_motion || ctx.measuring {
        return crate::motion::IntrinsicSize::default();
    }
    // `intrinsic_probe` answers `None` unless an endpoint is changing to or
    // from `auto` this frame, so a settled element and every frame of a run
    // cost nothing.
    let Some(probe) = crate::motion::intrinsic_probe(
        target,
        transition,
        content_sized,
        ctx.transition_states.get(&id),
    ) else {
        return crate::motion::IntrinsicSize::default();
    };
    measure_intrinsic_size(id, probe, ctx, window, cx)
}

/// Which axes take their `auto` from this element's own content.
///
/// GPUI resolves `auto` through the parent's layout algorithm, and only some of
/// those resolutions are content-based: a flex item's main axis, a flex cross
/// axis whose alignment is not `stretch`, a block child's height, and an
/// out-of-flow box without both insets. A stretched cross axis, a block child's
/// *width*, and a grid item all resolve to the parent's size instead, where a
/// content measurement is a number the settled element never paints — a lane
/// that crawls and then jumps, which is worse than the step it replaces. Those
/// axes keep CSS's step.
///
/// Anything this cannot read confidently — a custom-element parent, the app
/// root, an unrecognised parent layout — is treated as stretched.
fn content_sized_intrinsic_axes(
    parent: Option<&crate::retained_tree::RetainedElement>,
    style: Option<&StyleDesc>,
) -> crate::motion::IntrinsicAxes {
    use crate::motion::IntrinsicAxes;

    const STRETCHED: IntrinsicAxes = IntrinsicAxes {
        width: false,
        height: false,
    };
    let inset = |start: Option<f64>, end: Option<f64>| start.is_some() && end.is_some();
    if let Some(style) = style {
        if matches!(style.position.as_deref(), Some("absolute") | Some("fixed")) {
            return IntrinsicAxes {
                width: !inset(style.left, style.right),
                height: !inset(style.top, style.bottom),
            };
        }
    }

    let Some(parent) = parent else {
        return STRETCHED;
    };
    // Only a host container's own style describes how its children are laid
    // out. A custom element renders its children through its own element.
    if !matches!(parent.element_type.as_str(), "div" | "text") {
        return STRETCHED;
    }
    let parent_style = parent.style.as_deref();
    let parent_declares = |field: fn(&StyleDesc) -> Option<&str>| parent_style.and_then(field);
    // `build_host_container` makes an x-only scrollport a flex row, because
    // overflow-x only works as a flex viewport. A two-axis scrollport keeps
    // its authored display, so this has to read both axes exactly the way that
    // branch does.
    let scrolls = |axis: fn(&StyleDesc) -> Option<&str>| {
        parent_style
            .and_then(|style| axis(style).or(style.overflow.as_deref()))
            .is_some_and(|overflow| overflow == "scroll")
    };
    let flex_row_scrollport = scrolls(|style| style.overflow_x.as_deref())
        && !scrolls(|style| style.overflow_y.as_deref());

    let main_is_width = match parent_declares(|style| style.display.as_deref()) {
        Some("flex") => parent_declares(|style| style.flex_direction.as_deref()) != Some("column"),
        // A grid item is stretched into its area on both axes by default, and
        // GPUIX has no `justify-items` / `align-items` override to read there.
        Some("grid") => return STRETCHED,
        _ if flex_row_scrollport => true,
        // Block layout: a child's width fills the containing block, and its
        // height comes from its own content.
        _ => {
            return IntrinsicAxes {
                width: false,
                height: true,
            }
        }
    };

    let stretched = matches!(
        style
            .and_then(|style| style.align_self.as_deref())
            .or_else(|| parent_declares(|style| style.align_items.as_deref())),
        None | Some("stretch")
    );
    // A grown or basis-sized item takes its main size from the container's
    // free space rather than from its content. `flexShrink` still measures
    // as content: a squeezed lane travels at the content rate and arrives
    // early, which README documents.
    let main_from_content = style
        .is_none_or(|style| style.flex_grow.unwrap_or(0.0) == 0.0 && style.flex_basis.is_none());
    IntrinsicAxes {
        width: if main_is_width {
            main_from_content
        } else {
            !stretched
        },
        height: if main_is_width {
            !stretched
        } else {
            main_from_content
        },
    }
}

#[cfg(test)]
mod content_sized_intrinsic_axes_tests {
    use super::*;

    fn element(element_type: &str, style: serde_json::Value) -> crate::retained_tree::RetainedElement {
        let mut element =
            crate::retained_tree::RetainedElement::new(1, element_type.to_owned(), 0);
        let parsed = crate::style::parse_style_value(&style);
        assert_eq!(parsed.problems, [], "{style}");
        element.style = Some(Arc::new(parsed.style));
        element
    }

    fn own(style: serde_json::Value) -> StyleDesc {
        let parsed = crate::style::parse_style_value(&style);
        assert_eq!(parsed.problems, [], "{style}");
        parsed.style
    }

    /// Every parent layout GPUIX can produce, against the axes whose `auto`
    /// comes from the element's own content. `auto` on a stretched axis is the
    /// parent's size, which no content measurement describes.
    #[test]
    fn answers_each_parent_layout() {
        let cases: Vec<(&str, serde_json::Value, serde_json::Value, (bool, bool))> = vec![
            (
                "flex row: width is the main axis, height is stretched",
                serde_json::json!({ "display": "flex" }),
                serde_json::json!({}),
                (true, false),
            ),
            (
                "flex column, default alignment: width is stretched",
                serde_json::json!({ "display": "flex", "flexDirection": "column" }),
                serde_json::json!({}),
                (false, true),
            ),
            (
                "flex column, alignItems flex-start: both axes are content",
                serde_json::json!({
                    "display": "flex",
                    "flexDirection": "column",
                    "alignItems": "flex-start"
                }),
                serde_json::json!({}),
                (true, true),
            ),
            (
                "flex column, alignSelf flex-start on the element",
                serde_json::json!({ "display": "flex", "flexDirection": "column" }),
                serde_json::json!({ "alignSelf": "flex-start" }),
                (true, true),
            ),
            (
                "block parent: width fills the containing block, height is content",
                serde_json::json!({}),
                serde_json::json!({}),
                (false, true),
            ),
            (
                "grid parent: stretched into the area on both axes",
                serde_json::json!({ "display": "grid" }),
                serde_json::json!({}),
                (false, false),
            ),
            (
                "flex row, flexGrow: the main size comes from the free space",
                serde_json::json!({ "display": "flex" }),
                serde_json::json!({ "flexGrow": 1 }),
                (false, false),
            ),
            (
                "flex row, flexBasis: the main size comes from the basis",
                serde_json::json!({ "display": "flex" }),
                serde_json::json!({ "flexBasis": 0 }),
                (false, false),
            ),
            (
                "flex row, flexShrink 0: still content, and it cannot be squeezed",
                serde_json::json!({ "display": "flex" }),
                serde_json::json!({ "flexShrink": 0 }),
                (true, false),
            ),
            (
                "flex row, wrapping: the main axis is still content",
                serde_json::json!({ "display": "flex", "flexWrap": "wrap" }),
                serde_json::json!({}),
                (true, false),
            ),
            (
                "x-only scrollport: `build_host_container` makes it a flex row",
                serde_json::json!({ "overflowX": "scroll" }),
                serde_json::json!({}),
                (true, false),
            ),
            (
                "two-axis scrollport: display stays block",
                serde_json::json!({ "overflow": "scroll" }),
                serde_json::json!({}),
                (false, true),
            ),
            (
                "absolute, no insets on either axis: shrink to fit",
                serde_json::json!({ "display": "flex", "flexDirection": "column" }),
                serde_json::json!({ "position": "absolute" }),
                (true, true),
            ),
            (
                "absolute with both horizontal insets: the insets size it",
                serde_json::json!({ "display": "flex" }),
                serde_json::json!({ "position": "absolute", "left": 0, "right": 0 }),
                (false, true),
            ),
        ];

        for (name, parent_style, own_style, (width, height)) in cases {
            let parent = element("div", parent_style);
            let style = own(own_style);
            assert_eq!(
                content_sized_intrinsic_axes(Some(&parent), Some(&style)),
                crate::motion::IntrinsicAxes { width, height },
                "{name}"
            );
        }
    }

    #[test]
    fn treats_an_unreadable_parent_as_stretched() {
        let style = own(serde_json::json!({}));
        // No parent: the app root is laid out inside GPUIX's full-size wrapper.
        assert_eq!(
            content_sized_intrinsic_axes(None, Some(&style)),
            crate::motion::IntrinsicAxes::default()
        );
        // A custom element lays its children out through its own element, so
        // its style says nothing about them.
        let custom = element("code", serde_json::json!({ "display": "flex" }));
        assert_eq!(
            content_sized_intrinsic_axes(Some(&custom), Some(&style)),
            crate::motion::IntrinsicAxes::default()
        );
        // A `<text>` parent is a host container and reads like a `<div>`.
        let text = element("text", serde_json::json!({ "display": "flex" }));
        assert_eq!(
            content_sized_intrinsic_axes(Some(&text), Some(&style)),
            crate::motion::IntrinsicAxes {
                width: true,
                height: false
            }
        );
    }
}

/// Lay the probe subtree out and read its size.
///
/// What is guaranteed: the probe is never prepainted and never painted, so
/// hitboxes, the dispatch tree, accessibility nodes, painted text, the
/// selection registry and the bounds registry are untouched by it, and its
/// taffy nodes are an orphan root no painted node references. `ctx.measuring`
/// covers what GPUIX itself records during a build: retained transition and
/// motion tracks are read, not advanced, `onHighlight` is not queued, no
/// accessibility host identity is recorded, and nested probes are skipped.
///
/// What it does touch, because it walks the real build path: a descendant
/// custom element's `sync` and `render` run a second time this frame, so an
/// `<input>` refreshes its cached measured layout, an `<img>` creates GPUI
/// `ImgState` and can request an animation frame, and a `<virtual-list>`
/// consumes its pending scroll request (harmless only because its `ListState`
/// is `Rc`-shared with the painted build). GPUI element states are keyed by
/// the same element-id path as the painted element, so the probe borrows and
/// returns them rather than allocating a parallel set, and any state it
/// creates for an element the painted build does not reach is dropped with the
/// frame. This is why the probe is limited to endpoint edges rather than run
/// on every frame.
fn measure_intrinsic_size(
    id: u64,
    probe: crate::motion::IntrinsicProbe,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> crate::motion::IntrinsicSize {
    use gpui::AvailableSpace;

    let crate::motion::IntrinsicProbe {
        style,
        width: measure_width,
        height: measure_height,
    } = probe;
    let measuring = std::mem::replace(&mut ctx.measuring, true);
    let outer_probe = ctx.intrinsic_probe.replace((id, style));
    let mut element = build_element(id, ctx, window, cx);
    ctx.measuring = measuring;
    ctx.intrinsic_probe = outer_probe;

    // A measured axis must be offered unbounded space, or taffy answers with
    // the constraint rather than the content. The other axis keeps the width
    // the element last painted at, so a `height` endpoint wraps its text the
    // way the settled element does; before the first paint there is no such
    // width and max-content stands in.
    let available_width = if measure_width {
        AvailableSpace::MaxContent
    } else {
        crate::automation::get_bounds(id)
            .map(|bounds| AvailableSpace::Definite(gpui::px(bounds.width as f32)))
            .unwrap_or(AvailableSpace::MaxContent)
    };
    let size = element.layout_as_root(
        gpui::size(available_width, AvailableSpace::MaxContent),
        window,
        cx,
    );
    crate::motion::IntrinsicSize {
        width: measure_width.then(|| f64::from(f32::from(size.width))),
        height: measure_height.then(|| f64::from(f32::from(size.height))),
    }
}

/// Substitute the CSS intrinsic sizing keywords (`min-content`, `max-content`,
/// `fit-content`) on this element's dimension props with measured pixel
/// values before the style reaches GPUI.
///
/// Neither GPUI's `Length` nor taffy's flex/block algorithms carry an
/// intrinsic keyword (taffy 0.13 reserves those tags for grid tracks), so the
/// number has to come from a content measurement. The probe mechanism is the
/// one `measure_intrinsic_size` documents: the element is built once more with
/// its keyword props forced back to `auto` and handed to
/// `gpui::AnyElement::layout_as_root` under the available space that defines
/// the keyword (`AvailableSpace::MinContent` / `MaxContent`). The same
/// measured numbers substitute the keyword everywhere it appears on this
/// element — base props and state refinements alike — since both size the same
/// content.
///
/// `fit-content` becomes its CSS definition, `clamp(min-content, stretch,
/// max-content)`, with the stretch term expressed as `100%` of the containing
/// block; taffy resolves that basis at layout time. On the block axis the
/// three keywords all resolve to the content's laid-out height, which is what
/// a browser computes for them there.
///
/// Only the shared host containers are measurable, for the reason
/// `build_element` gives for transition endpoints: a custom element's `render`
/// is not required to be idempotent under re-entry. Everything else falls
/// through to `dimension_to_length`, which maps an unmeasured keyword to
/// `auto`. Inside a measurement pass the keywords fall through the same way —
/// under `MaxContent` available space an `auto` axis already resolves to its
/// content size, and probing from inside a probe would compound builds
/// exponentially in nesting depth.
fn resolve_intrinsic_keywords(
    id: u64,
    style: &mut StyleDesc,
    element_type: &str,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) {
    use crate::style::DimensionValue as Dim;
    use gpui::AvailableSpace;

    fn is_keyword(dim: Option<&Dim>) -> bool {
        matches!(
            dim,
            Some(Dim::MinContent | Dim::MaxContent | Dim::FitContent)
        )
    }

    /// Which measurements this style (base and refinements) asks for:
    /// `(min-content width, max-content width, content height)`.
    fn measurement_needs(style: &StyleDesc) -> (bool, bool, bool) {
        let widths = [
            style.width.as_ref(),
            style.min_width.as_ref(),
            style.max_width.as_ref(),
        ];
        let heights = [
            style.height.as_ref(),
            style.min_height.as_ref(),
            style.max_height.as_ref(),
        ];
        let mut min_w = widths
            .iter()
            .any(|dim| matches!(dim, Some(Dim::MinContent | Dim::FitContent)));
        let mut max_w = widths
            .iter()
            .any(|dim| matches!(dim, Some(Dim::MaxContent | Dim::FitContent)));
        let mut height = heights.iter().any(|dim| is_keyword(*dim));
        for refinement in [
            style.hover.as_deref(),
            style.hover_within.as_deref(),
            style.active.as_deref(),
            style.focus.as_deref(),
            style.focus_visible.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let (nested_min_w, nested_max_w, nested_height) = measurement_needs(refinement);
            min_w |= nested_min_w;
            max_w |= nested_max_w;
            height |= nested_height;
        }
        (min_w, max_w, height)
    }

    let (needs_min_width, needs_max_width, needs_height) = measurement_needs(style);
    if !(needs_min_width || needs_max_width || needs_height) {
        return;
    }
    if ctx.measuring || !matches!(element_type, "div" | "text") {
        return;
    }

    /// The keyword props forced back to their pre-keyword defaults, so the
    /// probe answers with the content's own size instead of the constraint.
    fn neutralize_keywords(style: &mut StyleDesc) {
        for dim in [&mut style.width, &mut style.height] {
            if is_keyword(dim.as_ref()) {
                *dim = Some(Dim::Auto);
            }
        }
        for dim in [
            &mut style.min_width,
            &mut style.max_width,
            &mut style.min_height,
            &mut style.max_height,
        ] {
            if is_keyword(dim.as_ref()) {
                *dim = None;
            }
        }
    }

    fn measure(
        id: u64,
        probe_style: StyleDesc,
        available: gpui::Size<AvailableSpace>,
        ctx: &mut BuildCtx,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<GpuixView>,
    ) -> gpui::Size<gpui::Pixels> {
        let measuring = std::mem::replace(&mut ctx.measuring, true);
        let outer_probe = ctx.intrinsic_probe.replace((id, probe_style));
        let mut element = build_element(id, ctx, window, cx);
        ctx.measuring = measuring;
        ctx.intrinsic_probe = outer_probe;
        element.layout_as_root(available, window, cx)
    }

    let mut width_probe = style.clone();
    neutralize_keywords(&mut width_probe);
    let min_width = needs_min_width.then(|| {
        let size = measure(
            id,
            width_probe.clone(),
            gpui::size(AvailableSpace::MinContent, AvailableSpace::MaxContent),
            ctx,
            window,
            cx,
        );
        f64::from(f32::from(size.width))
    });
    let max_width = needs_max_width.then(|| {
        let size = measure(
            id,
            width_probe.clone(),
            gpui::size(AvailableSpace::MaxContent, AvailableSpace::MaxContent),
            ctx,
            window,
            cx,
        );
        f64::from(f32::from(size.width))
    });

    fn substitute_width(dim: &mut Option<Dim>, min_width: Option<f64>, max_width: Option<f64>) {
        let replaced = match dim {
            Some(Dim::MinContent) => min_width.map(Dim::Pixels),
            Some(Dim::MaxContent) => max_width.map(Dim::Pixels),
            Some(Dim::FitContent) => min_width.zip(max_width).map(|(min, max)| Dim::Clamp {
                source: "fit-content".to_owned(),
                min: Box::new(Dim::Pixels(min)),
                preferred: Box::new(Dim::Percentage(1.0)),
                max: Box::new(Dim::Pixels(max)),
            }),
            _ => return,
        };
        *dim = replaced;
    }

    fn substitute_widths(style: &mut StyleDesc, min_width: Option<f64>, max_width: Option<f64>) {
        for dim in [&mut style.width, &mut style.min_width, &mut style.max_width] {
            substitute_width(dim, min_width, max_width);
        }
        for refinement in [
            style.hover.as_deref_mut(),
            style.hover_within.as_deref_mut(),
            style.active.as_deref_mut(),
            style.focus.as_deref_mut(),
            style.focus_visible.as_deref_mut(),
        ]
        .into_iter()
        .flatten()
        {
            substitute_widths(refinement, min_width, max_width);
        }
    }
    substitute_widths(style, min_width, max_width);

    if !needs_height {
        return;
    }
    // The content height depends on the width the content wraps at, so the
    // probe is offered the width this frame resolves to: the element's own
    // definite width when it has one (the width props above are already
    // substituted), otherwise the width it last painted at, the same
    // convention `measure_intrinsic_size` uses. Before the first paint,
    // max-content stands in.
    let mut height_probe = style.clone();
    neutralize_keywords(&mut height_probe);
    let available_width = match style.width {
        Some(Dim::Pixels(width)) => AvailableSpace::Definite(gpui::px(width as f32)),
        _ => crate::automation::get_bounds(id)
            .map(|bounds| AvailableSpace::Definite(gpui::px(bounds.width as f32)))
            .unwrap_or(AvailableSpace::MaxContent),
    };
    let size = measure(
        id,
        height_probe,
        gpui::size(available_width, AvailableSpace::MaxContent),
        ctx,
        window,
        cx,
    );
    let content_height = f64::from(f32::from(size.height));

    fn substitute_heights(style: &mut StyleDesc, content_height: f64) {
        for dim in [
            &mut style.height,
            &mut style.min_height,
            &mut style.max_height,
        ] {
            if is_keyword(dim.as_ref()) {
                *dim = Some(Dim::Pixels(content_height));
            }
        }
        for refinement in [
            style.hover.as_deref_mut(),
            style.hover_within.as_deref_mut(),
            style.active.as_deref_mut(),
            style.focus.as_deref_mut(),
            style.focus_visible.as_deref_mut(),
        ]
        .into_iter()
        .flatten()
        {
            substitute_heights(refinement, content_height);
        }
    }
    substitute_heights(style, content_height);
}

fn default_flex_none_for_parent_layout(style: &mut StyleDesc) {
    style.default_flex_none = true;
    for refinement in [
        &mut style.hover,
        &mut style.hover_within,
        &mut style.active,
        &mut style.focus,
        &mut style.focus_visible,
    ] {
        if let Some(refinement) = refinement.as_deref_mut() {
            default_flex_none_for_parent_layout(refinement);
        }
    }
}

fn build_virtual_list(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&StyleDesc>,
    hover_within: bool,
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
    let focused_target = ctx
        .focus_handles
        .iter()
        .find_map(|(element_id, handle)| {
            if handle.is_focused(window) {
                virtual_row_ancestor(ctx.tree, element.id, *element_id)
                    .map(|row_id| (*element_id, row_id))
            } else {
                None
            }
        })
        .or_else(|| {
            ctx.focus_handles.keys().find_map(|element_id| {
                if ctx
                    .tree
                    .elements
                    .get(element_id)
                    .is_some_and(|element| element.auto_focus)
                {
                    virtual_row_ancestor(ctx.tree, element.id, *element_id)
                        .map(|row_id| (*element_id, row_id))
                } else {
                    None
                }
            })
        });
    let pending_reveal_origin =
        focused_target.and_then(
            |(target_id, _)| match ctx.focus_scroll_anchors.get(&target_id) {
                Some(FocusScrollAnchor::VirtualList {
                    list_id,
                    pending_reveal_origin,
                    ..
                }) if *list_id == element.id => Some(pending_reveal_origin.clone()),
                _ => None,
            },
        );
    let config = VirtualListConfig::from_element(element);
    let window_start = if config.item_count.is_some() {
        window_start_from_element(element)
    } else {
        0
    };
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
            if let Some((_, row_id)) =
                focused_target.filter(|(_, row_id)| !entry.seen_rows.contains(row_id))
            {
                if let Some(index) = entry.logical_index_of(row_id) {
                    if let Some(pending_reveal_origin) = &pending_reveal_origin {
                        *pending_reveal_origin.lock().unwrap() =
                            Some(entry.state.scroll_px_offset_for_scrollbar().y);
                    }
                    entry.state.scroll_to_reveal_item(index);
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
            if let Some((_, row_id)) = focused_target {
                if let Some(index) = entry.logical_index_of(row_id) {
                    if let Some(pending_reveal_origin) = &pending_reveal_origin {
                        *pending_reveal_origin.lock().unwrap() =
                            Some(entry.state.scroll_px_offset_for_scrollbar().y);
                    }
                    entry.state.scroll_to_reveal_item(index);
                }
            }
            entry.state.clone()
        }
    };

    // Queued scrolls apply here, after `sync` spliced this frame's child
    // changes, so the indices JS computed against its committed child list are
    // the indices the splice-adjusted ListState sees.
    if let Some(offset) =
        PENDING_VIRTUAL_LIST_SCROLLS.with(|cell| cell.borrow_mut().remove(&element.id))
    {
        list_state.scroll_to(offset);
    }

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
    // Cloned, not copied: gpui runs this processor once per requested row, so
    // the captured value must survive every call.
    let inherited = ctx.inherited.clone();
    let render_item = cx.processor(move |view, index: usize, window, cx| {
        let Some(entry) = view.virtual_lists.get(&list_id) else {
            return unmounted_virtual_row(1.0);
        };
        let Some(child_id) = entry.child_at(index) else {
            // Empty measures as 0 and poisons ListState. Keep the estimate.
            return unmounted_virtual_row(entry.config.estimated_item_height.unwrap_or(1.0));
        };
        view.build_virtual_child(list_id, index, child_id, inherited.clone(), window, cx)
    });
    let mut list =
        gpui::list(list_state, render_item).with_sizing_behavior(gpui::ListSizingBehavior::Auto);
    if let Some(style) = style {
        list = apply_styles(list, style);
        if hover_within {
            if let Some(hover_within_style) = style.hover_within.as_deref() {
                list = apply_styles(list, hover_within_style);
            }
        }
    }
    if let Some(group) = style.and_then(|style| style.hover_group.as_deref()) {
        // `gpui::List` is Styled but has no interactive identity. A transparent
        // stateful surface gives the retained virtual-list node the same group
        // hitbox/state contract as every other hoverGroup source while the list
        // continues to own its declared layout and scrolling styles.
        let id = element.id;
        let mut surface = gpui::div()
            .id(gpui::ElementId::Integer(id))
            .relative()
            .group(gpui::SharedString::from(group.to_owned()))
            .child(list)
            .child(crate::automation::bounds_tracker(id, None, None))
            .on_hover(cx.listener(move |view, is_hovered: &bool, _window, cx| {
                if view
                    .interactive_style_states
                    .entry(id)
                    .or_default()
                    .set_hovered(*is_hovered)
                {
                    cx.notify();
                }
            }));
        if style.and_then(|style| style.pointer_events.as_deref()) == Some("none") {
            surface = surface.ignore_mouse();
        }
        return surface.into_any_element();
    }
    list.into_any_element()
}

fn unmounted_virtual_row(height: f32) -> gpui::AnyElement {
    use gpui::prelude::*;
    gpui::div().h(gpui::px(height.max(1.0))).w_full().into_any()
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

#[derive(Clone, Copy)]
enum ScrollAncestor {
    Overflow(u64),
    VirtualList(u64),
}

/// How far a reveal scrolls, mirroring the DOM's `scrollIntoView` `block`.
/// `Start` is the DOM default; `Nearest` is what programmatic focus uses.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RevealAlignment {
    Nearest,
    Start,
}

/// Flip gpui's negative scroll offset into the DOM's positive one. Subtracting
/// rather than negating keeps an unscrolled element at `0` instead of `-0`,
/// which `Object.is` and `toBe` treat as a different number.
fn dom_scroll_offset(offset: gpui::Pixels) -> f64 {
    f64::from(0.0f32 - f32::from(offset))
}

/// Web-shaped scroll geometry for one scrollable element, as
/// `[scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight]`.
///
/// The offsets are the sign-flipped gpui offset: gpui stores how far the content
/// has moved up/left (negative), the DOM reports how far the viewport has moved
/// down/right (positive). gpui's max offset is the overflow past the viewport, so
/// the scroll extent is the viewport plus that overflow.
///
/// The four extents round: they are `long` in the DOM's `Element` IDL, unlike
/// the two offsets, which are `unrestricted double` and keep their fraction.
pub(crate) fn scroll_handle_metrics(handle: &gpui::ScrollHandle) -> [f64; 6] {
    let offset = handle.offset();
    let max = handle.max_offset();
    let viewport = handle.bounds().size;
    [
        dom_scroll_offset(offset.x),
        dom_scroll_offset(offset.y),
        dom_extent(viewport.width + max.x),
        dom_extent(viewport.height + max.y),
        dom_extent(viewport.width),
        dom_extent(viewport.height),
    ]
}

/// One of the `long`-typed `Element` extents: `scrollWidth`, `scrollHeight`,
/// `clientWidth`, `clientHeight`. The DOM rounds these to whole pixels.
fn dom_extent(pixels: gpui::Pixels) -> f64 {
    f64::from(f32::from(pixels)).round()
}

/// The same geometry for a `<virtual-list>`, whose extent comes from measured
/// and estimated row heights. Lists scroll on one axis only, so the horizontal
/// values report an unscrollable viewport.
pub(crate) fn virtual_list_metrics(state: &gpui::ListState) -> [f64; 6] {
    let offset = state.scroll_px_offset_for_scrollbar();
    let max = state.max_offset_for_scrollbar();
    let viewport = state.viewport_bounds().size;
    [
        0.0,
        dom_scroll_offset(offset.y),
        dom_extent(viewport.width),
        dom_extent(viewport.height + max.y),
        dom_extent(viewport.width),
        dom_extent(viewport.height),
    ]
}

#[derive(Clone, Copy)]
pub(crate) enum FocusDirection {
    Next,
    Previous,
}

fn is_overflow_scroller(element: &crate::retained_tree::RetainedElement) -> bool {
    element.style.as_deref().is_some_and(|style| {
        [
            style.overflow.as_deref(),
            style.overflow_x.as_deref(),
            style.overflow_y.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| value == "scroll")
    })
}

/// Whether the element declares a vertical scroll viewport, resolved the way
/// `build_host_container` resolves it: the axis property overrides the
/// shorthand.
fn scrolls_vertically(element: &crate::retained_tree::RetainedElement) -> bool {
    element.style.as_deref().is_some_and(|style| {
        style.overflow_y.as_deref().or(style.overflow.as_deref()) == Some("scroll")
    })
}

fn nearest_scroll_ancestor(tree: &RetainedTree, element_id: u64) -> Option<ScrollAncestor> {
    let mut current = element_id;
    loop {
        let parent_id = tree.elements.get(&current)?.parent?;
        let parent = tree.elements.get(&parent_id)?;
        if parent.element_type == "virtual-list" {
            return Some(ScrollAncestor::VirtualList(parent_id));
        }
        if is_overflow_scroller(parent) {
            return Some(ScrollAncestor::Overflow(parent_id));
        }
        current = parent_id;
    }
}

fn direct_child_index(tree: &RetainedTree, ancestor_id: u64, element_id: u64) -> Option<usize> {
    let mut current = element_id;
    loop {
        let parent_id = tree.elements.get(&current)?.parent?;
        if parent_id == ancestor_id {
            return tree
                .elements
                .get(&ancestor_id)?
                .children
                .iter()
                .position(|child| *child == current);
        }
        current = parent_id;
    }
}

/// The index `gpui::ScrollHandle::scroll_to_item` needs for the scroller's
/// `index`th retained child.
///
/// gpui counts the children it painted, and `build_host_container` paints up to
/// three of its own before the retained ones, in this order:
///
/// 1. the automation bounds tracker, on every element;
/// 2. the scroll-position tracker, on a scroller carrying an `onScroll`
///    listener — the same `events.contains("scroll")` gate that attaches it;
/// 3. the element's own text, when it has `content`.
///
/// The index is only ever *used* on an element that owns a
/// `gpui::ScrollHandle`, so the scroll tracker's other condition (the element
/// scrolls at all) holds wherever the answer is acted on. The reveal path
/// computes it before looking the handle up, and reaches a scroller through the
/// looser `is_overflow_scroller`, so it can be computed for an element that
/// painted no tracker — and discarded a line later.
///
/// `None` leaves the reveal unrequested rather than scrolling to an unrelated
/// row, and covers the two indices that name no painted child:
///
/// - a `<text>` scroller, whose whole subtree `build_host_container` flattens
///   into one inline element, so gpui paints a single run where the retained
///   tree has children;
/// - an index past the last child. gpui keeps an unsatisfiable request pending
///   instead of dropping it, so a later frame that grows the child list would
///   apply it as an unexplained jump.
///
/// Both answer with `None` rather than an error, against this codebase's habit
/// of failing loudly, because the common way to reach them is benign: JS
/// computed the index against items it holds and a frame has not committed them
/// yet. Throwing would punish that one-frame race, and the DOM has no throw
/// here either — `scrollIntoView()` on an element with nothing to reveal is a
/// no-op.
fn painted_index_of_child(tree: &RetainedTree, scroller_id: u64, index: usize) -> Option<usize> {
    let scroller = tree.elements.get(&scroller_id)?;
    if scroller.element_type == "text" || index >= scroller.children.len() {
        return None;
    }
    let leading = 1
        + usize::from(scroller.events.contains("scroll"))
        + usize::from(scroller.content.is_some());
    Some(index + leading)
}

/// The index `gpui::ScrollHandle::scroll_to_item` needs for the scroller child
/// that contains `element_id`.
fn painted_child_index(tree: &RetainedTree, scroller_id: u64, element_id: u64) -> Option<usize> {
    let index = direct_child_index(tree, scroller_id, element_id)?;
    painted_index_of_child(tree, scroller_id, index)
}

/// Reveal the scroller's `index`th retained child through its scroll handle,
/// which counts painted children rather than retained ones.
fn scroll_handle_to_child(
    handle: &gpui::ScrollHandle,
    tree: &RetainedTree,
    scroller_id: u64,
    index: usize,
) {
    if let Some(painted) = painted_index_of_child(tree, scroller_id, index) {
        handle.scroll_to_item(painted);
    }
}

#[cfg(test)]
mod painted_child_index_tests {
    use super::*;

    fn tree_from(batch: serde_json::Value) -> RetainedTree {
        let bytes = serde_json::to_vec(&batch).unwrap();
        let mut tree = RetainedTree::new();
        apply_batch_to_tree_with_diagnostics(&mut tree, &bytes, false).expect("valid batch");
        tree
    }

    #[test]
    fn div_scroller_child_index_skips_the_automation_tracker() {
        let tree = tree_from(serde_json::json!([
            ["createElement", 1, "div"],
            ["createElement", 2, "div"],
            ["createElement", 3, "div"],
            ["appendChild", 1, 2],
            ["appendChild", 1, 3],
            ["setRoot", 1]
        ]));

        assert_eq!(painted_child_index(&tree, 1, 2), Some(1));
        assert_eq!(painted_child_index(&tree, 1, 3), Some(2));
    }

    #[test]
    fn flattened_text_scroller_has_no_painted_child_to_scroll_to() {
        let tree = tree_from(serde_json::json!([
            ["createElement", 1, "text"],
            ["createElement", 2, "text"],
            ["createElement", 3, "text"],
            ["setText", 2, "before "],
            ["setText", 3, "target"],
            ["appendChild", 1, 2],
            ["appendChild", 1, 3],
            ["setRoot", 1]
        ]));

        assert_eq!(painted_child_index(&tree, 1, 3), None);
    }

    #[test]
    fn child_index_from_the_public_api_skips_the_automation_tracker_too() {
        let tree = tree_from(serde_json::json!([
            ["createElement", 1, "div"],
            ["createElement", 2, "div"],
            ["createElement", 3, "div"],
            ["appendChild", 1, 2],
            ["appendChild", 1, 3],
            ["setRoot", 1]
        ]));

        assert_eq!(painted_index_of_child(&tree, 1, 0), Some(1));
        assert_eq!(painted_index_of_child(&tree, 1, 1), Some(2));
    }

    /// An `onScroll` listener puts a second canvas of gpui's own in front of
    /// the retained children, so the same child moves one further along.
    #[test]
    fn an_onscroll_listener_adds_a_second_leading_child() {
        let mut tree = tree_from(serde_json::json!([
            ["createElement", 1, "div"],
            ["createElement", 2, "div"],
            ["createElement", 3, "div"],
            ["appendChild", 1, 2],
            ["appendChild", 1, 3],
            ["setRoot", 1]
        ]));
        tree.set_event_listener(1, "scroll".to_string(), true);

        assert_eq!(painted_index_of_child(&tree, 1, 0), Some(2));
        assert_eq!(painted_index_of_child(&tree, 1, 1), Some(3));
        assert_eq!(painted_child_index(&tree, 1, 3), Some(3));

        // The scroller's own text paints after both trackers.
        tree.set_text(1, "leading text".to_string());
        assert_eq!(painted_index_of_child(&tree, 1, 0), Some(3));

        // A listener the scroller does not carry moves nothing.
        tree.set_event_listener(1, "scroll".to_string(), false);
        tree.set_event_listener(1, "click".to_string(), true);
        assert_eq!(painted_index_of_child(&tree, 1, 0), Some(2));
    }

    /// gpui holds an unsatisfiable `scroll_to_item` request until a frame can
    /// satisfy it, so a past-the-end index must not be requested at all.
    #[test]
    fn an_index_past_the_last_child_names_no_painted_child() {
        let tree = tree_from(serde_json::json!([
            ["createElement", 1, "div"],
            ["createElement", 2, "div"],
            ["createElement", 3, "div"],
            ["appendChild", 1, 2],
            ["appendChild", 1, 3],
            ["setRoot", 1]
        ]));

        assert_eq!(painted_index_of_child(&tree, 1, 1), Some(2));
        assert_eq!(painted_index_of_child(&tree, 1, 2), None);
        assert_eq!(painted_index_of_child(&tree, 1, 6), None);
    }
}

fn virtual_list_ancestor_id(tree: &RetainedTree, element_id: u64) -> Option<u64> {
    let mut current = element_id;
    loop {
        let parent_id = tree.elements.get(&current)?.parent?;
        let parent = tree.elements.get(&parent_id)?;
        if parent.element_type == "virtual-list" {
            return Some(parent_id);
        }
        current = parent_id;
    }
}

fn has_interactive_behavior(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&StyleDesc>,
) -> bool {
    let scrolls = style.is_some_and(|style| {
        [
            style.overflow.as_deref(),
            style.overflow_x.as_deref(),
            style.overflow_y.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| value == "scroll")
    });

    !element.events.is_empty()
        || element.custom_props.contains_key("tabIndex")
        || element.custom_props.get("autoFocus") == Some(&serde_json::Value::Bool(true))
        || style.is_some_and(|style| {
            style.cursor.is_some() || style.hover.is_some() || style.active.is_some()
        })
        || scrolls
}

fn tracks_mouse_hover_events(
    element: &crate::retained_tree::RetainedElement,
    tree: &RetainedTree,
) -> bool {
    let mut current = Some(element.id);
    while let Some(id) = current {
        let Some(current_element) = tree.elements.get(&id) else {
            return false;
        };
        if current_element.events.contains("mouseEnter")
            || current_element.events.contains("mouseLeave")
        {
            return true;
        }
        current = current_element.parent;
    }
    false
}

fn tracks_pointer_event(
    element: &crate::retained_tree::RetainedElement,
    tree: &RetainedTree,
    event_type: &str,
) -> bool {
    let mut current = Some(element.id);
    while let Some(id) = current {
        let Some(current_element) = tree.elements.get(&id) else {
            return false;
        };
        if current_element.events.contains(event_type) {
            return true;
        }
        current = current_element.parent;
    }
    false
}

fn accessibility_hidden_in_ancestry(tree: &RetainedTree, element_id: u64) -> bool {
    let mut current = Some(element_id);
    while let Some(id) = current {
        let Some(element) = tree.elements.get(&id) else {
            return false;
        };
        if crate::accessibility::is_hidden(element) {
            return true;
        }
        current = element.parent;
    }
    false
}

fn action_disabled_in_ancestry(tree: &RetainedTree, element_id: u64) -> bool {
    let mut current = Some(element_id);
    while let Some(id) = current {
        let Some(element) = tree.elements.get(&id) else {
            return false;
        };
        if crate::accessibility::is_action_disabled(element) {
            return true;
        }
        current = element.parent;
    }
    false
}

fn apply_click_handler<E>(
    mut el: E,
    element: &crate::retained_tree::RetainedElement,
    ctx: &BuildCtx,
) -> E
where
    E: gpui::StatefulInteractiveElement,
{
    let tracks_click = tracks_pointer_event(element, ctx.tree, "click");
    let tracks_double_click = tracks_pointer_event(element, ctx.tree, "doubleClick");
    if (!tracks_click && !tracks_double_click) || action_disabled_in_ancestry(ctx.tree, element.id)
    {
        return el;
    }

    let activates_on_space = element
        .custom_props
        .get("activationKind")
        .and_then(serde_json::Value::as_str)
        != Some("anchor");
    let callback = ctx.event_callback.clone();
    let id = element.id;
    el = el.on_click(move |click_event, _window, cx| {
        if !activates_on_space
            && matches!(
                click_event,
                gpui::ClickEvent::Keyboard(event)
                    if event.button == gpui::KeyboardButton::Space
            )
        {
            return;
        }
        let stop_native_propagation = !matches!(click_event, gpui::ClickEvent::Keyboard(_));
        emit_event_full(&callback, id, "click", |payload| {
            let (x, y) = point_to_xy(click_event.position());
            payload.x = Some(x);
            payload.y = Some(y);
            payload.modifiers = Some(click_event.modifiers().into());
            payload.click_count = Some(click_event.click_count() as u32);
            payload.is_right_click = Some(click_event.is_right_click());
            payload.button = Some(match click_event {
                gpui::ClickEvent::Mouse(event) => mouse_button_to_u32(event.down.button),
                gpui::ClickEvent::Keyboard(_) | gpui::ClickEvent::Touch(_) => 0,
            });
            payload.input_source = Some(
                match click_event {
                    gpui::ClickEvent::Mouse(_) => "mouse",
                    gpui::ClickEvent::Keyboard(_) => "keyboard",
                    gpui::ClickEvent::Touch(_) => "touch",
                }
                .to_string(),
            );
        });
        if stop_native_propagation {
            cx.stop_propagation();
        }
    });
    el
}

fn captures_pointer_in_ancestry(
    element: &crate::retained_tree::RetainedElement,
    tree: &RetainedTree,
) -> bool {
    let mut current = Some(element.id);
    while let Some(id) = current {
        let Some(current_element) = tree.elements.get(&id) else {
            return false;
        };
        if current_element.events.contains("mouseDown")
            && current_element.events.contains("mouseMove")
        {
            return true;
        }
        current = current_element.parent;
    }
    false
}

fn is_hover_target_descendant(tree: &RetainedTree, descendant: u64, ancestor: u64) -> bool {
    let mut current = Some(descendant);
    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        current = tree.elements.get(&id).and_then(|element| element.parent);
    }
    false
}

fn scroll_position_tracker(
    id: u64,
    handle: gpui::ScrollHandle,
    offsets: Arc<Mutex<HashMap<u64, gpui::Point<gpui::Pixels>>>>,
    callback: Option<EventCallback>,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    gpui::canvas(
        |bounds, _, _| bounds,
        move |_, _, _, _| {
            let offset = handle.offset();
            let changed = {
                let mut offsets = offsets.lock().unwrap();
                offsets
                    .insert(id, offset)
                    .is_some_and(|previous| previous != offset)
            };
            if changed {
                emit_event_full(&callback, id, "scroll", |_| {});
            }
        },
    )
    .absolute()
    .size_full()
    .into_any_element()
}

/// The one builder for `<div>` and `<text>`.
///
/// Both get the same stable GPUI id, so gpui keeps their interactive element
/// state (hover, active, pointer capture, scroll, accessibility node) across
/// frames, and both wire the whole shared `Props` surface.
pub(crate) fn build_host_container(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&StyleDesc>,
    ctx: &mut BuildCtx,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<GpuixView>,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    let flattened_text = (element.element_type == "text").then(|| flatten_text(element, ctx));
    let name_from_contents = accessible_name_from_contents(element, ctx);

    let transition_hover =
        style.is_some_and(|style| style.transition.is_some() && style.hover.is_some());
    let transition_active =
        style.is_some_and(|style| style.transition.is_some() && style.active.is_some());
    // Host ids are already unique per renderer. Keeping them as integers avoids
    // allocating a formatted name for every `<div>` and `<text>` on every frame.
    let mut el = gpui::div().id(gpui::ElementId::Integer(element.id));
    let tracks_hover =
        style.is_some_and(|style| style.hover.is_some() || style.hover_group.is_some());
    let tracks_active = style.is_some_and(|style| style.active.is_some());
    let tracks_mouse_hover = tracks_mouse_hover_events(element, ctx.tree);

    if let Some(style) = style {
        el = apply_interactive_styles(el, style);
    }

    if style.and_then(|style| style.pointer_events.as_deref()) == Some("none") {
        el = el.ignore_mouse();
    } else if crate::style::should_occlude(style, has_interactive_behavior(element, style)) {
        // BlockMouse (occlude) stops the hit test. The parent scroller
        // then never sees the wheel. In-flow interactive nodes use
        // BlockMouseExceptScroll. Keep occlude for overlays that steal
        // the pointer: absolute, fixed, or pointerEvents: "auto".
        let steal_scroll =
            style.is_some_and(|style| style.pointer_events.as_deref() == Some("auto"));
        el = if steal_scroll {
            el.occlude()
        } else {
            el.block_mouse_except_scroll()
        };
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
    let mut scroll_tracker = None;
    if let Some(style) = style {
        // Resolve each axis: axis-specific overrides shorthand.
        let resolved_x = style.overflow_x.as_deref().or(style.overflow.as_deref());
        let resolved_y = style.overflow_y.as_deref().or(style.overflow.as_deref());

        let needs_scroll_x = resolved_x == Some("scroll");
        let needs_scroll_y = resolved_y == Some("scroll");

        if needs_scroll_x && needs_scroll_y {
            el = el.overflow_scroll();
            // GPUI zeroes the smaller of the two deltas by default, so one
            // diagonal wheel moves one axis. A browser moves both, and a
            // two-axis container is exactly where a user expects that.
            el.style().allow_concurrent_scroll = Some(true);
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
                .or_insert_with(gpui::ScrollHandle::new)
                .clone();
            el = el.track_scroll(&handle);

            if element.events.contains("scroll") {
                ctx.scroll_event_offsets
                    .lock()
                    .unwrap()
                    .entry(element.id)
                    .or_insert_with(|| handle.offset());
                scroll_tracker = Some(scroll_position_tracker(
                    element.id,
                    handle,
                    ctx.scroll_event_offsets.clone(),
                    ctx.event_callback.clone(),
                ));
            } else {
                ctx.scroll_event_offsets.lock().unwrap().remove(&element.id);
            }
        } else {
            // Element is no longer scrollable — remove stale handle.
            ctx.scroll_handles.remove(&element.id);
            ctx.scroll_event_offsets.lock().unwrap().remove(&element.id);
        }
    } else {
        // No style at all — remove stale handle if it existed.
        ctx.scroll_handles.remove(&element.id);
        ctx.scroll_event_offsets.lock().unwrap().remove(&element.id);
    }

    // If a FocusHandle was pre-created for this element (by sync_focus_handles),
    // attach it via track_focus. This makes the element focusable — clicking it
    // or tabbing to it gives it keyboard focus. The handle persists across renders
    // because it's stored in GpuixView::focus_handles.
    if style.and_then(|style| style.position.as_deref()).is_none() {
        el = el.relative();
    }
    let paint_bounds_listener = focus_paint_bounds_listener(element.id, ctx);
    el = el.child(crate::automation::bounds_tracker(
        element.id,
        selection_start_flag(style),
        paint_bounds_listener,
    ));
    if let Some(scroll_tracker) = scroll_tracker {
        el = el.child(scroll_tracker);
    }

    let native_disabled =
        crate::accessibility::is_native_disabled(element) || ctx.inherited.accessibility_hidden;
    if !native_disabled {
        if let Some(handle) = ctx.focus_handles.get(&element.id) {
            el = el.track_focus(handle);
        }
    }
    if let Some(anchor) = ctx
        .focus_scroll_anchors
        .get(&element.id)
        .and_then(FocusScrollAnchor::overflow_anchor)
    {
        el = el.anchor_scroll(Some(anchor.clone()));
    }
    el = crate::accessibility::apply(
        el,
        ctx.tree,
        element,
        ctx.event_callback,
        ctx.focus_handles.get(&element.id),
        ctx.inherited.accessibility_hidden,
        name_from_contents.as_deref(),
        // Painted text carries its own value on the node that draws it.
        None,
    );
    if !native_disabled {
        if let Some(tab_index) = element
            .custom_props
            .get("tabIndex")
            .and_then(|value| value.as_i64())
            .and_then(|index| isize::try_from(index).ok())
        {
            el = el.tab_index(tab_index).tab_stop(tab_index >= 0);
        }
    }

    // Wire up events.
    // Some events (on_hover, on_click) require a stateful element (.id()),
    // which we already set above. Others (on_mouse_down, on_key_down) work
    // on any InteractiveElement.
    let id = element.id;
    for event_type in &element.events {
        let callback = ctx.event_callback.clone();
        match event_type.as_str() {
            // ── Click ────────────────────────────────────────────
            // Primary button only, like the DOM. Right and middle clicks go to
            // `onAuxClick`, and `onMouseDown` sees every button.
            "click" => {}

            // ── Aux click (non-primary), like the DOM `auxclick` ──
            "auxClick" => {}

            // ── Mouse down (all buttons) ─────────────────────────
            "mouseDown" => {}

            // ── Mouse up (all buttons) ───────────────────────────
            "mouseUp" => {}

            // ── Mouse move ───────────────────────────────────────
            "mouseMove" => {}

            // ── Hover (mouseEnter + mouseLeave) ──────────────────
            // One combined listener below owns React enter/leave events and
            // native transition retargeting. GPUI stores only one hover listener.
            "mouseEnter" | "mouseLeave" => {}

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

            // ── Wheel ────────────────────────────────────────────
            "wheel" => {
                el = el.on_scroll_wheel(move |scroll_event, _window, _cx| {
                    emit_event_full(&callback, id, "wheel", |p| {
                        let (x, y) = point_to_xy(scroll_event.position);
                        p.x = Some(x);
                        p.y = Some(y);
                        apply_wheel_delta(p, scroll_event);
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

    // Every painted descendant of a pointer listener becomes a native source.
    // GPUI's hit test picks the deepest source; React then performs the normal
    // capture/target/bubble walk from that source to the listener's ancestor.
    // This preserves an interactive child's target identity while allowing an
    // inert background-painted child to reach an ancestor listener.
    el = apply_click_handler(el, element, ctx);

    if tracks_pointer_event(element, ctx.tree, "auxClick") {
        let callback = ctx.event_callback.clone();
        let id = element.id;
        el = el.on_aux_click(move |click_event, _window, cx| {
            emit_event_full(&callback, id, "auxClick", |p| {
                let (x, y) = point_to_xy(click_event.position());
                p.x = Some(x);
                p.y = Some(y);
                p.modifiers = Some(click_event.modifiers().into());
                p.click_count = Some(click_event.click_count() as u32);
                p.is_right_click = Some(click_event.is_right_click());
                p.button = Some(match click_event {
                    gpui::ClickEvent::Mouse(event) => mouse_button_to_u32(event.down.button),
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
            cx.stop_propagation();
        });
    }

    // `contextMenu` rides the mouse-down listener: macOS opens a context menu
    // on the press, so the DOM order is mousedown, contextmenu, mouseup,
    // auxclick. React synthesizes it from the right-button payload.
    let tracks_mouse_down = tracks_pointer_event(element, ctx.tree, "mouseDown");
    let tracks_context_menu = tracks_pointer_event(element, ctx.tree, "contextMenu");
    if tracks_mouse_down || tracks_context_menu {
        for &button in mouse_down_button_set(tracks_mouse_down) {
            let callback = ctx.event_callback.clone();
            let id = element.id;
            el = el.on_mouse_down(button, move |mouse_event, _window, cx| {
                emit_event_full(&callback, id, "mouseDown", |p| {
                    let (x, y) = point_to_xy(mouse_event.position);
                    p.x = Some(x);
                    p.y = Some(y);
                    p.button = Some(mouse_button_to_u32(mouse_event.button));
                    p.click_count = Some(mouse_event.click_count as u32);
                    p.modifiers = Some(mouse_event.modifiers.into());
                });
                cx.stop_propagation();
            });
        }
    }

    if tracks_pointer_event(element, ctx.tree, "mouseUp") {
        for &button in &[
            gpui::MouseButton::Left,
            gpui::MouseButton::Middle,
            gpui::MouseButton::Right,
        ] {
            let callback = ctx.event_callback.clone();
            let id = element.id;
            el = el.on_mouse_up(button, move |mouse_event, _window, cx| {
                emit_event_full(&callback, id, "mouseUp", |p| {
                    let (x, y) = point_to_xy(mouse_event.position);
                    p.x = Some(x);
                    p.y = Some(y);
                    p.button = Some(mouse_button_to_u32(mouse_event.button));
                    p.click_count = Some(mouse_event.click_count as u32);
                    p.modifiers = Some(mouse_event.modifiers.into());
                });
                cx.stop_propagation();
            });
        }
    }

    if tracks_pointer_event(element, ctx.tree, "mouseMove") {
        let callback = ctx.event_callback.clone();
        let id = element.id;
        el = el.on_mouse_move(move |mouse_event, _window, cx| {
            emit_event_full(&callback, id, "mouseMove", |p| {
                let (x, y) = point_to_xy(mouse_event.position);
                p.x = Some(x);
                p.y = Some(y);
                p.modifiers = Some(mouse_event.modifiers.into());
                p.pressed_button = mouse_event.pressed_button.map(mouse_button_to_u32);
            });
            cx.stop_propagation();
        });
    }

    if captures_pointer_in_ancestry(element, ctx.tree) {
        el = el.capture_pointer();
    }

    if transition_hover || tracks_hover || tracks_mouse_hover {
        let id = element.id;
        el = el.on_hover(cx.listener(move |view, is_hovered: &bool, window, cx| {
            let transition_changed = transition_hover
                && view
                    .transition_states
                    .get_mut(&id)
                    .is_some_and(|state| state.set_hovered(*is_hovered));
            let interactive_changed = tracks_hover
                && view
                    .interactive_style_states
                    .entry(id)
                    .or_default()
                    .set_hovered(*is_hovered);
            if transition_changed || interactive_changed {
                cx.notify();
            }
            if tracks_mouse_hover {
                view.update_hover_target(id, *is_hovered, window, cx);
            }
        }));
    }

    if transition_active || tracks_active {
        let id = element.id;
        el = el
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(move |view, _event: &gpui::MouseDownEvent, _window, cx| {
                    let transition_changed = transition_active
                        && view
                            .transition_states
                            .get_mut(&id)
                            .is_some_and(|state| state.set_active(true));
                    let interactive_changed = tracks_active
                        && view
                            .interactive_style_states
                            .entry(id)
                            .or_default()
                            .set_active(true);
                    if transition_changed || interactive_changed {
                        cx.notify();
                    }
                }),
            )
            .on_mouse_up(
                gpui::MouseButton::Left,
                cx.listener(move |view, _event: &gpui::MouseUpEvent, _window, cx| {
                    let transition_changed = transition_active
                        && view
                            .transition_states
                            .get_mut(&id)
                            .is_some_and(|state| state.set_active(false));
                    let interactive_changed = tracks_active
                        && view
                            .interactive_style_states
                            .entry(id)
                            .or_default()
                            .set_active(false);
                    if transition_changed || interactive_changed {
                        cx.notify();
                    }
                }),
            )
            .on_mouse_up_out(
                gpui::MouseButton::Left,
                cx.listener(move |view, _event: &gpui::MouseUpEvent, _window, cx| {
                    let transition_changed = transition_active
                        && view
                            .transition_states
                            .get_mut(&id)
                            .is_some_and(|state| state.set_active(false));
                    let interactive_changed = tracks_active
                        && view
                            .interactive_style_states
                            .entry(id)
                            .or_default()
                            .set_active(false);
                    if transition_changed || interactive_changed {
                        cx.notify();
                    }
                }),
            );
    }

    if element.element_type == "text" {
        // React splits interpolated text into adjacent host nodes. Flatten the
        // subtree into one selectable layout while keeping this shared host
        // surface for identity, events, styles, focus and automation bounds.
        let inline =
            flattened_text.expect("text hosts are flattened before their content is attached");
        let accessibility_value = (!ctx.inherited.accessibility_hidden
            && !ctx.inherited.text_accessibility_owned_by_role
            && !inline.accessibility_text.is_empty())
        .then(|| gpui::SharedString::from(inline.accessibility_text.clone()));
        el = el.child(flattened_text_content(
            element,
            ctx,
            inline,
            accessibility_value,
        ));
    } else {
        // Text content — selectable, same as a <text> leaf.
        if let Some(ref content) = element.content {
            el = el.child(text_content(element, content, ctx));
        }

        // Children
        let child_ids: Vec<u64> = element.children.clone();
        for child_id in child_ids {
            let child = if overflow_x_only {
                build_element_with_parent_layout(child_id, true, ctx, window, cx)
            } else {
                build_element(child_id, ctx, window, cx)
            };
            el = el.child(child);
        }
    }

    el.into_any_element()
}

fn accessible_name_from_contents(
    element: &crate::retained_tree::RetainedElement,
    ctx: &BuildCtx,
) -> Option<String> {
    let owns_name = crate::accessibility::role_supports_name_from_contents(element)
        && element
            .custom_props
            .get("ariaLabel")
            .and_then(serde_json::Value::as_str)
            .is_none();
    if !owns_name {
        return None;
    }
    crate::accessibility::flattened_contents_text(ctx.tree, element)
}

fn build_visually_hidden_element(
    element: &crate::retained_tree::RetainedElement,
    ctx: &BuildCtx,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    // Flattening is the only check a malformed `<text>` subtree gets, and this
    // projection paints nothing that would otherwise reach it. Its accessible
    // text now comes from the tree, so run the flatten for the diagnostic alone
    // rather than let an authoring mistake pass silently here.
    if element.element_type == "text" {
        drop(flatten_text(element, ctx));
    }

    let name_from_contents = accessible_name_from_contents(element, ctx);
    // A role that does not name itself from its contents still keeps its text.
    // Painted text reaches AccessKit as the value of the node that draws it, and
    // the projection draws nothing, so the flattened string becomes this node's
    // value the same way the painted `<text>` host sets one below. An ancestor
    // that already owns this text as its own name suppresses the duplicate.
    //
    // Unlike a painted value, this one is whitespace-normalized: it is built by
    // the name flattener, and the accname flat string is normalized. A `<text>`
    // whose authored spacing is irregular therefore reads slightly differently
    // projected than painted.
    let content_value = (!ctx.inherited.text_accessibility_owned_by_role
        && !crate::accessibility::role_supports_name_from_contents(element))
    .then(|| crate::accessibility::flattened_contents_text(ctx.tree, element))
    .flatten();
    let element_id = retained_gpui_element_id(element)
        .expect("a validated visuallyHidden semantic host has a GPUI element id");
    // One pixel, out of flow, painting nothing. The web's `sr-only` clips to
    // 1x1 rather than collapsing the box for the same reason: platform
    // assistive technology moves a cursor over node bounds and hit-tests them,
    // and a zero-area rect is not reliably addressable.
    let el = gpui::div()
        .id(element_id)
        .absolute()
        .w(gpui::px(1.0))
        .h(gpui::px(1.0));
    crate::accessibility::apply(
        el,
        ctx.tree,
        element,
        ctx.event_callback,
        None,
        ctx.inherited.accessibility_hidden,
        name_from_contents.as_deref(),
        content_value.as_deref(),
    )
    .into_any_element()
}

/// A selectable text run owned by `element`. Runs are left to gpui so the
/// text keeps inheriting colour, weight and family from ancestor styles.
///
/// The run's group is its parent host element, because React makes a separate
/// host node for every interpolated string. `<text>Hello {name}!</text>` is one
/// logical line painted as three runs that all share the parent's id.
fn text_content(
    element: &crate::retained_tree::RetainedElement,
    content: &str,
    ctx: &BuildCtx,
) -> gpui::AnyElement {
    let accessibility_value = (!ctx.inherited.accessibility_hidden
        && !ctx.inherited.text_accessibility_owned_by_role)
        .then(|| gpui::SharedString::from(content.to_owned()));
    let painted_content = match ctx.inherited.text_transform {
        TextTransform::None => content.to_string(),
        TextTransform::Uppercase => content.to_uppercase(),
        TextTransform::Lowercase => content.to_lowercase(),
    };
    let painted_content = gpui::SharedString::from(painted_content);
    selectable_text(crate::text::SelectableText {
        group: crate::text::search::group_id(ctx.tree, element.id),
        selectable: ctx.inherited.selectable,
        highlight: ctx
            .inherited
            .highlight
            .clone()
            .map(crate::text::HighlightSource::Resolved),
        ..crate::text::SelectableText::new(
            element.id,
            0,
            painted_content,
            None,
            ctx.selection.clone(),
            ctx.inherited.selection_wash,
            accessibility_value,
        )
    })
}

fn flatten_text(
    element: &crate::retained_tree::RetainedElement,
    ctx: &BuildCtx,
) -> crate::text::inline::InlineText {
    match crate::text::inline::flatten_inline_text(
        ctx.tree,
        element.id,
        ctx.inherited.text_transform,
    ) {
        Ok(inline) => inline,
        Err(error) => {
            log::error!("Invalid inline text tree: {error}");
            crate::text::inline::InlineText::default()
        }
    }
}

fn flattened_text_content(
    element: &crate::retained_tree::RetainedElement,
    ctx: &BuildCtx,
    inline: crate::text::inline::InlineText,
    accessibility_value: Option<gpui::SharedString>,
) -> gpui::AnyElement {
    let mut highlight_mappings = Vec::new();
    if let Some(own_content) = element.content.as_ref().filter(|text| !text.is_empty()) {
        highlight_mappings.push((0..own_content.len(), element.id));
    }
    highlight_mappings.extend(inline.tracked_ranges.iter().cloned());

    let mut content = crate::text::SelectableText::new(
        element.id,
        0,
        gpui::SharedString::from(inline.text),
        None,
        ctx.selection.clone(),
        ctx.inherited.selection_wash,
        accessibility_value,
    );
    content.run_styles = Some(inline.runs);
    content.tracked_ranges = inline.tracked_ranges;
    content.clickable_ranges = inline.clickable_ranges;
    content.selectable = ctx.inherited.selectable;
    content.group = crate::text::search::group_id(ctx.tree, element.id);
    content.highlight = ctx.inherited.highlight.clone().map(|highlight| {
        crate::text::HighlightSource::FlattenedResolved(highlight, highlight_mappings)
    });

    if !content.clickable_ranges.is_empty() && !action_disabled_in_ancestry(ctx.tree, element.id) {
        let callback = ctx.event_callback.clone();
        content.on_inline_click = Some(Arc::new(move |id, event| {
            emit_event_full(&callback, id, "click", |payload| {
                let (x, y) = point_to_xy(event.position);
                payload.x = Some(x);
                payload.y = Some(y);
                payload.modifiers = Some(event.modifiers.into());
                payload.click_count = Some(event.click_count as u32);
                payload.is_right_click = Some(false);
                payload.button = Some(mouse_button_to_u32(event.button));
                payload.input_source = Some("mouse".to_string());
            });
        }));
    }

    selectable_text(content)
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
    let mut el = el;
    el.style().size.width = Some(dimension_to_length(dim));
    el
}

pub(crate) fn apply_height<E: gpui::Styled>(el: E, dim: &crate::style::DimensionValue) -> E {
    let mut el = el;
    el.style().size.height = Some(dimension_to_length(dim));
    el
}

fn dimension_to_calc(value: &crate::style::DimensionValue) -> gpui::CalcLength {
    use crate::style::{CalcOperator, DimensionValue};
    match value {
        DimensionValue::Pixels(value)
        | DimensionValue::Ch(value)
        | DimensionValue::Vw(value)
        | DimensionValue::Vh(value) => gpui::CalcLength::absolute(gpui::px(*value as f32)),
        DimensionValue::Percentage(value) => gpui::CalcLength::relative(*value as f32),
        DimensionValue::Calc {
            left,
            operator,
            right,
            ..
        } => match operator {
            CalcOperator::Add => {
                gpui::CalcLength::add(dimension_to_calc(left), dimension_to_calc(right))
            }
            CalcOperator::Subtract => {
                gpui::CalcLength::subtract(dimension_to_calc(left), dimension_to_calc(right))
            }
        },
        DimensionValue::Clamp {
            min,
            preferred,
            max,
            ..
        } => gpui::CalcLength::clamp(
            dimension_to_calc(min),
            dimension_to_calc(preferred),
            dimension_to_calc(max),
        ),
        DimensionValue::Auto => unreachable!("auto cannot be part of a calc expression"),
        DimensionValue::MinContent | DimensionValue::MaxContent | DimensionValue::FitContent => {
            unreachable!("intrinsic sizing keywords cannot be part of a calc expression")
        }
    }
}

fn dimension_to_length(value: &crate::style::DimensionValue) -> gpui::Length {
    use crate::style::DimensionValue;
    match value {
        // `ch`/`vw`/`vh` are reduced to pixels by `resolve_length_expressions`
        // before styles reach GPUI; treating a stray one as pixels mirrors the
        // long-standing `ch` fallback in `dimension_to_calc`.
        DimensionValue::Pixels(value)
        | DimensionValue::Ch(value)
        | DimensionValue::Vw(value)
        | DimensionValue::Vh(value) => gpui::px(*value as f32).into(),
        DimensionValue::Percentage(value) => gpui::relative(*value as f32).into(),
        DimensionValue::Calc { .. } | DimensionValue::Clamp { .. } => {
            gpui::Length::Calc(dimension_to_calc(value))
        }
        DimensionValue::Auto => gpui::Length::Auto,
        // Intrinsic keywords are measured and substituted by
        // `resolve_intrinsic_keywords` on the host containers that can be
        // probed. A surface that cannot be measured falls back to `auto`, the
        // closest layout GPUI can produce without a content measurement.
        DimensionValue::MinContent | DimensionValue::MaxContent | DimensionValue::FitContent => {
            gpui::Length::Auto
        }
    }
}

/// Resolve the font-relative and viewport-relative parts of a length before
/// handing percentages to GPUI/Taffy. Taffy supplies the containing-block
/// basis at layout time; the window supplies the viewport basis here, exactly
/// once per frame, so `vw`/`vh` track a window resize the way a browser does.
fn resolve_length_expressions(
    style: &StyleDesc,
    window: &gpui::Window,
    font: &InheritedFont,
) -> StyleDesc {
    let mut resolved = style.clone();
    let font_id = window.text_system().resolve_font(&font.font);
    let ch = f64::from(f32::from(
        window
            .text_system()
            .ch_advance(font_id, font.size)
            .unwrap_or(font.size * 0.5),
    ));
    let viewport = window.viewport_size();
    let units = LengthUnits {
        ch,
        vw: f64::from(f32::from(viewport.width)) / 100.0,
        vh: f64::from(f32::from(viewport.height)) / 100.0,
    };

    resolved.width = resolve_dimension(style.width.as_ref(), units);
    resolved.min_width = resolve_dimension(style.min_width.as_ref(), units);
    resolved.max_width = resolve_dimension(style.max_width.as_ref(), units);
    resolved.height = resolve_dimension(style.height.as_ref(), units);
    resolved.min_height = resolve_dimension(style.min_height.as_ref(), units);
    resolved.max_height = resolve_dimension(style.max_height.as_ref(), units);
    // State refinements go through the same expression resolver. Without this
    // a typed `hover: { width: "24ch" }` could reach StyleRefinement and be
    // ignored by its old pixels-only helpers.
    resolved.hover = style.hover.as_ref().map(|state| {
        let state_font = font_with_overrides(font.clone(), Some(state));
        Box::new(resolve_length_expressions(state, window, &state_font))
    });
    resolved.hover_within = style.hover_within.as_ref().map(|state| {
        let state_font = font_with_overrides(font.clone(), Some(state));
        Box::new(resolve_length_expressions(state, window, &state_font))
    });
    resolved.active = style.active.as_ref().map(|state| {
        let state_font = font_with_overrides(font.clone(), Some(state));
        Box::new(resolve_length_expressions(state, window, &state_font))
    });
    resolved.focus = style.focus.as_ref().map(|state| {
        let state_font = font_with_overrides(font.clone(), Some(state));
        Box::new(resolve_length_expressions(state, window, &state_font))
    });
    resolved.focus_visible = style.focus_visible.as_ref().map(|state| {
        let state_font = font_with_overrides(font.clone(), Some(state));
        Box::new(resolve_length_expressions(state, window, &state_font))
    });
    resolved
}

/// The pixel value of one unit of each font- or viewport-relative length,
/// resolved once per element per frame.
#[derive(Clone, Copy)]
struct LengthUnits {
    ch: f64,
    vw: f64,
    vh: f64,
}

fn resolve_dimension(
    value: Option<&crate::style::DimensionValue>,
    units: LengthUnits,
) -> Option<crate::style::DimensionValue> {
    let value = value?;
    match value {
        crate::style::DimensionValue::Percentage(_)
        | crate::style::DimensionValue::Pixels(_)
        | crate::style::DimensionValue::Auto => Some(value.clone()),
        // Intrinsic sizing keywords need a content measurement, which only the
        // build pass can take; `resolve_intrinsic_keywords` owns them.
        crate::style::DimensionValue::MinContent
        | crate::style::DimensionValue::MaxContent
        | crate::style::DimensionValue::FitContent => Some(value.clone()),
        crate::style::DimensionValue::Ch(value) => {
            Some(crate::style::DimensionValue::Pixels(value * units.ch))
        }
        crate::style::DimensionValue::Vw(value) => {
            Some(crate::style::DimensionValue::Pixels(value * units.vw))
        }
        crate::style::DimensionValue::Vh(value) => {
            Some(crate::style::DimensionValue::Pixels(value * units.vh))
        }
        crate::style::DimensionValue::Calc {
            source,
            left,
            operator,
            right,
        } => Some(crate::style::DimensionValue::Calc {
            source: source.clone(),
            left: Box::new(resolve_dimension(Some(left), units)?),
            operator: *operator,
            right: Box::new(resolve_dimension(Some(right), units)?),
        }),
        crate::style::DimensionValue::Clamp {
            source,
            min,
            preferred,
            max,
            ..
        } => Some(crate::style::DimensionValue::Clamp {
            source: source.clone(),
            min: Box::new(resolve_dimension(Some(min), units)?),
            preferred: Box::new(resolve_dimension(Some(preferred), units)?),
            max: Box::new(resolve_dimension(Some(max), units)?),
        }),
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

/// Base styles plus GPUI's native interaction refinements and hover groups.
///
/// Every stateful GPUI root must go through this, never `apply_styles` alone.
/// GPUI reads the refinements from the element state behind the element's
/// `ElementId`, so the caller must have called `.id(..)` first.
pub(crate) fn apply_interactive_styles<E>(mut el: E, style: &StyleDesc) -> E
where
    E: gpui::Styled + gpui::StatefulInteractiveElement,
{
    el = apply_styles(el, style);
    if let Some(group) = style.hover_group.as_deref() {
        el = el.group(gpui::SharedString::from(group.to_owned()));
    }
    if let Some(hover_style) = style.hover.as_deref() {
        el = el.hover(|refinement| apply_styles(refinement, hover_style));
    }
    if let Some(active_style) = style.active.as_deref() {
        el = el.active(|refinement| apply_styles(refinement, active_style));
    }
    el = apply_focus_styles(el, style);
    if let (Some(group), Some(hover_within_style)) = (
        style.hover_within_group.clone(),
        style.hover_within.as_deref(),
    ) {
        el = el.group_hover(group, |refinement| {
            apply_styles(refinement, hover_within_style)
        });
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
    // The former wrapper carried flex-none independently from the authored
    // child. On the child itself it is only a default: any authored flex
    // longhand keeps GPUI's normal values for the other longhands.
    if style.default_flex_none
        && style.flex_grow.is_none()
        && style.flex_shrink.is_none()
        && style.flex_basis.is_none()
    {
        el = el.flex_none();
    }
    match style.align_items.as_deref() {
        Some("center") => el = el.items_center(),
        Some("start") | Some("flex-start") => el = el.items_start(),
        Some("end") | Some("flex-end") => el = el.items_end(),
        Some("baseline") => el = el.items_baseline(),
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
        el.style().min_size.width = Some(dimension_to_length(min_w));
    }
    if let Some(ref min_h) = style.min_height {
        el.style().min_size.height = Some(dimension_to_length(min_h));
    }
    if let Some(ref max_w) = style.max_width {
        el.style().max_size.width = Some(dimension_to_length(max_w));
    }
    if let Some(ref max_h) = style.max_height {
        el.style().max_size.height = Some(dimension_to_length(max_h));
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
    // Taffy has no viewport-fixed position, and GPUI has no scrolling document,
    // so "fixed" lays out exactly like "absolute". `should_occlude` already
    // treated the two the same; without this arm a "fixed" box stayed in flow.
    match style.position.as_deref() {
        Some("absolute") | Some("fixed") => el = el.absolute(),
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
    match style.text_decoration.as_deref() {
        Some("underline") => el = el.underline(),
        Some("line-through") => el = el.line_through(),
        _ => {}
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
        Some("pre") => el = el.whitespace_pre(),
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
    if let Some(line_height) = style.line_height.as_ref() {
        match line_height {
            crate::style::LineHeightValue::Pixels(value) if *value > 0.0 => {
                el = el.line_height(gpui::px(*value as f32))
            }
            crate::style::LineHeightValue::Unitless(value) => {
                if let Ok(value) = value.parse::<f32>() {
                    el = el.line_height(gpui::relative(value));
                }
            }
            _ => {}
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
    if let Some(cursor) = style.cursor.as_deref().and_then(crate::style::parse_cursor) {
        el = el.cursor(cursor);
    }
    // Overflow: hidden is on the Styled trait, so we handle it here.
    // overflow: "scroll" requires StatefulInteractiveElement — handled in build_host_container().
    // CSS precedence: axis-specific (overflowX/Y) overrides the shorthand (overflow).
    {
        let resolved_x = style.overflow_x.as_deref().or(style.overflow.as_deref());
        let resolved_y = style.overflow_y.as_deref().or(style.overflow.as_deref());
        // Only apply hidden here — scroll is handled in build_host_container.
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

/// Fill the DOM `WheelEvent` fields of a payload from a GPUI wheel event.
///
/// A `ScrollDelta` is the negation of the DOM delta: it says how far the
/// content moves, while `WheelEvent` says how far the view scrolls. GPUI's own
/// browser platform negates on the way in
/// (`gpui_web::events::register_wheel`), so this negates on the way out and
/// `deltaY > 0` means "scrolled down" on every platform.
pub(crate) fn apply_wheel_delta(p: &mut EventPayload, event: &gpui::ScrollWheelEvent) {
    p.modifiers = Some(event.modifiers.into());
    p.precise = Some(event.delta.precise());
    p.delta_z = Some(0.0);
    // Subtract rather than negate: `-0.0` would survive into JSON, and a
    // motionless axis reports 0 in the DOM.
    let dom_delta = |value: f32| f64::from(0.0f32 - value);
    match event.delta {
        gpui::ScrollDelta::Pixels(delta) => {
            p.delta_x = Some(dom_delta(f32::from(delta.x)));
            p.delta_y = Some(dom_delta(f32::from(delta.y)));
            p.delta_mode = Some(0);
        }
        gpui::ScrollDelta::Lines(delta) => {
            p.delta_x = Some(dom_delta(delta.x));
            p.delta_y = Some(dom_delta(delta.y));
            p.delta_mode = Some(1);
        }
    }
    p.touch_phase = Some(
        match event.touch_phase {
            gpui::TouchPhase::Started => "started",
            gpui::TouchPhase::Moved => "moved",
            gpui::TouchPhase::Ended => "ended",
            gpui::TouchPhase::Cancelled => "cancelled",
        }
        .to_string(),
    );
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

/// The buttons a subtree's mouse-down listener has to cover.
///
/// `contextMenu` rides the mouse-down listener, and the tracking walk reaches
/// ancestors, so a subtree that tracks `contextMenu` without `mouseDown` would
/// otherwise put an all-button listener on every descendant: an IPC round trip
/// per left press, and a `stop_propagation` taken on behalf of a listener that
/// only ever wanted the right button. Such a subtree takes the right button
/// alone.
pub(crate) fn mouse_down_button_set(tracks_mouse_down: bool) -> &'static [gpui::MouseButton] {
    if tracks_mouse_down {
        &[
            gpui::MouseButton::Left,
            gpui::MouseButton::Middle,
            gpui::MouseButton::Right,
        ]
    } else {
        &[gpui::MouseButton::Right]
    }
}

#[cfg(test)]
mod mouse_down_button_set_tests {
    use super::*;

    #[test]
    fn context_menu_without_mouse_down_takes_the_right_button_alone() {
        assert_eq!(
            mouse_down_button_set(false),
            &[gpui::MouseButton::Right],
            "a subtree that tracks only `contextMenu` must not listen for the \
             left or middle button: each one costs an IPC round trip and a \
             `stop_propagation` no React listener asked for"
        );
    }

    #[test]
    fn tracked_mouse_down_takes_every_button() {
        assert_eq!(
            mouse_down_button_set(true),
            &[
                gpui::MouseButton::Left,
                gpui::MouseButton::Middle,
                gpui::MouseButton::Right,
            ],
            "`onMouseDown` sees every button through `event.button`"
        );
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

fn emit_window_activation(callback: &WindowEventCallback, is_active: bool) {
    emit_window_activation_payload(callback, is_active);
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

fn emit_window_activation_payload(callback: &WindowEventCallback, is_active: bool) {
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    let callback = callback.lock().unwrap().clone();
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    let callback = callback.borrow().clone();
    if let Some(callback) = callback {
        callback(EventPayload {
            event_type: "windowActivation".to_string(),
            is_active: Some(is_active),
            ..EventPayload::default()
        });
    }
}

// ── Batch processing ─────────────────────────────────────────────

/// Parsed batch operation — typed enum for atomic validation.
/// All ops are parsed and validated BEFORE any tree mutation occurs.
/// This prevents partial application on malformed batches.
enum BatchOp<'a> {
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
    InsertBefore {
        parent_id: u64,
        child_id: u64,
        before_id: u64,
    },
    /// The payload stays as raw JSON until apply time.
    ///
    /// Two reasons. A parsed `StyleDesc` is ~1.4 KB, and a `Vec<BatchOp>` is as
    /// wide as its widest variant, so inlining one made a 220k-op mount reserve
    /// over 300 MB before it parsed a single op. And the tree hash-conses
    /// styles by content, so it needs the bytes: hashing ~110 bytes is far
    /// cheaper than building 80 `Option` fields and throwing 99.8% of them away.
    SetStyle {
        id: u64,
        style: &'a serde_json::value::RawValue,
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

/// A batch failure. The message names the op index, so it survives the trip
/// back to JS as a plain `Error`.
pub type BatchResult<T> = std::result::Result<T, String>;

/// Decode the batch straight from its JSON bytes into `Vec<BatchOp>`.
///
/// There is deliberately no `Vec<serde_json::Value>` in between. That tree cost
/// a `String` per key and per value, every payload was then deep-cloned out of
/// it, and `from_value` parsed the clone a second time, so one style was
/// allocated three times. A 220k-op mount made 1.5M allocations that way.
///
/// Everything the `Value` version guaranteed still holds, and each one is
/// load-bearing:
///
/// * an unknown opcode is a hard error, not a skipped op. Silently ignoring one
///   would let a JS/Rust version skew desync the tree instead of throwing
/// * ids go through `raw_element_id`, so non-finite, negative, fractional and
///   out-of-safe-range values are still rejected
/// * `hasHandler` is accepted as a bool or a number
/// * errors still name the op index. `serde_json` reports a byte offset, which
///   is useless when you are chasing a desync
fn parse_batch_ops(bytes: &[u8]) -> BatchResult<Vec<BatchOp<'_>>> {
    serde_json::from_slice::<BatchOps>(bytes)
        .map(|batch| batch.0)
        .map_err(|error| format!("Failed to parse batch: {error}"))
}

struct BatchOps<'a>(Vec<BatchOp<'a>>);

impl<'de> serde::Deserialize<'de> for BatchOps<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct OpsVisitor;

        impl<'de> serde::de::Visitor<'de> for OpsVisitor {
            type Value = BatchOps<'de>;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an array of mutation tuples")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<BatchOps<'de>, A::Error> {
                let mut ops = Vec::with_capacity(seq.size_hint().unwrap_or(64));
                loop {
                    // The index is attached here because this is the only place
                    // that knows it.
                    let index = ops.len();
                    match seq.next_element::<BatchOp<'de>>() {
                        Ok(Some(op)) => ops.push(op),
                        Ok(None) => break,
                        Err(error) => {
                            return Err(serde::de::Error::custom(format!(
                                "Batch op {index}: {error}"
                            )))
                        }
                    }
                }
                Ok(BatchOps(ops))
            }
        }

        deserializer.deserialize_seq(OpsVisitor)
    }
}

/// A string argument, borrowed from the input when the JSON has no escapes.
///
/// The owned copy happens exactly once, on the way into the `BatchOp`. The
/// `Value` path allocated twice: into `Value::String`, then into the op.
struct StrArg<'a>(std::borrow::Cow<'a, str>);

impl<'de> serde::Deserialize<'de> for StrArg<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        use std::borrow::Cow;
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = StrArg<'de>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a string")
            }
            fn visit_borrowed_str<E: serde::de::Error>(
                self,
                v: &'de str,
            ) -> std::result::Result<StrArg<'de>, E> {
                Ok(StrArg(Cow::Borrowed(v)))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<StrArg<'de>, E> {
                Ok(StrArg(Cow::Owned(v.to_owned())))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<StrArg<'de>, E> {
                Ok(StrArg(Cow::Owned(v)))
            }
        }
        deserializer.deserialize_str(V)
    }
}

/// `hasHandler` arrives as a bool from the reconciler and as a non-negative
/// integer from hand-written batches. That is exactly what `as_bool()` then
/// `as_u64()` accepted before, so a negative or fractional number stays an
/// error rather than quietly meaning `true`.
struct BoolArg(bool);

impl<'de> serde::Deserialize<'de> for BoolArg {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = BoolArg;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a boolean or a non-negative integer")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<BoolArg, E> {
                Ok(BoolArg(v))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<BoolArg, E> {
                Ok(BoolArg(v != 0))
            }
        }
        deserializer.deserialize_any(V)
    }
}

fn next_arg<'de, A, T>(seq: &mut A, what: &str) -> std::result::Result<T, A::Error>
where
    A: serde::de::SeqAccess<'de>,
    T: serde::Deserialize<'de>,
{
    seq.next_element()?
        .ok_or_else(|| serde::de::Error::custom(format!("missing {what}")))
}

/// Read an element id. Ids cross napi as JS numbers, so they are read as `f64`
/// and validated exactly as `batch_id` did.
fn next_id<'de, A: serde::de::SeqAccess<'de>>(
    seq: &mut A,
    what: &str,
) -> std::result::Result<u64, A::Error> {
    let raw: f64 = next_arg(seq, what)?;
    raw_element_id(raw).map_err(serde::de::Error::custom)
}

impl<'de> serde::Deserialize<'de> for BatchOp<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct V;

        impl<'de> serde::de::Visitor<'de> for V {
            type Value = BatchOp<'de>;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a [opcode, ...args] mutation tuple")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<BatchOp<'de>, A::Error> {
                let name: StrArg<'de> = next_arg(&mut seq, "op name")?;
                let op = match name.0.as_ref() {
                    "createElement" => BatchOp::CreateElement {
                        id: next_id(&mut seq, "id")?,
                        element_type: next_arg::<A, StrArg>(&mut seq, "element type")?
                            .0
                            .into_owned(),
                    },
                    "destroyElement" => BatchOp::DestroyElement {
                        id: next_id(&mut seq, "id")?,
                    },
                    "appendChild" => BatchOp::AppendChild {
                        parent_id: next_id(&mut seq, "parent id")?,
                        child_id: next_id(&mut seq, "child id")?,
                    },
                    "insertBefore" => BatchOp::InsertBefore {
                        parent_id: next_id(&mut seq, "parent id")?,
                        child_id: next_id(&mut seq, "child id")?,
                        before_id: next_id(&mut seq, "before id")?,
                    },
                    "setStyle" => BatchOp::SetStyle {
                        id: next_id(&mut seq, "id")?,
                        style: next_arg(&mut seq, "style")?,
                    },
                    "setText" => BatchOp::SetText {
                        id: next_id(&mut seq, "id")?,
                        content: next_arg::<A, StrArg>(&mut seq, "text")?.0.into_owned(),
                    },
                    "setEventListener" => BatchOp::SetEventListener {
                        id: next_id(&mut seq, "id")?,
                        event_type: next_arg::<A, StrArg>(&mut seq, "event type")?
                            .0
                            .into_owned(),
                        has_handler: next_arg::<A, BoolArg>(&mut seq, "hasHandler")?.0,
                    },
                    "setRoot" => BatchOp::SetRoot {
                        id: next_id(&mut seq, "id")?,
                    },
                    "setCustomPropValue" => BatchOp::SetCustomProp {
                        id: next_id(&mut seq, "id")?,
                        key: next_arg::<A, StrArg>(&mut seq, "prop key")?.0.into_owned(),
                        value: next_arg(&mut seq, "custom prop value")?,
                    },
                    other => {
                        return Err(serde::de::Error::custom(format!(
                            "unknown operation: {other:?}"
                        )))
                    }
                };
                // Trailing arguments are tolerated, as they were when the op was
                // an indexed array.
                while seq.next_element::<serde::de::IgnoredAny>()?.is_some() {}
                Ok(op)
            }
        }

        deserializer.deserialize_seq(V)
    }
}

/// Resolve every `setStyle` payload in the batch, in op order.
///
/// Infallible. Decoding already proved every payload is syntactically valid
/// JSON, and a payload that is not a style *object* — `null` or a JSON string
/// included — degrades to the empty style with a recorded problem rather than
/// rejecting the batch. It still runs before the apply loop and borrows only
/// the style table, so the interned styles line up with the ops that use them.
fn resolve_styles(
    styles: &mut StyleTable,
    ops: &[BatchOp<'_>],
    collect_diagnostics: bool,
) -> Vec<(Arc<StyleDesc>, Vec<StyleProblem>)> {
    let mut resolved = Vec::new();
    for op in ops {
        if let BatchOp::SetStyle { style, .. } = op {
            // Keeping the raw bytes here is what makes the content hash work.
            let raw = style.get().trim().as_bytes();
            let value: serde_json::Value = serde_json::from_slice(raw)
                .expect("a RawValue payload is always valid JSON");
            let parsed = crate::style::parse_style_value(&value);
            let shared = styles.intern_parsed(raw, parsed.style);
            let problems = if collect_diagnostics {
                parsed.problems
            } else {
                Vec::new()
            };
            resolved.push((shared, problems));
        }
    }
    resolved
}

#[cfg(test)]
mod resolve_styles_tests {
    use super::*;
    use crate::style::TransitionEasing;
    use serde_json::json;

    fn resolve(
        style: serde_json::Value,
        collect_diagnostics: bool,
    ) -> (StyleDesc, Vec<PendingStyleDiagnostic>) {
        let batch = serde_json::to_vec(&json!([
            ["createElement", 1, "div"],
            ["setStyle", 1, style],
            ["setRoot", 1]
        ]))
        .unwrap();
        let mut tree = RetainedTree::new();
        let outcome = apply_batch_to_tree_with_diagnostics(&mut tree, &batch, collect_diagnostics)
            .expect("style problems must degrade instead of rejecting the batch");
        let style = tree.elements[&1]
            .style
            .as_deref()
            .expect("the degraded style is still applied")
            .clone();
        (style, outcome.diagnostics)
    }

    #[test]
    fn strict_and_non_strict_resolve_the_same_degraded_style() {
        let payload = json!({
            "display": "flex",
            "width": "banana",
            "flexGrain": 4,
            "transition": { "properties": ["opacity"], "durationMs": 150 }
        });

        let (strict_style, strict_diagnostics) = resolve(payload.clone(), true);
        let (non_strict_style, non_strict_diagnostics) = resolve(payload, false);

        assert_eq!(strict_style, non_strict_style);
        assert_eq!(strict_style.display.as_deref(), Some("flex"));
        assert_eq!(strict_style.width, None);
        let transition = strict_style
            .transition
            .expect("partial transition is valid");
        assert_eq!(transition.delay_ms, 0.0);
        assert_eq!(transition.easing, TransitionEasing::Name("ease".into()));
        assert_eq!(strict_diagnostics.len(), 2);
        assert!(non_strict_diagnostics.is_empty());
    }
}

/// Apply a batch of mutation tuples to a RetainedTree.
/// Shared between GpuixRenderer::apply_batch and TestGpuixRenderer::apply_batch.
/// Returns accumulated destroyed IDs (as f64) from all destroyElement ops.
///
/// ATOMIC: decoding is the only fallible phase, and it happens before a single
/// element or style is touched. If any op is malformed the tree is left
/// unchanged and an error is returned. Nothing after that point can fail, so JS
/// and Rust cannot desync when a batch is retried.
///
/// Batch format: JSON array of tuples [opcode, ...args].
/// See GpuixRenderer::apply_batch for opcode documentation.
pub(crate) struct BatchOutcome {
    pub destroyed_ids: Vec<f64>,
    pub diagnostics: Vec<PendingStyleDiagnostic>,
}

pub(crate) fn apply_batch_to_tree_with_diagnostics(
    tree: &mut RetainedTree,
    bytes: &[u8],
    collect_diagnostics: bool,
) -> BatchResult<BatchOutcome> {
    // Phase 1: decode. No mutation.
    let parsed = parse_batch_ops(bytes)?;

    // Phase 2: resolve styles. Touches the style table only, and cannot fail.
    let mut styles = resolve_styles(&mut tree.styles, &parsed, collect_diagnostics).into_iter();

    // Phase 3: apply. Cannot fail.
    let mut destroyed_ids: Vec<f64> = Vec::new();
    let mut diagnostics = Vec::new();
    let mut inline_style_candidates = HashSet::new();
    let mut inline_subtree_roots = Vec::new();
    let mut accessibility_candidates = HashSet::new();
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
                inline_subtree_roots.push(child_id);
            }
            BatchOp::InsertBefore {
                parent_id,
                child_id,
                before_id,
            } => {
                tree.insert_before(parent_id, child_id, before_id);
                inline_subtree_roots.push(child_id);
            }
            BatchOp::SetStyle { id, .. } => {
                let (shared, problems) = styles.next().expect("one resolved style per setStyle op");
                tree.set_style(id, shared);
                diagnostics.extend(pending_style_diagnostics(id, problems));
                inline_style_candidates.insert(id);
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
                tree.set_root(Some(id));
            }
            BatchOp::SetCustomProp { id, key, value } => {
                if let Some(diagnostic) = pending_custom_prop_diagnostic(tree, id, &key, &value) {
                    diagnostics.push(diagnostic);
                }
                if crate::accessibility::is_accessibility_prop(&key) {
                    accessibility_candidates.insert(id);
                }
                tree.set_custom_prop(id, key, value);
            }
        }
    }

    if collect_diagnostics {
        let mut accessibility_candidates = accessibility_candidates.into_iter().collect::<Vec<_>>();
        accessibility_candidates.sort_unstable();
        for id in accessibility_candidates {
            diagnostics.extend(pending_accessibility_diagnostics(tree, id));
        }
    }

    for root_id in inline_subtree_roots {
        crate::text::inline::subtree_ids(tree, root_id, &mut inline_style_candidates);
    }
    let mut inline_style_candidates = inline_style_candidates.into_iter().collect::<Vec<_>>();
    inline_style_candidates.sort_unstable();
    for id in inline_style_candidates {
        if !crate::text::inline::is_inline_text_descendant(tree, id) {
            continue;
        }
        let Some(style) = tree
            .elements
            .get(&id)
            .and_then(|element| element.style.as_ref())
        else {
            continue;
        };
        diagnostics.extend(pending_style_diagnostics(
            id,
            crate::text::inline::unsupported_inline_style_problems(style),
        ));
    }

    // Release styles nothing references any more. Without this a dragged
    // element, which produces a distinct style every frame, would grow the
    // table for as long as the app runs. The element count is what catches the
    // opposite case, a batch that destroyed most of the tree.
    let live_elements = tree.elements.len();
    tree.styles.maybe_sweep(live_elements);

    Ok(BatchOutcome {
        destroyed_ids,
        diagnostics,
    })
}

/// Public so `examples/bench_serde.rs` times the exact non-diagnostic path used
/// by production when strict style diagnostics are disabled.
pub fn apply_batch_to_tree(tree: &mut RetainedTree, bytes: &[u8]) -> BatchResult<Vec<f64>> {
    apply_batch_to_tree_with_diagnostics(tree, bytes, false).map(|outcome| outcome.destroyed_ids)
}

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Default)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct EdgeInsets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Default)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowInsets {
    pub safe_area: EdgeInsets,
    pub ime: EdgeInsets,
    pub effective: EdgeInsets,
}

impl WindowInsets {
    fn from_gpui(insets: gpui::WindowInsets) -> Self {
        let effective = insets.effective();
        Self {
            safe_area: EdgeInsets::from_gpui(insets.safe_area),
            ime: EdgeInsets::from_gpui(insets.ime),
            effective: EdgeInsets::from_gpui(effective),
        }
    }
}

impl EdgeInsets {
    fn from_gpui(insets: gpui::Edges<gpui::Pixels>) -> Self {
        Self {
            top: f32::from(insets.top) as f64,
            right: f32::from(insets.right) as f64,
            bottom: f32::from(insets.bottom) as f64,
            left: f32::from(insets.left) as f64,
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn edge_insets_js(
    insets: gpui::Edges<gpui::Pixels>,
) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
    let object = js_sys::Object::new();
    for (key, value) in [
        ("top", insets.top),
        ("right", insets.right),
        ("bottom", insets.bottom),
        ("left", insets.left),
    ] {
        js_sys::Reflect::set(
            &object,
            &wasm_bindgen::JsValue::from_str(key),
            &wasm_bindgen::JsValue::from_f64(f32::from(value) as f64),
        )?;
    }
    Ok(object.into())
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn window_insets_js(
    insets: gpui::WindowInsets,
) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
    let effective = insets.effective();
    let object = js_sys::Object::new();
    for (key, value) in [
        ("safeArea", edge_insets_js(insets.safe_area)?),
        ("ime", edge_insets_js(insets.ime)?),
        ("effective", edge_insets_js(effective)?),
    ] {
        js_sys::Reflect::set(&object, &wasm_bindgen::JsValue::from_str(key), &value)?;
    }
    Ok(object.into())
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

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Debug, Clone)]
#[napi(object)]
pub struct CanvasImageLoadState {
    pub status: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowOptions {
    pub title: Option<String>,
    /// The name used for the default application menu. Defaults to `title`.
    pub app_name: Option<String>,
    /// Application menus. Omit for the platform default; pass `[]` to opt out.
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
    /// Override GPUI's reduced-motion policy for this application.
    pub reduced_motion: Option<bool>,
    /// Allow URL-backed images to connect to loopback and private networks.
    /// Link-local and cloud-metadata ranges remain blocked.
    pub allow_private_network_images: Option<bool>,
    /// Give the window key focus when it opens. `false` opens it behind the
    /// active app, like `open -g`. Ignored on Linux.
    pub focus: Option<bool>,
    /// Show the window when it opens. `false` opens it hidden; call
    /// `activateWindow()` to reveal it. Ignored on Linux.
    pub show: Option<bool>,
}

fn effective_reduced_motion(override_: Option<bool>, os: impl FnOnce() -> Option<bool>) -> bool {
    override_.or_else(os).unwrap_or(false)
}

/// Features offered by one renderer instance on its current platform.
///
/// Each `true` capability corresponds to a callable renderer method. Calls
/// outside the advertised surface reject with `UnsupportedCapabilityError`.
#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct RendererCapabilities {
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(
            ts_type = "\"macos\" | \"windows\" | \"linux\" | \"freebsd\" | \"browser\" | \"unknown\""
        )
    )]
    pub platform: String,
    pub frame_clock: FrameClockCapabilities,
    pub window: WindowCapabilities,
    pub images: ImageCapabilities,
    pub automation: AutomationCapabilities,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct FrameClockCapabilities {
    /// The source currently driving frame work for this renderer.
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "\"display-link\" | \"timer\" | \"raf\" | \"manual\"")
    )]
    pub kind: String,
    pub requires_tick: bool,
    /// Whether `setFrameRequestHandler()` can switch this renderer to an
    /// external frame source.
    pub external_frame: bool,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct WindowCapabilities {
    /// `isActive()` is available for this renderer/window.
    pub activation: bool,
    /// `activateWindow()` can request foreground activation.
    pub activate: bool,
    /// Native/browser resize notifications are available.
    pub resize: bool,
    /// GPUIX currently owns one window per renderer process.
    pub multiple: bool,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct ImageCapabilities {
    /// `setAllowPrivateNetworkImages()` is available.
    pub private_network: bool,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct AutomationCapabilities {
    pub click: bool,
    pub hover: bool,
    pub drag: bool,
    pub scroll_wheel: bool,
    /// `native` injects through GPUI; `browser` uses the browser IME mirror.
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "\"native\" | \"browser\"")
    )]
    pub keyboard: String,
    pub screenshot: bool,
    /// Screenshot file formats currently accepted by `captureScreenshot()`.
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "Array<\"png\">")
    )]
    pub screenshot_formats: Vec<String>,
    pub clock: bool,
    pub tree: bool,
}

pub(crate) fn renderer_capabilities(frame_clock_kind: &str) -> RendererCapabilities {
    let (platform, requires_tick, screenshot) = if cfg!(target_os = "macos") {
        ("macos", true, cfg!(feature = "test-support"))
    } else if cfg!(target_os = "windows") {
        ("windows", true, cfg!(feature = "test-support"))
    } else if cfg!(target_os = "linux") {
        ("linux", true, false)
    } else if cfg!(target_os = "freebsd") {
        ("freebsd", true, false)
    } else {
        ("unknown", false, false)
    };

    RendererCapabilities {
        platform: platform.to_string(),
        frame_clock: FrameClockCapabilities {
            kind: frame_clock_kind.to_owned(),
            requires_tick,
            external_frame: cfg!(target_os = "macos"),
        },
        window: WindowCapabilities {
            activation: matches!(platform, "macos" | "windows" | "linux" | "freebsd"),
            activate: matches!(platform, "macos" | "windows" | "linux" | "freebsd"),
            resize: matches!(platform, "macos" | "windows" | "linux" | "freebsd"),
            multiple: false,
        },
        images: ImageCapabilities {
            private_network: true,
        },
        automation: AutomationCapabilities {
            click: true,
            hover: true,
            drag: true,
            scroll_wheel: true,
            keyboard: "native".to_string(),
            screenshot,
            screenshot_formats: if screenshot {
                vec!["png".to_string()]
            } else {
                Vec::new()
            },
            clock: true,
            tree: true,
        },
    }
}

pub(crate) fn test_renderer_capabilities() -> RendererCapabilities {
    let mut capabilities = renderer_capabilities("manual");
    capabilities.frame_clock.requires_tick = false;
    capabilities.frame_clock.external_frame = false;
    capabilities.window.activate = false;
    capabilities
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn web_renderer_capabilities() -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
    let capabilities = js_sys::Object::new();
    let frame_clock = js_sys::Object::new();
    let window = js_sys::Object::new();
    let images = js_sys::Object::new();
    let automation = js_sys::Object::new();

    for (key, value) in [
        ("platform", wasm_bindgen::JsValue::from_str("browser")),
        ("frameClock", frame_clock.clone().into()),
        ("window", window.clone().into()),
        ("images", images.clone().into()),
        ("automation", automation.clone().into()),
    ] {
        js_sys::Reflect::set(&capabilities, &key.into(), &value)?;
    }
    for (key, value) in [
        ("kind", wasm_bindgen::JsValue::from_str("raf")),
        ("requiresTick", wasm_bindgen::JsValue::FALSE),
        ("externalFrame", wasm_bindgen::JsValue::FALSE),
    ] {
        js_sys::Reflect::set(&frame_clock, &key.into(), &value)?;
    }
    for (key, value) in [
        ("activation", wasm_bindgen::JsValue::FALSE),
        ("activate", wasm_bindgen::JsValue::FALSE),
        ("resize", wasm_bindgen::JsValue::TRUE),
        ("multiple", wasm_bindgen::JsValue::FALSE),
    ] {
        js_sys::Reflect::set(&window, &key.into(), &value)?;
    }
    js_sys::Reflect::set(
        &images,
        &"privateNetwork".into(),
        &wasm_bindgen::JsValue::FALSE,
    )?;
    for (key, value) in [
        ("click", wasm_bindgen::JsValue::TRUE),
        ("hover", wasm_bindgen::JsValue::TRUE),
        ("drag", wasm_bindgen::JsValue::TRUE),
        ("scrollWheel", wasm_bindgen::JsValue::TRUE),
        ("keyboard", wasm_bindgen::JsValue::from_str("browser")),
        ("screenshot", wasm_bindgen::JsValue::FALSE),
        ("screenshotFormats", js_sys::Array::new().into()),
        ("clock", wasm_bindgen::JsValue::TRUE),
        ("tree", wasm_bindgen::JsValue::TRUE),
    ] {
        js_sys::Reflect::set(&automation, &key.into(), &value)?;
    }
    Ok(capabilities.into())
}

impl Default for WindowOptions {
    fn default() -> Self {
        Self {
            title: Some("GPUIX".to_string()),
            app_name: None,
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
            reduced_motion: Some(false),
            allow_private_network_images: Some(false),
            focus: Some(true),
            show: Some(true),
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
    let window_min_size = effective_window_min_size(options);
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
        focus: options.focus.unwrap_or(true),
        show: options.show.unwrap_or(true),
        ..Default::default()
    }
}

fn effective_window_min_size(options: &WindowOptions) -> Option<gpui::WindowMinSize> {
    if options.min_width.is_none() && options.min_height.is_none() {
        return None;
    }

    Some(gpui::WindowMinSize {
        width: options.min_width.map(|width| gpui::px(width as f32)),
        height: options.min_height.map(|height| gpui::px(height as f32)),
    })
}

#[cfg(test)]
mod highlight_cache_tests {
    use super::*;

    fn tree_with_text() -> RetainedTree {
        let mut tree = RetainedTree::new();
        tree.create_element(1, "div".to_string());
        tree.create_element(2, "text".to_string());
        tree.append_child(1, 2);
        tree.set_text(2, "a fox and a fox".to_string());
        tree
    }

    fn query(text: &str) -> serde_json::Value {
        serde_json::json!({ "query": text })
    }

    fn declare(tree: &mut RetainedTree, value: &serde_json::Value) {
        tree.set_custom_prop(1, "highlight".to_string(), value.clone());
    }

    /// The whole reason `search_revision` exists. `highlight` is a custom prop,
    /// so keying the group list on `subtree_revision` means every keystroke
    /// re-walks and re-folds the subtree. The pointer comparison is the proof;
    /// a timing budget over a realistic app is far too coarse to catch it.
    #[test]
    fn a_query_change_reuses_the_group_list() {
        let theme = Theme::dark();
        let mut tree = tree_with_text();
        let mut cache = HashMap::new();

        declare(&mut tree, &query("f"));
        resolve_highlight(&mut cache, &tree, 1, &query("f"), &theme, false).expect("resolves");
        let first = Arc::as_ptr(&cache[&1].groups);

        declare(&mut tree, &query("fo"));
        resolve_highlight(&mut cache, &tree, 1, &query("fo"), &theme, false).expect("resolves");
        assert_eq!(
            Arc::as_ptr(&cache[&1].groups),
            first,
            "a query change must not rebuild the group list"
        );
    }

    /// Moving a find cursor changes no text and no matcher, so it must re-use
    /// the located matches. Colours and ordinals are decided at paint.
    #[test]
    fn a_cursor_move_reuses_the_located_matches() {
        let theme = Theme::dark();
        let mut tree = tree_with_text();
        let mut cache = HashMap::new();
        let spec = |active: u64| serde_json::json!({ "query": "fox", "activeIndex": active });

        declare(&mut tree, &spec(0));
        resolve_highlight(&mut cache, &tree, 1, &spec(0), &theme, true).expect("resolves");
        let matches = Arc::as_ptr(&cache[&1].context.matches);

        declare(&mut tree, &spec(1));
        let (context, changed) =
            resolve_highlight(&mut cache, &tree, 1, &spec(1), &theme, true).expect("resolves");
        assert_eq!(Arc::as_ptr(&context.matches), matches, "no rescan");
        assert_eq!(changed, None, "a cursor move is not a new result");
        assert_eq!(
            context.set.specs[0].active_index,
            Some(1),
            "spec still swapped"
        );
    }

    /// Editing the text must invalidate, or the wash paints over stale offsets.
    #[test]
    fn a_text_change_rebuilds_the_group_list() {
        let theme = Theme::dark();
        let mut tree = tree_with_text();
        let mut cache = HashMap::new();

        declare(&mut tree, &query("fox"));
        resolve_highlight(&mut cache, &tree, 1, &query("fox"), &theme, true).expect("resolves");
        let first = Arc::as_ptr(&cache[&1].groups);

        tree.set_text(2, "one fox only".to_string());
        let (_, changed) =
            resolve_highlight(&mut cache, &tree, 1, &query("fox"), &theme, true).expect("resolves");
        assert_ne!(Arc::as_ptr(&cache[&1].groups), first);
        assert_eq!(changed, Some(1), "two matches became one");
    }

    /// A review caught this: `reported` used to be written even with no
    /// listener, so mounting without `onHighlight` and adding it later reported
    /// nothing, forever.
    #[test]
    fn adding_the_listener_later_still_reports() {
        let theme = Theme::dark();
        let mut tree = tree_with_text();
        let mut cache = HashMap::new();

        declare(&mut tree, &query("fox"));
        let (_, changed) = resolve_highlight(&mut cache, &tree, 1, &query("fox"), &theme, false)
            .expect("resolves");
        assert_eq!(changed, None, "nothing to report without a listener");

        let (_, changed) =
            resolve_highlight(&mut cache, &tree, 1, &query("fox"), &theme, true).expect("resolves");
        assert_eq!(changed, Some(2), "the listener gets the current count");

        let (_, changed) =
            resolve_highlight(&mut cache, &tree, 1, &query("fox"), &theme, true).expect("resolves");
        assert_eq!(changed, None, "and only once");
    }
}

/// The `applyBatch` protocol. This is the surface JS talks to, so every rule it
/// relies on is asserted here against real JSON bytes rather than through a
/// hand-built `Vec<BatchOp>`.
#[cfg(test)]
mod batch_tests {
    use super::*;

    fn apply(tree: &mut RetainedTree, json: &str) -> BatchResult<Vec<f64>> {
        apply_batch_to_tree(tree, json.as_bytes())
    }

    #[test]
    fn a_string_encoded_style_no_longer_applies() {
        let mut tree = RetainedTree::new();
        let outcome = apply_batch_to_tree_with_diagnostics(
            &mut tree,
            br#"[["createElement",1,"div"],["setStyle",1,"{\"color\":\"red\"}"]]"#,
            true,
        )
        .expect("a non-object style degrades like any other");
        assert_eq!(
            tree.elements[&1].style.as_deref(),
            Some(&StyleDesc::default()),
            "a JSON-string style is no longer unwrapped into an object"
        );
        // Degrading silently would hide the version skew that sent it.
        let problems: Vec<_> = outcome
            .diagnostics
            .iter()
            .map(|diagnostic| (&diagnostic.problem.property, &diagnostic.problem.reason))
            .collect();
        assert!(
            problems
                .iter()
                .any(|(property, reason)| *property == "<style>"
                    && reason.contains("expected a style object")),
            "{problems:?}"
        );
    }

    /// A non-object style is a field-level problem: non-strict mode deliberately
    /// applies the degraded empty style instead of terminating the application.
    #[test]
    fn a_null_style_degrades_to_an_empty_style() {
        let mut tree = RetainedTree::new();
        apply(
            &mut tree,
            r#"[["createElement",1,"div"],["setStyle",1,null]]"#,
        )
        .expect("style problems degrade");
        assert_eq!(
            tree.elements[&1].style.as_deref(),
            Some(&StyleDesc::default())
        );
    }

    /// Skipping an unknown opcode would let a JS/Rust version skew desync the
    /// tree quietly. It has to throw.
    #[test]
    fn an_unknown_opcode_is_an_error() {
        let mut tree = RetainedTree::new();
        let error = apply(&mut tree, r#"[["teleportElement",1]]"#).expect_err("unknown opcode");
        assert!(error.contains("unknown operation"), "{error}");
        assert!(tree.elements.is_empty());
    }

    /// Every op that takes an id must validate it. A fractional or oversized id
    /// would truncate into a *different* element, which is a silent desync.
    #[test]
    fn an_invalid_id_is_rejected_in_every_id_position() {
        let templates = [
            r#"[["createElement",ID,"div"]]"#,
            r#"[["destroyElement",ID]]"#,
            r#"[["appendChild",ID,2]]"#,
            r#"[["appendChild",1,ID]]"#,
            r#"[["insertBefore",ID,2,3]]"#,
            r#"[["insertBefore",1,ID,3]]"#,
            r#"[["insertBefore",1,2,ID]]"#,
            r#"[["setStyle",ID,{}]]"#,
            r#"[["setText",ID,"x"]]"#,
            r#"[["setEventListener",ID,"click",true]]"#,
            r#"[["setRoot",ID]]"#,
            r#"[["setCustomPropValue",ID,"k",1]]"#,
        ];
        // 1e999 overflows f64, 9007199254740992 is Number.MAX_SAFE_INTEGER + 1.
        let bad_ids = ["-1", "1.5", "9007199254740992", "1e999"];

        for template in templates {
            for bad in bad_ids {
                let json = template.replace("ID", bad);
                let mut tree = RetainedTree::new();
                let error = apply(&mut tree, &json).expect_err(&format!("{json} must be rejected"));
                assert!(error.contains("Batch op 0"), "{json}: {error}");
                assert!(tree.elements.is_empty(), "{json} mutated the tree");
                assert_eq!(tree.root_id, None, "{json} mutated the root");
            }
        }
    }

    /// The reconciler sends a bool; hand-written batches send 0 or 1. Anything
    /// else used to mean `true`, so `-1` silently registered a listener.
    #[test]
    fn has_handler_takes_a_bool_or_a_non_negative_integer() {
        for (payload, expected) in [("true", true), ("false", false), ("1", true), ("0", false)] {
            let mut tree = RetainedTree::new();
            let json =
                format!(r#"[["createElement",1,"div"],["setEventListener",1,"click",{payload}]]"#);
            apply(&mut tree, &json).expect("bool or non-negative integer");
            assert_eq!(
                tree.elements[&1].events.contains("click"),
                expected,
                "hasHandler {payload}"
            );
        }

        for payload in ["-1", "0.5"] {
            let mut tree = RetainedTree::new();
            let json =
                format!(r#"[["createElement",1,"div"],["setEventListener",1,"click",{payload}]]"#);
            apply(&mut tree, &json).expect_err(&format!("hasHandler {payload} is not a bool"));
        }
    }

    #[test]
    fn a_malformed_op_tuple_is_an_error() {
        let cases = [
            (r#"[42]"#, "a non-array op"),
            (r#"[["createElement",1]]"#, "a missing argument"),
            (r#"[[7,1,"div"]]"#, "a non-string op name"),
        ];
        for (json, what) in cases {
            let mut tree = RetainedTree::new();
            let error = apply(&mut tree, json).expect_err(what);
            assert!(
                error.starts_with("Failed to parse batch:"),
                "{what}: {error}"
            );
            assert!(tree.elements.is_empty(), "{what} mutated the tree");
        }
    }

    /// The legacy `setCustomProp` opcode carried a JSON-string payload that the
    /// renderer decoded a second time. Only `setCustomPropValue` remains, so the
    /// old opcode has to fail as loudly as any other version skew would.
    #[test]
    fn the_legacy_set_custom_prop_opcode_is_rejected() {
        let mut tree = RetainedTree::new();
        let error = apply(
            &mut tree,
            r#"[["createElement",1,"img"],["setCustomProp",1,"src","{\"kind\":\"path\",\"url\":\"/tmp/a.png\"}"]]"#,
        )
        .expect_err("the legacy opcode is gone");

        assert!(error.contains("unknown operation"), "{error}");
        // The visitor's op index has to survive past the first op, or a skew
        // late in a long batch names nothing.
        assert!(error.contains("Batch op 1"), "{error}");
        assert!(tree.elements.is_empty(), "the batch must stay atomic");
    }

    #[test]
    fn set_custom_prop_value_preserves_raw_values() {
        let mut tree = RetainedTree::new();
        apply(
            &mut tree,
            r#"[["createElement",1,"code"],["setCustomPropValue",1,"code","true"],["setCustomPropValue",1,"metadata",{"language":"txt"}]]"#,
        )
        .expect("raw custom-prop operations");

        assert_eq!(
            tree.get_custom_prop(1, "code"),
            Some(&serde_json::Value::String("true".to_owned()))
        );
        assert_eq!(
            tree.get_custom_prop(1, "metadata"),
            Some(&serde_json::json!({ "language": "txt" }))
        );
    }

    /// Interning keys on raw bytes, so re-ordered keys are two `Arc`s. They are
    /// still the same style, and a repaint per key order would be a real cost
    /// on any app that builds style objects conditionally.
    #[test]
    fn a_reordered_style_does_not_repaint() {
        let mut tree = RetainedTree::new();
        apply(
            &mut tree,
            r#"[["createElement",1,"div"],["setStyle",1,{"color":"red","left":10}]]"#,
        )
        .expect("valid batch");
        let revision = tree.elements[&1].subtree_revision;

        apply(&mut tree, r#"[["setStyle",1,{"left":10,"color":"red"}]]"#).expect("valid batch");
        assert_eq!(
            tree.elements[&1].subtree_revision, revision,
            "the same style in another key order is not a change"
        );
    }

    /// Three ways an interned style loses its last element reference.
    #[test]
    fn a_style_is_released_when_nothing_references_it() {
        let mut tree = RetainedTree::new();
        apply(&mut tree, r#"[["createElement",1,"div"]]"#).expect("valid batch");

        // Set on an id that does not exist: nothing keeps the style alive.
        apply(&mut tree, r#"[["setStyle",99,{"color":"red"}]]"#).expect("missing ids are ignored");
        tree.styles.sweep();
        assert_eq!(tree.styles.len(), 0, "a style nobody took must be released");

        apply(&mut tree, r#"[["setStyle",1,{"color":"red"}]]"#).expect("valid batch");
        tree.styles.sweep();
        assert_eq!(tree.styles.len(), 1);

        // Replaced.
        apply(&mut tree, r#"[["setStyle",1,{"color":"blue"}]]"#).expect("valid batch");
        tree.styles.sweep();
        assert_eq!(tree.styles.len(), 1, "the replaced style must be released");

        // Destroyed.
        apply(&mut tree, r#"[["destroyElement",1]]"#).expect("valid batch");
        tree.styles.sweep();
        assert_eq!(tree.styles.len(), 0);
    }
}

#[cfg(test)]
mod window_options_tests {
    use super::*;

    fn mapped(options: WindowOptions) -> gpui::WindowOptions {
        mapped_with_bounds(options, 800.0, 600.0)
    }

    fn mapped_with_bounds(options: WindowOptions, width: f32, height: f32) -> gpui::WindowOptions {
        let bounds = gpui::Bounds {
            origin: gpui::point(gpui::px(0.0), gpui::px(0.0)),
            size: gpui::size(gpui::px(width), gpui::px(height)),
        };
        to_gpui_window_options(&options, bounds)
    }

    #[test]
    fn defaults_open_a_focused_visible_window() {
        let gpui_options = mapped(WindowOptions::default());
        assert!(gpui_options.focus);
        assert!(gpui_options.show);
    }

    #[test]
    fn reduced_motion_override_takes_precedence_over_the_os() {
        let os_reads = std::rc::Rc::new(std::cell::Cell::new(0));
        let os = |value| {
            let os_reads = os_reads.clone();
            move || {
                os_reads.set(os_reads.get() + 1);
                value
            }
        };

        assert!(effective_reduced_motion(Some(true), os(Some(false))));
        assert!(!effective_reduced_motion(Some(false), os(Some(true))));
        assert_eq!(os_reads.get(), 0, "explicit overrides must not read the OS");
        assert!(effective_reduced_motion(None, os(Some(true))));
        assert!(!effective_reduced_motion(None, os(Some(false))));
        assert!(!effective_reduced_motion(None, os(None)));
        assert_eq!(os_reads.get(), 3);
    }

    #[test]
    fn unset_focus_and_show_still_default_to_true() {
        let gpui_options = mapped(WindowOptions {
            focus: None,
            show: None,
            ..WindowOptions::default()
        });
        assert!(gpui_options.focus);
        assert!(gpui_options.show);
    }

    #[test]
    fn focus_false_leaves_the_window_visible() {
        let gpui_options = mapped(WindowOptions {
            focus: Some(false),
            ..WindowOptions::default()
        });
        assert!(!gpui_options.focus);
        assert!(gpui_options.show);
    }

    #[test]
    fn show_false_keeps_focus_independent() {
        let gpui_options = mapped(WindowOptions {
            show: Some(false),
            ..WindowOptions::default()
        });
        assert!(!gpui_options.show);
        assert!(gpui_options.focus);
    }

    #[test]
    fn min_width_constrains_the_initial_window_without_min_height() {
        let options = WindowOptions {
            min_width: Some(320.0),
            min_height: None,
            ..WindowOptions::default()
        };

        let gpui_options = mapped_with_bounds(options, 200.0, 100.0);
        assert_eq!(
            gpui_options.window_min_size,
            Some(gpui::WindowMinSize {
                width: Some(gpui::px(320.0)),
                height: None,
            })
        );
    }

    #[test]
    fn min_height_constrains_the_initial_window_without_min_width() {
        let options = WindowOptions {
            min_width: None,
            min_height: Some(240.0),
            ..WindowOptions::default()
        };

        let gpui_options = mapped_with_bounds(options, 200.0, 100.0);
        assert_eq!(
            gpui_options.window_min_size,
            Some(gpui::WindowMinSize {
                width: None,
                height: Some(gpui::px(240.0)),
            })
        );
    }

    #[test]
    fn min_width_constrains_resize_without_min_height() {
        let mut app = gpui::TestApp::new();
        let mut window = app.open_window_with_options(
            mapped_with_bounds(
                WindowOptions {
                    min_width: Some(320.0),
                    min_height: None,
                    ..WindowOptions::default()
                },
                480.0,
                300.0,
            ),
            |_, _| gpui::EmptyView,
        );

        // TestPlatform has no default minimum height; an omitted minHeight
        // must therefore leave the requested 12px height unconstrained.
        window.simulate_resize(gpui::size(gpui::px(100.0), gpui::px(12.0)));
        window.update(|_, window, cx| window.bounds_changed(cx));

        assert_eq!(
            window.update(|_, window, _| window.viewport_size()),
            gpui::size(gpui::px(320.0), gpui::px(12.0)),
        );
    }

    #[test]
    fn min_height_constrains_resize_without_min_width() {
        let mut app = gpui::TestApp::new();
        let mut window = app.open_window_with_options(
            mapped_with_bounds(
                WindowOptions {
                    min_width: None,
                    min_height: Some(240.0),
                    ..WindowOptions::default()
                },
                480.0,
                300.0,
            ),
            |_, _| gpui::EmptyView,
        );

        // TestPlatform has no default minimum width; an omitted minWidth
        // must therefore leave the requested 12px width unconstrained.
        window.simulate_resize(gpui::size(gpui::px(12.0), gpui::px(100.0)));
        window.update(|_, window, cx| window.bounds_changed(cx));

        assert_eq!(
            window.update(|_, window, _| window.viewport_size()),
            gpui::size(gpui::px(12.0), gpui::px(240.0)),
        );
    }

    #[test]
    fn existing_options_are_still_mapped() {
        let gpui_options = mapped_with_bounds(
            WindowOptions {
                title: Some("Background".to_string()),
                resizable: Some(false),
                window_background: Some("blurred".to_string()),
                min_width: Some(320.0),
                min_height: Some(240.0),
                focus: Some(false),
                ..WindowOptions::default()
            },
            200.0,
            100.0,
        );
        let titlebar = gpui_options.titlebar.expect("titlebar options");
        assert_eq!(titlebar.title.as_deref(), Some("Background"));
        assert!(!gpui_options.is_resizable);
        assert_eq!(
            gpui_options.window_background,
            gpui::WindowBackgroundAppearance::Blurred
        );
        assert_eq!(
            gpui_options.window_min_size,
            Some(gpui::WindowMinSize::new(gpui::px(320.0), gpui::px(240.0)))
        );
    }
}
