use std::fmt;

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
    "ariaCurrent",
    "ariaSelected",
    "ariaValue",
    "ariaValueMin",
    "ariaValueMax",
    "ariaValueNow",
    "ariaLevel",
    "ariaRowIndex",
    "ariaColIndex",
    "ariaRowCount",
    "ariaColCount",
    "ariaRowSpan",
    "ariaColSpan",
    "ariaDisabled",
    "ariaHidden",
    "disabled",
];

#[derive(Clone, Copy, Eq, PartialEq)]
struct AccessibilityRole {
    role: gpui::Role,
    name_from_contents: bool,
}

impl fmt::Debug for AccessibilityRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.role.fmt(formatter)
    }
}

macro_rules! define_accessibility_roles {
    ($($name:literal => $role:ident, $name_from_contents:literal),+ $(,)?) => {
        #[cfg(test)]
        const SUPPORTED_ACCESSIBILITY_ROLE_NAMES: &[&str] = &[$($name),+];
        #[cfg(test)]
        const ACCESSIBILITY_ROLE_NAME_FROM_CONTENTS: &[(&str, bool)] =
            &[$(($name, $name_from_contents)),+];

        impl AccessibilityRole {
            fn parse(value: &serde_json::Value) -> Option<Self> {
                match value.as_str()? {
                    $($name => Some(Self {
                        role: gpui::Role::$role,
                        name_from_contents: $name_from_contents,
                    }),)+
                    _ => None,
                }
            }
        }
    };
}

