//! Flatten nested `<text>` hosts into one shaped string and byte-indexed runs.
//!
//! React retains each host node so events and automation keep stable element
//! ids. Painting is deliberately different: one outer `<text>` owns one GPUI
//! text layout, and every descendant contributes a range to that layout.

use std::collections::HashSet;
use std::fmt;
use std::ops::Range;

use gpui::{px, Hsla, Pixels, SharedString, StrikethroughStyle, UnderlineStyle};

use crate::retained_tree::RetainedTree;
use crate::style::{parse_font_weight, StyleDesc, StyleProblem};

/// Text case inherited while flattening inline descendants.
#[derive(Clone, Copy, Default)]
pub(crate) enum TextTransform {
    #[default]
    None,
    Uppercase,
    Lowercase,
}

/// The subset of text style that GPUI can vary inside one shaped layout.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TextRunStyle {
    pub(crate) color: Option<Hsla>,
    pub(crate) font_family: Option<SharedString>,
    pub(crate) font_weight: Option<gpui::FontWeight>,
    pub(crate) letter_spacing: Option<Pixels>,
    pub(crate) background_color: Option<Hsla>,
    pub(crate) underline: Option<UnderlineStyle>,
    pub(crate) strikethrough: Option<StrikethroughStyle>,
}

impl TextRunStyle {
    fn descend(mut self, style: Option<&StyleDesc>) -> Self {
        let Some(style) = style else {
            return self;
        };

        if let Some(color) = style
            .color
            .as_deref()
            .and_then(crate::color::parse_color_rgba)
        {
            self.color = Some(color.into());
        }
        if let Some(family) = &style.font_family {
            self.font_family = Some(SharedString::from(family.clone()));
        }
        if let Some(weight) = &style.font_weight {
            self.font_weight = Some(parse_font_weight(weight));
        }
        if let Some(spacing) = style.letter_spacing {
            self.letter_spacing = Some(px(spacing as f32));
        }
        if let Some(color) = style
            .background_color
            .as_deref()
            .and_then(crate::color::parse_color_rgba)
        {
            self.background_color = Some(color.into());
        }
        match style.text_decoration.as_deref() {
            Some("underline") => {
                self.underline = Some(UnderlineStyle {
                    thickness: px(1.0),
                    ..Default::default()
                });
            }
            Some("line-through") => {
                self.strikethrough = Some(StrikethroughStyle {
                    thickness: px(1.0),
                    ..Default::default()
                });
            }
            _ => {}
        }
        self
    }
}

/// One exact-cover byte range in a flattened string.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StyledTextRun {
    pub(crate) range: Range<usize>,
    pub(crate) style: TextRunStyle,
}

/// The result consumed by the selectable text painter.
#[derive(Debug, Default)]
pub(crate) struct InlineText {
    pub(crate) text: String,
    pub(crate) runs: Vec<StyledTextRun>,
    /// Nested React host ids whose glyph ranges should be exposed to automation.
    pub(crate) tracked_ranges: Vec<(Range<usize>, u64)>,
    /// React host ids that installed an `onClick` handler.
    pub(crate) clickable_ranges: Vec<(Range<usize>, u64)>,
}

#[derive(Debug)]
pub(crate) struct InlineTextError {
    parent_id: u64,
    child_id: u64,
    child_type: String,
}

impl fmt::Display for InlineTextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "<text> element {} can contain only strings and nested <text> elements; child {} is <{}>",
            self.parent_id, self.child_id, self.child_type
        )
    }
}

impl std::error::Error for InlineTextError {}

fn descend_transform(current: TextTransform, style: Option<&StyleDesc>) -> TextTransform {
    match style.and_then(|style| style.text_transform.as_deref()) {
        Some("none") => TextTransform::None,
        Some("uppercase") => TextTransform::Uppercase,
        Some("lowercase") => TextTransform::Lowercase,
        _ => current,
    }
}

fn transform(content: &str, transform: TextTransform) -> String {
    match transform {
        TextTransform::None => content.to_owned(),
        TextTransform::Uppercase => content.to_uppercase(),
        TextTransform::Lowercase => content.to_lowercase(),
    }
}

