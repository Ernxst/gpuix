//! `<input type="checkbox">`, `<input type="radio">`, and `<input type="hidden">`.
//!
//! These inputs hold no text, so the text editor is the wrong adapter for them.
//! Their state is owned by the React reconciler, which implements HTML's
//! activation, reset, and submission rules and writes the effective state here
//! as the internal `checked` and `indeterminate` props. This side paints the
//! control, takes focus, reports its clicks and keys, and answers the questions
//! that need the retained tree: accessibility state and radio-group tab stops.

use std::collections::{HashMap, HashSet};

use gpui::{div, point, prelude::*, px, relative, Context, Pixels, SharedString, Window};

use super::{CustomElement, CustomRenderContext};
use crate::retained_tree::{RetainedElement, RetainedTree};
use crate::theme::Theme;

/// The adapter an `<input>` needs, chosen by its `type`.
///
/// Every type without its own adapter is a text editor, as an unknown `type`
/// is a text input in HTML. `inputKind` in the React reconciler must agree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InputKind {
    Text,
    Checkbox,
    Radio,
    Hidden,
    Range,
}

impl InputKind {
    pub(crate) fn from_type(value: Option<&serde_json::Value>) -> Self {
        match value
            .and_then(serde_json::Value::as_str)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("checkbox") => Self::Checkbox,
            Some("radio") => Self::Radio,
            Some("hidden") => Self::Hidden,
            Some("range") => Self::Range,
            _ => Self::Text,
        }
    }

    /// The kind of a retained element. Everything but `<input>` is `Text`,
    /// which is what a `<textarea>` is.
    pub(crate) fn of(element: &RetainedElement) -> Self {
        if element.element_type != "input" {
            return Self::Text;
        }
        Self::from_type(element.custom_props.get("type"))
    }

    pub(crate) fn is_choice(self) -> bool {
        matches!(self, Self::Checkbox | Self::Radio)
    }
}

/// `<input>` (other than a hidden one) and `<textarea>` are tab stops
/// without an authored `tabIndex`.
pub(crate) fn is_default_focusable_control(element: &RetainedElement) -> bool {
    matches!(element.element_type.as_str(), "input" | "textarea")
        && InputKind::of(element) != InputKind::Hidden
}

/// A checkbox's or radio's state, as the reconciler last wrote it.
pub(crate) fn choice_state(element: &RetainedElement) -> Option<gpui::Toggled> {
    let kind = InputKind::of(element);
    if !kind.is_choice() {
        return None;
    }
    let flag = |key: &str| {
        element
            .custom_props
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    };
    Some(if kind == InputKind::Checkbox && flag("indeterminate") {
        gpui::Toggled::Mixed
    } else if flag("checked") {
        gpui::Toggled::True
    } else {
        gpui::Toggled::False
    })
}

// ── Radio groups ─────────────────────────────────────────────────────

/// HTML's form owner, as the reconciler resolves it: the `<form>` a `form`
/// prop names, or else the nearest ancestor `<form>`. A `form` prop that names
/// nothing leaves the control without an owner.
fn form_owner(tree: &RetainedTree, element: &RetainedElement) -> Option<u64> {
    let is_form = |candidate: &RetainedElement| {
        candidate
            .custom_props
            .get("authoredHostType")
            .and_then(serde_json::Value::as_str)
            == Some("form")
    };
    if let Some(form) = element
        .custom_props
        .get("form")
        .and_then(serde_json::Value::as_str)
        .filter(|form| !form.is_empty())
    {
        return tree
            .elements
            .values()
            .filter(|candidate| candidate.author_id.as_deref() == Some(form) && is_form(candidate))
            .map(|candidate| candidate.id)
            .min();
    }
    let mut current = element.parent;
    while let Some(id) = current {
        let ancestor = tree.elements.get(&id)?;
        if is_form(ancestor) {
            return Some(id);
        }
        current = ancestor.parent;
    }
    None
}

/// The enabled, named radios of the tree that can take focus, grouped by form
/// owner and name, each group in tree order.
#[derive(Debug, Default)]
pub(crate) struct RadioGroups {
    groups: Vec<Vec<(u64, bool)>>,
    group_of: HashMap<u64, usize>,
}

