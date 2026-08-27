use gpui::StatefulInteractiveElement;

use crate::{
    renderer::{emit_event_full, EventCallback},
    retained_tree::RetainedElement,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccessibilityRole {
    Button,
}

impl AccessibilityRole {
    fn parse(value: &serde_json::Value) -> Option<Self> {
        match value.as_str()? {
            "button" => Some(Self::Button),
            _ => None,
        }
    }

    fn into_gpui(self) -> gpui::Role {
        match self {
            Self::Button => gpui::Role::Button,
        }
    }
}

#[derive(Debug, Default)]
struct AccessibilityProps<'a> {
    role: Option<AccessibilityRole>,
    label: Option<&'a str>,
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
        }
    }
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

    if element.events.contains("accessibilityAction") {
        for (native_action, public_action) in [
            (gpui::AccessibleAction::Click, "activate"),
            (gpui::AccessibleAction::Increment, "increment"),
            (gpui::AccessibleAction::Decrement, "decrement"),
            (gpui::AccessibleAction::Focus, "focus"),
        ] {
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
    fn parses_only_supported_roles_and_string_labels() {
        let mut element = RetainedElement::new(7, "div".to_string(), 1);
        element.custom_props.insert("role".into(), "button".into());
        element
            .custom_props
            .insert("ariaLabel".into(), "Save".into());

        let props = AccessibilityProps::from_element(&element);
        assert_eq!(props.role, Some(AccessibilityRole::Button));
        assert_eq!(props.label, Some("Save"));

        element.custom_props.insert("role".into(), "invalid".into());
        element.custom_props.insert("ariaLabel".into(), true.into());
        let props = AccessibilityProps::from_element(&element);
        assert_eq!(props.role, None);
        assert_eq!(props.label, None);
    }
}
