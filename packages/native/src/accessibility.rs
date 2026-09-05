use std::fmt;

use gpui::StatefulInteractiveElement;

use crate::{
    renderer::{emit_event_full, EventCallback},
    retained_tree::{RetainedElement, RetainedTree},
    style::StyleProblem,
};

const ACCESSIBILITY_PROPS: &[&str] = &[
    "role",
    "ariaLabel",
    "ariaLabelledBy",
    "ariaDescription",
    "ariaDescribedBy",
    "ariaChecked",
    "ariaExpanded",
    "ariaCurrent",
    "ariaLive",
    "ariaAtomic",
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
    "visuallyHidden",
    "disabled",
];

#[derive(Clone, Copy, Eq, PartialEq)]
struct AccessibilityRole {
    role: gpui::Role,
    name_from_contents: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VisuallyHiddenMode {
    Always,
}

impl VisuallyHiddenMode {
    fn parse(value: &serde_json::Value) -> Option<Self> {
        (value == &serde_json::Value::Bool(true)).then_some(Self::Always)
    }
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

    /// Whether this role's checked state is binary, so `aria-checked="mixed"`
    /// has no meaning on it.
    ///
    /// WAI-ARIA gives `mixed` a meaning only where a third state exists: a
    /// switch, a radio and a menu item radio are each on or off, and `mixed`
    /// computes as `false` on all three.
    fn is_binary_checked(self) -> bool {
        matches!(
            self.role,
            gpui::Role::Switch | gpui::Role::RadioButton | gpui::Role::MenuItemRadio
        )
    }