impl RadioGroups {
    /// `unreachable` reports a radio that cannot take focus even though it is
    /// enabled — one under `display: none` or `ariaHidden`. Leaving it out keeps
    /// a group's tab stop on a radio that can actually be focused.
    pub(crate) fn collect(tree: &RetainedTree, unreachable: impl Fn(u64) -> bool) -> Self {
        let mut result = Self::default();
        let Some(root) = tree.root_id else {
            return result;
        };
        let mut keys: HashMap<(Option<u64>, String), usize> = HashMap::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            let Some(element) = tree.elements.get(&id) else {
                continue;
            };
            stack.extend(element.children.iter().rev().copied());
            if InputKind::of(element) != InputKind::Radio
                || crate::accessibility::is_native_disabled(element)
                || unreachable(id)
            {
                continue;
            }
            let Some(name) = element
                .custom_props
                .get("name")
                .and_then(serde_json::Value::as_str)
                .filter(|name| !name.is_empty())
            else {
                continue;
            };
            let key = (form_owner(tree, element), name.to_string());
            let index = *keys.entry(key).or_insert_with(|| {
                result.groups.push(Vec::new());
                result.groups.len() - 1
            });
            let checked = choice_state(element) == Some(gpui::Toggled::True);
            result.groups[index].push((id, checked));
            result.group_of.insert(id, index);
        }
        result
    }

    /// The group this radio belongs to, when it shares one with another radio.
    pub(crate) fn members(&self, id: u64) -> Option<&[(u64, bool)]> {
        let group = &self.groups[*self.group_of.get(&id)?];
        (group.len() > 1).then_some(group.as_slice())
    }

    /// A group is one tab stop: its checked radio, or its first radio when
    /// none is checked. Every other member is skipped by Tab, and reached with
    /// the arrow keys instead.
    pub(crate) fn tab_skips(&self) -> HashSet<u64> {
        let mut skips = HashSet::new();
        for group in &self.groups {
            let stop = group
                .iter()
                .find(|(_, checked)| *checked)
                .or_else(|| group.first())
                .map(|(id, _)| *id);
            skips.extend(group.iter().map(|(id, _)| *id).filter(|id| Some(*id) != stop));
        }
        skips
    }
}

// ── Adapters ─────────────────────────────────────────────────────────

/// The side of the default control, as browsers draw it at 100% zoom.
const DEFAULT_SIZE: f32 = 13.0;

pub(crate) struct ChoiceInputElement {
    radio: bool,
    checked: bool,
    indeterminate: bool,
    theme: Theme,
}

impl ChoiceInputElement {
    pub(crate) fn new(kind: InputKind) -> Self {
        Self {
            radio: kind == InputKind::Radio,
            checked: false,
            indeterminate: false,
            theme: Theme::dark(),
        }
    }

    /// The glyph inside the box: a tick, a dash for a mixed checkbox, or a
    /// radio's dot. Each scales with the box an author sizes.
    fn mark(&self) -> Option<gpui::AnyElement> {
        let accent = self.theme.accent;
        if self.radio {
            return self.checked.then(|| {
                div()
                    .w(relative(0.5))
                    .h(relative(0.5))
                    .rounded_full()
                    .bg(accent)
                    .into_any_element()
            });
        }
        let ink = self.theme.bg;
        if self.indeterminate {
            return Some(
                div()
                    .w(relative(0.6))
                    .h(relative(0.16))
                    .rounded(px(1.0))
                    .bg(ink)
                    .into_any_element(),
            );
        }
        self.checked.then(|| {
            gpui::canvas(
                |_, _, _| (),
                move |bounds, _, window, _| {
                    let width = f32::from(bounds.size.width);
                    let height = f32::from(bounds.size.height);
                    let at = |x: f32, y: f32| {
                        point(
                            bounds.origin.x + px(width * x),
                            bounds.origin.y + px(height * y),
                        )
                    };
                    let mut path = gpui::PathBuilder::stroke(px((width.min(height) * 0.14).max(1.0)));
                    path.move_to(at(0.22, 0.52));
                    path.line_to(at(0.42, 0.72));
                    path.line_to(at(0.78, 0.30));
                    if let Ok(path) = path.build() {
                        window.paint_path(path, ink);
                    }
                },
            )
            .absolute()
            .size_full()
            .into_any_element()
        })
    }
}

