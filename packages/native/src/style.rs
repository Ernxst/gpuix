use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;

const MAX_LINEAR_GRADIENT_STOPS: usize = 8;

/// Font weight value — accepts both CSS strings ("bold", "700") and numbers (700).
/// JS style objects commonly use both `fontWeight: "bold"` and `fontWeight: 700`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FontWeightValue {
    Num(f64),
    Str(String),
}

/// Parse a validated CSS font-weight value into GPUI's numeric representation.
pub(crate) fn parse_font_weight(value: &FontWeightValue) -> gpui::FontWeight {
    match value {
        FontWeightValue::Num(number) => gpui::FontWeight((*number as f32).clamp(1.0, 1000.0)),
        FontWeightValue::Str(value) => {
            let value = value.trim().to_ascii_lowercase();
            match value.as_str() {
                "100" | "thin" => gpui::FontWeight(100.0),
                "200" | "extralight" | "extra-light" => gpui::FontWeight(200.0),
                "300" | "light" => gpui::FontWeight(300.0),
                "400" | "normal" => gpui::FontWeight(400.0),
                "500" | "medium" => gpui::FontWeight(500.0),
                "600" | "semibold" | "semi-bold" => gpui::FontWeight(600.0),
                "700" | "bold" => gpui::FontWeight(700.0),
                "800" | "extrabold" | "extra-bold" => gpui::FontWeight(800.0),
                "900" | "black" => gpui::FontWeight(900.0),
                _ => value
                    .parse::<f32>()
                    .map(|number| gpui::FontWeight(number.clamp(1.0, 1000.0)))
                    .unwrap_or(gpui::FontWeight(400.0)),
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxShadowValue {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur_radius: f64,
    pub spread_radius: f64,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinearGradientStopValue {
    pub color: String,
    /// Position from 0 through 1.
    pub position: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BackgroundImageValue {
    LinearGradient {
        angle: f64,
        stops: Vec<LinearGradientStopValue>,
        #[serde(default)]
        color_space: Option<String>,
    },
}

/// A CSS-compatible paint string or a serializable native background.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BackgroundValue {
    String(String),
    Image(BackgroundImageValue),
}

/// A dimension value that can be a number (pixels) or a string (percentage, auto, etc.)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum DimensionValue {
    Pixels(f64),
    Percentage(f64), // 0.0 to 1.0
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionProperty {
    Opacity,
    BackgroundColor,
    Color,
    BorderColor,
    OutlineColor,
    Width,
    Height,
    MinWidth,
    MinHeight,
    MaxWidth,
    MaxHeight,
    Top,
    Right,
    Bottom,
    Left,
    BorderRadius,
    BorderTopLeftRadius,
    BorderTopRightRadius,
    BorderBottomLeftRadius,
    BorderBottomRightRadius,
}

impl TransitionProperty {
    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "opacity" => Self::Opacity,
            "backgroundColor" => Self::BackgroundColor,
            "color" => Self::Color,
            "borderColor" => Self::BorderColor,
            "outlineColor" => Self::OutlineColor,
            "width" => Self::Width,
            "height" => Self::Height,
            "minWidth" => Self::MinWidth,
            "minHeight" => Self::MinHeight,
            "maxWidth" => Self::MaxWidth,
            "maxHeight" => Self::MaxHeight,
            "top" => Self::Top,
            "right" => Self::Right,
            "bottom" => Self::Bottom,
            "left" => Self::Left,
            "borderRadius" => Self::BorderRadius,
            "borderTopLeftRadius" => Self::BorderTopLeftRadius,
            "borderTopRightRadius" => Self::BorderTopRightRadius,
            "borderBottomLeftRadius" => Self::BorderBottomLeftRadius,
            "borderBottomRightRadius" => Self::BorderBottomRightRadius,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TransitionEasing {
    Name(String),
    CubicBezier([f64; 4]),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTransition {
    pub(crate) properties: Vec<TransitionProperty>,
    pub(crate) duration_ms: f64,
    pub(crate) delay_ms: f64,
    pub(crate) easing: TransitionEasing,
}

/// One serializable CSS Grid track. Track lists deliberately use tagged objects
/// rather than CSS strings so the renderer can validate every nested function.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackValue {
    Px {
        value: f64,
    },
    Fr {
        value: f64,
    },
    Auto,
    MinContent,
    MaxContent,
    Minmax {
        min: GridTrackMinValue,
        max: GridTrackMaxValue,
    },
    Repeat {
        count: u16,
        tracks: Vec<GridTrackValue>,
    },
}

/// Valid lower-bound functions for a `minmax()` grid track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackMinValue {
    Px { value: f64 },
    Auto,
    MinContent,
    MaxContent,
}

/// Valid upper-bound functions for a `minmax()` grid track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackMaxValue {
    Px { value: f64 },
    Fr { value: f64 },
    Auto,
    MinContent,
    MaxContent,
}

/// Integer grid counts remain a compatibility shorthand for `repeat(count, 1fr)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GridTemplateValue {
    LegacyCount(f64),
    Tracks(Vec<GridTrackValue>),
}

impl Default for DimensionValue {
    fn default() -> Self {
        DimensionValue::Auto
    }
}

impl<'de> Deserialize<'de> for DimensionValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de::{self, Visitor};

        struct DimensionVisitor;

        impl<'de> Visitor<'de> for DimensionVisitor {
            type Value = DimensionValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a number, a percentage string, or 'auto'")
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(value as f64))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(value as f64))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value == "auto" {
                    return Ok(DimensionValue::Auto);
                }
                if let Some(percentage) = value.strip_suffix('%') {
                    return percentage
                        .parse::<f64>()
                        .map(|number| DimensionValue::Percentage(number / 100.0))
                        .map_err(|_| de::Error::custom(format!("invalid percentage: {value}")));
                }
                value
                    .parse::<f64>()
                    .map(DimensionValue::Pixels)
                    .map_err(|_| de::Error::custom(format!("invalid dimension: {value}")))
            }
        }

        deserializer.deserialize_any(DimensionVisitor)
    }
}