    fn supports(self, property: &str) -> bool {
        use gpui::Role;

        match property {
            // Every WAI-ARIA role that carries `aria-checked`, so a checked
            // state is projected wherever a browser would compute one.
            "ariaChecked" => matches!(
                self.role,
                Role::CheckBox
                    | Role::ListBoxOption
                    | Role::MenuItemCheckBox
                    | Role::MenuItemRadio
                    | Role::RadioButton
                    | Role::Switch
                    | Role::TreeItem
            ),
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

/// The live-region politeness and atomicity a role carries on its own.
///
/// WAI-ARIA gives five roles an implicit `aria-live`, and three of those an
/// implicit `aria-atomic`. An authored `ariaLive` / `ariaAtomic` overrides the
/// implicit value, exactly as it does in the DOM.
fn implicit_live(role: AccessibilityRole) -> (Option<gpui::Live>, Option<bool>) {
    match role.role {
        gpui::Role::Alert => (Some(gpui::Live::Assertive), Some(true)),
        gpui::Role::Status => (Some(gpui::Live::Polite), Some(true)),
        gpui::Role::Log => (Some(gpui::Live::Polite), Some(false)),
        gpui::Role::Marquee | gpui::Role::Timer => (Some(gpui::Live::Off), None),
        _ => (None, None),
    }
}

fn parse_aria_live(value: &serde_json::Value) -> Option<gpui::Live> {
    match value.as_str()? {
        "off" => Some(gpui::Live::Off),
        "polite" => Some(gpui::Live::Polite),
        "assertive" => Some(gpui::Live::Assertive),
        _ => None,
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

/// Why a subtree is being flattened. Whitespace, hiding and descent are the
/// same for both; what an authored label does at the root is not.
#[derive(Clone, Copy)]
enum NameSubject {
    /// A role that names itself from its contents. accname never reaches the
    /// contents step for an element that carries its own label or reference
    /// list, so that precedence belongs to the caller and neither is read at
    /// the root; a hidden root contributes nothing.
    ///
    /// Every *descendant* is named the way step 2F names it: a reference list
    /// or a label replaces the subtree it names, so `<div role="button"><img
    /// alt="Save"/></div>` is named "Save", as it is in the DOM. Only a
    /// descendant whose role carries that name counts, because a role-less one
    /// is dropped on its way to the platform and the name has to read the tree
    /// the platform reads.
    Contents,
    /// The node an `aria-labelledby` / `aria-describedby` entry points at. It
    /// contributes even when it is hidden — the `<div ariaHidden id="label">`
    /// pattern relies on that — and an authored label replaces the subtree it
    /// names, at the target and at every descendant. `follow_references` is
    /// false once accname is already resolving a reference: one level is both
    /// what the spec computes and what keeps a cycle finite.
    Reference { follow_references: bool },
}

/// Flatten `element`'s subtree into the string an accessible name reads.
///
/// Whitespace follows CSS rather than the tree. A React text node has no box of
/// its own, so contiguous ones concatenate: `Item{count}` is two adjacent nodes
/// in the retained tree and names `Items`, the way a browser flattens two
/// adjacent DOM text nodes. Every element here is a flex item of its parent and
/// flex blockifies its children, so an element separates from its siblings with
/// a space. The one exception is a `<text>` inside a `<text>`: those merge into
/// a single shaped line, which is an inline box by any other name.
///
/// The result is whitespace-normalized at the end, as the accname flat string
/// is, over the whitespace CSS collapses: the ASCII set. A no-break space is a
/// glyph an author chose, and survives here as it does on screen.
///
/// This walk does not apply `text-transform` and does not read an `<input>`'s
/// value, so flattening one of those yields its text content rather than its
/// computed value.
fn flattened_text(tree: &RetainedTree, element: &RetainedElement, subject: NameSubject) -> String {
    let mut flat = String::new();
    collect_flattened_text(tree, element, subject, true, &mut flat);

    let mut normalized = String::with_capacity(flat.len());
    for word in flat.split_ascii_whitespace() {
        if !normalized.is_empty() {
            normalized.push(' ');
        }
        normalized.push_str(word);
    }
    normalized
}

/// Whether an authored name on `node` reaches the accessibility tree at all.
///
/// `apply` sets one only for a node whose declared role supports it, and
/// `element_problems` tells the author when a role-less label was dropped. A
/// name computed from contents reads the tree the platform reads, so a label
/// the tree never carries contributes nothing to it either: the browser
/// ignores `aria-label` on a generic just the same.
fn carries_authored_name(node: &RetainedElement) -> bool {
    node.custom_props
        .get("role")
        .and_then(AccessibilityRole::parse)
        .is_some_and(|role| role.supports("ariaLabel"))
}

/// Whether `node` runs into its siblings instead of separating from them.
fn is_inline(tree: &RetainedTree, node: &RetainedElement) -> bool {
    // A React text node is a DOM text node: no box, no separation. Contiguous
    // ones share one anonymous item, exactly as CSS wraps a flex container's
    // text runs.
    if node.content.is_some() {
        return true;
    }
    // Nested `<text>` is this renderer's inline box. The outer `<text>` flattens
    // it into one layout rather than laying it out as an item of its own.
    node.element_type == "text"
        && node
            .parent
            .and_then(|parent| tree.elements.get(&parent))
            .is_some_and(|parent| parent.element_type == "text")
}

fn collect_flattened_text(
    tree: &RetainedTree,
    node: &RetainedElement,
    subject: NameSubject,
    is_root: bool,
    flat: &mut String,
) {
    // Separators are emitted unconditionally around a box and collapsed away by
    // the normalization pass, so an empty subtree cannot leave one behind. A
    // hidden box still emits them: `5<div ariaHidden/>kg` drops the box's own
    // text and keeps its boundary, exactly as the layout does.
    let separates = !is_inline(tree, node);
    if separates {
        flat.push(' ');
    }
    let is_reference_target = is_root && matches!(subject, NameSubject::Reference { .. });
    if is_reference_target || !is_hidden(node) {
        contribute_flattened_text(tree, node, subject, is_root, flat);
    }
    if separates {
        flat.push(' ');
    }
}

fn contribute_flattened_text(
    tree: &RetainedTree,
    node: &RetainedElement,
    subject: NameSubject,
    is_root: bool,
    flat: &mut String,
) {
    // An authored name — a reference list, then a label — replaces the subtree
    // it names, at every node accname would name in its own right. The root of
    // a contents walk is not one of those: its caller already decided that its
    // contents are what name it. A descendant is one only when the tree would
    // carry the name it declares.
    let carries_name = if is_root {
        !matches!(subject, NameSubject::Contents)
    } else {
        carries_authored_name(node)
    };
    // A reference is never followed from inside a reference: one level is what
    // the spec resolves, and it is what makes a descendant pointing back at an
    // ancestor terminate rather than recur.
    let follows_references = carries_name
        && match subject {
            NameSubject::Contents => !is_root,
            NameSubject::Reference { follow_references } => is_root && follow_references,
        };
    if follows_references {
        if let Some(text) = node
            .custom_props
            .get("ariaLabelledBy")
            .and_then(|value| resolve_references(tree, value, false))
        {
            flat.push_str(&text);
            return;
        }
    }
    if carries_name {
        if let Some(label) = node
            .custom_props
            .get("ariaLabel")
            .and_then(serde_json::Value::as_str)
            .filter(|label| !label.trim().is_empty())
        {
            flat.push_str(label);
            return;
        }
    }
    if let Some(content) = &node.content {
        flat.push_str(content);
    }
    for child in node.children.iter().filter_map(|id| tree.elements.get(id)) {
        collect_flattened_text(tree, child, subject, false, flat);
    }
}

/// The text a `aria-labelledby` / `aria-describedby` target contributes.
fn referenced_text(
    tree: &RetainedTree,
    element: &RetainedElement,
    follow_references: bool,
) -> String {
    flattened_text(tree, element, NameSubject::Reference { follow_references })
}

/// The subtree flattened to the string a role that names itself from its
/// contents reads, or `None` when the subtree holds no text.
///
/// The renderer's build has the element's shaped `InlineText` in hand at this
/// point, but reads the tree here instead: the two disagreed about whitespace,
/// and only one of them can be the accname computation.
pub(crate) fn flattened_contents_text(
    tree: &RetainedTree,
    element: &RetainedElement,
) -> Option<String> {
    let text = flattened_text(tree, element, NameSubject::Contents);
    (!text.is_empty()).then_some(text)
}

/// Resolve an `aria-labelledby` / `aria-describedby` IDREF list to the text its
/// targets contribute, joined by a single space in the order written.
///
/// An id that matches nothing contributes nothing rather than failing the whole
/// list, which is what the accname spec's traversal does.
fn resolve_id_references(tree: &RetainedTree, value: &serde_json::Value) -> Option<String> {
    resolve_references(tree, value, true)
}

fn resolve_references(
    tree: &RetainedTree,
    value: &serde_json::Value,
    follow_references: bool,
) -> Option<String> {
    let references = value.as_str()?;
    // One pass resolves the whole list, rather than one pass per id. The cost is
    // still O(tree) for each element that declares a reference list, so this
    // bounds the constant rather than changing the order.
    let mut targets: std::collections::HashMap<&str, Option<&RetainedElement>> =
        references.split_whitespace().map(|id| (id, None)).collect();
    if targets.is_empty() {
        return None;
    }
    for element in tree.elements.values() {
        let Some(author_id) = element.author_id.as_deref() else {
            continue;
        };
        if let Some(slot) = targets.get_mut(author_id) {
            // HTML requires document ids to be unique. `find_by_element_id`
            // takes the earliest renderer id when malformed input repeats one,
            // and this pass has to make the same choice: the map's iteration
            // order is not stable across rehashes, so keeping whichever
            // duplicate arrives first would make the name flip when unrelated
            // elements are added.
            if slot.is_none_or(|existing| element.id < existing.id) {
                *slot = Some(element);
            }
        }
    }

    let mut parts = Vec::new();
    for reference in references.split_whitespace() {
        let Some(Some(target)) = targets.get(reference) else {
            continue;
        };
        let text = referenced_text(tree, target, follow_references);
        if !text.is_empty() {
            parts.push(text);
        }
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

#[derive(Debug, Default)]
struct AccessibilityProps<'a> {
    role: Option<AccessibilityRole>,
    label: Option<&'a str>,
    /// Text resolved from `ariaLabelledBy`. Owned because it is built by joining
    /// several referenced subtrees rather than borrowed from one prop.
    labelled_by: Option<String>,
    description: Option<&'a str>,
    described_by: Option<String>,
    checked: Option<gpui::Toggled>,
    expanded: Option<bool>,
    current: Option<gpui::accesskit::AriaCurrent>,
    live: Option<gpui::Live>,
    atomic: Option<bool>,
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
    fn from_element(tree: &RetainedTree, element: &'a RetainedElement) -> Self {
        Self {
            role: element
                .custom_props
                .get("role")
                .and_then(AccessibilityRole::parse),
            label: element
                .custom_props
                .get("ariaLabel")
                .and_then(serde_json::Value::as_str),
            labelled_by: element
                .custom_props
                .get("ariaLabelledBy")
                .and_then(|value| resolve_id_references(tree, value)),
            description: element
                .custom_props
                .get("ariaDescription")
                .and_then(serde_json::Value::as_str),
            described_by: element
                .custom_props
                .get("ariaDescribedBy")
                .and_then(|value| resolve_id_references(tree, value)),
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
            live: element
                .custom_props
                .get("ariaLive")
                .and_then(parse_aria_live),
            atomic: element
                .custom_props
                .get("ariaAtomic")
                .and_then(parse_booleanish),
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

/// Why a property that needs a role is omitted when the element has none that
/// reaches AccessKit — either because none was authored, or because the one
/// that was resolves to no node.
fn roleless_reason(property: &str) -> &'static str {
    match property {
        "ariaLabel" | "ariaLabelledBy" => {
            "a name requires an explicit supported role, so it is omitted from the accessibility tree"
        }
        "ariaDescription" | "ariaDescribedBy" => {
            "a description requires an explicit supported role, so it is omitted from the accessibility tree"
        }
        // A live region without a node has nowhere for the politeness to land.
        // The DOM allows it; GPUIX says which role to add instead of implying
        // one.
        "ariaLive" | "ariaAtomic" => {
            "a live region requires an explicit supported role, so it is omitted from the accessibility tree; add role=\"status\", role=\"alert\", or role=\"log\""
        }
        _ => "the property requires an explicit supported role, so it is omitted from the accessibility tree",
    }
}

fn supports_accessibility_host(element_type: &str) -> bool {
    matches!(element_type, "div" | "text" | "input" | "textarea" | "img")
}

/// Element types whose accessibility declaration reaches an AccessKit node.
///
/// Every custom element projects `role` and the ARIA props through
/// `custom_elements::apply_accessibility`, so declaring them is meaningful on
/// all of them. `supports_accessibility_host` stays narrower because
/// `visuallyHidden` additionally needs the element to lay out as a plain box,
/// which the painting adapters do not.
fn projects_accessibility(element_type: &str) -> bool {
    supports_accessibility_host(element_type)
        || matches!(
            element_type,
            "svg" | "canvas" | "code" | "diff" | "markdown" | "anchored"
        )
}

pub(crate) fn is_visually_hidden(tree: &RetainedTree, element: &RetainedElement) -> bool {
    element
        .custom_props
        .get("visuallyHidden")
        .and_then(VisuallyHiddenMode::parse)
        .is_some()
        && supports_accessibility_host(&element.element_type)
        && visually_hidden_rejection(tree, element).is_none()
}

/// A control, an authored tab stop, or an element wired to keyboard and focus
/// interaction. Focus is not derived from the accessibility role, so this reads
/// the same declaration the focus handles are built from.
fn is_focusable(element: &RetainedElement) -> bool {
    matches!(element.element_type.as_str(), "input" | "textarea")
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
        })
}

/// Why a well-formed `visuallyHidden` declaration cannot be projected, or
/// `None` when the element can become an accessibility-only node.
///
/// The projection replaces the element with an unpainted node carrying its own
/// semantics and flattened text, so anything else the element owns — a control,
/// a focus target, a child subtree — would be destroyed rather than hidden. The
/// web's `sr-only` clips a fully live element instead, so declarations GPUIX
/// cannot honour that way are rejected rather than silently narrowed.
fn visually_hidden_rejection(
    tree: &RetainedTree,
    element: &RetainedElement,
) -> Option<&'static str> {
    // A custom element projects its own semantics but paints its own content
    // through an adapter, so there is no unpainted node for the projection to
    // put in its place. Widening the semantics gate to these hosts must not
    // widen this one by omission: say so rather than dropping the declaration.
    if projects_accessibility(&element.element_type)
        && !supports_accessibility_host(&element.element_type)
    {
        return Some(
            "visuallyHidden replaces the element with an accessibility-only node, which this element type cannot produce; wrap it in a <div> or <text> and visually hide that instead",
        );
    }
    if is_hidden(element) {
        return Some(
            "ariaHidden removes the accessibility node that visuallyHidden exists to preserve; remove one property",
        );
    }
    if element
        .custom_props
        .get("role")
        .and_then(AccessibilityRole::parse)
        .and_then(AccessibilityRole::into_gpui)
        .is_none()
    {
        return Some(
            "visuallyHidden requires an explicit supported role so the accessibility-only element produces a node",
        );
    }
    if is_focusable(element) {
        return Some(
            "visuallyHidden replaces the element with an accessibility-only node, which would destroy this control; visually hide a non-interactive element instead",
        );
    }
    // A `<text>` host owns its inline runs: they are flattened into its
    // accessible name rather than dropped. Another host keeps its children only
    // when the same flattening already covers them — a subtree of plain `<text>`
    // loses nothing under any role, because React makes a child element out of
    // every JSX string and the projection carries the flattened result as the
    // node's name or its value. A descendant that owns accessibility semantics
    // of its own has a node the projection would drop, and a focusable or
    // interactive descendant has a control the projection would destroy, so a
    // structured subtree stays out of scope for now.
    if element.element_type != "text"
        && !element.children.is_empty()
        && !subtree_is_flattened_text(tree, element)
    {
        return Some(
            "visuallyHidden exposes only this element, so children with accessibility semantics of their own, and focusable or interactive children, are destroyed rather than hidden; visually hide an element whose subtree is plain text instead",
        );
    }
    None
}

/// Whether every descendant is an unroled, non-interactive `<text>` element, so
/// the projection flattens the whole subtree into the surviving node and nothing
/// is dropped. A descendant missing from the tree counts as unknown, which is
/// not flattenable.
fn subtree_is_flattened_text(tree: &RetainedTree, element: &RetainedElement) -> bool {
    let mut pending: Vec<u64> = element.children.clone();
    while let Some(id) = pending.pop() {
        let Some(descendant) = tree.elements.get(&id) else {
            return false;
        };
        if descendant.element_type != "text"
            || has_semantics(descendant)
            || is_focusable(descendant)
        {
            return false;
        }
        pending.extend(descendant.children.iter().copied());
    }
    true
}

/// Validate the complete retained accessibility declaration after a mutation
/// batch. Cross-property checks intentionally happen here, not while props are
/// arriving, so JSX property order cannot change the diagnostics.
pub(crate) fn element_problems(
    tree: &RetainedTree,
    element: &RetainedElement,
) -> Vec<AccessibilityProblem> {
    let mut problems = Vec::new();
    let role_value = element.custom_props.get("role");
    let role = role_value.and_then(AccessibilityRole::parse);

    if has_semantics(element)
        && !projects_accessibility(&element.element_type)
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
                "<{}> does not support accessibility semantics; declare them on a <div> that wraps it",
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
            "ariaLabel" | "ariaDescription" | "ariaValue" | "ariaLabelledBy"
            | "ariaDescribedBy" => !value.is_string(),
            "ariaChecked" => !(value.is_boolean() || value.as_str() == Some("mixed")),
            "ariaCurrent" => parse_aria_current(value).is_none(),
            "ariaLive" => parse_aria_live(value).is_none(),
            "ariaExpanded" | "ariaSelected" | "ariaAtomic" | "ariaDisabled" | "ariaHidden" => {
                parse_booleanish(value).is_none()
            }
            "visuallyHidden" => VisuallyHiddenMode::parse(value).is_none(),
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
                "ariaLabelledBy" | "ariaDescribedBy" => "a string of space-separated element ids",
                "ariaChecked" => "a boolean or \"mixed\"",
                "ariaCurrent" => {
                    "one of \"page\", \"step\", \"location\", \"date\", \"time\", \"true\", or \"false\""
                }
                "ariaLive" => "one of \"off\", \"polite\", or \"assertive\"",
                "ariaValueMin" | "ariaValueMax" | "ariaValueNow" => "a finite number",
                "ariaLevel"
                | "ariaRowIndex"
                | "ariaColIndex"
                | "ariaRowCount"
                | "ariaColCount"
                | "ariaRowSpan"
                | "ariaColSpan" => "a positive integer",
                "disabled" => "a boolean or string",
                "visuallyHidden" => "the boolean true",
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
            && role.is_some_and(AccessibilityRole::is_binary_checked)
        {
            let authored = role_value
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            problems.push(applied_as_problem(
                property,
                value,
                "false",
                format!(
                    "role=\"{authored}\" is binary; WAI-ARIA computes ariaChecked=\"mixed\" as false"
                ),
            ));
            continue;
        }

        if matches!(
            property.as_str(),
            "ariaLabel"
                | "ariaLabelledBy"
                | "ariaDescription"
                | "ariaDescribedBy"
                | "ariaChecked"
                | "ariaExpanded"
                | "ariaCurrent"
                | "ariaLive"
                | "ariaAtomic"
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
                // `presentation` and `none` parse, but they resolve to no GPUI
                // role, so the element contributes no AccessKit node and the
                // politeness is as inert as it is on a role-less element. Only
                // the live-region props are reported here: the rest already
                // read as "this element is deliberately not exposed".
                Some(parsed)
                    if parsed.into_gpui().is_none()
                        && matches!(property.as_str(), "ariaLive" | "ariaAtomic") =>
                {
                    problems.push(ignored_problem(property, value, roleless_reason(property)));
                }
                None if role_value.is_none() => {
                    problems.push(ignored_problem(property, value, roleless_reason(property)));
                }
                _ => {}
            }
        }
    }

    if let Some(value) = element
        .custom_props
        .get("visuallyHidden")
        .filter(|value| VisuallyHiddenMode::parse(value).is_some())
    {
        if let Some(reason) = visually_hidden_rejection(tree, element) {
            problems.push(rejected_problem("visuallyHidden", value, reason));
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
        if is_focusable(element) {
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
///
/// `name_from_contents` is the flattened text a role that names itself from its
/// contents takes as its accessible name. `content_value` is the same text for a
/// role that does not: painted text reaches AccessKit as the value of its own
/// node, so a projection that keeps no such node carries the value here rather
/// than dropping the content.
pub(crate) fn apply<E>(
    mut el: E,
    tree: &RetainedTree,
    element: &RetainedElement,
    callback: &Option<EventCallback>,
    focus_handle: Option<&gpui::FocusHandle>,
    hidden: bool,
    name_from_contents: Option<&str>,
    content_value: Option<&str>,
) -> E
where
    E: StatefulInteractiveElement,
{
    if hidden {
        return el;
    }

    // `from_element` withholds malformed values. The role checks below compute
    // the accessibility projection, including role-specific fallbacks such as
    // ariaChecked="mixed" becoming false on a switch. It needs the tree because
    // `ariaLabelledBy` and `ariaDescribedBy` name other elements by id.
    let props = AccessibilityProps::from_element(tree, element);

    if let Some(role) = props.role.and_then(AccessibilityRole::into_gpui) {
        el = el.role(role);
    }
    if let Some(author_id) = &element.author_id {
        el = el.accessibility_id(author_id.clone());
    }
    // An authored politeness overrides the one the role carries, as it does in
    // the DOM. Both require a role: AccessKit's filter drops a node without one,
    // and every adapter's live-region branch runs behind that filter.
    let (role_live, role_atomic) = props.role.map_or((None, None), implicit_live);
    let live = props
        .live
        .or(role_live)
        .filter(|_| props.supports("ariaLive"));
    // A live `visuallyHidden` projection is one node with no children, so the
    // text it carries as its value has nothing else to speak it. macOS
    // announces `value`, but Windows and AT-SPI announce `name`, and only a
    // `Label` role reads that name from the value. Writing the flattened text
    // to both keeps the projection audible everywhere. `content_value` is set
    // by that projection alone, and the doubling is confined to a live region,
    // so an ordinary `visuallyHidden` node keeps exactly the accname it had.
    let live_projection_name =
        content_value.filter(|_| live.is_some_and(|live| live != gpui::Live::Off));
    // The mirror image, for a role that *does* name itself from its contents.
    // Its text becomes the node's name, and the child that painted it is
    // suppressed so the name is not announced twice — which leaves the live
    // node with no value at all, and macOS raises an announcement only for a
    // node that has one. A live `<div role="heading">` would therefore be
    // permanently silent there. Browsers announce it, so the text goes on as
    // the value as well, for a live region alone.
    let live_contents_value =
        name_from_contents.filter(|_| live.is_some_and(|live| live != gpui::Live::Off));
    // accname order: the referenced text wins over `ariaLabel`, which wins over
    // the name the contents would compute.
    if let Some(label) = props
        .labelled_by
        .clone()
        .filter(|_| props.supports("ariaLabel"))
        .or_else(|| {
            props
                .label
                .filter(|_| props.supports("ariaLabel"))
                .or(name_from_contents)
                .or(live_projection_name)
                .map(str::to_owned)
        })
    {
        el = el.aria_label(label);
    }
    if let Some(description) = props
        .described_by
        .clone()
        .or_else(|| props.description.map(str::to_owned))
        .filter(|_| props.supports("ariaDescription"))
    {
        el = el.aria_description(description);
    }
    if let Some(checked) = props.checked.filter(|_| props.supports("ariaChecked")) {
        let checked = if props.role.is_some_and(AccessibilityRole::is_binary_checked)
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
    if let Some(live) = live {
        el = el.aria_live(live);
    }
    if let Some(atomic) = props
        .atomic
        .or(role_atomic)
        .filter(|_| props.supports("ariaAtomic"))
    {
        el = el.aria_atomic(atomic);
    }
    if let Some(selected) = props.selected.filter(|_| props.supports("ariaSelected")) {
        el = el.aria_selected(selected);
    }
    if let Some(value) = props
        .value
        .filter(|_| props.supports("ariaValue"))
        .or(content_value)
        .or(live_contents_value)
    {
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

    /// Most declarations are validated without descendants, so the tree only
    /// has to exist. Tests that hide a subtree build a populated one.
    fn detached_tree() -> RetainedTree {
        RetainedTree::new()
    }

    /// Mirror the reconciler: an element node carries no text of its own, and
    /// every authored string arrives as a separate `<text>` node beneath it.
    fn append_element(tree: &mut RetainedTree, parent: Option<u64>, id: u64, element_type: &str) {
        tree.create_element(id, element_type.to_string());
        if let Some(parent) = parent {
            tree.append_child(parent, id);
        }
    }

    fn append_text_node(tree: &mut RetainedTree, parent: u64, id: u64, content: &str) {
        append_element(tree, Some(parent), id, "text");
        tree.set_text(id, content.to_string());
    }

    fn contents_name(tree: &RetainedTree, id: u64) -> Option<String> {
        flattened_contents_text(tree, tree.elements.get(&id).expect("element exists"))
    }

    #[test]
    fn concatenates_adjacent_text_nodes() {
        // `<div role="button">Item{count}</div>`: React splits the interpolation
        // into two host nodes, and neither has a box to separate from.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "Item");
        append_text_node(&mut tree, 1, 3, "s");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Items"));
    }

    #[test]
    fn concatenates_a_nested_text_run_with_its_parent_line() {
        // `<text>Save<text style={{fontWeight:"bold"}}>All</text></text>` is one
        // shaped line, so the nested run is an inline box.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "text");
        append_text_node(&mut tree, 1, 2, "Save");
        append_element(&mut tree, Some(1), 3, "text");
        append_text_node(&mut tree, 3, 4, "All");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("SaveAll"));
    }

    #[test]
    fn separates_sibling_element_boxes_with_a_space() {
        // `<div><text>Production</text><text>ledger</text></div>`: two items of
        // the same flex container, which CSS blockifies.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_element(&mut tree, Some(1), 2, "text");
        append_text_node(&mut tree, 2, 3, "Production");
        append_element(&mut tree, Some(1), 4, "text");
        append_text_node(&mut tree, 4, 5, "ledger");

        assert_eq!(
            contents_name(&tree, 1).as_deref(),
            Some("Production ledger")
        );
    }

    #[test]
    fn mixes_inline_runs_with_block_boundaries() {
        // `<div role="button">Item{count}<text>left</text><div>in stock</div></div>`.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "Item");
        append_text_node(&mut tree, 1, 3, "s");
        append_element(&mut tree, Some(1), 4, "text");
        append_text_node(&mut tree, 4, 5, "left");
        append_element(&mut tree, Some(1), 6, "div");
        append_text_node(&mut tree, 6, 7, "in stock");

        assert_eq!(
            contents_name(&tree, 1).as_deref(),
            Some("Items left in stock")
        );
    }

    #[test]
    fn normalizes_authored_whitespace() {
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "  Production \n  ledger  ");

        assert_eq!(
            contents_name(&tree, 1).as_deref(),
            Some("Production ledger")
        );
    }

    #[test]
    fn keeps_the_space_authored_between_two_text_nodes() {
        // `Item {count}` — the trailing space belongs to the first node, so the
        // words stay apart while `Item{count}` runs together.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "Item ");
        append_text_node(&mut tree, 1, 3, "5");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Item 5"));
    }

    #[test]
    fn skips_a_hidden_descendant_without_joining_its_neighbours() {
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "Item");
        append_element(&mut tree, Some(1), 3, "text");
        append_text_node(&mut tree, 3, 4, "hidden");
        tree.set_custom_prop(3, "ariaHidden".into(), true.into());
        append_element(&mut tree, Some(1), 5, "text");
        append_text_node(&mut tree, 5, 6, "left");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Item left"));
    }

    #[test]
    fn keeps_the_boundary_of_a_hidden_box_between_two_text_runs() {
        // `5<div ariaHidden/>kg`: the box contributes no text and still stands
        // between its neighbours, so they cannot run together.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "5");
        append_element(&mut tree, Some(1), 3, "div");
        append_text_node(&mut tree, 3, 4, "hidden");
        tree.set_custom_prop(3, "ariaHidden".into(), true.into());
        append_text_node(&mut tree, 1, 5, "kg");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("5 kg"));
    }

    #[test]
    fn leaves_a_hidden_text_run_out_without_a_boundary_of_its_own() {
        // A hidden text node has no box either way, so its neighbours meet.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "text");
        append_text_node(&mut tree, 1, 2, "Item");
        append_element(&mut tree, Some(1), 3, "text");
        append_text_node(&mut tree, 3, 4, "hidden");
        tree.set_custom_prop(3, "ariaHidden".into(), true.into());
        append_text_node(&mut tree, 1, 5, "s");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Items"));
    }

    #[test]
    fn keeps_a_no_break_space_an_author_wrote() {
        // CSS collapses the ASCII whitespace and leaves U+00A0 alone, which is
        // the whole point of typing one.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_text_node(&mut tree, 1, 2, "  5\u{a0}kg  ");
        append_element(&mut tree, Some(1), 3, "text");
        append_text_node(&mut tree, 3, 4, "\u{a0}left");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("5\u{a0}kg \u{a0}left"));
    }

    #[test]
    fn substitutes_a_descendant_label_for_the_subtree_it_names() {
        // accname step 2F names every descendant in its own right, so an
        // `<img alt>` inside a button names the button.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_element(&mut tree, Some(1), 2, "img");
        tree.set_custom_prop(2, "role".into(), "img".into());
        tree.set_custom_prop(2, "ariaLabel".into(), "Save".into());
        append_element(&mut tree, Some(1), 3, "text");
        tree.set_custom_prop(3, "role".into(), "img".into());
        tree.set_custom_prop(3, "ariaLabel".into(), "All".into());
        append_text_node(&mut tree, 3, 4, "ignored glyph");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Save All"));
    }

    #[test]
    fn ignores_a_descendant_label_that_no_role_carries() {
        // `apply` sets a label only for a node whose role supports one, and the
        // author is told the rest are dropped. A name from contents reads the
        // same tree: the label is not there, so the painted text is the name.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_element(&mut tree, Some(1), 2, "div");
        tree.set_custom_prop(2, "ariaLabel".into(), "Save".into());
        append_element(&mut tree, Some(1), 3, "text");
        append_text_node(&mut tree, 3, 4, "All");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("All"));
    }

    #[test]
    fn resolves_a_descendant_reference_list_for_the_subtree_it_names() {
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        append_element(&mut tree, Some(1), 2, "text");
        tree.set_custom_prop(2, "id".into(), "save".into());
        append_text_node(&mut tree, 2, 3, "Save");
        append_element(&mut tree, Some(1), 4, "div");
        tree.set_custom_prop(4, "role".into(), "button".into());
        append_element(&mut tree, Some(4), 5, "img");
        tree.set_custom_prop(5, "role".into(), "img".into());
        tree.set_custom_prop(5, "ariaLabelledBy".into(), "save".into());
        append_text_node(&mut tree, 5, 6, "glyph");
        append_element(&mut tree, Some(4), 7, "text");
        append_text_node(&mut tree, 7, 8, "All");

        assert_eq!(contents_name(&tree, 4).as_deref(), Some("Save All"));
    }

    #[test]
    fn stops_at_one_level_when_a_descendant_references_its_own_ancestor() {
        // The reference resolves against the subtree being walked. Following
        // one level is what the spec resolves and what makes this terminate.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        tree.set_custom_prop(1, "id".into(), "root".into());
        tree.set_custom_prop(1, "role".into(), "button".into());
        append_element(&mut tree, Some(1), 2, "text");
        tree.set_custom_prop(2, "role".into(), "img".into());
        tree.set_custom_prop(2, "ariaLabelledBy".into(), "root".into());
        append_text_node(&mut tree, 2, 3, "glyph");
        append_text_node(&mut tree, 1, 4, "All");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("glyph All All"));
    }

    #[test]
    fn leaves_the_root_of_a_contents_walk_to_its_caller() {
        // The element's own label outranks its contents, and that precedence is
        // applied before the walk. Reading it here would name every projected
        // value with the label instead of the text it stands in for.
        let mut tree = detached_tree();
        append_element(&mut tree, None, 1, "div");
        tree.set_custom_prop(1, "ariaLabel".into(), "Authored name".into());
        append_text_node(&mut tree, 1, 2, "Painted text");

        assert_eq!(contents_name(&tree, 1).as_deref(), Some("Painted text"));
    }

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

        let props = AccessibilityProps::from_element(&detached_tree(), &element);
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
        assert!(element_problems(&detached_tree(), &element).is_empty());
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
                AccessibilityProps::from_element(&detached_tree(), &element).disabled,
                expected,
                "{description}"
            );

            let problems = element_problems(&detached_tree(), &element);
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
        let link_problem = &element_problems(&detached_tree(), &link)[0];
        assert_eq!(link_problem.problem.property, "ariaSelected");

        let mut button = RetainedElement::new(10, "div".to_string(), 1);
        button.custom_props.insert("role".into(), "button".into());
        button
            .custom_props
            .insert("ariaCurrent".into(), "page".into());
        let button_problem = &element_problems(&detached_tree(), &button)[0];
        assert_eq!(button_problem.problem.property, "ariaCurrent");

        let mut malformed_current = RetainedElement::new(11, "div".to_string(), 1);
        malformed_current
            .custom_props
            .insert("role".into(), "link".into());
        malformed_current
            .custom_props
            .insert("ariaCurrent".into(), "chapter".into());
        let malformed_current_problem = &element_problems(&detached_tree(), &malformed_current)[0];
        assert!(malformed_current_problem
            .problem
            .reason
            .contains("expected one of"));

        let mut switch = RetainedElement::new(8, "div".to_string(), 1);
        switch.custom_props.insert("role".into(), "switch".into());
        switch
            .custom_props
            .insert("ariaChecked".into(), "mixed".into());
        let switch_problem = &element_problems(&detached_tree(), &switch)[0];
        assert!(switch_problem.problem.reason.contains("binary"));
        assert!(switch_problem.problem.reason.contains("role=\"switch\""));

        // Every binary role, not the switch alone: WAI-ARIA gives `mixed` no
        // meaning on a radio either, and the diagnostic names the role it is
        // talking about.
        let mut radio = RetainedElement::new(14, "div".to_string(), 1);
        radio.custom_props.insert("role".into(), "radio".into());
        radio
            .custom_props
            .insert("ariaChecked".into(), "mixed".into());
        let radio_problem = &element_problems(&detached_tree(), &radio)[0];
        assert!(radio_problem.problem.reason.contains("binary"));
        assert!(radio_problem.problem.reason.contains("role=\"radio\""));

        let mut heading = RetainedElement::new(9, "text".to_string(), 1);
        heading.custom_props.insert("role".into(), "heading".into());
        heading.custom_props.insert("ariaLevel".into(), 0.into());
        let heading_problem = &element_problems(&detached_tree(), &heading)[0];
        assert!(heading_problem.problem.reason.contains("positive integer"));

        let mut visually_hidden = RetainedElement::new(12, "text".to_string(), 1);
        visually_hidden
            .custom_props
            .insert("role".into(), "heading".into());
        visually_hidden
            .custom_props
            .insert("visuallyHidden".into(), true.into());
        assert!(is_visually_hidden(&detached_tree(), &visually_hidden));
        assert!(element_problems(&detached_tree(), &visually_hidden).is_empty());

        visually_hidden
            .custom_props
            .insert("ariaHidden".into(), true.into());
        assert!(!is_visually_hidden(&detached_tree(), &visually_hidden));
        let conflicting = element_problems(&detached_tree(), &visually_hidden);
        assert_eq!(conflicting.len(), 1);
        assert_eq!(conflicting[0].problem.property, "visuallyHidden");
        assert!(conflicting[0].problem.reason.contains("ariaHidden removes"));

        let mut malformed_visually_hidden = RetainedElement::new(13, "text".to_string(), 1);
        malformed_visually_hidden
            .custom_props
            .insert("role".into(), "heading".into());
        malformed_visually_hidden
            .custom_props
            .insert("visuallyHidden".into(), "untilFocus".into());
        let malformed = element_problems(&detached_tree(), &malformed_visually_hidden);
        assert_eq!(malformed.len(), 1);
        assert!(malformed[0].problem.reason.contains("boolean true"));
    }