fn push_content(output: &mut InlineText, content: &str, style: TextRunStyle) {
    if content.is_empty() {
        return;
    }
    let start = output.text.len();
    output.text.push_str(content);
    let end = output.text.len();

    if let Some(previous) = output.runs.last_mut() {
        if previous.range.end == start && previous.style == style {
            previous.range.end = end;
            return;
        }
    }
    output.runs.push(StyledTextRun {
        range: start..end,
        style,
    });
}

fn collect_node(
    tree: &RetainedTree,
    id: u64,
    inherited_style: TextRunStyle,
    inherited_transform: TextTransform,
    output: &mut InlineText,
) -> Result<(), InlineTextError> {
    let Some(element) = tree.elements.get(&id) else {
        return Ok(());
    };
    if element.element_type != "text" {
        return Err(InlineTextError {
            parent_id: element.parent.unwrap_or(id),
            child_id: id,
            child_type: element.element_type.clone(),
        });
    }

    let start = output.text.len();
    let style = inherited_style.descend(element.style.as_deref());
    let transform_kind = descend_transform(inherited_transform, element.style.as_deref());

    if let Some(content) = &element.content {
        push_content(output, &transform(content, transform_kind), style.clone());
    }
    for child_id in &element.children {
        let Some(child) = tree.elements.get(child_id) else {
            continue;
        };
        if child.element_type != "text" {
            return Err(InlineTextError {
                parent_id: id,
                child_id: *child_id,
                child_type: child.element_type.clone(),
            });
        }
        collect_node(tree, *child_id, style.clone(), transform_kind, output)?;
    }

    let range = start..output.text.len();
    if !range.is_empty() {
        output.tracked_ranges.push((range.clone(), id));
        if element.events.contains("click") {
            output.clickable_ranges.push((range, id));
        }
    }
    Ok(())
}

/// Flatten an outer `<text>` and all of its text-only descendants.
pub(crate) fn flatten_inline_text(
    tree: &RetainedTree,
    root_id: u64,
    inherited_transform: TextTransform,
) -> Result<InlineText, InlineTextError> {
    let Some(root) = tree.elements.get(&root_id) else {
        return Ok(InlineText::default());
    };

    let mut output = InlineText::default();
    if let Some(content) = &root.content {
        push_content(
            &mut output,
            &transform(content, inherited_transform),
            TextRunStyle::default(),
        );
    }
    for child_id in &root.children {
        let Some(child) = tree.elements.get(child_id) else {
            continue;
        };
        if child.element_type != "text" {
            return Err(InlineTextError {
                parent_id: root_id,
                child_id: *child_id,
                child_type: child.element_type.clone(),
            });
        }
        collect_node(
            tree,
            *child_id,
            TextRunStyle::default(),
            inherited_transform,
            &mut output,
        )?;
    }

    if root.events.contains("click") && !output.text.is_empty() {
        output
            .clickable_ranges
            .push((0..output.text.len(), root_id));
    }
    debug_assert!(validate_runs(&output.text, &output.runs).is_ok());
    Ok(output)
}

/// Validate exact byte coverage before styles reach `gpui::StyledText`.
pub(crate) fn validate_runs(text: &str, runs: &[StyledTextRun]) -> Result<(), String> {
    let mut cursor = 0;
    for run in runs {
        if run.range.start != cursor || run.range.end <= run.range.start {
            return Err(format!(
                "inline text runs must be ordered, non-empty, and exact-covering at byte {cursor}"
            ));
        }
        if run.range.end > text.len()
            || !text.is_char_boundary(run.range.start)
            || !text.is_char_boundary(run.range.end)
        {
            return Err(format!(
                "inline text run {:?} is not on UTF-8 character boundaries",
                run.range
            ));
        }
        cursor = run.range.end;
    }
    if cursor != text.len() {
        return Err(format!(
            "inline text runs cover {cursor} bytes but text contains {}",
            text.len()
        ));
    }
    Ok(())
}

const INLINE_STYLE_PROPERTIES: &[&str] = &[
    "backgroundColor",
    "color",
    "fontFamily",
    "fontWeight",
    "letterSpacing",
    "textDecoration",
    "textTransform",
];

