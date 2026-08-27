use gpui::StatefulInteractiveElement;

use crate::{
    renderer::{emit_event_full, EventCallback},
    retained_tree::RetainedElement,
    style::StyleProblem,
};

const ACCESSIBILITY_PROPS: &[&str] = &[
    "role",
    "ariaLabel",
    "ariaDescription",
    "ariaChecked",
    "ariaExpanded",
    "ariaSelected",
    "ariaValue",
    "ariaValueMin",
    "ariaValueMax",
    "ariaValueNow",
    "ariaLevel",
    "ariaDisabled",
    "ariaHidden",
    "disabled",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccessibilityRole {
    Button,
    CheckBox,
    Heading,
    Image,
    Link,
    Option,
    Slider,
    SpinButton,
    Switch,
    TextBox,
}

impl AccessibilityRole {
    fn parse(value: &serde_json::Value) -> Option<Self> {
        match value.as_str()? {
            "button" => Some(Self::Button),
            "checkbox" => Some(Self::CheckBox),
            "heading" => Some(Self::Heading),
            "img" => Some(Self::Image),
            "link" => Some(Self::Link),
            "option" => Some(Self::Option),
            "slider" => Some(Self::Slider),
            "spinbutton" => Some(Self::SpinButton),
            "switch" => Some(Self::Switch),
            "textbox" => Some(Self::TextBox),
            _ => None,
        }
    }

    fn into_gpui(self) -> gpui::Role {
        match self {
            Self::Button => gpui::Role::Button,
            Self::CheckBox => gpui::Role::CheckBox,
            Self::Heading => gpui::Role::Heading,
            Self::Image => gpui::Role::Image,
            Self::Link => gpui::Role::Link,
            Self::Option => gpui::Role::ListBoxOption,
            Self::Slider => gpui::Role::Slider,
            Self::SpinButton => gpui::Role::SpinButton,
            Self::Switch => gpui::Role::Switch,
            Self::TextBox => gpui::Role::TextInput,
        }
    }

    fn supports_specialized_action(self, action: gpui::AccessibleAction) -> bool {
        match action {
            gpui::AccessibleAction::Increment | gpui::AccessibleAction::Decrement => {
                matches!(self, Self::Slider | Self::SpinButton)
            }
            gpui::AccessibleAction::Focus => true,
            _ => false,
        }
    }

    fn supports(self, property: &str) -> bool {
        match property {
            "ariaChecked" => matches!(self, Self::CheckBox | Self::Switch),
            "ariaExpanded" => matches!(self, Self::Button | Self::Link),
            "ariaSelected" => matches!(self, Self::Option),
            "ariaValue" | "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => {
                matches!(self, Self::Slider | Self::SpinButton)
            }
            "ariaLevel" => matches!(self, Self::Heading),
            "disabled" | "ariaDisabled" => !matches!(self, Self::Heading | Self::Image),
            _ => true,
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
    disabled: bool,
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
            disabled: is_action_disabled(element),
        }
    }
}

fn finite_number(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}

