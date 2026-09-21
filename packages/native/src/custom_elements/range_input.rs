//! `<input type="range">`.
//!
//! A range holds a number, not text, so the text editor is the wrong adapter
//! for it. Its value is owned by the React reconciler, which sanitizes it the
//! way HTML does, steps it on arrow keys and on assistive technology's
//! increment and decrement actions, and writes the result here as the internal
//! `value` prop. This side paints the track and thumb, takes focus, reports its
//! keys, and gives the accessibility tree the value, bounds and step.

use gpui::{div, prelude::*, px, relative, Context, SharedString, Window};

use super::choice_input::InputKind;
use super::{CustomElement, CustomRenderContext};
use crate::retained_tree::RetainedElement;
use crate::theme::Theme;

/// Chromium's default range box.
const DEFAULT_WIDTH: f32 = 129.0;
const DEFAULT_HEIGHT: f32 = 16.0;
const TRACK_HEIGHT: f32 = 4.0;
const THUMB_SIZE: f32 = 12.0;

/// A range's bounds, step and current value, as the accessibility tree reads
/// them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RangeValues {
    pub(crate) min: f64,
    pub(crate) max: f64,
    /// `None` for `step="any"`.
    pub(crate) step: Option<f64>,
    pub(crate) value: f64,
}

/// HTML's rules for parsing floating-point number values, for a prop that may
/// arrive as a number or a string. `parseRangeNumber` in the React reconciler
/// must agree.
fn range_number(value: Option<&serde_json::Value>) -> Option<f64> {
    let number = match value? {
        serde_json::Value::Number(number) => number.as_f64()?,
        serde_json::Value::String(text) if !text.is_empty() && text.trim() == text => {
            text.parse::<f64>().ok()?
        }
        _ => return None,
    };
    number.is_finite().then_some(number)
}

/// The values of a range input, or `None` for any other element.
///
/// `min` is 0 and `max` 100 unless authored, and `max` is never below `min`.
/// The value is the one the reconciler last wrote, already sanitized against
/// these bounds; before it arrives, the midpoint stands in for it, as HTML's
/// default does.
pub(crate) fn range_values(element: &RetainedElement) -> Option<RangeValues> {
    if InputKind::of(element) != InputKind::Range {
        return None;
    }
    let props = &element.custom_props;
    let min = range_number(props.get("min")).unwrap_or(0.0);
    let max = range_number(props.get("max")).unwrap_or(100.0).max(min);
    let any_step = props
        .get("step")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|step| step.eq_ignore_ascii_case("any"));
    let step = (!any_step).then(|| {
        range_number(props.get("step"))
            .filter(|step| *step > 0.0)
            .unwrap_or(1.0)
    });
    let value = range_number(props.get("value"))
        .unwrap_or(min + (max - min) / 2.0)
        .clamp(min, max);
    Some(RangeValues {
        min,
        max,
        step,
        value,
    })
}

pub(crate) struct RangeInputElement {
    theme: Theme,
}

impl RangeInputElement {
    pub(crate) fn new() -> Self {
        Self {
            theme: Theme::dark(),
        }
    }
}

impl CustomElement for RangeInputElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut Window,
        cx: &mut Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        let element = ctx.retained_element;
        let native_disabled =
            crate::accessibility::is_native_disabled(element) || ctx.accessibility_hidden;
        let fraction = range_values(element).map_or(0.5, |range| {
            if range.max > range.min {
                ((range.value - range.min) / (range.max - range.min)) as f32
            } else {
                0.0
            }
        });

        let track = div()
            .absolute()
            .left_0()
            .right_0()
            .h(px(TRACK_HEIGHT))
            .rounded(px(TRACK_HEIGHT / 2.0))
            .bg(self.theme.border)
            .child(
                div()
                    .h_full()
                    .w(relative(fraction))
                    .rounded(px(TRACK_HEIGHT / 2.0))
                    .bg(self.theme.accent),
            );
        // The thumb's centre travels the track's full width, so at either end
        // half of it overhangs, as a browser's does.
        let thumb = div()
            .absolute()
            .left(relative(fraction))
            .ml(px(-THUMB_SIZE / 2.0))
            .w(px(THUMB_SIZE))
            .h(px(THUMB_SIZE))
            .rounded_full()
            .bg(self.theme.accent);

        let mut el = div()
            .id(SharedString::from(format!("__gpuix_editor_{}", ctx.id)))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .w(px(DEFAULT_WIDTH))
            .h(px(DEFAULT_HEIGHT))
            .child(track)
            .child(thumb);
        if native_disabled {
            el = el.opacity(0.5);
        } else if let Some(handle) = ctx.focus_handle {
            el = el.track_focus(handle);
        }
        // Authored styles land on top of the default box, so `width` and the
        // visually-hidden styles Base UI applies win over it.
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

        el.into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        if key == "theme" {
            self.theme = Theme::from_prop(Some(&value));
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["value", "min", "max", "step", "theme"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[
            "keyDown",
            "keyUp",
            "focus",
            "blur",
            "click",
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
        Some(serde_json::json!({ "kind": "range" }))
    }

    fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(props: &[(&str, serde_json::Value)]) -> RetainedElement {
        let mut element = RetainedElement::new(1, "input".to_string(), 0);
        element
            .custom_props
            .insert("type".into(), serde_json::json!("range"));
        for (key, value) in props {
            element.custom_props.insert((*key).into(), value.clone());
        }
        element
    }

    #[test]
    fn a_range_defaults_to_zero_to_one_hundred_at_the_midpoint() {
        assert_eq!(
            range_values(&range(&[])),
            Some(RangeValues {
                min: 0.0,
                max: 100.0,
                step: Some(1.0),
                value: 50.0,
            })
        );
    }

    #[test]
    fn a_range_reads_numeric_and_string_bounds_and_keeps_max_above_min() {
        let values = range_values(&range(&[
            ("min", serde_json::json!("10")),
            ("max", serde_json::json!(5)),
            ("step", serde_json::json!("any")),
            ("value", serde_json::json!(7)),
        ]))
        .unwrap();
        assert_eq!(values.min, 10.0);
        assert_eq!(values.max, 10.0);
        assert_eq!(values.step, None);
        assert_eq!(values.value, 10.0);
    }

    #[test]
    fn malformed_bounds_and_steps_fall_back_to_the_defaults() {
        let values = range_values(&range(&[
            ("min", serde_json::json!(" 3")),
            ("max", serde_json::json!("x")),
            ("step", serde_json::json!(-2)),
        ]))
        .unwrap();
        assert_eq!(
            (values.min, values.max, values.step),
            (0.0, 100.0, Some(1.0))
        );
    }

    #[test]
    fn only_a_range_input_has_range_values() {
        let mut text = range(&[]);
        text.custom_props
            .insert("type".into(), serde_json::json!("text"));
        assert_eq!(range_values(&text), None);
    }
}