/// Style description retained by the native renderer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDesc {
    pub display: Option<String>,
    pub visibility: Option<String>,

    pub flex_direction: Option<String>,
    pub flex_wrap: Option<String>,
    pub flex_grow: Option<f64>,
    pub flex_shrink: Option<f64>,
    pub flex_basis: Option<f64>,
    pub align_items: Option<String>,
    pub align_self: Option<String>,
    pub align_content: Option<String>,
    pub justify_content: Option<String>,
    pub gap: Option<f64>,
    pub row_gap: Option<f64>,
    pub column_gap: Option<f64>,
    pub grid_template_columns: Option<GridTemplateValue>,
    pub grid_template_rows: Option<GridTemplateValue>,
    pub grid_column_min: Option<String>,
    pub grid_row_min: Option<String>,

    pub width: Option<DimensionValue>,
    pub height: Option<DimensionValue>,
    pub min_width: Option<DimensionValue>,
    pub min_height: Option<DimensionValue>,
    pub max_width: Option<DimensionValue>,
    pub max_height: Option<DimensionValue>,

    pub padding: Option<f64>,
    pub padding_top: Option<f64>,
    pub padding_right: Option<f64>,
    pub padding_bottom: Option<f64>,
    pub padding_left: Option<f64>,

    pub margin: Option<f64>,
    pub margin_top: Option<f64>,
    pub margin_right: Option<f64>,
    pub margin_bottom: Option<f64>,
    pub margin_left: Option<f64>,

    pub position: Option<String>,
    pub top: Option<f64>,
    pub right: Option<f64>,
    pub bottom: Option<f64>,
    pub left: Option<f64>,

    pub background: Option<BackgroundValue>,
    pub background_color: Option<String>,
    pub color: Option<String>,
    pub opacity: Option<f64>,

    pub border_width: Option<f64>,
    pub border_top_width: Option<f64>,
    pub border_right_width: Option<f64>,
    pub border_bottom_width: Option<f64>,
    pub border_left_width: Option<f64>,
    pub border_color: Option<String>,
    pub border_radius: Option<f64>,
    pub border_top_left_radius: Option<f64>,
    pub border_top_right_radius: Option<f64>,
    pub border_bottom_left_radius: Option<f64>,
    pub border_bottom_right_radius: Option<f64>,
    pub box_shadow: Option<BoxShadowValue>,
    pub outline_color: Option<String>,
    pub outline_width: Option<f64>,
    pub outline_offset: Option<f64>,

    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub font_weight: Option<FontWeightValue>,
    pub letter_spacing: Option<f64>,
    pub text_decoration: Option<String>,
    pub text_transform: Option<String>,
    pub text_align: Option<String>,
    pub line_height: Option<f64>,
    pub white_space: Option<String>,
    pub text_wrap: Option<String>,
    pub text_overflow: Option<String>,
    pub line_clamp: Option<f64>,

    pub overflow: Option<String>,
    pub overflow_x: Option<String>,
    pub overflow_y: Option<String>,

    pub cursor: Option<String>,
    pub pointer_events: Option<String>,
    pub user_select: Option<String>,
    pub selection_color: Option<String>,

    pub transition: Option<StyleTransition>,

    pub hover: Option<Box<StyleDesc>>,
    pub hover_within: Option<Box<StyleDesc>>,
    pub active: Option<Box<StyleDesc>>,
    pub focus: Option<Box<StyleDesc>>,
    pub focus_visible: Option<Box<StyleDesc>>,
}

/// One rejected field. The renderer adds element context when diagnostics are drained,
/// after the rest of the batch (including `testId`) has been applied.
#[derive(Debug, Clone, PartialEq)]
pub struct StyleProblem {
    pub property: String,
    pub value: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct ParsedStyle {
    pub style: StyleDesc,
    pub problems: Vec<StyleProblem>,
}

fn displayed_value(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"))
}

fn reject(
    problems: &mut Vec<StyleProblem>,
    property: impl Into<String>,
    value: &serde_json::Value,
    reason: impl Into<String>,
) {
    problems.push(StyleProblem {
        property: property.into(),
        value: displayed_value(value),
        reason: reason.into(),
    });
}

fn decode<T: serde::de::DeserializeOwned>(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<T> {
    match serde_json::from_value::<Option<T>>(value.clone()) {
        Ok(decoded) => decoded,
        Err(error) => {
            reject(problems, property, value, error.to_string());
            None
        }
    }
}

fn decode_enum(
    property: &str,
    value: &serde_json::Value,
    allowed: &[&str],
    problems: &mut Vec<StyleProblem>,
) -> Option<String> {
    let decoded = decode::<String>(property, value, problems)?;
    if allowed.contains(&decoded.as_str()) {
        Some(decoded)
    } else {
        reject(
            problems,
            property,
            value,
            format!("expected one of {}", allowed.join(", ")),
        );
        None
    }
}

fn decode_number(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<f64> {
    decode(property, value, problems)
}

fn reject_unexpected_grid_fields(
    path: &str,
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
    problems: &mut Vec<StyleProblem>,
) -> bool {
    let mut valid = true;
    for (key, value) in object {
        if !allowed.contains(&key.as_str()) {
            reject(
                problems,
                format!("{path}.{key}"),
                value,
                "unsupported grid track property",
            );
            valid = false;
        }
    }
    valid
}

fn grid_track_object<'a>(
    path: &str,
    value: &'a serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<(&'a str, &'a serde_json::Map<String, serde_json::Value>)> {
    let Some(object) = value.as_object() else {
        reject(problems, path, value, "expected a grid track object");
        return None;
    };
    let Some(track_type) = object.get("type").and_then(serde_json::Value::as_str) else {
        reject(
            problems,
            format!("{path}.type"),
            object.get("type").unwrap_or(&serde_json::Value::Null),
            "expected a grid track type",
        );
        return None;
    };
    Some((track_type, object))
}

fn grid_track_number(
    path: &str,
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    problems: &mut Vec<StyleProblem>,
    positive: bool,
) -> Option<f64> {
    let property = format!("{path}.{field}");
    let Some(value) = object.get(field) else {
        reject(
            problems,
            property,
            &serde_json::Value::Null,
            "expected a number",
        );
        return None;
    };
    let Some(number) = decode_number(&property, value, problems) else {
        return None;
    };
    if !number.is_finite()
        || if positive {
            number <= 0.0
        } else {
            number < 0.0
        }
    {
        reject(
            problems,
            property,
            value,
            if positive {
                "expected a positive number"
            } else {
                "expected a non-negative number"
            },
        );
        return None;
    }
    Some(number)
}

fn parse_grid_track_sizing(
    path: &str,
    value: &serde_json::Value,
    allow_fr: bool,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTrackValue> {
    let (track_type, object) = grid_track_object(path, value, problems)?;
    match track_type {
        "px" => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "value"], problems);
            let value = grid_track_number(path, object, "value", problems, false)?;
            fields_ok.then_some(GridTrackValue::Px { value })
        }
        "fr" if allow_fr => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "value"], problems);
            let value = grid_track_number(path, object, "value", problems, true)?;
            fields_ok.then_some(GridTrackValue::Fr { value })
        }
        "auto" => reject_unexpected_grid_fields(path, object, &["type"], problems)
            .then_some(GridTrackValue::Auto),
        "min-content" => reject_unexpected_grid_fields(path, object, &["type"], problems)
            .then_some(GridTrackValue::MinContent),
        "max-content" => reject_unexpected_grid_fields(path, object, &["type"], problems)
            .then_some(GridTrackValue::MaxContent),
        "fr" => {
            reject(
                problems,
                format!("{path}.type"),
                object.get("type").expect("track type is present"),
                "fr is not valid as a minmax minimum",
            );
            None
        }
        "minmax" | "repeat" => {
            reject(
                problems,
                format!("{path}.type"),
                object.get("type").expect("track type is present"),
                "expected a grid track sizing function",
            );
            None
        }
        _ => {
            reject(
                problems,
                format!("{path}.type"),
                object.get("type").expect("track type is present"),
                "expected px, fr, auto, min-content, or max-content",
            );
            None
        }
    }
}