impl CustomElement for ChoiceInputElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut Window,
        cx: &mut Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        let element = ctx.retained_element;
        let native_disabled =
            crate::accessibility::is_native_disabled(element) || ctx.accessibility_hidden;
        let filled = !self.radio && (self.checked || self.indeterminate);
        let border = if self.checked || self.indeterminate {
            self.theme.accent
        } else {
            self.theme.border
        };
        let size = px(DEFAULT_SIZE);
        let corner: Pixels = if self.radio { size } else { px(3.0) };

        let mut el = div()
            .id(SharedString::from(format!("__gpuix_editor_{}", ctx.id)))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .w(size)
            .h(size)
            .border_1()
            .border_color(border)
            .rounded(corner)
            .bg(if filled { self.theme.accent } else { self.theme.bg })
            .overflow_hidden();
        if native_disabled {
            el = el.opacity(0.5);
        } else if let Some(handle) = ctx.focus_handle {
            el = el.track_focus(handle);
        }
        // Authored styles land on top of the default box, so `width`, `border`,
        // and the visually-hidden styles Base UI applies all win over it.
        el = super::custom_surface(el, &ctx, cx);
        el = crate::accessibility::apply(
            el,
            ctx.tree,
            element,
            ctx.event_callback,
            ctx.focus_handle,
            ctx.accessibility_hidden,
            crate::accessibility::AccessibleText::default(),
        );

        if element.events.contains("click") && !native_disabled {
            let callback = ctx.event_callback.clone();
            let id = ctx.id;
            el = el.on_click(move |click, _window, cx| {
                // Space activates a checkbox or radio; Enter submits its form
                // in a browser, which is not this control's to do.
                if matches!(
                    click,
                    gpui::ClickEvent::Keyboard(event) if event.button == gpui::KeyboardButton::Enter
                ) {
                    return;
                }
                crate::renderer::emit_event_full(&callback, id, "click", |payload| {
                    let (x, y) = crate::renderer::point_to_xy(click.position());
                    payload.x = Some(x);
                    payload.y = Some(y);
                    payload.modifiers = Some(click.modifiers().into());
                    payload.click_count = Some(click.click_count() as u32);
                    payload.is_right_click = Some(click.is_right_click());
                    payload.button = Some(match click {
                        gpui::ClickEvent::Mouse(event) => {
                            crate::renderer::mouse_button_to_u32(event.down.button)
                        }
                        gpui::ClickEvent::Keyboard(_) | gpui::ClickEvent::Touch(_) => 0,
                    });
                    payload.input_source = Some(
                        match click {
                            gpui::ClickEvent::Mouse(_) => "mouse",
                            gpui::ClickEvent::Keyboard(_) => "keyboard",
                            gpui::ClickEvent::Touch(_) => "touch",
                        }
                        .to_string(),
                    );
                });
                // React bubbles the click to ancestors; their own GPUI click
                // listeners must not report it a second time.
                if !matches!(click, gpui::ClickEvent::Keyboard(_)) {
                    cx.stop_propagation();
                }
            });
        }
        if !native_disabled && ctx.style.is_some_and(|style| style.active.is_some()) {
            let focus_handle = ctx.focus_handle.cloned();
            let id = ctx.id;
            el = el.on_key_down(cx.listener(move |view, event: &gpui::KeyDownEvent, window, cx| {
                let activates = event.keystroke.key == "space" && !event.keystroke.modifiers.modified();
                if activates
                    && focus_handle.as_ref().is_some_and(|handle| handle.is_focused(window))
                    && view.begin_keyboard_active(id)
                {
                    cx.notify();
                }
            }));
        }
        if ctx.events.contains("keyDown") {
            let callback = ctx.event_callback.clone();
            let id = ctx.id;
            el = el.on_key_down(move |event, _window, _cx| {
                crate::renderer::emit_event_full(&callback, id, "keyDown", |payload| {
                    payload.key = Some(event.keystroke.key.clone());
                    payload.key_char = event.keystroke.key_char.clone();
                    payload.is_held = Some(event.is_held);
                    payload.modifiers = Some(event.keystroke.modifiers.into());
                });
            });
        }
        if ctx.events.contains("keyUp") {
            let callback = ctx.event_callback.clone();
            let id = ctx.id;
            el = el.on_key_up(move |event, _window, _cx| {
                crate::renderer::emit_event_full(&callback, id, "keyUp", |payload| {
                    payload.key = Some(event.keystroke.key.clone());
                    payload.key_char = event.keystroke.key_char.clone();
                    payload.modifiers = Some(event.keystroke.modifiers.into());
                });
            });
        }

        match self.mark() {
            Some(mark) => el.child(mark).into_any_element(),
            None => el.into_any_element(),
        }
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "checked" => self.checked = value.as_bool().unwrap_or(false),
            "indeterminate" => self.indeterminate = !self.radio && value.as_bool().unwrap_or(false),
            "theme" => self.theme = Theme::from_prop(Some(&value)),
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["checked", "indeterminate", "theme"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        // `click` is wired above rather than by `custom_surface`, which does
        // not tell Space from Enter.
        &[
            "keyDown",
            "keyUp",
            "focus",
            "blur",
            "mouseDown",
            "mouseUp",
            "contextMenu",
            "mouseEnter",
            "mouseLeave",
            "pointerDown",
            "pointerUp",
            "pointerMove",
            "pointerCancel",
            "pointerEnter",
            "pointerLeave",
            "wheel",
            "dragEnter",
            "dragOver",
            "dragLeave",
            "drop",
            "fileDrop",
        ]
    }

    fn test_state(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "kind": if self.radio { "radio" } else { "checkbox" },
            "checked": self.checked,
            "indeterminate": self.indeterminate,
        }))
    }

    fn destroy(&mut self) {}
}