fn bool_prop(element: &RetainedElement, key: &str) -> bool {
    element
        .custom_props
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn is_accessibility_prop(key: &str) -> bool {
    ACCESSIBILITY_PROPS.contains(&key)
}

pub(crate) fn has_semantics(element: &RetainedElement) -> bool {
    element
        .custom_props
        .keys()
        .any(|key| is_accessibility_prop(key))
}

pub(crate) fn is_native_disabled(element: &RetainedElement) -> bool {
    bool_prop(element, "disabled")
}

pub(crate) fn is_action_disabled(element: &RetainedElement) -> bool {
    is_native_disabled(element) || bool_prop(element, "ariaDisabled")
}

pub(crate) fn is_hidden(element: &RetainedElement) -> bool {
    bool_prop(element, "ariaHidden")
}

fn value_json(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"))
}

fn problem(property: &str, value: &serde_json::Value, reason: impl Into<String>) -> StyleProblem {
    StyleProblem {
        property: property.to_string(),
        value: value_json(value),
        reason: reason.into(),
    }
}

fn supports_accessibility_host(element_type: &str) -> bool {
    matches!(element_type, "div" | "text" | "input" | "textarea" | "img")
}

/// Validate the complete retained accessibility declaration after a mutation
/// batch. Cross-property checks intentionally happen here, not while props are
/// arriving, so JSX property order cannot change the diagnostics.
pub(crate) fn element_problems(element: &RetainedElement) -> Vec<StyleProblem> {
    let mut problems = Vec::new();
    let role_value = element.custom_props.get("role");
    let role = role_value.and_then(AccessibilityRole::parse);

    if has_semantics(element)
        && !supports_accessibility_host(&element.element_type)
        && element
            .custom_props
            .keys()
            .any(|key| is_accessibility_prop(key) && key != "ariaHidden")
    {
        let (property, value) = role_value
            .map(|value| ("role", value))
            .or_else(|| {
                element
                    .custom_props
                    .iter()
                    .find(|(key, _)| is_accessibility_prop(key) && key.as_str() != "ariaHidden")
                    .map(|(key, value)| (key.as_str(), value))
            })
            .expect("semantic host has a semantic property");
        problems.push(problem(
            property,
            value,
            format!(
                "<{}> does not support accessibility semantics; use a <div>, <text>, <input>, <textarea>, or <img> semantic root",
                element.element_type
            ),
        ));
        return problems;
    }

    if let Some(value) = role_value.filter(|value| AccessibilityRole::parse(value).is_none()) {
        problems.push(problem(
            "role",
            value,
            "unsupported accessibility role; expected button, checkbox, heading, img, link, option, slider, spinbutton, switch, or textbox",
        ));
    }

    for (property, value) in &element.custom_props {
        let malformed = match property.as_str() {
            "ariaLabel" | "ariaDescription" | "ariaValue" => !value.is_string(),
            "ariaChecked" => !(value.is_boolean() || value.as_str() == Some("mixed")),
            "ariaExpanded" | "ariaSelected" | "ariaDisabled" | "ariaHidden" | "disabled" => {
                !value.is_boolean()
            }
            "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => {
                value.as_f64().is_none_or(|number| !number.is_finite())
            }
            "ariaLevel" => value.as_u64().is_none_or(|level| level == 0),
            _ => false,
        };
        if malformed {
            let expected = match property.as_str() {
                "ariaLabel" | "ariaDescription" | "ariaValue" => "a string",
                "ariaChecked" => "a boolean or \"mixed\"",
                "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => "a finite number",
                "ariaLevel" => "a positive integer",
                _ => "a boolean",
            };
            problems.push(problem(property, value, format!("expected {expected}")));
            continue;
        }

        if property == "ariaChecked"
            && value.as_str() == Some("mixed")
            && role == Some(AccessibilityRole::Switch)
        {
            problems.push(problem(
                property,
                value,
                "role=\"switch\" is binary; ariaChecked=\"mixed\" is valid only for role=\"checkbox\"",
            ));
            continue;
        }

        if matches!(
            property.as_str(),
            "ariaLabel"
                | "ariaDescription"
                | "ariaChecked"
                | "ariaExpanded"
                | "ariaSelected"
                | "ariaValue"
                | "ariaValueMin"
                | "ariaValueMax"
                | "ariaValueNow"
                | "ariaLevel"
                | "disabled"
                | "ariaDisabled"
        ) {
            match role {
                Some(role) if !role.supports(property) => problems.push(problem(
                    property,
                    value,
                    format!("is not supported by role={:?}", role),
                )),
                None if role_value.is_none() => problems.push(problem(
                    property,
                    value,
                    "requires an explicit supported role",
                )),
                _ => {}
            }
        }
    }

    if is_native_disabled(element) && bool_prop(element, "ariaDisabled") {
        problems.push(problem(
            "ariaDisabled",
            &serde_json::Value::Bool(true),
            "do not combine disabled and ariaDisabled; disabled removes the control from tab order, while ariaDisabled keeps it focusable",
        ));
    }

    if is_hidden(element) {
        let focusable = matches!(element.element_type.as_str(), "input" | "textarea")
            || element
                .custom_props
                .get("tabIndex")
                .and_then(serde_json::Value::as_i64)
                .is_some_and(|index| index >= 0)
            || element.auto_focus
            || element.events.iter().any(|event| {
                matches!(
                    event.as_str(),
                    "click" | "keyDown" | "keyUp" | "focus" | "accessibilityAction"
                )
            });
        if focusable {
            problems.push(problem(
                "ariaHidden",
                &serde_json::Value::Bool(true),
                "an ariaHidden subtree must not contain or be a focusable control",
            ));
        }
    }

    problems
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
    hidden: bool,
) -> E
where
    E: StatefulInteractiveElement,
{
    if hidden {
        return el;
    }

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
    if props.disabled {
        el = el.aria_disabled(true);
    }

    if let Some(role) = props
        .role
        .filter(|_| element.events.contains("accessibilityAction"))
    {
        for (native_action, public_action) in [
            (gpui::AccessibleAction::Increment, "increment"),
            (gpui::AccessibleAction::Decrement, "decrement"),
            (gpui::AccessibleAction::Focus, "focus"),
        ]
        .into_iter()
        .filter(|(action, _)| role.supports_specialized_action(*action))
        .filter(|(action, _)| {
            if *action == gpui::AccessibleAction::Focus {
                !is_native_disabled(element)
            } else {
                !is_action_disabled(element)
            }
        }) {
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
    fn parses_supported_roles_and_valid_states() {
        let mut element = RetainedElement::new(7, "div".to_string(), 1);
        element.custom_props.insert("role".into(), "slider".into());
        element
            .custom_props
            .insert("ariaLabel".into(), "Clock speed".into());
        element
            .custom_props
            .insert("ariaDescription".into(), "Factory output".into());
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
        element.custom_props.insert("disabled".into(), true.into());

        let props = AccessibilityProps::from_element(&element);
        assert_eq!(props.role, Some(AccessibilityRole::Slider));
        assert_eq!(props.label, Some("Clock speed"));
        assert_eq!(props.description, Some("Factory output"));
        assert_eq!(props.value, Some("42 percent"));
        assert_eq!(props.value_min, Some(0.0));
        assert_eq!(props.value_max, Some(100.0));
        assert_eq!(props.value_now, Some(42.0));
        assert!(props.disabled);
        assert!(element_problems(&element).is_empty());
    }

    #[test]
    fn reports_role_state_incompatibilities_and_malformed_values() {
        let mut link = RetainedElement::new(7, "div".to_string(), 1);
        link.custom_props.insert("role".into(), "link".into());
        link.custom_props.insert("ariaSelected".into(), true.into());
        assert_eq!(element_problems(&link)[0].property, "ariaSelected");

        let mut switch = RetainedElement::new(8, "div".to_string(), 1);
        switch.custom_props.insert("role".into(), "switch".into());
        switch
            .custom_props
            .insert("ariaChecked".into(), "mixed".into());
        assert!(element_problems(&switch)[0].reason.contains("binary"));

        let mut heading = RetainedElement::new(9, "text".to_string(), 1);
        heading.custom_props.insert("role".into(), "heading".into());
        heading.custom_props.insert("ariaLevel".into(), 0.into());
        assert!(element_problems(&heading)[0]
            .reason
            .contains("positive integer"));
    }

    #[test]
    fn reports_unsupported_hosts_instead_of_dropping_semantics() {
        for (index, element_type) in [
            "virtual-list",
            "anchored",
            "canvas",
            "svg",
            "code",
            "diff",
            "markdown",
        ]
        .into_iter()
        .enumerate()
        {
            let mut element = RetainedElement::new(index as u64 + 1, element_type.to_string(), 1);
            element.custom_props.insert("role".into(), "heading".into());
            element
                .custom_props
                .insert("ariaLabel".into(), "Notes".into());

            let problems = element_problems(&element);
            assert_eq!(problems.len(), 1, "<{element_type}>");
            assert!(
                problems[0]
                    .reason
                    .contains("does not support accessibility semantics"),
                "<{element_type}>"
            );
        }
    }
}