/// Contextual diagnostics for styles that cannot vary inside one text layout.
pub(crate) fn unsupported_inline_style_problems(style: &StyleDesc) -> Vec<StyleProblem> {
    let value = serde_json::to_value(style).expect("StyleDesc is serializable");
    let Some(object) = value.as_object() else {
        return Vec::new();
    };

    object
        .iter()
        .filter(|(property, value)| {
            !value.is_null() && !INLINE_STYLE_PROPERTIES.contains(&property.as_str())
        })
        .map(|(property, value)| StyleProblem {
            property: property.clone(),
            value: serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}")),
            reason: "this property cannot vary inside flowing text; move it to the outer <text>"
                .into(),
        })
        .collect()
}

pub(crate) fn is_inline_text_descendant(tree: &RetainedTree, id: u64) -> bool {
    tree.elements
        .get(&id)
        .and_then(|element| element.parent)
        .and_then(|parent_id| tree.elements.get(&parent_id))
        .is_some_and(|parent| parent.element_type == "text")
}

pub(crate) fn subtree_ids(tree: &RetainedTree, root_id: u64, output: &mut HashSet<u64>) {
    if !output.insert(root_id) {
        return;
    }
    if let Some(element) = tree.elements.get(&root_id) {
        for child_id in &element.children {
            subtree_ids(tree, *child_id, output);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::parse_style_value;
    use serde_json::json;

    #[test]
    fn multibyte_ranges_are_exact_utf8_boundaries() {
        let mut tree = RetainedTree::new();
        tree.create_element(1, "text".into());
        tree.create_element(2, "text".into());
        tree.set_text(2, "Cost ".into());
        tree.append_child(1, 2);

        tree.create_element(3, "text".into());
        tree.set_style(
            3,
            parse_style_value(&json!({ "color": "red", "letterSpacing": 2 }))
                .style
                .into(),
        );
        tree.create_element(4, "text".into());
        tree.set_text(4, "核🚀".into());
        tree.append_child(3, 4);
        tree.append_child(1, 3);

        let inline = flatten_inline_text(&tree, 1, TextTransform::None).unwrap();
        assert_eq!(inline.text, "Cost 核🚀");
        assert_eq!(inline.runs.len(), 2);
        assert_eq!(inline.runs[1].range, 5..12);
        assert!(inline
            .runs
            .iter()
            .all(|run| inline.text.is_char_boundary(run.range.start)
                && inline.text.is_char_boundary(run.range.end)));
        assert_eq!(inline.tracked_ranges.last(), Some(&(5..12, 3)));
        assert!(validate_runs(&inline.text, &inline.runs).is_ok());
    }

    #[test]
    fn transformed_content_computes_ranges_after_expansion() {
        let mut tree = RetainedTree::new();
        tree.create_element(1, "text".into());
        tree.create_element(2, "text".into());
        tree.set_style(
            2,
            parse_style_value(&json!({ "textTransform": "uppercase" }))
                .style
                .into(),
        );
        tree.create_element(3, "text".into());
        tree.set_text(3, "straße".into());
        tree.append_child(2, 3);
        tree.append_child(1, 2);

        let inline = flatten_inline_text(&tree, 1, TextTransform::None).unwrap();
        assert_eq!(inline.text, "STRASSE");
        assert_eq!(inline.runs[0].range, 0..7);
        assert!(validate_runs(&inline.text, &inline.runs).is_ok());
    }

    #[test]
    fn rejects_non_text_descendants_precisely() {
        let mut tree = RetainedTree::new();
        tree.create_element(1, "text".into());
        tree.create_element(2, "code".into());
        tree.append_child(1, 2);

        let error = flatten_inline_text(&tree, 1, TextTransform::None).unwrap_err();
        assert_eq!(
            error.to_string(),
            "<text> element 1 can contain only strings and nested <text> elements; child 2 is <code>"
        );
    }

    #[test]
    fn reports_layout_styles_on_inline_descendants() {
        let style = parse_style_value(&json!({
            "color": "red",
            "fontWeight": "bold",
            "paddingLeft": 4,
            "lineHeight": 24
        }))
        .style;
        let problems = unsupported_inline_style_problems(&style);
        assert_eq!(
            problems
                .iter()
                .map(|problem| problem.property.as_str())
                .collect::<Vec<_>>(),
            ["paddingLeft", "lineHeight"]
        );
    }
}