/// `<input type="hidden">`: nothing to paint, focus, or announce. It exists
/// for the value the reconciler submits with its form.
pub(crate) struct HiddenInputElement;

impl CustomElement for HiddenInputElement {
    fn render(
        &mut self,
        _ctx: CustomRenderContext,
        _window: &mut Window,
        _cx: &mut Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        gpui::Empty.into_any_element()
    }

    fn set_prop(&mut self, _key: &str, _value: serde_json::Value) {}

    fn supported_props(&self) -> &'static [&'static str] {
        &[]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[]
    }

    fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree_with(children: &[(u64, &[(&str, serde_json::Value)])]) -> RetainedTree {
        let mut tree = RetainedTree::new();
        tree.create_element(1, "div".to_string());
        tree.root_id = Some(1);
        for (id, props) in children {
            tree.create_element(*id, "input".to_string());
            for (key, value) in *props {
                tree.set_custom_prop(*id, (*key).to_string(), value.clone());
            }
            tree.append_child(1, *id);
        }
        tree
    }

    #[test]
    fn input_kind_is_case_insensitive_and_defaults_to_text() {
        let kind = |value: serde_json::Value| InputKind::from_type(Some(&value));
        assert_eq!(kind("CheckBox".into()), InputKind::Checkbox);
        assert_eq!(kind("radio".into()), InputKind::Radio);
        assert_eq!(kind("hidden".into()), InputKind::Hidden);
        assert_eq!(kind("Range".into()), InputKind::Range);
        assert_eq!(kind("email".into()), InputKind::Text);
        assert_eq!(InputKind::from_type(None), InputKind::Text);
    }

    #[test]
    fn indeterminate_is_mixed_only_on_a_checkbox() {
        let tree = tree_with(&[
            (2, &[("type", "checkbox".into()), ("indeterminate", true.into())]),
            (3, &[("type", "radio".into()), ("indeterminate", true.into())]),
            (4, &[("type", "radio".into()), ("checked", true.into())]),
        ]);
        assert_eq!(choice_state(&tree.elements[&2]), Some(gpui::Toggled::Mixed));
        assert_eq!(choice_state(&tree.elements[&3]), Some(gpui::Toggled::False));
        assert_eq!(choice_state(&tree.elements[&4]), Some(gpui::Toggled::True));
    }

    #[test]
    fn a_radio_group_is_one_tab_stop() {
        let radio = |name: &str, checked: bool| -> Vec<(&'static str, serde_json::Value)> {
            vec![
                ("type", "radio".into()),
                ("name", name.to_string().into()),
                ("checked", checked.into()),
            ]
        };
        let (a, b, c) = (radio("size", false), radio("size", true), radio("size", false));
        let (d, e) = (radio("tone", false), radio("tone", false));
        let tree = tree_with(&[(2, &a), (3, &b), (4, &c), (5, &d), (6, &e)]);
        let groups = RadioGroups::collect(&tree, |_| false);
        assert_eq!(groups.tab_skips(), HashSet::from([2, 4, 6]));
        assert_eq!(groups.members(5).map(<[_]>::len), Some(2));
    }

    #[test]
    fn disabled_and_unnamed_radios_are_not_grouped() {
        let tree = tree_with(&[
            (2, &[("type", "radio".into())]),
            (3, &[("type", "radio".into())]),
            (
                4,
                &[
                    ("type", "radio".into()),
                    ("name", "size".into()),
                    ("disabled", true.into()),
                ],
            ),
            (5, &[("type", "radio".into()), ("name", "size".into())]),
        ]);
        let groups = RadioGroups::collect(&tree, |_| false);
        assert!(groups.tab_skips().is_empty());
        assert!(groups.members(5).is_none());
    }

    #[test]
    fn an_unreachable_radio_is_never_the_tab_stop() {
        let radio = |checked: bool| -> Vec<(&'static str, serde_json::Value)> {
            vec![
                ("type", "radio".into()),
                ("name", "size".into()),
                ("checked", checked.into()),
            ]
        };
        // The first member would be the stop, and the checked one would win,
        // but both are hidden.
        let (a, b, c, d) = (radio(false), radio(true), radio(false), radio(false));
        let tree = tree_with(&[(2, &a), (3, &b), (4, &c), (5, &d)]);
        let groups = RadioGroups::collect(&tree, |id| id == 2 || id == 3);
        assert_eq!(groups.tab_skips(), HashSet::from([5]));
        assert_eq!(groups.members(4).map(<[_]>::len), Some(2));
        assert!(groups.members(2).is_none());
    }
}