    #[test]
    fn rejects_visually_hidden_where_the_projection_would_destroy_the_element() {
        let visually_hidden = |mut element: RetainedElement| {
            element
                .custom_props
                .insert("visuallyHidden".into(), true.into());
            element
        };
        let only_reason = |tree: &RetainedTree, element: &RetainedElement| {
            let problems = element_problems(tree, element);
            assert_eq!(problems.len(), 1, "{problems:?}");
            assert_eq!(problems[0].problem.property, "visuallyHidden");
            assert_eq!(problems[0].effect, AccessibilityProblemEffect::Rejected);
            problems[0].problem.reason.clone()
        };

        let mut control = visually_hidden(RetainedElement::new(20, "input".to_string(), 1));
        control.custom_props.insert("role".into(), "textbox".into());
        assert!(!is_visually_hidden(&detached_tree(), &control));
        assert!(only_reason(&detached_tree(), &control).contains("destroy this control"));

        let mut clickable = visually_hidden(RetainedElement::new(21, "text".to_string(), 1));
        clickable
            .custom_props
            .insert("role".into(), "heading".into());
        clickable.events.insert("click".into());
        assert!(!is_visually_hidden(&detached_tree(), &clickable));
        assert!(only_reason(&detached_tree(), &clickable).contains("destroy this control"));

        let mut tab_stop = visually_hidden(RetainedElement::new(22, "div".to_string(), 1));
        tab_stop.custom_props.insert("role".into(), "img".into());
        tab_stop.custom_props.insert("tabIndex".into(), 0.into());
        assert!(!is_visually_hidden(&detached_tree(), &tab_stop));
        assert!(only_reason(&detached_tree(), &tab_stop).contains("destroy this control"));

        // React makes a child element out of every JSX string, so a wrapper over
        // plain text keeps everything: the name computation flattens the subtree.
        let mut tree = RetainedTree::new();
        tree.create_element(24, "text".to_string());
        tree.create_element(27, "text".to_string());
        tree.set_custom_prop(27, "role".into(), "link".into());

        let mut wrapper = visually_hidden(RetainedElement::new(23, "div".to_string(), 1));
        wrapper.custom_props.insert("role".into(), "heading".into());
        wrapper.children.push(24);
        assert!(is_visually_hidden(&tree, &wrapper));
        assert!(element_problems(&tree, &wrapper).is_empty());

        // The canonical sr-only live region: the same subtree under a role that
        // is named from an author string keeps its text as the node's value.
        let mut live_region = visually_hidden(RetainedElement::new(28, "div".to_string(), 1));
        live_region
            .custom_props
            .insert("role".into(), "status".into());
        live_region.children.push(24);
        assert!(is_visually_hidden(&tree, &live_region));
        assert!(element_problems(&tree, &live_region).is_empty());

        // A descendant with accessibility semantics of its own owns a node the
        // projection drops.
        let mut roled_child = visually_hidden(RetainedElement::new(29, "div".to_string(), 1));
        roled_child
            .custom_props
            .insert("role".into(), "heading".into());
        roled_child.children.push(27);
        assert!(!is_visually_hidden(&tree, &roled_child));
        assert!(
            only_reason(&tree, &roled_child).contains("accessibility semantics of their own")
        );

        // Plain text that is focusable or wired to an event is not plain: the
        // projection would destroy the handler and the tab stop along with it.
        tree.create_element(30, "text".to_string());
        tree.elements
            .get_mut(&30)
            .expect("created element")
            .events
            .insert("click".into());
        let mut handler_child = visually_hidden(RetainedElement::new(31, "div".to_string(), 1));
        handler_child
            .custom_props
            .insert("role".into(), "status".into());
        handler_child.children.extend([24, 30]);
        assert!(!is_visually_hidden(&tree, &handler_child));
        assert!(only_reason(&tree, &handler_child).contains("destroyed rather than hidden"));

        tree.create_element(32, "text".to_string());
        tree.set_custom_prop(32, "tabIndex".into(), 0.into());
        let mut tab_stop_child = visually_hidden(RetainedElement::new(33, "div".to_string(), 1));
        tab_stop_child
            .custom_props
            .insert("role".into(), "status".into());
        tab_stop_child.children.extend([24, 32]);
        assert!(!is_visually_hidden(&tree, &tab_stop_child));
        assert!(only_reason(&tree, &tab_stop_child).contains("destroyed rather than hidden"));

        let mut runs = visually_hidden(RetainedElement::new(25, "text".to_string(), 1));
        runs.custom_props.insert("role".into(), "heading".into());
        runs.children.push(26);
        assert!(is_visually_hidden(&detached_tree(), &runs));
        assert!(element_problems(&detached_tree(), &runs).is_empty());
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
                AccessibilityProps::from_element(&detached_tree(), &link).current,
                Some(expected)
            );
            assert!(element_problems(&detached_tree(), &link).is_empty(), "{token}");
        }
    }

    #[test]
    fn parses_every_aria_live_token() {
        for (token, expected) in [
            ("off", gpui::Live::Off),
            ("polite", gpui::Live::Polite),
            ("assertive", gpui::Live::Assertive),
        ] {
            let mut region = RetainedElement::new(13, "div".to_string(), 1);
            region.custom_props.insert("role".into(), "region".into());
            region.custom_props.insert("ariaLive".into(), token.into());

            assert_eq!(
                AccessibilityProps::from_element(&detached_tree(), &region).live,
                Some(expected)
            );
            assert!(
                element_problems(&detached_tree(), &region).is_empty(),
                "{token}"
            );
        }
    }

    #[test]
    fn derives_live_region_defaults_from_the_role() {
        // WAI-ARIA's implicit live-region values. A role that carries them needs
        // no authored ariaLive, exactly as in the DOM.
        for (role, live, atomic) in [
            ("alert", Some(gpui::Live::Assertive), Some(true)),
            ("status", Some(gpui::Live::Polite), Some(true)),
            ("log", Some(gpui::Live::Polite), Some(false)),
            ("marquee", Some(gpui::Live::Off), None),
            ("timer", Some(gpui::Live::Off), None),
            ("region", None, None),
        ] {
            let parsed = AccessibilityRole::parse(&role.into()).expect("declared role");
            assert_eq!(implicit_live(parsed), (live, atomic), "{role}");

            // An implicit live region is authored as nothing but its role, so
            // it must stay diagnostic-free.
            let mut element = RetainedElement::new(17, "div".to_string(), 1);
            element.custom_props.insert("role".into(), role.into());
            let problems = element_problems(&detached_tree(), &element);
            assert!(problems.is_empty(), "{role}: {problems:?}");
        }
    }

    #[test]
    fn reports_a_live_region_on_a_role_that_reaches_no_node() {
        // `presentation` parses, but it resolves to no GPUI role, so the
        // element contributes no AccessKit node and the politeness is as inert
        // as it is on a role-less element.
        let mut presentational = RetainedElement::new(18, "div".to_string(), 1);
        presentational
            .custom_props
            .insert("role".into(), "presentation".into());
        presentational
            .custom_props
            .insert("ariaLive".into(), "assertive".into());

        let problems = element_problems(&detached_tree(), &presentational);
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].problem.property, "ariaLive");
        assert_eq!(problems[0].effect, AccessibilityProblemEffect::Ignored);
        assert!(
            problems[0]
                .problem
                .reason
                .contains("a live region requires an explicit supported role"),
            "{:?}",
            problems[0]
        );
    }

    #[test]
    fn keeps_an_authored_politeness_over_the_one_the_role_carries() {
        let mut alert = RetainedElement::new(14, "div".to_string(), 1);
        alert.custom_props.insert("role".into(), "alert".into());
        alert
            .custom_props
            .insert("ariaLive".into(), "polite".into());
        alert.custom_props.insert("ariaAtomic".into(), false.into());

        let props = AccessibilityProps::from_element(&detached_tree(), &alert);
        assert_eq!(props.live, Some(gpui::Live::Polite));
        assert_eq!(props.atomic, Some(false));
        assert!(element_problems(&detached_tree(), &alert).is_empty());
    }

    #[test]
    fn reports_a_live_region_that_has_no_role_to_carry_it() {
        // GPUI produces no AccessKit node without a role, so the politeness has
        // nowhere to land. The DOM allows it; say which role to add instead.
        let mut roleless = RetainedElement::new(15, "div".to_string(), 1);
        roleless
            .custom_props
            .insert("ariaLive".into(), "polite".into());

        let problems = element_problems(&detached_tree(), &roleless);
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].problem.property, "ariaLive");
        assert_eq!(problems[0].effect, AccessibilityProblemEffect::Ignored);
        assert!(
            problems[0]
                .problem
                .reason
                .contains("a live region requires an explicit supported role"),
            "{:?}",
            problems[0]
        );
    }

    #[test]
    fn rejects_a_malformed_politeness_and_atomicity() {
        let mut region = RetainedElement::new(16, "div".to_string(), 1);
        region.custom_props.insert("role".into(), "status".into());
        region.custom_props.insert("ariaLive".into(), "rude".into());
        region
            .custom_props
            .insert("ariaAtomic".into(), "sometimes".into());

        let problems = element_problems(&detached_tree(), &region);
        assert_eq!(problems.len(), 2);
        for problem in &problems {
            assert_eq!(problem.effect, AccessibilityProblemEffect::Rejected);
        }
        assert!(
            AccessibilityProps::from_element(&detached_tree(), &region)
                .live
                .is_none()
        );
    }

    fn semantic_element(id: u64, element_type: &str) -> RetainedElement {
        let mut element = RetainedElement::new(id, element_type.to_string(), 1);
        element.custom_props.insert("role".into(), "heading".into());
        element
            .custom_props
            .insert("ariaLabel".into(), "Notes".into());
        element
    }

    #[test]
    fn reports_unsupported_hosts_instead_of_dropping_semantics() {
        // `<virtual-list>` is the one host left that never projects what it is
        // given, so it is the one that still has to say so.
        let element = semantic_element(1, "virtual-list");
        let problems = element_problems(&detached_tree(), &element);

        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .problem
                .reason
                .contains("does not support accessibility semantics")
        );
    }

    #[test]
    fn duplicate_author_ids_resolve_to_the_earliest_element() {
        // HTML requires ids to be unique, and `find_by_element_id` answers a
        // malformed duplicate with the earliest renderer id. The resolution pass
        // walks a hash map whose order shifts as unrelated elements are added,
        // so it has to make that same choice rather than take what it meets
        // first. Both insertion orders must agree.
        for order in [[40_u64, 41], [41, 40]] {
            let mut tree = RetainedTree::new();
            // The text names the renderer id, not the insertion order, so the
            // expected answer stays "Earliest" whichever way the map is built.
            for id in order {
                tree.create_element(id, "text".to_string());
                tree.set_custom_prop(id, "id".into(), "ledger-title".into());
                tree.set_text(
                    id,
                    if id == 40 { "Earliest" } else { "Later" }.to_string(),
                );
            }

            let mut element = RetainedElement::new(1, "div".to_string(), 1);
            element.custom_props.insert("role".into(), "region".into());
            element
                .custom_props
                .insert("ariaLabelledBy".into(), "ledger-title".into());

            let props = AccessibilityProps::from_element(&tree, &element);

            assert_eq!(
                props.labelled_by.as_deref(),
                Some("Earliest"),
                "insertion order {order:?}"
            );
        }
    }

    #[test]
    fn reference_lists_have_to_be_strings() {
        for property in ["ariaLabelledBy", "ariaDescribedBy"] {
            let mut element = RetainedElement::new(1, "div".to_string(), 1);
            element.custom_props.insert("role".into(), "region".into());
            element.custom_props.insert(property.into(), 7.into());

            let problems = element_problems(&detached_tree(), &element);

            assert_eq!(problems.len(), 1, "{property}");
            assert_eq!(
                problems[0].problem.reason,
                "expected a string of space-separated element ids",
                "{property}"
            );
        }
    }

    #[test]
    fn custom_elements_cannot_be_visually_hidden() {
        for (index, element_type) in ["anchored", "canvas", "svg", "code", "diff", "markdown"]
            .into_iter()
            .enumerate()
        {
            let mut element = RetainedElement::new(index as u64 + 1, element_type.to_string(), 1);
            element.custom_props.insert("role".into(), "region".into());
            element
                .custom_props
                .insert("visuallyHidden".into(), true.into());

            let problems = element_problems(&detached_tree(), &element);

            assert_eq!(problems.len(), 1, "<{element_type}>");
            assert!(
                problems[0]
                    .problem
                    .reason
                    .contains("this element type cannot produce"),
                "<{element_type}>: {}",
                problems[0].problem.reason
            );
            assert!(
                !is_visually_hidden(&detached_tree(), &element),
                "<{element_type}>"
            );
        }
    }

    #[test]
    fn every_custom_element_accepts_a_semantic_declaration() {
        for (index, element_type) in ["anchored", "canvas", "svg", "code", "diff", "markdown"]
            .into_iter()
            .enumerate()
        {
            let element = semantic_element(index as u64 + 1, element_type);

            assert_eq!(
                element_problems(&detached_tree(), &element),
                Vec::new(),
                "<{element_type}>"
            );
        }
    }
}