define_accessibility_roles! {
    "alert" => Alert, false,
    "alertdialog" => AlertDialog, false,
    "application" => Application, false,
    "article" => Article, false,
    "banner" => Banner, false,
    "blockquote" => Blockquote, false,
    "button" => Button, true,
    "caption" => Caption, false,
    "cell" => Cell, true,
    "checkbox" => CheckBox, true,
    "code" => Code, false,
    "columnheader" => ColumnHeader, true,
    "combobox" => ComboBox, false,
    "comment" => Comment, true,
    "complementary" => Complementary, false,
    "contentinfo" => ContentInfo, false,
    "definition" => Definition, false,
    "deletion" => ContentDeletion, false,
    "dialog" => Dialog, false,
    "document" => Document, false,
    "emphasis" => Emphasis, false,
    "feed" => Feed, false,
    "figure" => Figure, false,
    "form" => Form, false,
    "generic" => GenericContainer, false,
    "grid" => Grid, false,
    "gridcell" => GridCell, true,
    "group" => Group, false,
    "heading" => Heading, true,
    "img" => Image, false,
    "insertion" => ContentInsertion, false,
    "link" => Link, true,
    "list" => List, false,
    "listbox" => ListBox, false,
    "listitem" => ListItem, false,
    "log" => Log, false,
    "main" => Main, false,
    "mark" => Mark, false,
    "marquee" => Marquee, false,
    "math" => Math, false,
    "menu" => Menu, false,
    "menubar" => MenuBar, false,
    "menuitem" => MenuItem, true,
    "menuitemcheckbox" => MenuItemCheckBox, true,
    "menuitemradio" => MenuItemRadio, true,
    "meter" => Meter, false,
    "navigation" => Navigation, false,
    "none" => GenericContainer, false,
    "note" => Note, false,
    "option" => ListBoxOption, true,
    "paragraph" => Paragraph, false,
    "presentation" => GenericContainer, false,
    "progressbar" => ProgressIndicator, false,
    "radio" => RadioButton, true,
    "radiogroup" => RadioGroup, false,
    "region" => Region, false,
    "row" => Row, true,
    "rowgroup" => RowGroup, false,
    "rowheader" => RowHeader, true,
    "scrollbar" => ScrollBar, false,
    "search" => Search, false,
    "searchbox" => SearchInput, false,
    "sectionfooter" => SectionFooter, false,
    "sectionheader" => SectionHeader, false,
    "separator" => Splitter, false,
    "slider" => Slider, false,
    "spinbutton" => SpinButton, false,
    "status" => Status, false,
    "strong" => Strong, false,
    "suggestion" => Suggestion, false,
    "switch" => Switch, true,
    "tab" => Tab, true,
    "table" => Table, false,
    "tablist" => TabList, false,
    "tabpanel" => TabPanel, false,
    "term" => Term, false,
    "textbox" => TextInput, false,
    "time" => Time, false,
    "timer" => Timer, false,
    "toolbar" => Toolbar, false,
    "tooltip" => Tooltip, false,
    "tree" => Tree, false,
    "treegrid" => TreeGrid, false,
    "treeitem" => TreeItem, true,
    "graphics-document" => GraphicsDocument, false,
    "graphics-object" => GraphicsObject, true,
    "graphics-symbol" => GraphicsSymbol, false,
    "doc-abstract" => DocAbstract, false,
    "doc-acknowledgments" => DocAcknowledgements, false,
    "doc-afterword" => DocAfterword, false,
    "doc-appendix" => DocAppendix, false,
    "doc-backlink" => DocBackLink, true,
    "doc-biblioentry" => DocBiblioEntry, false,
    "doc-bibliography" => DocBibliography, false,
    "doc-biblioref" => DocBiblioRef, true,
    "doc-chapter" => DocChapter, false,
    "doc-colophon" => DocColophon, false,
    "doc-conclusion" => DocConclusion, false,
    "doc-cover" => DocCover, false,
    "doc-credit" => DocCredit, false,
    "doc-credits" => DocCredits, false,
    "doc-dedication" => DocDedication, false,
    "doc-endnote" => DocEndnote, false,
    "doc-endnotes" => DocEndnotes, false,
    "doc-epigraph" => DocEpigraph, false,
    "doc-epilogue" => DocEpilogue, false,
    "doc-errata" => DocErrata, false,
    "doc-example" => DocExample, false,
    "doc-footnote" => DocFootnote, false,
    "doc-foreword" => DocForeword, false,
    "doc-glossary" => DocGlossary, false,
    "doc-glossref" => DocGlossRef, true,
    "doc-index" => DocIndex, false,
    "doc-introduction" => DocIntroduction, false,
    "doc-noteref" => DocNoteRef, true,
    "doc-notice" => DocNotice, false,
    "doc-pagebreak" => DocPageBreak, false,
    "doc-pagefooter" => DocPageFooter, false,
    "doc-pageheader" => DocPageHeader, false,
    "doc-pagelist" => DocPageList, false,
    "doc-part" => DocPart, false,
    "doc-preface" => DocPreface, false,
    "doc-prologue" => DocPrologue, false,
    "doc-pullquote" => DocPullquote, false,
    "doc-qna" => DocQna, false,
    "doc-subtitle" => DocSubtitle, true,
    "doc-tip" => DocTip, false,
    "doc-toc" => DocToc, false,
}

impl AccessibilityRole {
    fn into_gpui(self) -> Option<gpui::Role> {
        (self.role != gpui::Role::GenericContainer).then_some(self.role)
    }

    fn supports_specialized_action(self, action: gpui::AccessibleAction) -> bool {
        match action {
            gpui::AccessibleAction::Increment | gpui::AccessibleAction::Decrement => {
                matches!(self.role, gpui::Role::Slider | gpui::Role::SpinButton)
            }
            gpui::AccessibleAction::Focus => self.into_gpui().is_some(),
            _ => false,
        }
    }

    fn supports(self, property: &str) -> bool {
        use gpui::Role;

        match property {
            "ariaChecked" => matches!(self.role, Role::CheckBox | Role::Switch),
            "ariaExpanded" => matches!(self.role, Role::Button | Role::Link),
            "ariaCurrent" => {
                // GPUIX currently exposes current-item state only for links.
                // Options use ariaSelected; controls expose their checked,
                // expanded, or value state instead.
                matches!(self.role, Role::Link)
            }
            "ariaSelected" => matches!(self.role, Role::ListBoxOption),
            "ariaValue" | "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => {
                matches!(self.role, Role::Slider | Role::SpinButton)
            }
            "ariaLevel" => matches!(self.role, Role::Heading),
            "ariaRowIndex" => matches!(
                self.role,
                Role::Cell | Role::ColumnHeader | Role::GridCell | Role::Row | Role::RowHeader
            ),
            "ariaColIndex" => matches!(
                self.role,
                Role::Cell | Role::ColumnHeader | Role::GridCell | Role::Row | Role::RowHeader
            ),
            "ariaRowCount" | "ariaColCount" => {
                matches!(self.role, Role::Grid | Role::Table | Role::TreeGrid)
            }
            "ariaRowSpan" | "ariaColSpan" => matches!(
                self.role,
                Role::Cell | Role::ColumnHeader | Role::GridCell | Role::RowHeader
            ),
            "disabled" | "ariaDisabled" => !matches!(self.role, Role::Heading | Role::Image),
            _ => true,
        }
    }
}

