use gpui::StatefulInteractiveElement;

use crate::{
    renderer::{emit_event_full, EventCallback},
    retained_tree::RetainedElement,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccessibilityRole {
    Button,
    CheckBox,
    Heading,
    Link,
    Slider,
    SpinButton,
    Switch,
}

impl AccessibilityRole {
    fn parse(value: &serde_json::Value) -> Option<Self> {
        match value.as_str()? {
            "button" => Some(Self::Button),
            "checkbox" => Some(Self::CheckBox),
            "heading" => Some(Self::Heading),
            "link" => Some(Self::Link),
            "slider" => Some(Self::Slider),
            "spinbutton" => Some(Self::SpinButton),
            "switch" => Some(Self::Switch),
            _ => None,
        }
    }

    fn into_gpui(self) -> gpui::Role {
        match self {
            Self::Button => gpui::Role::Button,
            Self::CheckBox => gpui::Role::CheckBox,
            Self::Heading => gpui::Role::Heading,
            Self::Link => gpui::Role::Link,
            Self::Slider => gpui::Role::Slider,
            Self::SpinButton => gpui::Role::SpinButton,
            Self::Switch => gpui::Role::Switch,
        }
    }

    fn supports_action(self, action: gpui::AccessibleAction) -> bool {
        match action {
            gpui::AccessibleAction::Click => matches!(
                self,
                Self::Button | Self::CheckBox | Self::Link | Self::Switch
            ),
            gpui::AccessibleAction::Increment | gpui::AccessibleAction::Decrement => {
                matches!(self, Self::Slider | Self::SpinButton)
            }
            gpui::AccessibleAction::Focus => true,
            _ => false,
        }
    }
}

#[derive(Debug, Default)]
struct AccessibilityProps<'a> {
    role: Option<AccessibilityRole>,
    label: Option<&'a str>,
    description: Option<&'a str>,
    checked: Option<gpui::Toggled>,
    expanded: Option<bool>,
    selected: Option<bool>,
    value: Option<&'a str>,
    value_min: Option<f64>,
    value_max: Option<f64>,
    value_now: Option<f64>,
    level: Option<usize>,
    disabled: Option<bool>,
}

impl<'a> AccessibilityProps<'a> {
    fn from_element(element: &'a RetainedElement) -> Self {
        Self {
            role: element
                .custom_props
                .get("role")
                .and_then(AccessibilityRole::parse),
            label: element
                .custom_props
                .get("ariaLabel")
                .and_then(serde_json::Value::as_str),
            description: element
                .custom_props
                .get("ariaDescription")
                .and_then(serde_json::Value::as_str),
            checked: element.custom_props.get("ariaChecked").and_then(|value| {
                if let Some(checked) = value.as_bool() {
                    Some(if checked {
                        gpui::Toggled::True
                    } else {
                        gpui::Toggled::False
                    })
                } else if value.as_str() == Some("mixed") {
                    Some(gpui::Toggled::Mixed)
                } else {
                    None
                }
            }),
            expanded: element
                .custom_props
                .get("ariaExpanded")
                .and_then(serde_json::Value::as_bool),
            selected: element
                .custom_props
                .get("ariaSelected")
                .and_then(serde_json::Value::as_bool),
            value: element
                .custom_props
                .get("ariaValue")
                .and_then(serde_json::Value::as_str),
            value_min: finite_number(element.custom_props.get("ariaValueMin")),
            value_max: finite_number(element.custom_props.get("ariaValueMax")),
            value_now: finite_number(element.custom_props.get("ariaValueNow")),
            level: element
                .custom_props
                .get("ariaLevel")
                .and_then(serde_json::Value::as_u64)
                .and_then(|level| usize::try_from(level).ok())
                .filter(|level| *level > 0),
            disabled: element
                .custom_props
                .get("disabled")
                .and_then(serde_json::Value::as_bool),
        }
    }
}

fn finite_number(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}