fn parse_grid_track_min(
    path: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTrackMinValue> {
    match parse_grid_track_sizing(path, value, false, problems)? {
        GridTrackValue::Px { value } => Some(GridTrackMinValue::Px { value }),
        GridTrackValue::Auto => Some(GridTrackMinValue::Auto),
        GridTrackValue::MinContent => Some(GridTrackMinValue::MinContent),
        GridTrackValue::MaxContent => Some(GridTrackMinValue::MaxContent),
        GridTrackValue::Fr { .. }
        | GridTrackValue::Minmax { .. }
        | GridTrackValue::Repeat { .. } => {
            unreachable!("grid track sizing grammar excludes these values")
        }
    }
}

fn parse_grid_track_max(
    path: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTrackMaxValue> {
    match parse_grid_track_sizing(path, value, true, problems)? {
        GridTrackValue::Px { value } => Some(GridTrackMaxValue::Px { value }),
        GridTrackValue::Fr { value } => Some(GridTrackMaxValue::Fr { value }),
        GridTrackValue::Auto => Some(GridTrackMaxValue::Auto),
        GridTrackValue::MinContent => Some(GridTrackMaxValue::MinContent),
        GridTrackValue::MaxContent => Some(GridTrackMaxValue::MaxContent),
        GridTrackValue::Minmax { .. } | GridTrackValue::Repeat { .. } => {
            unreachable!("grid track sizing grammar excludes these values")
        }
    }
}

fn parse_grid_track(
    path: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
    allow_repeat: bool,
) -> Option<GridTrackValue> {
    let (track_type, object) = grid_track_object(path, value, problems)?;
    match track_type {
        "minmax" => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "min", "max"], problems);
            let min = parse_grid_track_min(
                &format!("{path}.min"),
                object.get("min").unwrap_or(&serde_json::Value::Null),
                problems,
            )?;
            let max = parse_grid_track_max(
                &format!("{path}.max"),
                object.get("max").unwrap_or(&serde_json::Value::Null),
                problems,
            )?;
            fields_ok.then_some(GridTrackValue::Minmax { min, max })
        }
        "repeat" if allow_repeat => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "count", "tracks"], problems);
            let count = grid_track_number(path, object, "count", problems, true)?;
            if count.fract() != 0.0 || count > 64.0 {
                reject(
                    problems,
                    format!("{path}.count"),
                    object.get("count").expect("repeat count is present"),
                    "expected an integer from 1 through 64",
                );
                return None;
            }
            let Some(tracks) = object.get("tracks").and_then(serde_json::Value::as_array) else {
                reject(
                    problems,
                    format!("{path}.tracks"),
                    object.get("tracks").unwrap_or(&serde_json::Value::Null),
                    "expected a non-empty grid track list",
                );
                return None;
            };
            if tracks.is_empty() {
                reject(
                    problems,
                    format!("{path}.tracks"),
                    object.get("tracks").expect("repeat tracks is present"),
                    "expected a non-empty grid track list",
                );
                return None;
            }
            let mut parsed_tracks = Vec::with_capacity(tracks.len());
            let mut valid = fields_ok;
            for (index, track) in tracks.iter().enumerate() {
                match parse_grid_track(&format!("{path}.tracks[{index}]"), track, problems, false) {
                    Some(track) => parsed_tracks.push(track),
                    None => valid = false,
                }
            }
            valid.then_some(GridTrackValue::Repeat {
                count: count as u16,
                tracks: parsed_tracks,
            })
        }
        "repeat" => {
            reject(
                problems,
                format!("{path}.type"),
                object.get("type").expect("track type is present"),
                "repeat cannot be nested inside repeat",
            );
            None
        }
        _ => parse_grid_track_sizing(path, value, true, problems),
    }
}

fn grid_track_count(track: &GridTrackValue) -> usize {
    match track {
        GridTrackValue::Repeat { count, tracks } => usize::from(*count) * tracks.len(),
        _ => 1,
    }
}