fn parse_aria_current(value: &serde_json::Value) -> Option<gpui::accesskit::AriaCurrent> {
    match value.as_str()? {
        "false" => Some(gpui::accesskit::AriaCurrent::False),
        "true" => Some(gpui::accesskit::AriaCurrent::True),
        "page" => Some(gpui::accesskit::AriaCurrent::Page),
        "step" => Some(gpui::accesskit::AriaCurrent::Step),
        "location" => Some(gpui::accesskit::AriaCurrent::Location),
        "date" => Some(gpui::accesskit::AriaCurrent::Date),
        "time" => Some(gpui::accesskit::AriaCurrent::Time),
        _ => None,
    }
}

#[derive(Debug, Default)]
struct AccessibilityProps<'a> {
    role: Option<AccessibilityRole>,
    label: Option<&'a str>,
    description: Option<&'a str>,
    checked: Option<gpui::Toggled>,
    expanded: Option<bool>,
    current: Option<gpui::accesskit::AriaCurrent>,
    selected: Option<bool>,
    value: Option<&'a str>,
    value_min: Option<f64>,
    value_max: Option<f64>,
    value_now: Option<f64>,
    level: Option<usize>,
    row_index: Option<usize>,
    column_index: Option<usize>,
    row_count: Option<usize>,
    column_count: Option<usize>,
    row_span: Option<usize>,
    column_span: Option<usize>,
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
                .and_then(parse_booleanish),
            current: element
                .custom_props
                .get("ariaCurrent")
                .and_then(parse_aria_current),
            selected: element
                .custom_props
                .get("ariaSelected")
                .and_then(parse_booleanish),
            value: element
                .custom_props
                .get("ariaValue")
                .and_then(serde_json::Value::as_str),
            value_min: finite_number(element.custom_props.get("ariaValueMin")),
            value_max: finite_number(element.custom_props.get("ariaValueMax")),
            value_now: finite_number(element.custom_props.get("ariaValueNow")),
            level: positive_integer(element.custom_props.get("ariaLevel")),
            row_index: positive_integer(element.custom_props.get("ariaRowIndex")),
            column_index: positive_integer(element.custom_props.get("ariaColIndex")),
            row_count: positive_integer(element.custom_props.get("ariaRowCount")),
            column_count: positive_integer(element.custom_props.get("ariaColCount")),
            row_span: positive_integer(element.custom_props.get("ariaRowSpan")),
            column_span: positive_integer(element.custom_props.get("ariaColSpan")),
            disabled: is_action_disabled(element),
        }
    }

    fn supports(&self, property: &str) -> bool {
        self.role.is_some_and(|role| role.supports(property))
    }
}

fn finite_number(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}