/// Apply React accessibility props to GPUI's existing AccessKit-backed div API.
///
/// The GPUI element id remains the stable AccessKit identity. The author `id`
/// is additional platform-visible metadata, never the identity source.
pub(crate) fn apply<E>(
    mut el: E,
    element: &RetainedElement,
    callback: &Option<EventCallback>,
    focus_handle: Option<&gpui::FocusHandle>,
) -> E
where
    E: StatefulInteractiveElement,
{
    let props = AccessibilityProps::from_element(element);

    if let Some(role) = props.role {
        el = el.role(role.into_gpui());
    }
    if let Some(author_id) = &element.author_id {
        el = el.accessibility_id(author_id.clone());
    }
    if let Some(label) = props.label {
        el = el.aria_label(label.to_owned());
    }
    if let Some(description) = props.description {
        el = el.aria_description(description.to_owned());
    }
    if let Some(checked) = props.checked {
        el = el.aria_toggled(checked);
    }
    if let Some(expanded) = props.expanded {
        el = el.aria_expanded(expanded);
    }
    if let Some(selected) = props.selected {
        el = el.aria_selected(selected);
    }
    if let Some(value) = props.value {
        el = el.aria_value(value.to_owned());
    }
    if let Some(value_min) = props.value_min {
        el = el.aria_min_numeric_value(value_min);
    }
    if let Some(value_max) = props.value_max {
        el = el.aria_max_numeric_value(value_max);
    }
    if let Some(value_now) = props.value_now {
        el = el.aria_numeric_value(value_now);
    }
    if let Some(level) = props.level {
        el = el.aria_level(level);
    }
    if let Some(disabled) = props.disabled {
        el = el.aria_disabled(disabled);
    }

    if let Some(role) = props
        .role
        .filter(|_| element.events.contains("accessibilityAction"))
    {
        for (native_action, public_action) in [
            (gpui::AccessibleAction::Click, "activate"),
            (gpui::AccessibleAction::Increment, "increment"),
            (gpui::AccessibleAction::Decrement, "decrement"),
            (gpui::AccessibleAction::Focus, "focus"),
        ]
        .into_iter()
        .filter(|(action, _)| role.supports_action(*action))
        {
            let callback = callback.clone();
            let focus_handle = focus_handle.cloned();
            let id = element.id;
            el = el.on_a11y_action(native_action, move |_data, window, cx| {
                if native_action == gpui::AccessibleAction::Focus {
                    if let Some(handle) = &focus_handle {
                        handle.focus(window, cx);
                    }
                }
                emit_event_full(&callback, id, "accessibilityAction", |payload| {
                    payload.accessibility_action = Some(public_action.to_string());
                });
            });
        }
    }

    el
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_roles_and_states() {
        let mut element = RetainedElement::new(7, "div".to_string(), 1);
        element.custom_props.insert("role".into(), "slider".into());
        element
            .custom_props
            .insert("ariaLabel".into(), "Save".into());
        element
            .custom_props
            .insert("ariaDescription".into(), "Factory output".into());
        element
            .custom_props
            .insert("ariaChecked".into(), "mixed".into());
        element
            .custom_props
            .insert("ariaExpanded".into(), true.into());
        element
            .custom_props
            .insert("ariaSelected".into(), false.into());
        element
            .custom_props
            .insert("ariaValue".into(), "42 percent".into());
        element.custom_props.insert("ariaValueMin".into(), 0.into());
        element
            .custom_props
            .insert("ariaValueMax".into(), 100.into());
        element
            .custom_props
            .insert("ariaValueNow".into(), 42.into());
        element.custom_props.insert("ariaLevel".into(), 2.into());
        element.custom_props.insert("disabled".into(), true.into());

        let props = AccessibilityProps::from_element(&element);
        assert_eq!(props.role, Some(AccessibilityRole::Slider));
        assert_eq!(props.label, Some("Save"));
        assert_eq!(props.description, Some("Factory output"));
        assert_eq!(props.checked, Some(gpui::Toggled::Mixed));
        assert_eq!(props.expanded, Some(true));
        assert_eq!(props.selected, Some(false));
        assert_eq!(props.value, Some("42 percent"));
        assert_eq!(props.value_min, Some(0.0));
        assert_eq!(props.value_max, Some(100.0));
        assert_eq!(props.value_now, Some(42.0));
        assert_eq!(props.level, Some(2));
        assert_eq!(props.disabled, Some(true));
    }

    #[test]
    fn rejects_unsupported_or_malformed_semantics() {
        let mut element = RetainedElement::new(7, "div".to_string(), 1);

        element.custom_props.insert("role".into(), "invalid".into());
        element.custom_props.insert("ariaLabel".into(), true.into());
        element
            .custom_props
            .insert("ariaChecked".into(), "invalid".into());
        element
            .custom_props
            .insert("ariaValueNow".into(), "42".into());
        element.custom_props.insert("ariaLevel".into(), 0.into());
        let props = AccessibilityProps::from_element(&element);
        assert_eq!(props.role, None);
        assert_eq!(props.label, None);
        assert_eq!(props.checked, None);
        assert_eq!(props.value_now, None);
        assert_eq!(props.level, None);
    }
}