fn parse_grid_template(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTemplateValue> {
    if value.is_number() {
        let count = decode_number(property, value, problems)?;
        if count < 1.0 || count > 64.0 || count.fract() != 0.0 {
            reject(
                problems,
                property,
                value,
                "expected an integer from 1 through 64 or a grid track list",
            );
            return None;
        }
        return Some(GridTemplateValue::LegacyCount(count));
    }

    let Some(tracks) = value.as_array() else {
        reject(
            problems,
            property,
            value,
            "expected an integer shorthand or a non-empty grid track list",
        );
        return None;
    };
    if tracks.is_empty() {
        reject(
            problems,
            property,
            value,
            "expected a non-empty grid track list",
        );
        return None;
    }

    let mut parsed_tracks = Vec::with_capacity(tracks.len());
    let mut valid = true;
    for (index, track) in tracks.iter().enumerate() {
        match parse_grid_track(&format!("{property}[{index}]"), track, problems, true) {
            Some(track) => parsed_tracks.push(track),
            None => valid = false,
        }
    }
    if !valid {
        return None;
    }
    if parsed_tracks.iter().map(grid_track_count).sum::<usize>() > 64 {
        reject(
            problems,
            property,
            value,
            "expected no more than 64 expanded grid tracks",
        );
        return None;
    }
    Some(GridTemplateValue::Tracks(parsed_tracks))
}

fn parse_nested_style(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<Box<StyleDesc>> {
    if value.is_null() {
        return None;
    }
    let mut nested = parse_style_value_at(value, property);
    problems.append(&mut nested.problems);
    Some(Box::new(nested.style))
}

fn parse_transition(
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<StyleTransition> {
    let Some(object) = value.as_object() else {
        reject(
            problems,
            "transition",
            value,
            "expected a transition object",
        );
        return None;
    };

    let mut valid = true;
    for (key, value) in object {
        if !matches!(
            key.as_str(),
            "properties" | "durationMs" | "delayMs" | "easing"
        ) {
            reject(
                problems,
                format!("transition.{key}"),
                value,
                "unsupported transition field",
            );
            valid = false;
        }
    }

    let mut properties = Vec::new();
    let mut seen = HashSet::new();
    match object
        .get("properties")
        .and_then(serde_json::Value::as_array)
    {
        Some(values) if values.is_empty() => {
            reject(
                problems,
                "transition.properties",
                object.get("properties").unwrap(),
                "expected at least one transition property",
            );
            valid = false;
        }
        Some(values) => {
            for (index, value) in values.iter().enumerate() {
                let path = format!("transition.properties[{index}]");
                let Some(name) = value.as_str() else {
                    reject(problems, path, value, "expected a property name");
                    valid = false;
                    continue;
                };
                let Some(property) = TransitionProperty::from_name(name) else {
                    reject(problems, path, value, "property is not transitionable");
                    valid = false;
                    continue;
                };
                if !seen.insert(property) {
                    reject(problems, path, value, "duplicate transition property");
                    valid = false;
                    continue;
                }
                properties.push(property);
            }
        }
        None => {
            reject(
                problems,
                "transition.properties",
                object.get("properties").unwrap_or(&serde_json::Value::Null),
                "expected an array of transitionable property names",
            );
            valid = false;
        }
    }

    let duration_ms = match object.get("durationMs").and_then(serde_json::Value::as_f64) {
        Some(value) if valid_transition_milliseconds(value) => value,
        _ => {
            reject(
                problems,
                "transition.durationMs",
                object.get("durationMs").unwrap_or(&serde_json::Value::Null),
                "expected a supported finite non-negative number of milliseconds",
            );
            valid = false;
            0.0
        }
    };
    let delay_ms = match object.get("delayMs") {
        None => 0.0,
        Some(value) => match value.as_f64() {
            Some(value) if valid_transition_milliseconds(value) => value,
            _ => {
                reject(
                    problems,
                    "transition.delayMs",
                    value,
                    "expected a supported finite non-negative number of milliseconds",
                );
                valid = false;
                0.0
            }
        },
    };
    let easing = match object.get("easing") {
        None => TransitionEasing::Name("ease".to_string()),
        Some(value) => match serde_json::from_value::<TransitionEasing>(value.clone()) {
            Ok(TransitionEasing::Name(name))
                if matches!(
                    name.as_str(),
                    "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut"
                ) =>
            {
                TransitionEasing::Name(name)
            }
            Ok(TransitionEasing::CubicBezier(curve))
                if curve.iter().all(|value| value.is_finite())
                    && (0.0..=1.0).contains(&curve[0])
                    && (0.0..=1.0).contains(&curve[2]) =>
            {
                TransitionEasing::CubicBezier(curve)
            }
            _ => {
                reject(
                    problems,
                    "transition.easing",
                    value,
                    "expected linear, ease, easeIn, easeOut, easeInOut, or a cubic-bezier tuple with x values from 0 through 1",
                );
                valid = false;
                TransitionEasing::Name("ease".to_string())
            }
        },
    };

    valid.then_some(StyleTransition {
        properties,
        duration_ms,
        delay_ms,
        easing,
    })
}

fn valid_transition_milliseconds(value: f64) -> bool {
    value.is_finite()
        && value >= 0.0
        && std::time::Duration::try_from_secs_f64(value / 1000.0).is_ok()
}

/// Parse one style object field-by-field. A malformed field is omitted while valid
/// siblings survive, so one bad value can never abort a React commit.
pub fn parse_style_value(value: &serde_json::Value) -> ParsedStyle {
    parse_style_value_at(value, "")
}

fn parse_style_value_at(value: &serde_json::Value, prefix: &str) -> ParsedStyle {
    let mut parsed = ParsedStyle::default();
    let Some(object) = value.as_object() else {
        reject(
            &mut parsed.problems,
            if prefix.is_empty() { "<style>" } else { prefix },
            value,
            "expected a style object",
        );
        return parsed;
    };

    macro_rules! property {
        ($name:literal) => {
            if prefix.is_empty() {
                $name.to_string()
            } else {
                format!("{prefix}.{}", $name)
            }
        };
    }

    macro_rules! number_field {
        ($key:expr, $value:expr, $name:literal, $field:ident) => {
            if $key == $name {
                parsed.style.$field =
                    decode_number(&property!($name), $value, &mut parsed.problems);
                continue;
            }
        };
    }

    macro_rules! dimension_field {
        ($key:expr, $value:expr, $name:literal, $field:ident) => {
            if $key == $name {
                parsed.style.$field = decode(&property!($name), $value, &mut parsed.problems);
                continue;
            }
        };
    }

    macro_rules! string_field {
        ($key:expr, $value:expr, $name:literal, $field:ident) => {
            if $key == $name {
                parsed.style.$field = decode(&property!($name), $value, &mut parsed.problems);
                continue;
            }
        };
    }

    macro_rules! enum_field {
        ($key:expr, $value:expr, $name:literal, $field:ident, [$($allowed:literal),+ $(,)?]) => {
            if $key == $name {
                parsed.style.$field = decode_enum(
                    &property!($name),
                    $value,
                    &[$($allowed),+],
                    &mut parsed.problems,
                );
                continue;
            }
        };
    }

    'fields: for (key, value) in object {
        if key == "transition" {
            if prefix.is_empty() {
                parsed.style.transition = parse_transition(value, &mut parsed.problems);
            } else {
                reject(
                    &mut parsed.problems,
                    property!("transition"),
                    value,
                    "nested transitions are not supported; declare transition on the base style",
                );
            }
            continue;
        }
        enum_field!(key, value, "display", display, ["flex", "grid"]);
        enum_field!(key, value, "visibility", visibility, ["visible", "hidden"]);
        enum_field!(
            key,
            value,
            "flexDirection",
            flex_direction,
            ["row", "column"]
        );
        enum_field!(
            key,
            value,
            "flexWrap",
            flex_wrap,
            ["nowrap", "wrap", "wrap-reverse"]
        );
        number_field!(key, value, "flexGrow", flex_grow);
        number_field!(key, value, "flexShrink", flex_shrink);
        number_field!(key, value, "flexBasis", flex_basis);
        enum_field!(
            key,
            value,
            "alignItems",
            align_items,
            [
                "start",
                "flex-start",
                "center",
                "end",
                "flex-end",
                "baseline",
                "stretch"
            ]
        );
        enum_field!(
            key,
            value,
            "alignSelf",
            align_self,
            [
                "start",
                "flex-start",
                "center",
                "end",
                "flex-end",
                "stretch",
                "baseline"
            ]
        );
        enum_field!(
            key,
            value,
            "alignContent",
            align_content,
            [
                "normal",
                "start",
                "flex-start",
                "center",
                "end",
                "flex-end",
                "between",
                "space-between",
                "around",
                "space-around",
                "evenly",
                "space-evenly",
                "stretch"
            ]
        );
        enum_field!(
            key,
            value,
            "justifyContent",
            justify_content,
            [
                "start",
                "flex-start",
                "center",
                "end",
                "flex-end",
                "between",
                "space-between",
                "around",
                "space-around",
                "evenly",
                "space-evenly"
            ]
        );
        number_field!(key, value, "gap", gap);
        number_field!(key, value, "rowGap", row_gap);
        number_field!(key, value, "columnGap", column_gap);
        if key == "gridTemplateColumns" {
            parsed.style.grid_template_columns = parse_grid_template(
                &property!("gridTemplateColumns"),
                value,
                &mut parsed.problems,
            );
            continue;
        }
        if key == "gridTemplateRows" {
            parsed.style.grid_template_rows =
                parse_grid_template(&property!("gridTemplateRows"), value, &mut parsed.problems);
            continue;
        }
        enum_field!(
            key,
            value,
            "gridColumnMin",
            grid_column_min,
            ["zero", "min-content", "max-content"]
        );
        enum_field!(
            key,
            value,
            "gridRowMin",
            grid_row_min,
            ["zero", "min-content", "max-content"]
        );

        dimension_field!(key, value, "width", width);
        dimension_field!(key, value, "height", height);
        dimension_field!(key, value, "minWidth", min_width);
        dimension_field!(key, value, "minHeight", min_height);
        dimension_field!(key, value, "maxWidth", max_width);
        dimension_field!(key, value, "maxHeight", max_height);

        number_field!(key, value, "padding", padding);
        number_field!(key, value, "paddingTop", padding_top);
        number_field!(key, value, "paddingRight", padding_right);
        number_field!(key, value, "paddingBottom", padding_bottom);
        number_field!(key, value, "paddingLeft", padding_left);
        number_field!(key, value, "margin", margin);
        number_field!(key, value, "marginTop", margin_top);
        number_field!(key, value, "marginRight", margin_right);
        number_field!(key, value, "marginBottom", margin_bottom);
        number_field!(key, value, "marginLeft", margin_left);

        enum_field!(
            key,
            value,
            "position",
            position,
            ["relative", "absolute", "fixed"]
        );
        number_field!(key, value, "top", top);
        number_field!(key, value, "right", right);
        number_field!(key, value, "bottom", bottom);
        number_field!(key, value, "left", left);

        if key == "background" {
            let property = property!("background");
            if let Some(background) =
                decode::<BackgroundValue>(&property, value, &mut parsed.problems)
            {
                match parse_background(&background) {
                    Ok(_) => parsed.style.background = Some(background),
                    Err(reason) => reject(&mut parsed.problems, property, value, reason),
                }
            }
            continue;
        }
        for (name, slot) in [
            ("backgroundColor", &mut parsed.style.background_color),
            ("color", &mut parsed.style.color),
            ("borderColor", &mut parsed.style.border_color),
            ("outlineColor", &mut parsed.style.outline_color),
            ("selectionColor", &mut parsed.style.selection_color),
        ] {
            if key == name {
                let property = if prefix.is_empty() {
                    name.to_string()
                } else {
                    format!("{prefix}.{name}")
                };
                if let Some(color) = decode::<String>(&property, value, &mut parsed.problems) {
                    if crate::color::parse_color_rgba(&color).is_some() {
                        *slot = Some(color);
                    } else {
                        reject(&mut parsed.problems, property, value, "unsupported color");
                    }
                }
                continue 'fields;
            }
        }
        number_field!(key, value, "opacity", opacity);

        number_field!(key, value, "borderWidth", border_width);
        number_field!(key, value, "borderTopWidth", border_top_width);
        number_field!(key, value, "borderRightWidth", border_right_width);
        number_field!(key, value, "borderBottomWidth", border_bottom_width);
        number_field!(key, value, "borderLeftWidth", border_left_width);
        number_field!(key, value, "borderRadius", border_radius);
        number_field!(key, value, "borderTopLeftRadius", border_top_left_radius);
        number_field!(key, value, "borderTopRightRadius", border_top_right_radius);
        number_field!(
            key,
            value,
            "borderBottomLeftRadius",
            border_bottom_left_radius
        );
        number_field!(
            key,
            value,
            "borderBottomRightRadius",
            border_bottom_right_radius
        );
        if key == "boxShadow" {
            let property = property!("boxShadow");
            if let Some(shadow) = decode::<BoxShadowValue>(&property, value, &mut parsed.problems) {
                if crate::color::parse_color_rgba(&shadow.color).is_some() {
                    parsed.style.box_shadow = Some(shadow);
                } else {
                    reject(
                        &mut parsed.problems,
                        format!("{property}.color"),
                        &serde_json::Value::String(shadow.color),
                        "unsupported color",
                    );
                }
            }
            continue;
        }
        number_field!(key, value, "outlineWidth", outline_width);
        number_field!(key, value, "outlineOffset", outline_offset);

        number_field!(key, value, "fontSize", font_size);
        string_field!(key, value, "fontFamily", font_family);
        if key == "fontWeight" {
            let property = property!("fontWeight");
            if let Some(weight) = decode::<FontWeightValue>(&property, value, &mut parsed.problems)
            {
                let valid = match &weight {
                    FontWeightValue::Num(number) => (1.0..=1000.0).contains(number),
                    FontWeightValue::Str(name) => {
                        matches!(
                            name.as_str(),
                            "thin"
                                | "extralight"
                                | "extra-light"
                                | "light"
                                | "normal"
                                | "medium"
                                | "semibold"
                                | "semi-bold"
                                | "bold"
                                | "extrabold"
                                | "extra-bold"
                                | "black"
                        ) || name
                            .parse::<f64>()
                            .is_ok_and(|number| (1.0..=1000.0).contains(&number))
                    }
                };
                if valid {
                    parsed.style.font_weight = Some(weight);
                } else {
                    reject(
                        &mut parsed.problems,
                        property,
                        value,
                        "unsupported font weight",
                    );
                }
            }
            continue;
        }
        number_field!(key, value, "letterSpacing", letter_spacing);
        enum_field!(
            key,
            value,
            "textDecoration",
            text_decoration,
            ["underline", "line-through"]
        );
        enum_field!(
            key,
            value,
            "textTransform",
            text_transform,
            ["none", "uppercase", "lowercase"]
        );
        enum_field!(
            key,
            value,
            "textAlign",
            text_align,
            ["left", "start", "center", "right"]
        );
        number_field!(key, value, "lineHeight", line_height);
        enum_field!(key, value, "whiteSpace", white_space, ["normal", "nowrap"]);
        if key == "textWrap" {
            let property = property!("textWrap");
            let wrap = decode::<String>(&property, value, &mut parsed.problems);
            match wrap.as_deref() {
                Some("wrap" | "nowrap") => parsed.style.text_wrap = wrap,
                Some("balance" | "pretty") => reject(
                    &mut parsed.problems,
                    property,
                    value,
                    "balanced and pretty wrapping are not supported by GPUI",
                ),
                Some(_) => reject(
                    &mut parsed.problems,
                    property,
                    value,
                    "expected wrap, nowrap, balance, or pretty",
                ),
                None => {}
            }
            continue;
        }
        enum_field!(
            key,
            value,
            "textOverflow",
            text_overflow,
            ["ellipsis", "ellipsis-start"]
        );
        number_field!(key, value, "lineClamp", line_clamp);

        enum_field!(
            key,
            value,
            "overflow",
            overflow,
            ["visible", "hidden", "scroll"]
        );
        enum_field!(
            key,
            value,
            "overflowX",
            overflow_x,
            ["visible", "hidden", "scroll"]
        );
        enum_field!(
            key,
            value,
            "overflowY",
            overflow_y,
            ["visible", "hidden", "scroll"]
        );
        if key == "cursor" {
            let property = property!("cursor");
            if let Some(cursor) = decode::<String>(&property, value, &mut parsed.problems) {
                if parse_cursor(&cursor).is_some() {
                    parsed.style.cursor = Some(cursor);
                } else {
                    reject(&mut parsed.problems, property, value, "unsupported cursor");
                }
            }
            continue;
        }
        enum_field!(
            key,
            value,
            "pointerEvents",
            pointer_events,
            ["auto", "none"]
        );
        enum_field!(
            key,
            value,
            "userSelect",
            user_select,
            ["auto", "text", "none"]
        );

        if matches!(
            key.as_str(),
            "hover" | "hoverWithin" | "active" | "focus" | "focusVisible"
        ) {
            let property = match key.as_str() {
                "hover" => property!("hover"),
                "hoverWithin" => property!("hoverWithin"),
                "active" => property!("active"),
                "focus" => property!("focus"),
                "focusVisible" => property!("focusVisible"),
                _ => unreachable!(),
            };
            if !prefix.is_empty() {
                reject(
                    &mut parsed.problems,
                    property,
                    value,
                    "nested state styles are not supported",
                );
            } else {
                match key.as_str() {
                    "hover" => {
                        parsed.style.hover =
                            parse_nested_style("hover", value, &mut parsed.problems)
                    }
                    "hoverWithin" => {
                        parsed.style.hover_within =
                            parse_nested_style("hoverWithin", value, &mut parsed.problems)
                    }
                    "active" => {
                        parsed.style.active =
                            parse_nested_style("active", value, &mut parsed.problems)
                    }
                    "focus" => {
                        parsed.style.focus =
                            parse_nested_style("focus", value, &mut parsed.problems)
                    }
                    "focusVisible" => {
                        parsed.style.focus_visible =
                            parse_nested_style("focusVisible", value, &mut parsed.problems)
                    }
                    _ => unreachable!(),
                }
            }
            continue;
        }

        reject(
            &mut parsed.problems,
            if prefix.is_empty() {
                key.clone()
            } else {
                format!("{prefix}.{key}")
            },
            value,
            "unsupported style property",
        );
    }

    validate_ranges(&mut parsed, prefix);
    parsed
}

fn validate_ranges(parsed: &mut ParsedStyle, prefix: &str) {
    macro_rules! reject_if {
        ($field:ident, $name:literal, $invalid:expr, $reason:literal) => {
            if parsed.style.$field.is_some_and($invalid) {
                let value = serde_json::Value::from(parsed.style.$field.take().unwrap());
                let property = if prefix.is_empty() {
                    $name.to_string()
                } else {
                    format!("{prefix}.{}", $name)
                };
                reject(&mut parsed.problems, property, &value, $reason);
            }
        };
    }

    reject_if!(
        opacity,
        "opacity",
        |value| !(0.0..=1.0).contains(&value),
        "expected a number from 0 through 1"
    );
    reject_if!(
        font_size,
        "fontSize",
        |value| value <= 0.0,
        "expected a positive number"
    );
    reject_if!(
        line_height,
        "lineHeight",
        |value| value <= 0.0,
        "expected a positive number"
    );
    reject_if!(
        line_clamp,
        "lineClamp",
        |value| value < 1.0 || value.fract() != 0.0,
        "expected a positive integer"
    );
    reject_if!(
        flex_grow,
        "flexGrow",
        |value| value < 0.0,
        "expected a non-negative number"
    );
    reject_if!(
        flex_shrink,
        "flexShrink",
        |value| value < 0.0,
        "expected a non-negative number"
    );
    macro_rules! non_negative {
        ($($field:ident => $name:literal),+ $(,)?) => {
            $(reject_if!($field, $name, |value| value < 0.0, "expected a non-negative number");)+
        };
    }
    non_negative!(
        gap => "gap",
        row_gap => "rowGap",
        column_gap => "columnGap",
        padding => "padding",
        padding_top => "paddingTop",
        padding_right => "paddingRight",
        padding_bottom => "paddingBottom",
        padding_left => "paddingLeft",
        border_width => "borderWidth",
        border_top_width => "borderTopWidth",
        border_right_width => "borderRightWidth",
        border_bottom_width => "borderBottomWidth",
        border_left_width => "borderLeftWidth",
        border_radius => "borderRadius",
        border_top_left_radius => "borderTopLeftRadius",
        border_top_right_radius => "borderTopRightRadius",
        border_bottom_left_radius => "borderBottomLeftRadius",
        border_bottom_right_radius => "borderBottomRightRadius",
        outline_width => "outlineWidth",
    );
}

fn gradient_color_space(value: Option<&str>) -> Result<gpui::ColorSpace, String> {
    match value.unwrap_or("srgb") {
        "srgb" => Ok(gpui::ColorSpace::Srgb),
        "oklab" => Ok(gpui::ColorSpace::Oklab),
        other => Err(format!("unsupported gradient color space {other:?}")),
    }
}

fn native_linear_gradient(
    angle: f64,
    stops: &[LinearGradientStopValue],
    color_space: Option<&str>,
) -> Result<gpui::Background, String> {
    if !angle.is_finite() {
        return Err("gradient angle must be finite".into());
    }
    if !(2..=MAX_LINEAR_GRADIENT_STOPS).contains(&stops.len()) {
        return Err(format!(
            "linear gradients require 2 through {MAX_LINEAR_GRADIENT_STOPS} color stops"
        ));
    }

    let mut previous = -1.0;
    let mut native_stops = Vec::with_capacity(stops.len());
    for stop in stops {
        if !(0.0..=1.0).contains(&stop.position) || stop.position < previous {
            return Err("gradient stop positions must increase from 0 through 1".into());
        }
        previous = stop.position;
        let color = crate::color::parse_color_rgba(&stop.color)
            .ok_or_else(|| format!("unsupported gradient color {:?}", stop.color))?;
        native_stops.push(gpui::linear_color_stop(color, stop.position as f32));
    }

    Ok(gpui::linear_gradient_stops(angle as f32, native_stops)
        .color_space(gradient_color_space(color_space)?))
}

/// Parse a solid or linear-gradient background through one shared path.
pub fn parse_background(value: &BackgroundValue) -> Result<gpui::Background, String> {
    match value {
        BackgroundValue::String(value) => parse_background_string(value),
        BackgroundValue::Image(BackgroundImageValue::LinearGradient {
            angle,
            stops,
            color_space,
        }) => native_linear_gradient(*angle, stops, color_space.as_deref()),
    }
}

fn parse_background_string(value: &str) -> Result<gpui::Background, String> {
    let trimmed = value.trim();
    if trimmed.starts_with("radial-gradient(") {
        return Err("radial gradients are not supported by GPUI".into());
    }
    if !trimmed.starts_with("linear-gradient(") {
        return crate::color::parse_color_rgba(trimmed)
            .map(Into::into)
            .ok_or_else(|| "unsupported color or background".into());
    }

    let body = trimmed
        .strip_prefix("linear-gradient(")
        .and_then(|body| body.strip_suffix(')'))
        .ok_or_else(|| "malformed linear-gradient()".to_string())?;
    let mut parts = split_top_level(body, ',');
    if parts.len() < 2 {
        return Err("linear-gradient() requires at least two color stops".into());
    }

    let mut angle = 180.0;
    let mut color_space = None;
    let prelude = parts[0].trim();
    if let Some(parsed) = parse_gradient_direction(prelude) {
        angle = parsed.0;
        color_space = parsed.1;
        parts.remove(0);
    }

    let count = parts.len();
    let mut stops = Vec::with_capacity(count);
    for (index, part) in parts.into_iter().enumerate() {
        let part = part.trim();
        let (color, position) = match part.rsplit_once(char::is_whitespace) {
            Some((color, position)) if position.ends_with('%') => {
                let position = position[..position.len() - 1]
                    .parse::<f64>()
                    .map_err(|_| format!("invalid gradient stop position {position:?}"))?
                    / 100.0;
                (color.trim(), position)
            }
            _ => (part, index as f64 / (count.saturating_sub(1)) as f64),
        };
        stops.push(LinearGradientStopValue {
            color: color.to_string(),
            position,
        });
    }

    native_linear_gradient(angle, &stops, color_space.as_deref())
}

fn parse_gradient_direction(value: &str) -> Option<(f64, Option<String>)> {
    if let Some(color_space) = value.strip_prefix("in ") {
        return Some((180.0, Some(color_space.trim().to_string())));
    }
    let (direction, color_space) = value
        .split_once(" in ")
        .map(|(direction, space)| (direction.trim(), Some(space.trim().to_string())))
        .unwrap_or((value.trim(), None));
    let angle = if let Some(degrees) = direction.strip_suffix("deg") {
        degrees.trim().parse().ok()?
    } else {
        match direction {
            "to top" => 0.0,
            "to right" => 90.0,
            "to bottom" => 180.0,
            "to left" => 270.0,
            _ if color_space.is_some() && direction.is_empty() => 180.0,
            _ => return None,
        }
    };
    Some((angle, color_space))
}

fn split_top_level(value: &str, separator: char) -> Vec<&str> {
    let mut depth = 0usize;
    let mut start = 0usize;
    let mut parts = Vec::new();
    for (index, character) in value.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if character == separator && depth == 0 => {
                parts.push(&value[start..index]);
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&value[start..]);
    parts
}

pub use crate::color::{parse_color, parse_color_hex};

/// Whether an element should block ordinary pointer hits behind it.
/// Explicit `pointerEvents` wins. Otherwise interactive elements, painted
/// fills, and positioned boxes own a hitbox while still allowing wheel input
/// to reach an ancestor scroller.
pub fn should_occlude(style: Option<&StyleDesc>, interactive: bool) -> bool {
    match style.and_then(|style| style.pointer_events.as_deref()) {
        Some("none") => return false,
        Some("auto") => return true,
        _ => {}
    }
    if interactive {
        return true;
    }
    let Some(style) = style else {
        return false;
    };
    if matches!(style.position.as_deref(), Some("absolute") | Some("fixed")) {
        return true;
    }
    let color = if let Some(color) = style.background_color.as_deref() {
        color
    } else {
        match style.background.as_ref() {
            Some(BackgroundValue::String(color)) => color,
            Some(BackgroundValue::Image(_)) => return true,
            None => return false,
        }
    };
    match crate::color::parse_color_rgba(color) {
        Some(color) => color.a > 0.0,
        None => true,
    }
}

/// Map a CSS `cursor` keyword onto a GPUI cursor. Unknown keywords return
/// `None` so the property is ignored, like every other invalid style value.
///
/// `ResizeUpLeftDownRight` is the NorthWest/SouthEast cursor on every backend,
/// so it is `nwse-resize`. GPUI's doc comments and its browser backend named
/// the opposite CSS values until the pinned fork corrected them, so do not
/// "fix" this pair back by reading an older GPUI.
pub fn parse_cursor(name: &str) -> Option<gpui::CursorStyle> {
    use gpui::CursorStyle;
    Some(match name {
        "default" | "auto" => CursorStyle::Arrow,
        "pointer" => CursorStyle::PointingHand,
        "text" => CursorStyle::IBeam,
        "vertical-text" => CursorStyle::IBeamCursorForVerticalLayout,
        "crosshair" => CursorStyle::Crosshair,
        "grab" => CursorStyle::OpenHand,
        "grabbing" | "move" | "all-scroll" => CursorStyle::ClosedHand,
        "col-resize" => CursorStyle::ResizeColumn,
        "row-resize" => CursorStyle::ResizeRow,
        "ew-resize" => CursorStyle::ResizeLeftRight,
        "ns-resize" => CursorStyle::ResizeUpDown,
        "nwse-resize" | "nw-resize" | "se-resize" => CursorStyle::ResizeUpLeftDownRight,
        "nesw-resize" | "ne-resize" | "sw-resize" => CursorStyle::ResizeUpRightDownLeft,
        "w-resize" => CursorStyle::ResizeLeft,
        "e-resize" => CursorStyle::ResizeRight,
        "n-resize" => CursorStyle::ResizeUp,
        "s-resize" => CursorStyle::ResizeDown,
        "not-allowed" | "no-drop" => CursorStyle::OperationNotAllowed,
        "alias" => CursorStyle::DragLink,
        "copy" => CursorStyle::DragCopy,
        "context-menu" => CursorStyle::ContextualMenu,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pointer_hit_testing_follows_interaction_and_explicit_overrides() {
        let passive = StyleDesc::default();
        assert!(!should_occlude(Some(&passive), false));
        assert!(should_occlude(Some(&passive), true));
        assert!(should_occlude(None, true));

        let auto = StyleDesc {
            pointer_events: Some("auto".into()),
            ..Default::default()
        };
        assert!(should_occlude(Some(&auto), false));

        let none = StyleDesc {
            pointer_events: Some("none".into()),
            ..Default::default()
        };
        assert!(!should_occlude(Some(&none), true));
    }

    #[test]
    fn malformed_fields_are_rejected_independently() {
        let parsed = parse_style_value(&json!({
            "backgroundColor": "red",
            "marginTop": "auto",
            "textTranform": "uppercase",
            "hover": { "opacity": 2 }
        }));

        assert_eq!(parsed.style.background_color.as_deref(), Some("red"));
        assert_eq!(parsed.style.margin_top, None);
        assert_eq!(parsed.problems.len(), 3);
        assert_eq!(parsed.problems[0].property, "marginTop");
        assert_eq!(parsed.problems[0].value, "\"auto\"");
        assert_eq!(parsed.problems[1].property, "textTranform");
        assert_eq!(parsed.problems[2].property, "hover.opacity");
    }

    #[test]
    fn malformed_transition_specs_are_rejected_as_a_whole() {
        let parsed = parse_style_value(&json!({
            "opacity": 0.5,
            "transition": {
                "properties": ["opacity", "display", "opacity"],
                "durationMs": -1,
                "easing": [2, 0, 0, 1],
                "duration": 100
            }
        }));

        assert_eq!(parsed.style.opacity, Some(0.5));
        assert_eq!(parsed.style.transition, None);
        let properties = parsed
            .problems
            .iter()
            .map(|problem| problem.property.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            properties,
            [
                "transition.duration",
                "transition.properties[1]",
                "transition.properties[2]",
                "transition.durationMs",
                "transition.easing"
            ]
        );

        let nested = parse_style_value(&json!({
            "hover": {
                "transition": { "properties": ["opacity"], "durationMs": 100 }
            }
        }));
        assert_eq!(nested.problems[0].property, "hover.transition");
        assert!(nested.style.hover.unwrap().transition.is_none());

        let oversized = parse_style_value(&json!({
            "transition": { "properties": ["opacity"], "durationMs": 1e300 }
        }));
        assert_eq!(oversized.style.transition, None);
        assert_eq!(oversized.problems[0].property, "transition.durationMs");
    }

    #[test]
    fn parses_mixed_grid_track_lists_and_preserves_integer_shorthand() {
        let parsed = parse_style_value(&json!({
            "gridTemplateColumns": [
                { "type": "max-content" },
                {
                    "type": "minmax",
                    "min": { "type": "px", "value": 0 },
                    "max": { "type": "fr", "value": 1 }
                },
                { "type": "auto" },
                {
                    "type": "repeat",
                    "count": 2,
                    "tracks": [{ "type": "px", "value": 24 }]
                }
            ],
            "gridTemplateRows": [
                { "type": "px", "value": 40 },
                { "type": "auto" }
            ]
        }));

        assert!(parsed.problems.is_empty());
        assert!(matches!(
            parsed.style.grid_template_columns,
            Some(GridTemplateValue::Tracks(ref tracks)) if tracks.len() == 4
        ));
        assert!(matches!(
            parsed.style.grid_template_rows,
            Some(GridTemplateValue::Tracks(ref tracks)) if tracks.len() == 2
        ));

        let shorthand = parse_style_value(&json!({ "gridTemplateRows": 2 }));
        assert_eq!(
            shorthand.style.grid_template_rows,
            Some(GridTemplateValue::LegacyCount(2.0))
        );
    }

    #[test]
    fn rejects_malformed_grid_tracks_at_the_nested_index() {
        let parsed = parse_style_value(&json!({
            "gridTemplateColumns": [
                { "type": "max-content" },
                {
                    "type": "minmax",
                    "min": { "type": "fr", "value": 1 },
                    "max": { "type": "fr", "value": 1 }
                }
            ]
        }));

        assert_eq!(parsed.style.grid_template_columns, None);
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(
            parsed.problems[0].property,
            "gridTemplateColumns[1].min.type"
        );
        assert_eq!(parsed.problems[0].value, "\"fr\"");
    }

    #[test]
    fn named_colors_are_valid_paints() {
        let parsed = parse_style_value(&json!({ "backgroundColor": "red" }));
        assert!(parsed.problems.is_empty());
        assert_eq!(parsed.style.background_color.as_deref(), Some("red"));
    }

    #[test]
    fn radial_and_unsupported_wrapping_are_explicit_rejections() {
        let parsed = parse_style_value(&json!({
            "background": "radial-gradient(red, blue)",
            "textWrap": "balance"
        }));
        assert_eq!(parsed.problems.len(), 2);
        assert!(parsed.problems[0].reason.contains("radial"));
        assert!(parsed.problems[1].reason.contains("not supported"));
    }

    #[test]
    fn outline_and_focus_fields_use_the_shared_validation_path() {
        let parsed = parse_style_value(&json!({
            "outlineColor": "not-a-color",
            "outlineWidth": -1,
            "outlineOffset": "wide",
            "focusVisible": {
                "backgroundColor": "blue",
                "outlineWidth": -2
            }
        }));

        let mut properties = parsed
            .problems
            .iter()
            .map(|problem| problem.property.as_str())
            .collect::<Vec<_>>();
        properties.sort_unstable();
        assert_eq!(
            properties,
            [
                "focusVisible.outlineWidth",
                "outlineColor",
                "outlineOffset",
                "outlineWidth"
            ]
        );
        assert_eq!(
            parsed
                .style
                .focus_visible
                .as_deref()
                .and_then(|style| style.background_color.as_deref()),
            Some("blue")
        );
    }

    #[test]
    fn parses_css_and_structured_linear_gradients() {
        let css = parse_background(&BackgroundValue::String(
            "linear-gradient(90deg in oklab, red 0%, blue 100%)".into(),
        ));
        assert!(css.is_ok());
        let default_direction = parse_background(&BackgroundValue::String(
            "linear-gradient(in oklab, red, blue)".into(),
        ));
        assert!(default_direction.is_ok());

        let structured = parse_background(&BackgroundValue::Image(
            BackgroundImageValue::LinearGradient {
                angle: 45.0,
                stops: vec![
                    LinearGradientStopValue {
                        color: "red".into(),
                        position: 0.0,
                    },
                    LinearGradientStopValue {
                        color: "green".into(),
                        position: 0.5,
                    },
                    LinearGradientStopValue {
                        color: "blue".into(),
                        position: 1.0,
                    },
                ],
                color_space: Some("srgb".into()),
            },
        ));
        assert!(structured.is_ok());

        let structured_json = parse_style_value(&json!({
            "background": {
                "type": "linearGradient",
                "angle": 45,
                "stops": [
                    { "color": "red", "position": 0 },
                    { "color": "blue", "position": 1 }
                ],
                "colorSpace": "oklab"
            }
        }));
        assert!(
            structured_json.problems.is_empty(),
            "{:?}",
            structured_json.problems
        );

        let malformed = parse_style_value(&json!({
            "background": {
                "type": "linearGradient",
                "angle": 45,
                "stops": [
                    { "color": "red", "position": 0 },
                    { "color": "blue", "position": 1 }
                ],
                "colourSpace": "srgb"
            }
        }));
        assert_eq!(malformed.problems.len(), 1);
        assert_eq!(malformed.problems[0].property, "background");
        assert!(malformed.problems[0].value.contains("colourSpace"));
    }

    #[test]
    fn every_declared_style_field_is_parsed_or_has_an_explicit_value_rejection() {
        let source: serde_json::Value = serde_json::from_str(
            r#"{
            "display": "flex",
            "visibility": "visible",
            "flexDirection": "row",
            "flexWrap": "wrap",
            "flexGrow": 1,
            "flexShrink": 1,
            "flexBasis": 20,
            "alignItems": "baseline",
            "alignSelf": "baseline",
            "alignContent": "space-evenly",
            "justifyContent": "space-evenly",
            "gap": 1,
            "rowGap": 2,
            "columnGap": 3,
            "gridTemplateColumns": 2,
            "gridTemplateRows": 2,
            "gridColumnMin": "min-content",
            "gridRowMin": "max-content",
            "width": 100,
            "height": "100%",
            "minWidth": "auto",
            "minHeight": 1,
            "maxWidth": 200,
            "maxHeight": "90%",
            "padding": 1,
            "paddingTop": 1,
            "paddingRight": 1,
            "paddingBottom": 1,
            "paddingLeft": 1,
            "margin": -1,
            "marginTop": -1,
            "marginRight": -1,
            "marginBottom": -1,
            "marginLeft": -1,
            "position": "absolute",
            "top": 1,
            "right": 1,
            "bottom": 1,
            "left": 1,
            "background": "red",
            "backgroundColor": "red",
            "color": "red",
            "opacity": 0.5,
            "borderWidth": 1,
            "borderTopWidth": 1,
            "borderRightWidth": 1,
            "borderBottomWidth": 1,
            "borderLeftWidth": 1,
            "borderColor": "red",
            "borderRadius": 1,
            "borderTopLeftRadius": 1,
            "borderTopRightRadius": 1,
            "borderBottomLeftRadius": 1,
            "borderBottomRightRadius": 1,
            "boxShadow": {
                "offsetX": 1,
                "offsetY": 1,
                "blurRadius": 1,
                "spreadRadius": 1,
                "color": "red"
            },
            "outlineColor": "blue",
            "outlineWidth": 2,
            "outlineOffset": 3,
            "fontSize": 16,
            "fontFamily": "Helvetica",
            "fontWeight": "bold",
            "letterSpacing": 1,
            "textDecoration": "underline",
            "textTransform": "uppercase",
            "textAlign": "center",
            "lineHeight": 20,
            "whiteSpace": "normal",
            "textWrap": "wrap",
            "textOverflow": "ellipsis",
            "lineClamp": 2,
            "overflow": "visible",
            "overflowX": "hidden",
            "overflowY": "scroll",
            "cursor": "pointer",
            "pointerEvents": "auto",
            "userSelect": "text",
            "selectionColor": "red",
            "transition": {
                "properties": ["opacity", "backgroundColor", "width"],
                "durationMs": 140,
                "delayMs": 20,
                "easing": "ease"
            },
            "hover": { "color": "blue" },
            "hoverWithin": { "backgroundColor": "magenta" },
            "active": { "color": "green" },
            "focus": { "borderColor": "yellow" },
            "focusVisible": { "outlineColor": "cyan" }
        }"#,
        )
        .unwrap();

        let parsed = parse_style_value(&source);
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        let declared = serde_json::to_value(parsed.style).unwrap();
        let declared_keys = declared
            .as_object()
            .unwrap()
            .keys()
            .collect::<std::collections::BTreeSet<_>>();
        let covered_keys = source
            .as_object()
            .unwrap()
            .keys()
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(declared_keys, covered_keys);

        // This catches the original alignSelf failure mode: a field may parse
        // and serialize correctly while never reaching any renderer branch.
        // Strip whitespace so split method chains such as
        // `style\n.selection_color` remain visible to the check.
        let renderer = include_str!("renderer.rs")
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        for key in source.as_object().unwrap().keys() {
            let mut native_name = String::new();
            for character in key.chars() {
                if character.is_ascii_uppercase() {
                    native_name.push('_');
                    native_name.push(character.to_ascii_lowercase());
                } else {
                    native_name.push(character);
                }
            }
            assert!(
                renderer.contains(&format!("style.{native_name}")),
                "{key} is declared but has no renderer application path"
            );
        }
    }
    fn with_fill(fill: &str) -> StyleDesc {
        StyleDesc {
            background_color: Some(fill.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn transparent_function_does_not_occlude() {
        assert!(!should_occlude(Some(&with_fill("transparent")), false));
        assert!(!should_occlude(
            Some(&with_fill("oklch(50% 0.2 30 / 0%)")),
            false
        ));
    }

    #[test]
    fn invalid_fill_keeps_conservative_occlusion() {
        assert!(should_occlude(Some(&with_fill("not-a-color")), false));
    }

    #[test]
    fn maps_the_timeline_cursors() {
        assert_eq!(
            parse_cursor("col-resize"),
            Some(gpui::CursorStyle::ResizeColumn)
        );
        assert_eq!(parse_cursor("grab"), Some(gpui::CursorStyle::OpenHand));
        assert_eq!(
            parse_cursor("grabbing"),
            Some(gpui::CursorStyle::ClosedHand)
        );
        assert_eq!(
            parse_cursor("pointer"),
            Some(gpui::CursorStyle::PointingHand)
        );
        assert_eq!(parse_cursor("default"), Some(gpui::CursorStyle::Arrow));
    }

    #[test]
    fn strict_style_parsing_accepts_every_paintable_cursor() {
        for cursor in [
            "default",
            "auto",
            "pointer",
            "text",
            "vertical-text",
            "crosshair",
            "grab",
            "grabbing",
            "move",
            "all-scroll",
            "col-resize",
            "row-resize",
            "ew-resize",
            "ns-resize",
            "nwse-resize",
            "nesw-resize",
            "n-resize",
            "e-resize",
            "s-resize",
            "w-resize",
            "ne-resize",
            "nw-resize",
            "se-resize",
            "sw-resize",
            "not-allowed",
            "no-drop",
            "alias",
            "copy",
            "context-menu",
        ] {
            let parsed = parse_style_value(&json!({ "cursor": cursor }));
            assert!(
                parsed.problems.is_empty(),
                "{cursor}: {:?}",
                parsed.problems
            );
            assert_eq!(parsed.style.cursor.as_deref(), Some(cursor));
        }
    }

    #[test]
    fn ignores_an_unknown_cursor() {
        assert_eq!(parse_cursor("zoom-in"), None);
        assert_eq!(parse_cursor("POINTER"), None);
    }
}