fn positive_integer(value: Option<&serde_json::Value>) -> Option<usize> {
    value
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn parse_booleanish(value: &serde_json::Value) -> Option<bool> {
    value.as_bool().or_else(|| {
        let value = value.as_str()?;
        if value.eq_ignore_ascii_case("true") {
            Some(true)
        } else if value.eq_ignore_ascii_case("false") {
            Some(false)
        } else {
            None
        }
    })
}

fn bool_prop(element: &RetainedElement, key: &str) -> bool {
    element
        .custom_props
        .get(key)
        .and_then(parse_booleanish)
        .unwrap_or(false)
}

fn html_boolean_prop(element: &RetainedElement, key: &str) -> bool {
    match element.custom_props.get(key) {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::String(_)) => true,
        _ => false,
    }
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

pub(crate) fn role_supports_name_from_contents(element: &RetainedElement) -> bool {
    element
        .custom_props
        .get("role")
        .and_then(AccessibilityRole::parse)
        .is_some_and(|role| role.into_gpui().is_some() && role.name_from_contents)
}

pub(crate) fn is_native_disabled(element: &RetainedElement) -> bool {
    html_boolean_prop(element, "disabled")
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

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum AccessibilityProblemEffect {
    /// Typed parsing withholds the malformed value before GPUI sees it.
    Rejected,
    /// Role processing omits the retained value from the accessibility tree.
    Ignored,
    /// The retained value affects the accessibility tree as authored.
    Applied,
    /// Role processing applies a computed value instead of the authored value.
    AppliedAs(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessibilityProblem {
    pub(crate) problem: StyleProblem,
    pub(crate) effect: AccessibilityProblemEffect,
}

fn problem(
    property: &str,
    value: &serde_json::Value,
    reason: impl Into<String>,
    effect: AccessibilityProblemEffect,
) -> AccessibilityProblem {
    AccessibilityProblem {
        problem: StyleProblem {
            property: property.to_string(),
            value: value_json(value),
            reason: reason.into(),
        },
        effect,
    }
}

fn rejected_problem(
    property: &str,
    value: &serde_json::Value,
    reason: impl Into<String>,
) -> AccessibilityProblem {
    problem(
        property,
        value,
        reason,
        AccessibilityProblemEffect::Rejected,
    )
}

fn applied_problem(
    property: &str,
    value: &serde_json::Value,
    reason: impl Into<String>,
) -> AccessibilityProblem {
    problem(property, value, reason, AccessibilityProblemEffect::Applied)
}

fn ignored_problem(
    property: &str,
    value: &serde_json::Value,
    reason: impl Into<String>,
) -> AccessibilityProblem {
    problem(property, value, reason, AccessibilityProblemEffect::Ignored)
}

fn applied_as_problem(
    property: &str,
    value: &serde_json::Value,
    computed_value: &'static str,
    reason: impl Into<String>,
) -> AccessibilityProblem {
    problem(
        property,
        value,
        reason,
        AccessibilityProblemEffect::AppliedAs(computed_value),
    )
}

fn supports_accessibility_host(element_type: &str) -> bool {
    matches!(element_type, "div" | "text" | "input" | "textarea" | "img")
}

/// Validate the complete retained accessibility declaration after a mutation
/// batch. Cross-property checks intentionally happen here, not while props are
/// arriving, so JSX property order cannot change the diagnostics.
pub(crate) fn element_problems(element: &RetainedElement) -> Vec<AccessibilityProblem> {
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
        problems.push(rejected_problem(
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
        problems.push(rejected_problem(
            "role",
            value,
            "unsupported accessibility role; expected a WAI-ARIA role with an AccessKit mapping",
        ));
    }

    for (property, value) in &element.custom_props {
        let malformed = match property.as_str() {
            "ariaLabel" | "ariaDescription" | "ariaValue" => !value.is_string(),
            "ariaChecked" => !(value.is_boolean() || value.as_str() == Some("mixed")),
            "ariaCurrent" => parse_aria_current(value).is_none(),
            "ariaExpanded" | "ariaSelected" | "ariaDisabled" | "ariaHidden" => {
                parse_booleanish(value).is_none()
            }
            "disabled" => !(value.is_boolean() || value.is_string()),
            "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => {
                value.as_f64().is_none_or(|number| !number.is_finite())
            }
            "ariaLevel" | "ariaRowIndex" | "ariaColIndex" | "ariaRowCount" | "ariaColCount"
            | "ariaRowSpan" | "ariaColSpan" => positive_integer(Some(value)).is_none(),
            _ => false,
        };
        if malformed {
            let expected = match property.as_str() {
                "ariaLabel" | "ariaDescription" | "ariaValue" => "a string",
                "ariaChecked" => "a boolean or \"mixed\"",
                "ariaCurrent" => {
                    "one of \"page\", \"step\", \"location\", \"date\", \"time\", \"true\", or \"false\""
                }
                "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => "a finite number",
                "ariaLevel"
                | "ariaRowIndex"
                | "ariaColIndex"
                | "ariaRowCount"
                | "ariaColCount"
                | "ariaRowSpan"
                | "ariaColSpan" => "a positive integer",
                "disabled" => "a boolean or string",
                _ => "a boolean",
            };
            problems.push(rejected_problem(
                property,
                value,
                format!("expected {expected}"),
            ));
            continue;
        }

        if property == "disabled" && value.is_string() {
            problems.push(applied_as_problem(
                property,
                value,
                "true",
                "disabled is an HTML boolean attribute; its presence computes disabled=true",
            ));
        }

        if property == "ariaChecked"
            && value.as_str() == Some("mixed")
            && role.is_some_and(|role| role.role == gpui::Role::Switch)
        {
            problems.push(applied_as_problem(
                property,
                value,
                "false",
                "role=\"switch\" is binary; WAI-ARIA computes ariaChecked=\"mixed\" as false",
            ));
            continue;
        }

        if matches!(
            property.as_str(),
            "ariaLabel"
                | "ariaDescription"
                | "ariaChecked"
                | "ariaExpanded"
                | "ariaCurrent"
                | "ariaSelected"
                | "ariaValue"
                | "ariaValueMin"
                | "ariaValueMax"
                | "ariaValueNow"
                | "ariaLevel"
                | "ariaRowIndex"
                | "ariaColIndex"
                | "ariaRowCount"
                | "ariaColCount"
                | "ariaRowSpan"
                | "ariaColSpan"
                | "disabled"
                | "ariaDisabled"
        ) {
            match role {
                Some(role) if !role.supports(property) => problems.push(ignored_problem(
                    property,
                    value,
                    format!(
                        "role={:?} does not support {property}, so it is omitted from the accessibility tree",
                        role
                    ),
                )),
                None if role_value.is_none() => {
                    let reason = match property.as_str() {
                        "ariaLabel" => {
                            "a name requires an explicit supported role, so it is omitted from the accessibility tree"
                        }
                        "ariaDescription" => {
                            "a description requires an explicit supported role, so it is omitted from the accessibility tree"
                        }
                        _ => {
                            "the property requires an explicit supported role, so it is omitted from the accessibility tree"
                        }
                    };
                    problems.push(ignored_problem(property, value, reason));
                }
                _ => {}
            }
        }
    }

    if role.is_some_and(|role| role.supports("ariaDisabled"))
        && is_native_disabled(element)
        && bool_prop(element, "ariaDisabled")
    {
        problems.push(ignored_problem(
            "ariaDisabled",
            &serde_json::Value::Bool(true),
            "disabled takes precedence and already sets disabled=true, so ariaDisabled does not change the accessibility tree",
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
            problems.push(applied_problem(
                "ariaHidden",
                &serde_json::Value::Bool(true),
                "removes the focusable control from the accessibility tree; an ariaHidden subtree must not contain or be a focusable control",
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
    name_from_contents: Option<&str>,
) -> E
where
    E: StatefulInteractiveElement,
{
    if hidden {
        return el;
    }

    // `from_element` withholds malformed values. The role checks below compute
    // the accessibility projection, including role-specific fallbacks such as
    // ariaChecked="mixed" becoming false on a switch.
    let props = AccessibilityProps::from_element(element);

    if let Some(role) = props.role.and_then(AccessibilityRole::into_gpui) {
        el = el.role(role);
    }
    if let Some(author_id) = &element.author_id {
        el = el.accessibility_id(author_id.clone());
    }
    if let Some(label) = props
        .label
        .filter(|_| props.supports("ariaLabel"))
        .or(name_from_contents)
    {
        el = el.aria_label(label.to_owned());
    }
    if let Some(description) = props
        .description
        .filter(|_| props.supports("ariaDescription"))
    {
        el = el.aria_description(description.to_owned());
    }
    if let Some(checked) = props.checked.filter(|_| props.supports("ariaChecked")) {
        let checked = if props
            .role
            .is_some_and(|role| role.role == gpui::Role::Switch)
            && checked == gpui::Toggled::Mixed
        {
            gpui::Toggled::False
        } else {
            checked
        };
        el = el.aria_toggled(checked);
    }
    if let Some(expanded) = props.expanded.filter(|_| props.supports("ariaExpanded")) {
        el = el.aria_expanded(expanded);
    }
    if let Some(current) = props.current.filter(|_| props.supports("ariaCurrent")) {
        el = el.aria_current(current);
    }
    if let Some(selected) = props.selected.filter(|_| props.supports("ariaSelected")) {
        el = el.aria_selected(selected);
    }
    if let Some(value) = props.value.filter(|_| props.supports("ariaValue")) {
        el = el.aria_value(value.to_owned());
    }
    if let Some(value_min) = props.value_min.filter(|_| props.supports("ariaValueMin")) {
        el = el.aria_min_numeric_value(value_min);
    }
    if let Some(value_max) = props.value_max.filter(|_| props.supports("ariaValueMax")) {
        el = el.aria_max_numeric_value(value_max);
    }
    if let Some(value_now) = props.value_now.filter(|_| props.supports("ariaValueNow")) {
        el = el.aria_numeric_value(value_now);
    }
    if let Some(level) = props.level.filter(|_| props.supports("ariaLevel")) {
        el = el.aria_level(level);
    }
    if let Some(index) = props.row_index.filter(|_| props.supports("ariaRowIndex")) {
        el = el.aria_row_index(index);
    }
    if let Some(index) = props
        .column_index
        .filter(|_| props.supports("ariaColIndex"))
    {
        el = el.aria_column_index(index);
    }
    if let Some(count) = props.row_count.filter(|_| props.supports("ariaRowCount")) {
        el = el.aria_row_count(count);
    }
    if let Some(count) = props
        .column_count
        .filter(|_| props.supports("ariaColCount"))
    {
        el = el.aria_column_count(count);
    }
    if let Some(span) = props.row_span.filter(|_| props.supports("ariaRowSpan")) {
        el = el.aria_row_span(span);
    }
    if let Some(span) = props.column_span.filter(|_| props.supports("ariaColSpan")) {
        el = el.aria_column_span(span);
    }
    if props.disabled && props.supports("disabled") {
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
    fn parses_every_declared_accessibility_role() {
        let unique = SUPPORTED_ACCESSIBILITY_ROLE_NAMES
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(SUPPORTED_ACCESSIBILITY_ROLE_NAMES.len(), 128);
        assert_eq!(unique.len(), SUPPORTED_ACCESSIBILITY_ROLE_NAMES.len());
        for name in SUPPORTED_ACCESSIBILITY_ROLE_NAMES {
            assert!(
                AccessibilityRole::parse(&serde_json::Value::String((*name).to_string())).is_some(),
                "{name}"
            );
        }
    }

    #[test]
    fn classifies_every_name_from_contents_role() {
        assert_eq!(
            ACCESSIBILITY_ROLE_NAME_FROM_CONTENTS.len(),
            SUPPORTED_ACCESSIBILITY_ROLE_NAMES.len()
        );
        let actual = ACCESSIBILITY_ROLE_NAME_FROM_CONTENTS
            .iter()
            .filter_map(|(name, enabled)| enabled.then_some(*name))
            .collect::<Vec<_>>();

        assert_eq!(
            actual,
            vec![
                "button",
                "cell",
                "checkbox",
                "columnheader",
                "comment",
                "gridcell",
                "heading",
                "link",
                "menuitem",
                "menuitemcheckbox",
                "menuitemradio",
                "option",
                "radio",
                "row",
                "rowheader",
                "switch",
                "tab",
                "treeitem",
                "graphics-object",
                "doc-backlink",
                "doc-biblioref",
                "doc-glossref",
                "doc-noteref",
                "doc-subtitle",
            ]
        );
    }

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
        assert_eq!(
            props.role,
            Some(AccessibilityRole {
                role: gpui::Role::Slider,
                name_from_contents: false,
            })
        );
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
    fn treats_disabled_as_an_html_boolean_attribute() {
        for (description, value, expected, computed) in [
            ("boolean true", serde_json::Value::Bool(true), true, None),
            ("boolean false", serde_json::Value::Bool(false), false, None),
            (
                "string true",
                serde_json::Value::String("true".into()),
                true,
                Some("true"),
            ),
            (
                "string false",
                serde_json::Value::String("false".into()),
                true,
                Some("true"),
            ),
            (
                "empty string",
                serde_json::Value::String(String::new()),
                true,
                Some("true"),
            ),
        ] {
            let mut element = RetainedElement::new(7, "div".to_string(), 1);
            element.custom_props.insert("role".into(), "button".into());
            element.custom_props.insert("disabled".into(), value);

            assert_eq!(
                AccessibilityProps::from_element(&element).disabled,
                expected,
                "{description}"
            );

            let problems = element_problems(&element);
            match computed {
                Some(value) => assert_eq!(
                    problems.as_slice(),
                    [AccessibilityProblem {
                        problem: StyleProblem {
                            property: "disabled".into(),
                            value: value_json(element.custom_props.get("disabled").unwrap()),
                            reason: "disabled is an HTML boolean attribute; its presence computes disabled=true".into(),
                        },
                        effect: AccessibilityProblemEffect::AppliedAs(value),
                    }],
                    "{description}"
                ),
                None => assert!(problems.is_empty(), "{description}: {problems:?}"),
            }
        }
    }

    #[test]
    fn reports_role_state_incompatibilities_and_malformed_values() {
        let mut link = RetainedElement::new(7, "div".to_string(), 1);
        link.custom_props.insert("role".into(), "link".into());
        link.custom_props.insert("ariaSelected".into(), true.into());
        let link_problem = &element_problems(&link)[0];
        assert_eq!(link_problem.problem.property, "ariaSelected");

        let mut button = RetainedElement::new(10, "div".to_string(), 1);
        button.custom_props.insert("role".into(), "button".into());
        button
            .custom_props
            .insert("ariaCurrent".into(), "page".into());
        let button_problem = &element_problems(&button)[0];
        assert_eq!(button_problem.problem.property, "ariaCurrent");

        let mut malformed_current = RetainedElement::new(11, "div".to_string(), 1);
        malformed_current
            .custom_props
            .insert("role".into(), "link".into());
        malformed_current
            .custom_props
            .insert("ariaCurrent".into(), "chapter".into());
        let malformed_current_problem = &element_problems(&malformed_current)[0];
        assert!(malformed_current_problem
            .problem
            .reason
            .contains("expected one of"));

        let mut switch = RetainedElement::new(8, "div".to_string(), 1);
        switch.custom_props.insert("role".into(), "switch".into());
        switch
            .custom_props
            .insert("ariaChecked".into(), "mixed".into());
        let switch_problem = &element_problems(&switch)[0];
        assert!(switch_problem.problem.reason.contains("binary"));

        let mut heading = RetainedElement::new(9, "text".to_string(), 1);
        heading.custom_props.insert("role".into(), "heading".into());
        heading.custom_props.insert("ariaLevel".into(), 0.into());
        let heading_problem = &element_problems(&heading)[0];
        assert!(heading_problem.problem.reason.contains("positive integer"));
    }

    #[test]
    fn parses_every_aria_current_token_for_links() {
        for (token, expected) in [
            ("false", gpui::accesskit::AriaCurrent::False),
            ("true", gpui::accesskit::AriaCurrent::True),
            ("page", gpui::accesskit::AriaCurrent::Page),
            ("step", gpui::accesskit::AriaCurrent::Step),
            ("location", gpui::accesskit::AriaCurrent::Location),
            ("date", gpui::accesskit::AriaCurrent::Date),
            ("time", gpui::accesskit::AriaCurrent::Time),
        ] {
            let mut link = RetainedElement::new(12, "div".to_string(), 1);
            link.custom_props.insert("role".into(), "link".into());
            link.custom_props.insert("ariaCurrent".into(), token.into());

            assert_eq!(
                AccessibilityProps::from_element(&link).current,
                Some(expected)
            );
            assert!(element_problems(&link).is_empty(), "{token}");
        }
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
                    .problem
                    .reason
                    .contains("does not support accessibility semantics"),
                "<{element_type}>"
            );
        }
    }
}
