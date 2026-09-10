use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;

const MAX_LINEAR_GRADIENT_STOPS: usize = 8;
const REPEATING_GRADIENT_REJECTION: &str = "repeating-linear-gradient() is painted only as a 135deg two-stop pixel hatch: `135deg, <color> 0 <w>px, transparent <w>px <p>px`";

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

/// One layer of a `boxShadow` value. `inset` defaults to a drop shadow;
/// setting it draws inside the element's padding box instead (CSS
/// `box-shadow`'s `inset` keyword).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxShadowLayer {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur_radius: f64,
    pub spread_radius: f64,
    pub color: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inset: bool,
}

/// `boxShadow` accepts either a single layer or a CSS-style comma-separated
/// list of layers. This enum preserves whichever shape the author used, so
/// resolved-style read-back round-trips it unchanged (`One` stays an object,
/// `Many` stays an array).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BoxShadowValue {
    One(BoxShadowLayer),
    Many(Vec<BoxShadowLayer>),
}

impl BoxShadowValue {
    /// The layers in CSS authoring order (first layer paints on top).
    pub fn layers(&self) -> &[BoxShadowLayer] {
        match self {
            BoxShadowValue::One(layer) => std::slice::from_ref(layer),
            BoxShadowValue::Many(layers) => layers,
        }
    }
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

/// A validated native length. Expressions stay parsed in the retained style so
/// rendering never has to re-accept an arbitrary CSS string.
#[derive(Debug, Clone, PartialEq)]
pub enum DimensionValue {
    Pixels(f64),
    Percentage(f64), // 0.0 to 1.0
    Ch(f64),
    /// 1vw is 1% of the window's viewport width, as in a browser.
    Vw(f64),
    /// 1vh is 1% of the window's viewport height.
    Vh(f64),
    /// CSS `min-content`: the smallest size the content can take.
    MinContent,
    /// CSS `max-content`: the content laid out without wrapping.
    MaxContent,
    /// CSS `fit-content`: `clamp(min-content, stretch, max-content)`.
    FitContent,
    /// CSS `fit-content(<length-percentage>)`, retaining the source for
    /// serialization and the parsed limit for layout.
    FitContentLimit {
        source: String,
        limit: Box<DimensionValue>,
    },
    Calc {
        source: String,
        left: Box<DimensionValue>,
        operator: CalcOperator,
        right: Box<DimensionValue>,
    },
    Clamp {
        source: String,
        min: Box<DimensionValue>,
        preferred: Box<DimensionValue>,
        max: Box<DimensionValue>,
    },
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
    Spring(SpringEasing),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
enum SpringEasingType {
    #[serde(rename = "spring")]
    Spring,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpringEasing {
    #[serde(rename = "type")]
    _kind: SpringEasingType,
    #[serde(default = "default_spring_stiffness")]
    pub(crate) stiffness: f64,
    #[serde(default = "default_spring_damping")]
    pub(crate) damping: f64,
    #[serde(default = "default_spring_mass")]
    pub(crate) mass: f64,
    #[serde(default)]
    pub(crate) velocity: f64,
}

impl SpringEasing {
    pub(crate) fn is_valid(&self) -> bool {
        let fits_f32 = |value: f64| value.is_finite() && value.abs() <= f64::from(f32::MAX);
        let positive_f32 = |value: f64| fits_f32(value) && value >= f64::from(f32::MIN_POSITIVE);
        positive_f32(self.stiffness)
            && positive_f32(self.damping)
            && positive_f32(self.mass)
            && fits_f32(self.velocity)
    }
}

fn default_spring_stiffness() -> f64 {
    100.0
}

fn default_spring_damping() -> f64 {
    10.0
}

fn default_spring_mass() -> f64 {
    1.0
}

fn default_transition_easing() -> TransitionEasing {
    TransitionEasing::Name("ease".to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTransition {
    pub(crate) properties: Vec<TransitionProperty>,
    pub(crate) duration_ms: f64,
    #[serde(default)]
    pub(crate) delay_ms: f64,
    #[serde(default = "default_transition_easing")]
    pub(crate) easing: TransitionEasing,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CalcOperator {
    Add,
    Subtract,
}

/// CSS treats an unadorned line-height as a multiplier, while a pixel length
/// is absolute. A JSON number remains the backwards-compatible pixel shorthand.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LineHeightValue {
    Pixels(f64),
    Unitless(String),
}

/// Which auto-repeat strategy a `repeat()` track uses.
///
/// [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat#auto-fill)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GridAutoRepeatKind {
    AutoFill,
    AutoFit,
}

/// The repetition count of a `repeat()` grid track: either an exact number of
/// repetitions, or the `auto-fill`/`auto-fit` keywords that repeat as many
/// times as the container permits. Serializes as a bare number or one of
/// those two strings, matching the authored form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GridRepeatCount {
    Fixed(u16),
    Auto(GridAutoRepeatKind),
}

/// One serializable CSS Grid track. Track lists deliberately use tagged objects
/// rather than CSS strings so the renderer can validate every nested function.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackValue {
    Px {
        value: f64,
    },
    Percent {
        value: f64,
    },
    Fr {
        value: f64,
    },
    Auto,
    MinContent,
    MaxContent,
    FitContent {
        limit: GridTrackFitContentLimit,
    },
    Minmax {
        min: GridTrackMinValue,
        max: GridTrackMaxValue,
    },
    Repeat {
        count: GridRepeatCount,
        tracks: Vec<GridTrackValue>,
    },
}

/// A length-percentage limit for a `fit-content()` grid track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackFitContentLimit {
    Px { value: f64 },
    Percent { value: f64 },
}

/// Valid lower-bound functions for a `minmax()` grid track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackMinValue {
    Px { value: f64 },
    Percent { value: f64 },
    Auto,
    MinContent,
    MaxContent,
}

/// Valid upper-bound functions for a `minmax()` grid track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GridTrackMaxValue {
    Px { value: f64 },
    Percent { value: f64 },
    Fr { value: f64 },
    Auto,
    MinContent,
    MaxContent,
}

/// A CSS Grid line value retained in the form GPUI's grid layout accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GridLineValue {
    #[default]
    Auto,
    Line(i16),
    Span(u16),
}

const GRID_LINE_ERROR: &str = "expected auto, an integer, or span <integer>";

fn grid_line_from_integer(value: i64) -> Result<GridLineValue, String> {
    if value == 0 {
        return Err(GRID_LINE_ERROR.to_string());
    }
    // CSS Grid §8.3: a UA clamps a grid line number to its implementation
    // limit rather than rejecting it. taffy's line numbers are i16, so clamp
    // into that range (never landing on zero, which the grammar reserves).
    let clamped = value.clamp(i64::from(i16::MIN) + 1, i64::from(i16::MAX));
    Ok(GridLineValue::Line(clamped as i16))
}

fn parse_grid_line_text(value: &str) -> Result<GridLineValue, String> {
    let parts = value.split_ascii_whitespace().collect::<Vec<_>>();
    match parts.as_slice() {
        [keyword] if keyword.eq_ignore_ascii_case("auto") => Ok(GridLineValue::Auto),
        [keyword, span] if keyword.eq_ignore_ascii_case("span") => span
            .parse::<i64>()
            .ok()
            .filter(|span| *span > 0)
            // Same implementation-limit clamp as a bare line number, saturating
            // to u16::MAX (taffy narrows this further to its own 10,000 cap).
            .map(|span| GridLineValue::Span(span.min(i64::from(u16::MAX)) as u16))
            .ok_or_else(|| GRID_LINE_ERROR.to_string()),
        [line] => line
            .parse::<i64>()
            .ok()
            .and_then(|value| grid_line_from_integer(value).ok())
            .ok_or_else(|| GRID_LINE_ERROR.to_string()),
        _ => Err(GRID_LINE_ERROR.to_string()),
    }
}

fn parse_grid_line_value(value: &serde_json::Value) -> Result<GridLineValue, String> {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| {
                number.as_f64().and_then(|value| {
                    (value.is_finite() && value.fract() == 0.0).then_some(value as i64)
                })
            })
            .ok_or_else(|| GRID_LINE_ERROR.to_string())
            .and_then(grid_line_from_integer),
        serde_json::Value::String(value) => parse_grid_line_text(value),
        _ => Err(GRID_LINE_ERROR.to_string()),
    }
}

impl<'de> Deserialize<'de> for GridLineValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de::{self, Visitor};

        struct GridLineVisitor;

        impl<'de> Visitor<'de> for GridLineVisitor {
            type Value = GridLineValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str(GRID_LINE_ERROR)
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                grid_line_from_integer(value).map_err(E::custom)
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                i64::try_from(value)
                    .map_err(|_| E::custom(GRID_LINE_ERROR))
                    .and_then(|value| grid_line_from_integer(value).map_err(E::custom))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.is_finite() && value.fract() == 0.0 {
                    grid_line_from_integer(value as i64).map_err(E::custom)
                } else {
                    Err(E::custom(GRID_LINE_ERROR))
                }
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                parse_grid_line_text(value).map_err(E::custom)
            }
        }

        deserializer.deserialize_any(GridLineVisitor)
    }
}

impl Serialize for GridLineValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let value = match self {
            Self::Auto => "auto".to_string(),
            Self::Line(line) => line.to_string(),
            Self::Span(span) => format!("span {span}"),
        };
        serializer.serialize_str(&value)
    }
}

fn parse_grid_line_list(
    value: &serde_json::Value,
    min: usize,
    max: usize,
    count_error: &str,
) -> Result<Vec<GridLineValue>, String> {
    let parts = match value {
        serde_json::Value::String(value) => value.split('/').map(str::trim).collect::<Vec<_>>(),
        _ if min == 1 && max == 2 => return Ok(vec![parse_grid_line_value(value)?]),
        _ => return Err(count_error.to_string()),
    };
    if !(min..=max).contains(&parts.len()) {
        return Err(count_error.to_string());
    }
    parts
        .into_iter()
        .map(parse_grid_line_text)
        .collect::<Result<Vec<_>, _>>()
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
                formatter.write_str(
                    "a number, px, %, ch, vw, vh, calc(), clamp(), 'auto', or an intrinsic sizing keyword",
                )
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
                parse_dimension(value).map_err(de::Error::custom)
            }
        }

        deserializer.deserialize_any(DimensionVisitor)
    }
}

impl Serialize for DimensionValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Pixels(value) => serializer.serialize_f64(*value),
            // Retained-tree inspection has historically exposed percentages as
            // their normalized fraction (for example, "100%" as a fraction).
            // Preserve that public diagnostic/test representation.
            Self::Percentage(value) => serializer.serialize_f64(*value),
            Self::Ch(value) => serializer.serialize_str(&format!("{value}ch")),
            Self::Vw(value) => serializer.serialize_str(&format!("{value}vw")),
            Self::Vh(value) => serializer.serialize_str(&format!("{value}vh")),
            Self::MinContent => serializer.serialize_str("min-content"),
            Self::MaxContent => serializer.serialize_str("max-content"),
            Self::FitContent => serializer.serialize_str("fit-content"),
            Self::FitContentLimit { source, .. } => serializer.serialize_str(source),
            Self::Calc { source, .. } | Self::Clamp { source, .. } => {
                serializer.serialize_str(source)
            }
            Self::Auto => serializer.serialize_str("auto"),
        }
    }
}

impl<'de> Deserialize<'de> for LineHeightValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de::{self, Visitor};

        struct LineHeightVisitor;
        impl<'de> Visitor<'de> for LineHeightVisitor {
            type Value = LineHeightValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a positive pixel number, px length, or unitless multiplier")
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(LineHeightValue::Pixels(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(LineHeightValue::Pixels(value as f64))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(LineHeightValue::Pixels(value as f64))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if let Some(pixels) = value.strip_suffix("px") {
                    return pixels
                        .parse::<f64>()
                        .map(LineHeightValue::Pixels)
                        .map_err(|_| de::Error::custom("invalid px lineHeight at byte 0"));
                }
                match value.parse::<f64>() {
                    Ok(number) if number.is_finite() => {
                        Ok(LineHeightValue::Unitless(value.to_owned()))
                    }
                    _ => Err(de::Error::custom("invalid unitless lineHeight at byte 0")),
                }
            }
        }
        deserializer.deserialize_any(LineHeightVisitor)
    }
}

fn parse_dimension(value: &str) -> Result<DimensionValue, String> {
    // Keep this compact, canonical grammar in lockstep with the literal types
    // in packages/react/src/types/host.ts. JSON numbers remain pixels; strings
    // must name their unit, and calc has exactly one spaced binary operator.
    let value = value.trim();
    if value == "auto" {
        return Ok(DimensionValue::Auto);
    }
    // CSS intrinsic sizing keywords are lengths only at the top level; calc()
    // and clamp() reject them, exactly as a browser does.
    match value {
        "min-content" => return Ok(DimensionValue::MinContent),
        "max-content" => return Ok(DimensionValue::MaxContent),
        "fit-content" => return Ok(DimensionValue::FitContent),
        _ => {}
    }
    if let Some(inner) = value
        .strip_prefix("fit-content(")
        .and_then(|value| value.strip_suffix(')'))
    {
        let limit = parse_length_atom(inner.trim())
            .map_err(|error| format!("invalid fit-content() at byte 12: {error}"))?;
        return Ok(DimensionValue::FitContentLimit {
            source: value.to_owned(),
            limit: Box::new(limit),
        });
    }
    if let Some(inner) = value
        .strip_prefix("calc(")
        .and_then(|value| value.strip_suffix(')'))
    {
        let (index, operator) = find_calc_operator(inner).ok_or_else(|| {
            "invalid calc() at byte 5: expected `length + length` or `length - length`".to_string()
        })?;
        let left = parse_length_atom(&inner[..index])
            .map_err(|error| format!("invalid calc() at byte 5: {error}"))?;
        let right = parse_length_atom(&inner[index + 3..])
            .map_err(|error| format!("invalid calc() at byte {}: {error}", index + 8))?;
        return Ok(DimensionValue::Calc {
            source: value.to_owned(),
            left: Box::new(left),
            operator,
            right: Box::new(right),
        });
    }
    if let Some(inner) = value
        .strip_prefix("clamp(")
        .and_then(|value| value.strip_suffix(')'))
    {
        let parts: Vec<_> = inner.split(", ").collect();
        if parts.len() != 3 {
            return Err("invalid clamp() at byte 6: expected three comma-separated lengths".into());
        }
        let parse = |part: &str| parse_length_atom(part).map(Box::new);
        let min = parse(parts[0]).map_err(|error| format!("invalid clamp() at byte 6: {error}"))?;
        let preferred = parse(parts[1])
            .map_err(|error| format!("invalid clamp() at byte {}: {error}", parts[0].len() + 7))?;
        let max = parse(parts[2]).map_err(|error| {
            format!(
                "invalid clamp() at byte {}: {error}",
                parts[0].len() + parts[1].len() + 8
            )
        })?;
        return Ok(DimensionValue::Clamp {
            source: value.to_owned(),
            min,
            preferred,
            max,
        });
    }
    parse_length_atom(value)
}

fn parse_length_atom(value: &str) -> Result<DimensionValue, String> {
    let parse = |number: &str, unit: &str| match number.parse::<f64>() {
        Ok(value) if value.is_finite() => Ok(value),
        _ => Err(format!("invalid {unit} length at byte 0")),
    };
    if let Some(number) = value.strip_suffix("px") {
        return parse(number, "px").map(DimensionValue::Pixels);
    }
    if let Some(number) = value.strip_suffix('%') {
        return parse(number, "%").map(|value| DimensionValue::Percentage(value / 100.0));
    }
    if let Some(number) = value.strip_suffix("ch") {
        return parse(number, "ch").map(DimensionValue::Ch);
    }
    if let Some(number) = value.strip_suffix("vw") {
        return parse(number, "vw").map(DimensionValue::Vw);
    }
    if let Some(number) = value.strip_suffix("vh") {
        return parse(number, "vh").map(DimensionValue::Vh);
    }
    Err("invalid length at byte 0: expected a number with px, %, ch, vw, or vh".into())
}

fn find_calc_operator(value: &str) -> Option<(usize, CalcOperator)> {
    value
        .find(" + ")
        .map(|index| (index, CalcOperator::Add))
        .or_else(|| {
            value
                .find(" - ")
                .map(|index| (index, CalcOperator::Subtract))
        })
}

/// Style description retained by the native renderer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDesc {
    /// Internal parent-layout default. An overflow-x scrollport makes a direct
    /// child with no authored flex longhands non-shrinking without inserting a
    /// containing block between the authored parent and child.
    #[serde(skip)]
    pub(crate) default_flex_none: bool,

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
    pub grid_template_columns: Option<Vec<GridTrackValue>>,
    pub grid_template_rows: Option<Vec<GridTrackValue>>,
    pub grid_row_start: Option<GridLineValue>,
    pub grid_row_end: Option<GridLineValue>,
    pub grid_column_start: Option<GridLineValue>,
    pub grid_column_end: Option<GridLineValue>,
    pub grid_auto_flow: Option<String>,
    pub grid_auto_rows: Option<Vec<GridTrackValue>>,
    pub grid_auto_columns: Option<Vec<GridTrackValue>>,
    pub justify_items: Option<String>,
    pub justify_self: Option<String>,

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
    /// CSS `border-style` line style. `"none"` and `"hidden"` compute the used
    /// border width to zero. GPUI paints only solid and dashed lines, so
    /// `"dotted"` degrades to dashed and the 3D styles (`"double"`,
    /// `"groove"`, `"ridge"`, `"inset"`, `"outset"`) degrade to solid, the
    /// fallback CSS 2.1 §8.5.3 permits.
    pub border_style: Option<String>,
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
    pub font_variant_numeric: Option<String>,
    pub text_decoration: Option<String>,
    pub text_transform: Option<String>,
    pub text_align: Option<String>,
    pub line_height: Option<LineHeightValue>,
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

    /// CSS `interpolate-size`. `"allow-keywords"` lets a `width` or `height`
    /// transition travel to or from `auto` by taking the laid-out size of the
    /// intrinsic endpoint as the number. Inherited, like the CSS property.
    pub interpolate_size: Option<String>,

    pub transition: Option<StyleTransition>,
    pub hover_group: Option<String>,

    /// Nearest ancestor hover group, resolved by the renderer for this frame.
    /// This is paint context rather than an authored declaration.
    #[serde(skip)]
    pub(crate) hover_within_group: Option<gpui::SharedString>,

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

fn decode_box_shadow_layer(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<BoxShadowLayer> {
    let layer = decode::<BoxShadowLayer>(property, value, problems)?;
    if crate::color::parse_color_rgba(&layer.color).is_some() {
        Some(layer)
    } else {
        reject(
            problems,
            format!("{property}.color"),
            &serde_json::Value::String(layer.color.clone()),
            "unsupported color",
        );
        None
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

fn decode_font_variant_numeric(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<String> {
    let decoded = decode::<String>(property, value, problems)?;
    if decoded.is_empty() {
        reject(
            problems,
            property,
            value,
            "expected normal or a space-separated set of lining-nums, oldstyle-nums, proportional-nums, tabular-nums, diagonal-fractions, stacked-fractions, ordinal, slashed-zero",
        );
        return None;
    }

    let tokens = decoded
        .split_ascii_whitespace()
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        reject(
            problems,
            property,
            value,
            "expected normal or a space-separated set of lining-nums, oldstyle-nums, proportional-nums, tabular-nums, diagonal-fractions, stacked-fractions, ordinal, slashed-zero",
        );
        return None;
    }

    if tokens.len() == 1 && tokens[0] == "normal" {
        return Some("normal".to_owned());
    }
    if tokens.contains(&"normal") {
        reject(
            problems,
            property,
            value,
            "normal cannot be combined with other values",
        );
        return None;
    }

    let mut seen = HashSet::new();
    let mut has_lining = false;
    let mut has_oldstyle = false;
    let mut has_proportional = false;
    let mut has_tabular = false;
    let mut has_diagonal = false;
    let mut has_stacked = false;
    let allowed = [
        "lining-nums",
        "oldstyle-nums",
        "proportional-nums",
        "tabular-nums",
        "diagonal-fractions",
        "stacked-fractions",
        "ordinal",
        "slashed-zero",
    ];

    for token in &tokens {
        if !allowed.contains(token) {
            reject(
                problems,
                property,
                value,
                "expected normal or a space-separated set of lining-nums, oldstyle-nums, proportional-nums, tabular-nums, diagonal-fractions, stacked-fractions, ordinal, slashed-zero",
            );
            return None;
        }
        if !seen.insert(*token) {
            reject(
                problems,
                property,
                value,
                format!("\"{token}\" is repeated"),
            );
            return None;
        }
        match *token {
            "lining-nums" => has_lining = true,
            "oldstyle-nums" => has_oldstyle = true,
            "proportional-nums" => has_proportional = true,
            "tabular-nums" => has_tabular = true,
            "diagonal-fractions" => has_diagonal = true,
            "stacked-fractions" => has_stacked = true,
            _ => {}
        }
    }

    if has_lining && has_oldstyle {
        reject(
            problems,
            property,
            value,
            "\"lining-nums\" and \"oldstyle-nums\" cannot be combined",
        );
        return None;
    }
    if has_proportional && has_tabular {
        reject(
            problems,
            property,
            value,
            "\"proportional-nums\" and \"tabular-nums\" cannot be combined",
        );
        return None;
    }
    if has_diagonal && has_stacked {
        reject(
            problems,
            property,
            value,
            "\"diagonal-fractions\" and \"stacked-fractions\" cannot be combined",
        );
        return None;
    }

    Some(tokens.join(" "))
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

fn parse_grid_fit_content_limit(
    path: &str,
    value: Option<&serde_json::Value>,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTrackFitContentLimit> {
    let limit_path = format!("{path}.limit");
    let Some(value) = value else {
        reject(
            problems,
            limit_path,
            &serde_json::Value::Null,
            "expected a px or percent limit",
        );
        return None;
    };
    let Some(object) = value.as_object() else {
        reject(
            problems,
            limit_path,
            value,
            "expected a px or percent limit",
        );
        return None;
    };
    let Some(limit_type) = object.get("type").and_then(serde_json::Value::as_str) else {
        reject(
            problems,
            limit_path,
            value,
            "expected a px or percent limit",
        );
        return None;
    };
    if limit_type != "px" && limit_type != "percent" {
        reject(
            problems,
            limit_path,
            value,
            "expected a px or percent limit",
        );
        return None;
    }
    let fields_ok = reject_unexpected_grid_fields(
        &format!("{path}.limit"),
        object,
        &["type", "value"],
        problems,
    );
    let number = grid_track_number(&format!("{path}.limit"), object, "value", problems, false)?;
    if !fields_ok {
        return None;
    }
    Some(match limit_type {
        "px" => GridTrackFitContentLimit::Px { value: number },
        "percent" => GridTrackFitContentLimit::Percent { value: number },
        _ => unreachable!("limit_type validated above"),
    })
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
        "percent" => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "value"], problems);
            let value = grid_track_number(path, object, "value", problems, false)?;
            fields_ok.then_some(GridTrackValue::Percent { value })
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
        "fit-content" => {
            reject(
                problems,
                format!("{path}.type"),
                object.get("type").expect("track type is present"),
                "fit-content is not valid as a minmax bound",
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
                "expected px, percent, fr, fit-content, auto, min-content, or max-content",
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
        GridTrackValue::Percent { value } => Some(GridTrackMinValue::Percent { value }),
        GridTrackValue::Auto => Some(GridTrackMinValue::Auto),
        GridTrackValue::MinContent => Some(GridTrackMinValue::MinContent),
        GridTrackValue::MaxContent => Some(GridTrackMinValue::MaxContent),
        GridTrackValue::Fr { .. }
        | GridTrackValue::FitContent { .. }
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
        GridTrackValue::Percent { value } => Some(GridTrackMaxValue::Percent { value }),
        GridTrackValue::Fr { value } => Some(GridTrackMaxValue::Fr { value }),
        GridTrackValue::Auto => Some(GridTrackMaxValue::Auto),
        GridTrackValue::MinContent => Some(GridTrackMaxValue::MinContent),
        GridTrackValue::MaxContent => Some(GridTrackMaxValue::MaxContent),
        GridTrackValue::FitContent { .. }
        | GridTrackValue::Minmax { .. }
        | GridTrackValue::Repeat { .. } => {
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
        "fit-content" => {
            let fields_ok =
                reject_unexpected_grid_fields(path, object, &["type", "limit"], problems);
            let limit = parse_grid_fit_content_limit(path, object.get("limit"), problems)?;
            fields_ok.then_some(GridTrackValue::FitContent { limit })
        }
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
            let count = parse_grid_repeat_count(path, object, problems)?;
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
                count,
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

/// Parses a `repeat()` track's `count` field: an integer from 1 through 64,
/// or one of the `auto-fill`/`auto-fit` keywords.
fn parse_grid_repeat_count(
    path: &str,
    object: &serde_json::Map<String, serde_json::Value>,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridRepeatCount> {
    let property = format!("{path}.count");
    let reason = "expected an integer from 1 through 64, or \"auto-fill\"/\"auto-fit\"";
    match object.get("count") {
        Some(serde_json::Value::String(keyword)) if keyword == "auto-fill" => {
            Some(GridRepeatCount::Auto(GridAutoRepeatKind::AutoFill))
        }
        Some(serde_json::Value::String(keyword)) if keyword == "auto-fit" => {
            Some(GridRepeatCount::Auto(GridAutoRepeatKind::AutoFit))
        }
        Some(value @ serde_json::Value::Number(_)) => {
            let count = decode_number(&property, value, problems)?;
            if count.fract() != 0.0 || count < 1.0 || count > 64.0 {
                reject(problems, property, value, reason);
                return None;
            }
            Some(GridRepeatCount::Fixed(count as u16))
        }
        found => {
            reject(
                problems,
                property,
                found.unwrap_or(&serde_json::Value::Null),
                reason,
            );
            None
        }
    }
}

/// Whether a single (non-repeat) grid track sizing function has a fixed
/// (length or percentage) component, mirroring taffy's
/// `TrackSizingFunction::has_fixed_component`. `fr`, `auto`, `min-content`,
/// `max-content`, and `fit-content()` never count, even with a px/percent
/// `fit-content()` limit: taffy tags `fit-content()` distinctly from a plain
/// length or percentage.
fn grid_track_sizing_has_fixed_component(track: &GridTrackValue) -> bool {
    match track {
        GridTrackValue::Px { .. } | GridTrackValue::Percent { .. } => true,
        GridTrackValue::Fr { .. }
        | GridTrackValue::Auto
        | GridTrackValue::MinContent
        | GridTrackValue::MaxContent
        | GridTrackValue::FitContent { .. } => false,
        GridTrackValue::Minmax { min, max } => {
            matches!(
                min,
                GridTrackMinValue::Px { .. } | GridTrackMinValue::Percent { .. }
            ) || matches!(
                max,
                GridTrackMaxValue::Px { .. } | GridTrackMaxValue::Percent { .. }
            )
        }
        GridTrackValue::Repeat { .. } => unreachable!("repeat cannot be nested inside repeat"),
    }
}

/// Whether a parsed `grid-template-columns`/`-rows` track list is one taffy
/// would keep as the explicit grid, rather than collapsing to zero explicit
/// tracks (taffy 0.13's `compute_explicit_grid_size_in_axis`,
/// `explicit_grid.rs:74-90`). CSS's `<auto-track-list>` grammar allows at
/// most one auto repetition (`auto-fill`/`auto-fit`) per template, and only
/// when every track in the template — inside or outside that repetition —
/// carries a fixed length or percentage component.
fn grid_template_has_valid_auto_repetition(tracks: &[GridTrackValue]) -> bool {
    let auto_repetition_count = tracks
        .iter()
        .filter(|track| matches!(track, GridTrackValue::Repeat { count: GridRepeatCount::Auto(_), .. }))
        .count();

    match auto_repetition_count {
        0 => true,
        1 => tracks.iter().all(|track| match track {
            GridTrackValue::Repeat { tracks, .. } => {
                tracks.iter().all(grid_track_sizing_has_fixed_component)
            }
            other => grid_track_sizing_has_fixed_component(other),
        }),
        _ => false,
    }
}

fn grid_track_count(track: &GridTrackValue) -> usize {
    match track {
        GridTrackValue::Repeat {
            count: GridRepeatCount::Fixed(count),
            tracks,
        } => usize::from(*count) * tracks.len(),
        // An auto repetition counts as its own track count (one repetition):
        // its actual repeat count is resolved at layout time from the
        // container size, not from this cap.
        GridTrackValue::Repeat {
            count: GridRepeatCount::Auto(_),
            tracks,
        } => tracks.len(),
        _ => 1,
    }
}

/// Parses a single track of a `grid-auto-rows` / `grid-auto-columns` list.
/// CSS's `<track-size>+` grammar for these properties excludes `repeat()`
/// (unlike `grid-template-columns`/`-rows`, which allow it), so `repeat` is
/// rejected here with a property-specific reason rather than falling through
/// to `parse_grid_track`'s "cannot be nested" message.
fn parse_grid_auto_track(
    path: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<GridTrackValue> {
    let (track_type, _) = grid_track_object(path, value, problems)?;
    if track_type == "repeat" {
        reject(
            problems,
            format!("{path}.type"),
            value,
            "repeat is not valid in gridAutoRows/gridAutoColumns",
        );
        return None;
    }
    parse_grid_track(path, value, problems, false)
}

/// Parses a `grid-template-columns` / `-rows` or `grid-auto-rows` /
/// `-columns` track list — the array/empty/64-track-cap grammar the two
/// property groups share. Only `grid-template-*` allows `repeat()`, per
/// CSS's `<track-size>+` grammar for the auto properties; `allow_repeat`
/// selects the per-track parser (and, through it, the diagnostic a stray
/// `repeat` gets) accordingly.
fn parse_grid_template(
    property: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
    allow_repeat: bool,
) -> Option<Vec<GridTrackValue>> {
    let Some(tracks) = value.as_array() else {
        reject(
            problems,
            property,
            value,
            "expected a non-empty grid track list",
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
        let path = format!("{property}[{index}]");
        let parsed = if allow_repeat {
            parse_grid_track(&path, track, problems, true)
        } else {
            parse_grid_auto_track(&path, track, problems)
        };
        match parsed {
            Some(track) => parsed_tracks.push(track),
            None => valid = false,
        }
    }
    if !valid {
        return None;
    }
    if !grid_template_has_valid_auto_repetition(&parsed_tracks) {
        reject(
            problems,
            property,
            value,
            "at most one auto-fill/auto-fit repeat() is allowed per template, and every track \
             in the template must include a fixed length or percentage",
        );
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
    Some(parsed_tracks)
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

    let easing_value = object.get("easing");
    let parsed_easing = easing_value
        .map(|value| serde_json::from_value::<TransitionEasing>(value.clone()))
        .transpose();
    let valid_spring = parsed_easing
        .as_ref()
        .ok()
        .and_then(|easing| easing.as_ref())
        .is_some_and(
            |easing| matches!(easing, TransitionEasing::Spring(spring) if spring.is_valid()),
        );
    // A spring-shaped easing does not acquire a fixed duration merely because
    // one of its own fields is malformed. Report the easing itself and keep
    // duration optional for the whole tagged-object branch.
    let spring_shaped = easing_value.is_some_and(serde_json::Value::is_object);
    let duration_ms = match object.get("durationMs") {
        _ if valid_spring => 0.0,
        None if spring_shaped => 0.0,
        Some(value) => match value.as_f64() {
            Some(value) if valid_transition_milliseconds(value) => value,
            _ => {
                reject(
                    problems,
                    "transition.durationMs",
                    value,
                    "expected a supported finite non-negative number of milliseconds",
                );
                valid = false;
                0.0
            }
        },
        None => {
            reject(
                problems,
                "transition.durationMs",
                &serde_json::Value::Null,
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
    let easing = match (easing_value, parsed_easing) {
        (None, _) => default_transition_easing(),
        (Some(value), Ok(Some(easing))) => match easing {
            TransitionEasing::Name(name)
                if matches!(
                    name.as_str(),
                    "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut"
                ) =>
            {
                TransitionEasing::Name(name)
            }
            TransitionEasing::CubicBezier(curve)
                if curve.iter().all(|value| value.is_finite())
                    && (0.0..=1.0).contains(&curve[0])
                    && (0.0..=1.0).contains(&curve[2]) =>
            {
                TransitionEasing::CubicBezier(curve)
            }
            TransitionEasing::Spring(spring) if spring.is_valid() => {
                TransitionEasing::Spring(spring)
            }
            _ => {
                reject(
                    problems,
                    "transition.easing",
                    value,
                    "expected linear, ease, easeIn, easeOut, easeInOut, a cubic-bezier tuple with x values from 0 through 1, or a valid spring easing",
                );
                valid = false;
                default_transition_easing()
            }
        },
        (Some(value), _) => {
            reject(
                problems,
                "transition.easing",
                value,
                "expected linear, ease, easeIn, easeOut, easeInOut, a cubic-bezier tuple with x values from 0 through 1, or a valid spring easing",
            );
            valid = false;
            default_transition_easing()
        }
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

const BORDER_STYLE_VALUES: [&str; 10] = [
    "none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset",
];

/// Splits a border shorthand string on whitespace, except inside parentheses, so a
/// color function such as `rgb(1, 2, 3)` or `oklch(from #bad455 calc(l - 0.15) c h)`
/// survives tokenising as a single token.
fn tokenize_border_value(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut depth: i32 = 0;
    for ch in value.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth -= 1;
                current.push(ch);
            }
            ch if ch.is_whitespace() && depth == 0 => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            ch => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// A border width token: `0` (unitless zero) or `<n>px` with a finite, non-negative
/// `n`. A leading `-` is rejected outright, ahead of the numeric check, so `-0px`
/// is rejected exactly like `-4px` rather than surviving as negative-zero.
fn parse_border_width_token(token: &str) -> Option<f64> {
    if token == "0" {
        return Some(0.0);
    }
    if token.starts_with('-') {
        return None;
    }
    let magnitude = token.strip_suffix("px")?;
    if magnitude.is_empty() {
        return None;
    }
    let magnitude: f64 = magnitude.parse().ok()?;
    (magnitude.is_finite() && magnitude >= 0.0).then_some(magnitude)
}

enum BorderToken {
    Width(f64),
    Style(String),
    /// The authored color text, alongside its parsed value — conflicts across
    /// shorthands compare the parsed color, not the authored text, so `#333`
    /// and `#333333` agree.
    Color(String, gpui::Rgba),
}

fn classify_border_token(token: &str) -> Option<BorderToken> {
    if let Some(width) = parse_border_width_token(token) {
        return Some(BorderToken::Width(width));
    }
    if BORDER_STYLE_VALUES.contains(&token) {
        return Some(BorderToken::Style(token.to_string()));
    }
    if let Some(parsed) = crate::color::parse_color_rgba(token) {
        return Some(BorderToken::Color(token.to_string(), parsed));
    }
    None
}

/// The three optional components of a `border` / `borderTop` / `borderRight` /
/// `borderBottom` / `borderLeft` shorthand string.
#[derive(Debug, Default, Clone)]
struct BorderShorthand {
    width: Option<f64>,
    style: Option<String>,
    color: Option<(String, gpui::Rgba)>,
}

fn parse_border_shorthand(
    property: &str,
    raw: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<BorderShorthand> {
    if raw.trim().is_empty() {
        reject(
            problems,
            property,
            value,
            format!("{property} is an empty string; expected a width, a style, or a color"),
        );
        return None;
    }

    let mut shorthand = BorderShorthand::default();
    for token in tokenize_border_value(raw) {
        match classify_border_token(&token) {
            Some(BorderToken::Width(width)) => {
                if shorthand.width.is_some() {
                    reject(
                        problems,
                        property,
                        value,
                        format!("{property} declares more than one width (\"{token}\")"),
                    );
                    return None;
                }
                shorthand.width = Some(width);
            }
            Some(BorderToken::Style(style)) => {
                if shorthand.style.is_some() {
                    reject(
                        problems,
                        property,
                        value,
                        format!("{property} declares more than one style (\"{token}\")"),
                    );
                    return None;
                }
                shorthand.style = Some(style);
            }
            Some(BorderToken::Color(text, parsed)) => {
                if shorthand.color.is_some() {
                    reject(
                        problems,
                        property,
                        value,
                        format!("{property} declares more than one color (\"{token}\")"),
                    );
                    return None;
                }
                shorthand.color = Some((text, parsed));
            }
            None => {
                reject(
                    problems,
                    property,
                    value,
                    format!("{property} token \"{token}\" is not a border width, style, or color"),
                );
                return None;
            }
        }
    }
    Some(shorthand)
}

/// The result of parsing a `borderWidth` string: a single value behaves like the
/// number form (`border_width` alone), while 2 to 4 values expand CSS-style into
/// the four per-side fields, which then are the whole answer for `borderWidth`.
enum BorderWidthList {
    Single(f64),
    PerSide([f64; 4]),
}

/// The CSS-style expansion of a multi-value `borderWidth` list: 1 value sets all
/// sides, 2 sets top/bottom then left/right, 3 sets top, left/right, bottom, and 4
/// sets top, right, bottom, left.
fn parse_border_width_list(
    property: &str,
    raw: &str,
    value: &serde_json::Value,
    problems: &mut Vec<StyleProblem>,
) -> Option<BorderWidthList> {
    let tokens = tokenize_border_value(raw);
    if tokens.is_empty() {
        reject(
            problems,
            property,
            value,
            format!("{property} is an empty string; expected 1 to 4 widths"),
        );
        return None;
    }
    if tokens.len() > 4 {
        reject(
            problems,
            property,
            value,
            format!(
                "{property} declares {} widths; expected 1 to 4",
                tokens.len()
            ),
        );
        return None;
    }

    let mut widths = Vec::with_capacity(tokens.len());
    for token in &tokens {
        match parse_border_width_token(token) {
            Some(width) => widths.push(width),
            None => {
                reject(
                    problems,
                    property,
                    value,
                    format!("{property} token \"{token}\" is not a valid width"),
                );
                return None;
            }
        }
    }

    Some(match widths[..] {
        [top] => BorderWidthList::Single(top),
        [top_bottom, left_right] => {
            BorderWidthList::PerSide([top_bottom, left_right, top_bottom, left_right])
        }
        [top, left_right, bottom] => {
            BorderWidthList::PerSide([top, left_right, bottom, left_right])
        }
        [top, right, bottom, left] => BorderWidthList::PerSide([top, right, bottom, left]),
        _ => unreachable!("length was validated above"),
    })
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
        ($name:expr) => {
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

    // Shorthands are collected separately so explicit longhands win regardless
    // of the property order in the JavaScript object.
    let mut derived_grid_lines: [Option<GridLineValue>; 4] = [None; 4];
    let mut explicit_grid_lines: [Option<GridLineValue>; 4] = [None; 4];

    // GPUI paints one border color and one border style for all four sides, so the
    // first of `border` / `borderTop` / `borderRight` / `borderBottom` / `borderLeft`
    // to declare a color or a style wins; a later one that disagrees is rejected.
    // Colors compare by parsed value (`#333` and `#333333` agree), not text.
    // Longhand `borderColor` / `borderStyle` keep last-wins and never populate this.
    let mut border_color_source: Option<(String, String, gpui::Rgba)> = None;
    let mut border_style_source: Option<(String, String)> = None;

    // A multi-value `borderWidth` string only fills in sides an explicit per-side
    // longhand or per-side shorthand left untouched, so — like the grid lines
    // above — its 2-to-4-value expansion is buffered here and applied after the
    // loop, once every per-side field's final explicit state is known.
    let mut border_width_expansion: Option<[f64; 4]> = None;

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
        if key == "hoverGroup" {
            if prefix.is_empty() {
                parsed.style.hover_group =
                    decode::<String>(&property!("hoverGroup"), value, &mut parsed.problems);
            } else {
                reject(
                    &mut parsed.problems,
                    property!("hoverGroup"),
                    value,
                    "hoverGroup marks the base element and cannot be nested in a state style",
                );
            }
            continue;
        }
        if key == "display"
            && matches!(prefix, "hover" | "active")
            && value.as_str() == Some("none")
        {
            reject(
                &mut parsed.problems,
                property!("display"),
                value,
                "display: \"none\" cannot be set by hover or active: hiding the element removes the hit-test box that triggers the state; use visibility: \"hidden\" or hoverWithin on a descendant",
            );
            continue;
        }
        enum_field!(key, value, "display", display, ["none", "flex", "grid"]);
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
            "justifyItems",
            justify_items,
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
            "justifySelf",
            justify_self,
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
            "gridAutoFlow",
            grid_auto_flow,
            ["row", "column", "dense", "row dense", "column dense"]
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
        if key == "gridColumn" || key == "gridRow" {
            let property = property!(key);
            match parse_grid_line_list(value, 1, 2, "expected 1 or 2 grid lines separated by \"/\"")
            {
                Ok(lines) => {
                    let (start, end) = (lines[0], lines.get(1).copied().unwrap_or_default());
                    let offset = if key == "gridRow" { 0 } else { 2 };
                    derived_grid_lines[offset] = Some(start);
                    derived_grid_lines[offset + 1] = Some(end);
                }
                Err(reason) => reject(&mut parsed.problems, property, value, reason),
            }
            continue;
        }
        if key == "gridArea" {
            let property = property!("gridArea");
            match parse_grid_line_list(
                value,
                2,
                4,
                "expected 2 to 4 grid lines separated by \"/\"; named areas are not supported",
            ) {
                Ok(lines) => {
                    for (index, line) in lines
                        .into_iter()
                        .chain(std::iter::repeat(GridLineValue::Auto))
                        .take(4)
                        .enumerate()
                    {
                        let slot = [0, 2, 1, 3][index];
                        derived_grid_lines[slot] = Some(line);
                    }
                }
                Err(reason) => reject(&mut parsed.problems, property, value, reason),
            }
            continue;
        }
        let explicit_slot = match key.as_str() {
            "gridRowStart" => Some(0),
            "gridRowEnd" => Some(1),
            "gridColumnStart" => Some(2),
            "gridColumnEnd" => Some(3),
            _ => None,
        };
        if let Some(slot) = explicit_slot {
            let property = property!(key);
            match parse_grid_line_value(value) {
                Ok(line) => explicit_grid_lines[slot] = Some(line),
                Err(reason) => reject(&mut parsed.problems, property, value, reason),
            }
            continue;
        }
        if key == "gridTemplateColumns" {
            parsed.style.grid_template_columns = parse_grid_template(
                &property!("gridTemplateColumns"),
                value,
                &mut parsed.problems,
                true,
            );
            continue;
        }
        if key == "gridTemplateRows" {
            parsed.style.grid_template_rows = parse_grid_template(
                &property!("gridTemplateRows"),
                value,
                &mut parsed.problems,
                true,
            );
            continue;
        }
        if key == "gridAutoRows" {
            parsed.style.grid_auto_rows = parse_grid_template(
                &property!("gridAutoRows"),
                value,
                &mut parsed.problems,
                false,
            );
            continue;
        }
        if key == "gridAutoColumns" {
            parsed.style.grid_auto_columns = parse_grid_template(
                &property!("gridAutoColumns"),
                value,
                &mut parsed.problems,
                false,
            );
            continue;
        }
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

        if key == "border"
            || key == "borderTop"
            || key == "borderRight"
            || key == "borderBottom"
            || key == "borderLeft"
        {
            let property = property!(key.as_str());
            if let Some(raw) = decode::<String>(&property, value, &mut parsed.problems) {
                if let Some(shorthand) =
                    parse_border_shorthand(&property, &raw, value, &mut parsed.problems)
                {
                    let mut conflict: Option<(&'static str, String, String, String)> = None;
                    if let Some((new_text, new_parsed)) = shorthand.color.clone() {
                        if let Some((earlier_key, earlier_text, earlier_parsed)) =
                            &border_color_source
                        {
                            if *earlier_parsed != new_parsed {
                                conflict = Some((
                                    "color",
                                    earlier_key.clone(),
                                    earlier_text.clone(),
                                    new_text,
                                ));
                            }
                        }
                    }
                    if conflict.is_none() {
                        if let Some(new_style) = shorthand.style.clone() {
                            if let Some((earlier_key, earlier_style)) = &border_style_source {
                                if *earlier_style != new_style {
                                    conflict = Some((
                                        "style",
                                        earlier_key.clone(),
                                        earlier_style.clone(),
                                        new_style,
                                    ));
                                }
                            }
                        }
                    }

                    if let Some((component, earlier_key, earlier_value, new_value)) = conflict {
                        reject(
                            &mut parsed.problems,
                            property,
                            value,
                            format!(
                                "{key} {component} {new_value} conflicts with {earlier_key} \
                                 {component} {earlier_value}; GPUI paints one border color and \
                                 style for all four sides"
                            ),
                        );
                    } else {
                        match key.as_str() {
                            "border" => {
                                if let Some(width) = shorthand.width {
                                    parsed.style.border_width = Some(width);
                                }
                            }
                            "borderTop" => {
                                if let Some(width) = shorthand.width {
                                    parsed.style.border_top_width = Some(width);
                                }
                            }
                            "borderRight" => {
                                if let Some(width) = shorthand.width {
                                    parsed.style.border_right_width = Some(width);
                                }
                            }
                            "borderBottom" => {
                                if let Some(width) = shorthand.width {
                                    parsed.style.border_bottom_width = Some(width);
                                }
                            }
                            "borderLeft" => {
                                if let Some(width) = shorthand.width {
                                    parsed.style.border_left_width = Some(width);
                                }
                            }
                            _ => unreachable!("matched above"),
                        }
                        if let Some((text, parsed_color)) = shorthand.color {
                            parsed.style.border_color = Some(text.clone());
                            border_color_source
                                .get_or_insert_with(|| (key.clone(), text, parsed_color));
                        }
                        if let Some(style) = shorthand.style {
                            parsed.style.border_style = Some(style.clone());
                            border_style_source.get_or_insert_with(|| (key.clone(), style));
                        }
                    }
                }
            }
            continue;
        }

        if key == "borderWidth" {
            if let Some(text) = value.as_str() {
                let property = property!("borderWidth");
                if let Some(widths) =
                    parse_border_width_list(&property, text, value, &mut parsed.problems)
                {
                    match widths {
                        // A single value behaves like the number form: it never
                        // touches the per-side fields, so it applies immediately.
                        BorderWidthList::Single(width) => {
                            parsed.style.border_width = Some(width);
                        }
                        // 2 to 4 values only fill in sides an explicit per-side
                        // longhand or shorthand leaves untouched, so the expansion
                        // is buffered and applied after the loop.
                        BorderWidthList::PerSide(sides) => {
                            border_width_expansion = Some(sides);
                        }
                    }
                }
                continue;
            }
        }
        number_field!(key, value, "borderWidth", border_width);
        number_field!(key, value, "borderTopWidth", border_top_width);
        number_field!(key, value, "borderRightWidth", border_right_width);
        number_field!(key, value, "borderBottomWidth", border_bottom_width);
        number_field!(key, value, "borderLeftWidth", border_left_width);
        enum_field!(
            key,
            value,
            "borderStyle",
            border_style,
            [
                "none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge",
                "inset", "outset"
            ]
        );
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
            // CSS drops an invalid `box-shadow` declaration wholesale: if any
            // layer in the list fails to decode, the whole value is rejected
            // rather than keeping the layers that did parse.
            if let Some(items) = value.as_array() {
                let mut layers = Vec::with_capacity(items.len());
                let mut all_valid = true;
                for (index, item) in items.iter().enumerate() {
                    let item_property = format!("{property}[{index}]");
                    match decode_box_shadow_layer(&item_property, item, &mut parsed.problems) {
                        Some(layer) => layers.push(layer),
                        None => all_valid = false,
                    }
                }
                if all_valid {
                    // `[]` is a valid, present value: CSS `none`. It clears an
                    // inherited base shadow when authored on a state override.
                    parsed.style.box_shadow = Some(BoxShadowValue::Many(layers));
                }
            } else if let Some(layer) =
                decode_box_shadow_layer(&property, value, &mut parsed.problems)
            {
                parsed.style.box_shadow = Some(BoxShadowValue::One(layer));
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
        if key == "fontVariantNumeric" {
            let property = property!("fontVariantNumeric");
            parsed.style.font_variant_numeric =
                decode_font_variant_numeric(&property, value, &mut parsed.problems);
            continue;
        }
        enum_field!(
            key,
            value,
            "textDecoration",
            text_decoration,
            ["underline", "line-through", "none"]
        );
        enum_field!(
            key,
            value,
            "textTransform",
            text_transform,
            ["none", "uppercase", "lowercase"]
        );
        // Native lists paint no marker, so `none` is the only value that
        // describes what is drawn. Validated and then dropped: there is
        // no field because no renderer path would read it.
        if key == "listStyle" {
            let _ = decode_enum(
                &property!("listStyle"),
                value,
                &["none"],
                &mut parsed.problems,
            );
            continue;
        }
        if key == "listStyleType" {
            let _ = decode_enum(
                &property!("listStyleType"),
                value,
                &["none"],
                &mut parsed.problems,
            );
            continue;
        }
        enum_field!(
            key,
            value,
            "textAlign",
            text_align,
            ["left", "start", "center", "right"]
        );
        if key == "lineHeight" {
            parsed.style.line_height =
                decode(&property!("lineHeight"), value, &mut parsed.problems);
            continue;
        }
        enum_field!(
            key,
            value,
            "whiteSpace",
            white_space,
            ["normal", "nowrap", "pre"]
        );
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
            ["visible", "hidden", "scroll", "auto"]
        );
        enum_field!(
            key,
            value,
            "overflowX",
            overflow_x,
            ["visible", "hidden", "scroll", "auto"]
        );
        enum_field!(
            key,
            value,
            "overflowY",
            overflow_y,
            ["visible", "hidden", "scroll", "auto"]
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
        enum_field!(
            key,
            value,
            "interpolateSize",
            interpolate_size,
            ["numeric-only", "allow-keywords"]
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

    for (slot, (derived, explicit)) in derived_grid_lines
        .into_iter()
        .zip(explicit_grid_lines)
        .enumerate()
    {
        let value = explicit.or(derived);
        match slot {
            0 => parsed.style.grid_row_start = value,
            1 => parsed.style.grid_row_end = value,
            2 => parsed.style.grid_column_start = value,
            3 => parsed.style.grid_column_end = value,
            _ => unreachable!(),
        }
    }

    if let Some([top, right, bottom, left]) = border_width_expansion {
        parsed.style.border_width = None;
        parsed.style.border_top_width.get_or_insert(top);
        parsed.style.border_right_width.get_or_insert(right);
        parsed.style.border_bottom_width.get_or_insert(bottom);
        parsed.style.border_left_width.get_or_insert(left);
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
    if let Some(line_height) = parsed.style.line_height.as_ref() {
        let value = match line_height {
            LineHeightValue::Pixels(value) => *value,
            LineHeightValue::Unitless(value) => value.parse::<f64>().unwrap_or(f64::NAN),
        };
        if !(value > 0.0 && value.is_finite()) {
            let value = serde_json::to_value(line_height).unwrap();
            parsed.style.line_height = None;
            let property = if prefix.is_empty() {
                "lineHeight".to_string()
            } else {
                format!("{prefix}.lineHeight")
            };
            reject(
                &mut parsed.problems,
                property,
                &value,
                "expected a positive pixel length or unitless multiplier",
            );
        }
    }
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
    if let Some(rest) = trimmed.strip_prefix("repeating-linear-gradient(") {
        return match rest.strip_suffix(')') {
            Some(body) => parse_repeating_linear_gradient(body),
            None => Err(REPEATING_GRADIENT_REJECTION.into()),
        };
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

fn parse_repeating_linear_gradient(body: &str) -> Result<gpui::Background, String> {
    fn px_length(token: &str) -> Option<f64> {
        let value = token.strip_suffix("px")?.parse::<f64>().ok()?;
        value.is_finite().then_some(value)
    }

    // Peel the last two whitespace-separated positions off the right of a
    // stop, leaving the color expression intact. CSS functional colors
    // (`rgb(136 136 136 / 100%)`, `oklch(0 0 0)`, ...) contain their own
    // internal whitespace, so the color can't be found by splitting on the
    // first whitespace run; `parse_color_rgba` owns validating whatever is
    // left over.
    fn split_stop(stop: &str) -> Option<(&str, &str, &str)> {
        let stop = stop.trim();
        let (rest, width) = stop.rsplit_once(char::is_whitespace)?;
        let (color, start) = rest.trim_end().rsplit_once(char::is_whitespace)?;
        Some((color.trim_end(), start, width))
    }

    let parts = split_top_level(body, ',');
    if parts.len() != 3 || parts[0].trim() != "135deg" {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    }

    let Some((color, start, width)) = split_stop(parts[1]) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };
    if !matches!(start, "0" | "0px") {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    }
    let Some(width) = px_length(width) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };

    let Some((keyword, second_start, period)) = split_stop(parts[2]) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };
    if !keyword.eq_ignore_ascii_case("transparent") {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    }
    let Some(second_start) = px_length(second_start) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };
    let Some(period) = px_length(period) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };
    if second_start != width || !(0.0 < width && width < period) {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    }

    let Some(color) = crate::color::parse_color_rgba(color) else {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    };

    let width = width as f32;
    let period = period as f32;
    if !width.is_finite() || !period.is_finite() || width <= 0.0 || period <= 0.0 || width >= period
    {
        return Err(REPEATING_GRADIENT_REJECTION.into());
    }

    Ok(gpui::repeating_hatch_135(color, width, period))
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
    fn transition_deserialization_defaults_optional_fields() {
        let transition: StyleTransition = serde_json::from_value(json!({
            "properties": ["opacity"],
            "durationMs": 150
        }))
        .expect("the published optional fields may be omitted");

        assert_eq!(transition.delay_ms, 0.0);
        assert_eq!(transition.easing, TransitionEasing::Name("ease".into()));
    }

    #[test]
    fn parses_expressive_dimensions_once_with_their_css_source() {
        let parsed = parse_style_value(&json!({
            "width": "calc(100% - 4ch)",
            "minWidth": "24ch",
            "maxWidth": "clamp(240px, 70%, 960px)",
            "lineHeight": "1.4",
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(
            parsed.style.width,
            Some(DimensionValue::Calc { .. })
        ));
        assert!(matches!(
            parsed.style.min_width,
            Some(DimensionValue::Ch(24.0))
        ));
        assert!(matches!(
            parsed.style.max_width,
            Some(DimensionValue::Clamp { .. })
        ));
        assert_eq!(
            parsed.style.line_height,
            Some(LineHeightValue::Unitless("1.4".into()))
        );
        assert_eq!(
            serde_json::to_value(parsed.style).unwrap()["width"],
            "calc(100% - 4ch)"
        );
    }

    #[test]
    fn parses_intrinsic_keywords_and_viewport_units() {
        let parsed = parse_style_value(&json!({
            "width": "max-content",
            "minWidth": "min-content",
            "maxWidth": "fit-content",
            "height": "100vh",
            "minHeight": "calc(50vh - 10px)",
            "maxHeight": "12.5vw",
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.width, Some(DimensionValue::MaxContent));
        assert_eq!(parsed.style.min_width, Some(DimensionValue::MinContent));
        assert_eq!(parsed.style.max_width, Some(DimensionValue::FitContent));
        assert_eq!(parsed.style.height, Some(DimensionValue::Vh(100.0)));
        assert!(matches!(
            parsed.style.min_height,
            Some(DimensionValue::Calc { ref left, .. }) if **left == DimensionValue::Vh(50.0)
        ));
        assert_eq!(parsed.style.max_height, Some(DimensionValue::Vw(12.5)));

        let serialized = serde_json::to_value(parsed.style).unwrap();
        assert_eq!(serialized["width"], "max-content");
        assert_eq!(serialized["minWidth"], "min-content");
        assert_eq!(serialized["maxWidth"], "fit-content");
        assert_eq!(serialized["height"], "100vh");
        assert_eq!(serialized["maxHeight"], "12.5vw");
    }

    #[test]
    fn parses_fit_content_limits_and_rejects_invalid_limits() {
        let parsed = parse_style_value(&json!({
            "width": "fit-content(240px)",
            "maxWidth": "fit-content(50%)",
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(
            parsed.style.width,
            Some(DimensionValue::FitContentLimit {
                source: "fit-content(240px)".into(),
                limit: Box::new(DimensionValue::Pixels(240.0)),
            })
        );
        assert_eq!(
            parsed.style.max_width,
            Some(DimensionValue::FitContentLimit {
                source: "fit-content(50%)".into(),
                limit: Box::new(DimensionValue::Percentage(0.5)),
            })
        );

        let serialized = serde_json::to_value(parsed.style).unwrap();
        assert_eq!(serialized["width"], "fit-content(240px)");
        assert_eq!(serialized["maxWidth"], "fit-content(50%)");

        for (property, value) in [
            ("width", "fit-content()"),
            ("maxWidth", "fit-content(auto)"),
            ("height", "fit-content(max-content)"),
        ] {
            let parsed = parse_style_value(&json!({ property: value }));
            assert_eq!(parsed.problems.len(), 1, "{value}");
            assert_eq!(parsed.problems[0].property, property, "{value}");
        }
    }

    #[test]
    fn rejects_intrinsic_keywords_inside_expressions() {
        // A browser rejects `calc(max-content + 4px)` and
        // `clamp(min-content, 50%, max-content)` too: the keywords are not
        // <length-percentage> terms. The fit-content() functional form is
        // parsed separately and accepts only a length atom as its limit.
        for (property, value) in [
            ("width", "calc(max-content + 4px)"),
            ("width", "clamp(min-content, 50%, 240px)"),
        ] {
            let parsed = parse_style_value(&json!({ property: value }));
            assert_eq!(parsed.problems.len(), 1, "{value}");
            assert_eq!(parsed.problems[0].property, property, "{value}");
        }
    }

    #[test]
    fn reports_expression_parse_positions_without_dropping_valid_siblings() {
        let parsed = parse_style_value(&json!({
            "width": "calc(100% - 2rem)",
            "height": 40,
        }));

        assert_eq!(parsed.style.height, Some(DimensionValue::Pixels(40.0)));
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].property, "width");
        assert_eq!(parsed.problems[0].value, "\"calc(100% - 2rem)\"");
        assert!(parsed.problems[0].reason.contains("byte"));
    }

    #[test]
    fn keeps_the_length_grammar_in_lockstep_with_the_literal_types() {
        for value in [
            "12",
            "calc(24ch)",
            "calc(100%-4ch)",
            "calc(calc(100% - 4ch) + 2px)",
        ] {
            let parsed = parse_style_value(&json!({ "width": value, "height": 40 }));
            assert_eq!(parsed.style.height, Some(DimensionValue::Pixels(40.0)));
            assert_eq!(parsed.problems.len(), 1, "{value}");
            assert_eq!(parsed.problems[0].property, "width", "{value}");
        }
    }

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
    fn spring_easing_ignores_duration_but_malformed_springs_reject_the_transition() {
        let spring = parse_style_value(&json!({
            "opacity": 0.5,
            "transition": {
                "properties": ["opacity"],
                "easing": { "type": "spring" }
            }
        }));
        assert!(spring.problems.is_empty(), "{:?}", spring.problems);
        assert!(spring.style.transition.is_some());

        let spring_with_extreme_duration = parse_style_value(&json!({
            "opacity": 0.5,
            "transition": {
                "properties": ["opacity"],
                "durationMs": 1e300,
                "easing": { "type": "spring" }
            }
        }));
        assert!(
            spring_with_extreme_duration.problems.is_empty(),
            "{:?}",
            spring_with_extreme_duration.problems
        );
        assert!(spring_with_extreme_duration.style.transition.is_some());

        for easing in [
            json!({ "type": "bounce" }),
            json!({ "type": "spring", "stiffness": 0 }),
            json!({ "type": "spring", "damping": -1 }),
            json!({ "type": "spring", "mass": 0 }),
            json!({ "type": "spring", "velocity": 1e300 }),
            json!({ "type": "spring", "unknown": 1 }),
        ] {
            let parsed = parse_style_value(&json!({
                "opacity": 0.5,
                "transition": {
                    "properties": ["opacity"],
                    "easing": easing
                }
            }));
            assert_eq!(parsed.style.opacity, Some(0.5));
            assert_eq!(parsed.style.transition, None);
            assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
            assert_eq!(parsed.problems[0].property, "transition.easing");
        }
    }

    #[test]
    fn hover_group_is_a_top_level_style_marker() {
        let top_level = parse_style_value(&json!({ "hoverGroup": "destination-row" }));
        assert!(top_level.problems.is_empty());
        assert_eq!(
            top_level.style.hover_group.as_deref(),
            Some("destination-row")
        );

        let nested = parse_style_value(&json!({
            "hover": { "hoverGroup": "nested-group" }
        }));
        assert_eq!(nested.problems.len(), 1);
        assert_eq!(nested.problems[0].property, "hover.hoverGroup");
        assert_eq!(
            nested.problems[0].reason,
            "hoverGroup marks the base element and cannot be nested in a state style"
        );
    }

    #[test]
    fn rejects_display_none_in_hover_and_active_styles() {
        let reason = "display: \"none\" cannot be set by hover or active: hiding the element removes the hit-test box that triggers the state; use visibility: \"hidden\" or hoverWithin on a descendant";

        for (state, style) in [
            ("hover", json!({ "hover": { "display": "none" } })),
            ("active", json!({ "active": { "display": "none" } })),
        ] {
            let parsed = parse_style_value(&style);
            assert_eq!(parsed.problems.len(), 1, "{state}: {:?}", parsed.problems);
            assert_eq!(parsed.problems[0].property, format!("{state}.display"));
            assert_eq!(parsed.problems[0].reason, reason);
        }

        let hover_grid = parse_style_value(&json!({
            "hover": { "display": "grid", "opacity": 0.5 }
        }));
        assert!(hover_grid.problems.is_empty(), "{:?}", hover_grid.problems);
        assert_eq!(hover_grid.style.hover.as_deref().unwrap().display.as_deref(), Some("grid"));

        let hover_within_none = parse_style_value(&json!({
            "hoverWithin": { "display": "none" }
        }));
        assert!(
            hover_within_none.problems.is_empty(),
            "{:?}",
            hover_within_none.problems
        );
        assert_eq!(
            hover_within_none
                .style
                .hover_within
                .as_deref()
                .unwrap()
                .display
                .as_deref(),
            Some("none")
        );
    }

    #[test]
    fn parses_mixed_grid_track_lists_and_rejects_integer_shorthand() {
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
            Some(ref tracks) if tracks.len() == 4
        ));
        assert!(matches!(
            parsed.style.grid_template_rows,
            Some(ref tracks) if tracks.len() == 2
        ));

        let shorthand = parse_style_value(&json!({ "gridTemplateRows": 2 }));
        assert_eq!(shorthand.style.grid_template_rows, None);
        assert_eq!(shorthand.problems.len(), 1);
        assert_eq!(shorthand.problems[0].property, "gridTemplateRows");
        assert_eq!(
            shorthand.problems[0].reason,
            "expected a non-empty grid track list"
        );
    }

    #[test]
    fn parses_percentage_and_fit_content_grid_tracks() {
        let parsed = parse_style_value(&json!({
            "gridTemplateColumns": [
                { "type": "percent", "value": 25 },
                {
                    "type": "minmax",
                    "min": { "type": "percent", "value": 10 },
                    "max": { "type": "percent", "value": 125 }
                },
                { "type": "fit-content", "limit": { "type": "px", "value": 200 } },
                {
                    "type": "repeat",
                    "count": 2,
                    "tracks": [
                        { "type": "percent", "value": 50 },
                        { "type": "fit-content", "limit": { "type": "percent", "value": 75 } }
                    ]
                }
            ]
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(
            parsed.style.grid_template_columns,
            Some(ref tracks)
                if matches!(tracks[0], GridTrackValue::Percent { value } if value == 25.0)
                    && matches!(tracks[1], GridTrackValue::Minmax {
                        min: GridTrackMinValue::Percent { value: 10.0 },
                        max: GridTrackMaxValue::Percent { value: 125.0 },
                    })
                    && matches!(tracks[2], GridTrackValue::FitContent {
                        limit: GridTrackFitContentLimit::Px { value: 200.0 },
                    })
                    && matches!(tracks[3], GridTrackValue::Repeat { ref tracks, .. }
                        if matches!(tracks[0], GridTrackValue::Percent { value } if value == 50.0)
                            && matches!(tracks[1], GridTrackValue::FitContent {
                                limit: GridTrackFitContentLimit::Percent { value: 75.0 },
                            }))
        ));
    }

    #[test]
    fn rejects_invalid_percentage_and_fit_content_grid_tracks() {
        for (value, property, reason) in [
            (
                json!({ "type": "percent", "value": -1 }),
                "gridTemplateColumns[0].value",
                "expected a non-negative number",
            ),
            (
                json!({
                    "type": "minmax",
                    "min": { "type": "fit-content", "limit": { "type": "px", "value": 20 } },
                    "max": { "type": "fr", "value": 1 }
                }),
                "gridTemplateColumns[0].min.type",
                "fit-content is not valid as a minmax bound",
            ),
            (
                json!({ "type": "fit-content", "limit": { "type": "fr", "value": 1 } }),
                "gridTemplateColumns[0].limit",
                "expected a px or percent limit",
            ),
        ] {
            let parsed = parse_style_value(&json!({ "gridTemplateColumns": [value] }));
            assert_eq!(parsed.style.grid_template_columns, None);
            assert_eq!(parsed.problems.len(), 1, "{property}");
            assert_eq!(parsed.problems[0].property, property);
            assert_eq!(parsed.problems[0].reason, reason);
        }
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
    fn parses_grid_auto_tracks_and_rejects_repeat() {
        let parsed = parse_style_value(&json!({
            "gridAutoRows": [
                { "type": "px", "value": 40 },
                { "type": "percent", "value": 25 },
                { "type": "fit-content", "limit": { "type": "px", "value": 200 } },
                {
                    "type": "minmax",
                    "min": { "type": "px", "value": 0 },
                    "max": { "type": "fr", "value": 1 }
                }
            ],
            "gridAutoColumns": [{ "type": "auto" }]
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(
            parsed.style.grid_auto_rows,
            Some(ref tracks) if tracks.len() == 4
        ));
        assert!(matches!(
            parsed.style.grid_auto_columns,
            Some(ref tracks) if tracks.len() == 1 && matches!(tracks[0], GridTrackValue::Auto)
        ));

        let repeat_in_rows = parse_style_value(&json!({
            "gridAutoRows": [{
                "type": "repeat",
                "count": 2,
                "tracks": [{ "type": "px", "value": 24 }]
            }]
        }));
        assert_eq!(repeat_in_rows.style.grid_auto_rows, None);
        assert_eq!(repeat_in_rows.problems.len(), 1);
        assert_eq!(repeat_in_rows.problems[0].property, "gridAutoRows[0].type");
        assert_eq!(
            repeat_in_rows.problems[0].reason,
            "repeat is not valid in gridAutoRows/gridAutoColumns"
        );

        let repeat_in_columns = parse_style_value(&json!({
            "gridAutoColumns": [{
                "type": "repeat",
                "count": 2,
                "tracks": [{ "type": "px", "value": 24 }]
            }]
        }));
        assert_eq!(repeat_in_columns.style.grid_auto_columns, None);
        assert_eq!(repeat_in_columns.problems.len(), 1);
        assert_eq!(
            repeat_in_columns.problems[0].property,
            "gridAutoColumns[0].type"
        );
        assert_eq!(
            repeat_in_columns.problems[0].reason,
            "repeat is not valid in gridAutoRows/gridAutoColumns"
        );
    }

    #[test]
    fn parses_auto_fill_and_auto_fit_grid_repetitions() {
        for keyword in ["auto-fill", "auto-fit"] {
            let parsed = parse_style_value(&json!({
                "gridTemplateColumns": [{
                    "type": "repeat",
                    "count": keyword,
                    "tracks": [{
                        "type": "minmax",
                        "min": { "type": "px", "value": 180 },
                        "max": { "type": "fr", "value": 1 }
                    }]
                }]
            }));

            assert!(parsed.problems.is_empty(), "{keyword}: {:?}", parsed.problems);
            let expected = match keyword {
                "auto-fill" => GridAutoRepeatKind::AutoFill,
                _ => GridAutoRepeatKind::AutoFit,
            };
            assert!(
                matches!(
                    parsed.style.grid_template_columns,
                    Some(ref tracks)
                        if tracks.len() == 1
                            && matches!(
                                tracks[0],
                                GridTrackValue::Repeat { count: GridRepeatCount::Auto(kind), .. }
                                    if kind == expected
                            )
                ),
                "{keyword}"
            );
        }
    }

    #[test]
    fn rejects_a_grid_repeat_count_that_is_neither_an_integer_nor_an_auto_keyword() {
        let parsed = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": "sometimes",
                "tracks": [{ "type": "px", "value": 24 }]
            }]
        }));

        assert_eq!(parsed.style.grid_template_columns, None);
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].property, "gridTemplateColumns[0].count");
        assert_eq!(
            parsed.problems[0].reason,
            "expected an integer from 1 through 64, or \"auto-fill\"/\"auto-fit\""
        );
    }

    #[test]
    fn rejects_grid_templates_that_would_collapse_the_explicit_grid_to_zero_tracks() {
        // Mirrors taffy 0.13's `compute_explicit_grid_size_in_axis`
        // (explicit_grid.rs:74-90): an auto repetition is only valid when
        // there is exactly one in the template, and every track in the
        // template has a fixed length or percentage component.
        let cases = [
            // The repetition's only track (`1fr`) has no fixed component.
            json!([{
                "type": "repeat",
                "count": "auto-fill",
                "tracks": [{ "type": "fr", "value": 1 }]
            }]),
            // Two auto repetitions in one template.
            json!([
                {
                    "type": "repeat",
                    "count": "auto-fill",
                    "tracks": [{ "type": "px", "value": 100 }]
                },
                {
                    "type": "repeat",
                    "count": "auto-fit",
                    "tracks": [{ "type": "px", "value": 100 }]
                }
            ]),
            // The repetition itself is fixed, but a track outside it is not.
            json!([
                {
                    "type": "repeat",
                    "count": "auto-fill",
                    "tracks": [{ "type": "px", "value": 100 }]
                },
                { "type": "fr", "value": 1 }
            ]),
        ];

        for tracks in cases {
            let parsed = parse_style_value(&json!({ "gridTemplateColumns": tracks }));
            assert_eq!(parsed.style.grid_template_columns, None, "{tracks:?}");
            assert_eq!(parsed.problems.len(), 1, "{tracks:?}");
            assert_eq!(
                parsed.problems[0].property, "gridTemplateColumns",
                "{tracks:?}"
            );
        }
    }

    #[test]
    fn counts_an_auto_repetition_as_one_repetition_against_the_64_track_cap() {
        // 32 tracks outside the repetition + 32 inside it (one repetition,
        // per the 64-track cap's treatment of auto repetitions) stays at the
        // cap; a 33rd single track would tip it over.
        let mut tracks: Vec<serde_json::Value> = (0..32)
            .map(|_| json!({ "type": "px", "value": 10 }))
            .collect();
        tracks.push(json!({
            "type": "repeat",
            "count": "auto-fill",
            "tracks": (0..32).map(|_| json!({ "type": "px", "value": 10 })).collect::<Vec<_>>()
        }));

        let parsed = parse_style_value(&json!({ "gridTemplateColumns": tracks.clone() }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(
            parsed.style.grid_template_columns,
            Some(ref tracks) if tracks.len() == 33
        ));

        tracks.push(json!({ "type": "px", "value": 10 }));
        let oversized = parse_style_value(&json!({ "gridTemplateColumns": tracks }));
        assert_eq!(oversized.style.grid_template_columns, None);
        assert_eq!(oversized.problems.len(), 1);
        assert_eq!(
            oversized.problems[0].reason,
            "expected no more than 64 expanded grid tracks"
        );
    }

    #[test]
    fn rejects_every_invalid_grid_repeat_count() {
        for count in [json!(0), json!(2.5), json!(-1), json!(65), json!("auto"), json!("Auto-Fill")] {
            let parsed = parse_style_value(&json!({
                "gridTemplateColumns": [{
                    "type": "repeat",
                    "count": count,
                    "tracks": [{ "type": "px", "value": 24 }]
                }]
            }));

            assert_eq!(parsed.style.grid_template_columns, None, "{count:?}");
            assert_eq!(parsed.problems.len(), 1, "{count:?}");
            assert_eq!(
                parsed.problems[0].property, "gridTemplateColumns[0].count",
                "{count:?}"
            );
        }
    }

    #[test]
    fn fit_content_never_counts_as_a_fixed_component_but_a_fixed_minmax_bound_does() {
        // taffy tags `fit-content()` distinctly from a plain length or
        // percentage (`CompactLength::is_length_or_percentage`), so it never
        // satisfies CSS's `<fixed-size>` requirement for an auto repetition's
        // tracks, even with a px limit.
        let fit_content_only = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": "auto-fill",
                "tracks": [{ "type": "fit-content", "limit": { "type": "px", "value": 100 } }]
            }]
        }));
        assert_eq!(fit_content_only.style.grid_template_columns, None);
        assert_eq!(fit_content_only.problems.len(), 1);
        assert_eq!(
            fit_content_only.problems[0].property,
            "gridTemplateColumns"
        );

        // A `minmax()` with a fixed percentage lower bound does count, even
        // though its upper bound (`1fr`) does not.
        let minmax_with_fixed_min = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": "auto-fill",
                "tracks": [{
                    "type": "minmax",
                    "min": { "type": "percent", "value": 10 },
                    "max": { "type": "fr", "value": 1 }
                }]
            }]
        }));
        assert!(
            minmax_with_fixed_min.problems.is_empty(),
            "{:?}",
            minmax_with_fixed_min.problems
        );
        assert!(matches!(
            minmax_with_fixed_min.style.grid_template_columns,
            Some(ref tracks) if tracks.len() == 1
        ));
    }

    #[test]
    fn serializes_grid_repeat_counts_back_to_their_authored_form() {
        let auto_fill = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": "auto-fill",
                "tracks": [{ "type": "px", "value": 100 }]
            }]
        }));
        assert!(auto_fill.problems.is_empty(), "{:?}", auto_fill.problems);
        let serialized = serde_json::to_value(auto_fill.style).unwrap();
        assert_eq!(serialized["gridTemplateColumns"][0]["count"], "auto-fill");

        let auto_fit = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": "auto-fit",
                "tracks": [{ "type": "px", "value": 100 }]
            }]
        }));
        assert!(auto_fit.problems.is_empty(), "{:?}", auto_fit.problems);
        let serialized = serde_json::to_value(auto_fit.style).unwrap();
        assert_eq!(serialized["gridTemplateColumns"][0]["count"], "auto-fit");

        let fixed = parse_style_value(&json!({
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": 3,
                "tracks": [{ "type": "px", "value": 100 }]
            }]
        }));
        assert!(fixed.problems.is_empty(), "{:?}", fixed.problems);
        let serialized = serde_json::to_value(fixed.style).unwrap();
        assert_eq!(serialized["gridTemplateColumns"][0]["count"], 3);
    }

    #[test]
    fn parses_grid_auto_flow_and_inline_axis_justification() {
        for value in ["row", "column", "dense", "row dense", "column dense"] {
            let parsed = parse_style_value(&json!({ "gridAutoFlow": value }));
            assert!(parsed.problems.is_empty(), "{value}");
            assert_eq!(parsed.style.grid_auto_flow.as_deref(), Some(value));
        }

        let rejected = parse_style_value(&json!({ "gridAutoFlow": "diagonal" }));
        assert_eq!(rejected.style.grid_auto_flow, None);
        assert_eq!(rejected.problems.len(), 1);
        assert_eq!(rejected.problems[0].property, "gridAutoFlow");

        for property in ["justifyItems", "justifySelf"] {
            let parsed = parse_style_value(&json!({ property: "center" }));
            assert!(parsed.problems.is_empty(), "{property}");
        }
        let parsed = parse_style_value(&json!({
            "justifyItems": "center",
            "justifySelf": "end"
        }));
        assert_eq!(parsed.style.justify_items.as_deref(), Some("center"));
        assert_eq!(parsed.style.justify_self.as_deref(), Some("end"));
    }

    #[test]
    fn parses_grid_lines_shorthands_longhands_and_areas() {
        let parsed = parse_style_value(&json!({
            "gridColumn": "1 / -1",
            "gridRow": "2 / span 3",
            "gridArea": "1 / 2 / 3 / 4",
            "gridColumnStart": 2,
        }));

        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.grid_row_start, Some(GridLineValue::Line(1)));
        assert_eq!(parsed.style.grid_row_end, Some(GridLineValue::Line(3)));
        // The explicit longhand wins over gridColumn's derived start line.
        assert_eq!(parsed.style.grid_column_start, Some(GridLineValue::Line(2)));
        assert_eq!(parsed.style.grid_column_end, Some(GridLineValue::Line(4)));

        let span = parse_style_value(&json!({ "gridColumn": "span 2" }));
        assert_eq!(span.style.grid_column_start, Some(GridLineValue::Span(2)));
        assert_eq!(span.style.grid_column_end, Some(GridLineValue::Auto));

        let area = parse_style_value(&json!({ "gridArea": "1 / 2" }));
        assert_eq!(area.style.grid_row_start, Some(GridLineValue::Line(1)));
        assert_eq!(area.style.grid_column_start, Some(GridLineValue::Line(2)));
        assert_eq!(area.style.grid_row_end, Some(GridLineValue::Auto));
        assert_eq!(area.style.grid_column_end, Some(GridLineValue::Auto));

        let serialized = serde_json::to_value(parsed.style).unwrap();
        assert_eq!(serialized["gridRowStart"], "1");
        assert_eq!(serialized["gridRowEnd"], "3");
        assert_eq!(serialized["gridColumnStart"], "2");
        assert_eq!(serialized["gridColumnEnd"], "4");
    }

    #[test]
    fn parses_grid_line_shorthand_spacing_and_span_pairs() {
        let unspaced = parse_style_value(&json!({ "gridColumn": "1/2" }));
        assert!(unspaced.problems.is_empty(), "{:?}", unspaced.problems);
        assert_eq!(
            unspaced.style.grid_column_start,
            Some(GridLineValue::Line(1))
        );
        assert_eq!(unspaced.style.grid_column_end, Some(GridLineValue::Line(2)));

        let padded = parse_style_value(&json!({ "gridRow": " 2 / span 3 " }));
        assert!(padded.problems.is_empty(), "{:?}", padded.problems);
        assert_eq!(padded.style.grid_row_start, Some(GridLineValue::Line(2)));
        assert_eq!(padded.style.grid_row_end, Some(GridLineValue::Span(3)));

        let both_spans = parse_style_value(&json!({ "gridColumn": "span 2 / span 3" }));
        assert!(both_spans.problems.is_empty(), "{:?}", both_spans.problems);
        assert_eq!(
            both_spans.style.grid_column_start,
            Some(GridLineValue::Span(2))
        );
        assert_eq!(
            both_spans.style.grid_column_end,
            Some(GridLineValue::Span(3))
        );
    }

    #[test]
    fn rejects_a_five_value_grid_area() {
        let parsed = parse_style_value(&json!({ "gridArea": "1 / 2 / 3 / 4 / 5" }));
        assert_eq!(parsed.style, StyleDesc::default());
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].property, "gridArea");
        assert_eq!(
            parsed.problems[0].reason,
            "expected 2 to 4 grid lines separated by \"/\"; named areas are not supported"
        );
    }

    #[test]
    fn serializes_auto_and_span_grid_lines() {
        let parsed = parse_style_value(&json!({
            "gridColumnStart": "auto",
            "gridColumnEnd": "span 2",
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.grid_column_start, Some(GridLineValue::Auto));
        assert_eq!(parsed.style.grid_column_end, Some(GridLineValue::Span(2)));

        let serialized = serde_json::to_value(parsed.style).unwrap();
        assert_eq!(serialized["gridColumnStart"], "auto");
        assert_eq!(serialized["gridColumnEnd"], "span 2");
    }

    #[test]
    fn clamps_out_of_range_grid_lines_instead_of_rejecting_them() {
        let over = parse_style_value(&json!({ "gridColumnStart": "40000" }));
        assert!(over.problems.is_empty(), "{:?}", over.problems);
        assert_eq!(
            over.style.grid_column_start,
            Some(GridLineValue::Line(32767))
        );

        let under = parse_style_value(&json!({ "gridColumnStart": "-40000" }));
        assert!(under.problems.is_empty(), "{:?}", under.problems);
        assert_eq!(
            under.style.grid_column_start,
            Some(GridLineValue::Line(-32767))
        );

        let numeric = parse_style_value(&json!({ "gridColumnStart": 40000 }));
        assert!(numeric.problems.is_empty(), "{:?}", numeric.problems);
        assert_eq!(
            numeric.style.grid_column_start,
            Some(GridLineValue::Line(32767))
        );

        let span = parse_style_value(&json!({ "gridColumnStart": "span 70000" }));
        assert!(span.problems.is_empty(), "{:?}", span.problems);
        assert_eq!(
            span.style.grid_column_start,
            Some(GridLineValue::Span(65535))
        );

        // Zero remains a grammar rejection regardless of clamping.
        let zero = parse_style_value(&json!({ "gridColumnStart": "0" }));
        assert_eq!(zero.problems.len(), 1);
        assert_eq!(zero.problems[0].reason, GRID_LINE_ERROR);
    }

    #[test]
    fn rejects_invalid_grid_lines_and_area_shapes() {
        for (property, value) in [
            ("gridColumn", json!("0")),
            ("gridColumn", json!("span 0")),
            ("gridColumn", json!("span")),
            ("gridColumn", json!("header")),
            ("gridArea", json!("header")),
            ("gridColumn", json!("1 / 2 / 3")),
        ] {
            let parsed = parse_style_value(&json!({ property: value }));
            assert_eq!(parsed.style, StyleDesc::default(), "{property}: {value}");
            assert_eq!(parsed.problems.len(), 1, "{property}: {value}");
            assert_eq!(parsed.problems[0].property, property);
        }
        assert_eq!(
            parse_style_value(&json!({ "gridArea": "header" })).problems[0].reason,
            "expected 2 to 4 grid lines separated by \"/\"; named areas are not supported"
        );
        assert_eq!(
            parse_style_value(&json!({ "gridColumnStart": "header" })).problems[0].reason,
            GRID_LINE_ERROR
        );
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
    fn parses_the_pixel_hatch_form_of_repeating_linear_gradient() {
        for value in [
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 5px)",
            "repeating-linear-gradient(135deg, #888 0px 2px, transparent 2px 5px)",
            "repeating-linear-gradient( 135deg , #888 0 2px , transparent 2px 5px )",
        ] {
            assert_eq!(
                parse_background(&BackgroundValue::String(value.into())),
                Ok(gpui::repeating_hatch_135(
                    crate::color::parse_color_rgba("#888").unwrap(),
                    2.0,
                    5.0,
                ))
            );
        }
    }

    #[test]
    fn accepts_wide_repeating_linear_gradient_hatch() {
        // Regression: the old `pattern_slash` translation packed width/interval
        // into a single u32, which overflowed well below these logical-pixel
        // values. `repeating_hatch_135` carries width/period as plain f32s.
        let value = "repeating-linear-gradient(135deg, #888 0 200px, transparent 200px 500px)";
        assert_eq!(
            parse_background(&BackgroundValue::String(value.into())),
            Ok(gpui::repeating_hatch_135(
                crate::color::parse_color_rgba("#888").unwrap(),
                200.0,
                500.0,
            ))
        );
    }

    #[test]
    fn rejects_repeating_linear_gradient_hatch_with_width_unrepresentable_in_f32() {
        // Finite as f64 but overflows to infinity once narrowed to f32.
        let value = "repeating-linear-gradient(135deg, #888 0 5e38px, transparent 5e38px 6e38px)";
        assert_eq!(
            parse_background(&BackgroundValue::String(value.into())),
            Err(REPEATING_GRADIENT_REJECTION.to_string())
        );
    }

    #[test]
    fn rejects_every_other_repeating_linear_gradient() {
        for value in [
            "repeating-linear-gradient(45deg, #888 0 2px, transparent 2px 5px)",
            "repeating-linear-gradient(135deg, #888 0 20%, transparent 20% 50%)",
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 5px, #888 5px 6px)",
            "repeating-linear-gradient(135deg, #888 0 2px, #000 2px 5px)",
            "repeating-linear-gradient(135deg, #888 0 5px, transparent 5px 5px)",
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 3px 5px)",
            // Nonzero unitless positions, rejected individually.
            "repeating-linear-gradient(135deg, #888 0 2, transparent 2px 5px)",
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2 5px)",
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 5)",
            // Missing closing parenthesis and trailing junk after it.
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 5px",
            "repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 5px) no-repeat",
        ] {
            assert_eq!(
                parse_background(&BackgroundValue::String(value.into())),
                Err(REPEATING_GRADIENT_REJECTION.to_string())
            );
        }
    }

    #[test]
    fn parses_functional_colors_in_repeating_linear_gradient() {
        for color in [
            "rgb(136, 136, 136)",
            "rgb(136 136 136 / 100%)",
            "oklch(0 0 0)",
        ] {
            let value =
                format!("repeating-linear-gradient(135deg, {color} 0 2px, transparent 2px 5px)");
            assert_eq!(
                parse_background(&BackgroundValue::String(value)),
                Ok(gpui::repeating_hatch_135(
                    crate::color::parse_color_rgba(color).unwrap(),
                    2.0,
                    5.0,
                ))
            );
        }

        // Extra internal whitespace around the color and positions must not
        // split the functional color expression apart.
        let color = "rgb(136 136 136 / 100%)";
        let value =
            format!("repeating-linear-gradient(135deg,  {color}   0   2px , transparent 2px 5px)");
        assert_eq!(
            parse_background(&BackgroundValue::String(value)),
            Ok(gpui::repeating_hatch_135(
                crate::color::parse_color_rgba(color).unwrap(),
                2.0,
                5.0,
            ))
        );
    }

    #[test]
    fn display_accepts_none_and_rejects_block() {
        let hidden = parse_style_value(&json!({ "display": "none" }));
        assert!(hidden.problems.is_empty(), "{:?}", hidden.problems);
        assert_eq!(hidden.style.display.as_deref(), Some("none"));

        let block = parse_style_value(&json!({ "display": "block" }));
        assert_eq!(block.style.display, None);
        assert_eq!(block.problems.len(), 1);
        assert_eq!(block.problems[0].property, "display");
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
            "gridTemplateColumns": [{
                "type": "repeat",
                "count": 2,
                "tracks": [{
                    "type": "minmax",
                    "min": { "type": "min-content" },
                    "max": { "type": "fr", "value": 1 }
                }]
            }],
            "gridTemplateRows": [{
                "type": "repeat",
                "count": 2,
                "tracks": [{
                    "type": "minmax",
                    "min": { "type": "px", "value": 0 },
                    "max": { "type": "max-content" }
                }]
            }],
            "gridRowStart": "1",
            "gridRowEnd": "2",
            "gridColumnStart": "1",
            "gridColumnEnd": "2",
            "gridAutoFlow": "column dense",
            "gridAutoRows": [{ "type": "px", "value": 40 }],
            "gridAutoColumns": [{ "type": "fr", "value": 1 }],
            "justifyItems": "center",
            "justifySelf": "end",
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
            "borderStyle": "solid",
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
            "fontVariantNumeric": "tabular-nums",
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
            "interpolateSize": "allow-keywords",
            "transition": {
                "properties": ["opacity", "backgroundColor", "width"],
                "durationMs": 140,
                "delayMs": 20,
                "easing": "ease"
            },
            "hoverGroup": "destination-row",
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

    // Issue #301: `borderStyle: "solid"` used to be rejected outright, so a
    // border could not be declared the way a browser stylesheet declares one.
    #[test]
    fn border_style_accepts_the_css_set_and_rejects_others() {
        for value in [
            "none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset",
            "outset",
        ] {
            let parsed = parse_style_value(&json!({ "borderStyle": value }));
            assert!(parsed.problems.is_empty(), "{value}: {:?}", parsed.problems);
            assert_eq!(parsed.style.border_style.as_deref(), Some(value));
        }

        let rejected = parse_style_value(&json!({ "borderStyle": "wavy" }));
        assert_eq!(rejected.style.border_style, None);
        assert_eq!(rejected.problems.len(), 1);
        assert_eq!(rejected.problems[0].property, "borderStyle");
    }

    #[test]
    fn text_decoration_accepts_the_supported_set() {
        for value in ["underline", "line-through", "none"] {
            let parsed = parse_style_value(&json!({ "textDecoration": value }));
            assert!(parsed.problems.is_empty(), "{value}: {:?}", parsed.problems);
            assert_eq!(parsed.style.text_decoration.as_deref(), Some(value));
        }
    }

    #[test]
    fn list_style_accepts_only_none() {
        let parsed = parse_style_value(&json!({ "listStyle": "none" }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);

        let parsed = parse_style_value(&json!({ "listStyle": "disc" }));
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].property, "listStyle");

        let parsed = parse_style_value(&json!({ "listStyleType": "none" }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);

        let parsed = parse_style_value(&json!({ "listStyleType": "decimal" }));
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].property, "listStyleType");

        let parsed = parse_style_value(&json!({ "hover": { "listStyle": "none" } }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
    }

    #[test]
    fn font_variant_numeric_accepts_the_supported_set() {
        for value in [
            "normal",
            "tabular-nums",
            "tabular-nums slashed-zero",
            "oldstyle-nums tabular-nums ordinal",
        ] {
            let parsed = parse_style_value(&json!({ "fontVariantNumeric": value }));
            assert!(parsed.problems.is_empty(), "{value}: {:?}", parsed.problems);
            assert_eq!(parsed.style.font_variant_numeric.as_deref(), Some(value));
        }
    }

    #[test]
    fn font_variant_numeric_rejects_invalid_set() {
        for value in [
            "tabular-nums proportional-nums",
            "tabular-nums tabular-nums",
            "normal tabular-nums",
            "tnum",
            "",
        ] {
            let parsed = parse_style_value(&json!({ "fontVariantNumeric": value }));
            assert_eq!(parsed.problems.len(), 1, "{value}: {:?}", parsed.problems);
            assert_eq!(
                parsed.style.font_variant_numeric, None,
                "{value}: {:?}",
                parsed.problems
            );
        }
    }

    // Issue #403: `border` / `borderTop` / `borderRight` / `borderBottom` /
    // `borderLeft` accept a CSS-shorthand string of a width, a style and a
    // color, in any order, each optional, folding into the existing longhand
    // fields so resolved styles read back as longhands.
    #[test]
    fn border_shorthand_accepts_any_order() {
        for value in [
            "4px solid #333333",
            "solid 4px #333333",
            "solid #333333 4px",
            "#333333 solid 4px",
            "#333333 4px solid",
            "4px #333333 solid",
        ] {
            let parsed = parse_style_value(&json!({ "border": value }));
            assert!(parsed.problems.is_empty(), "{value}: {:?}", parsed.problems);
            assert_eq!(parsed.style.border_width, Some(4.0), "{value}");
            assert_eq!(
                parsed.style.border_style.as_deref(),
                Some("solid"),
                "{value}"
            );
            assert_eq!(
                parsed.style.border_color.as_deref(),
                Some("#333333"),
                "{value}"
            );
        }
    }

    #[test]
    fn border_shorthand_accepts_every_subset_of_components() {
        for (value, width, style, color) in [
            ("4px", Some(4.0), None, None),
            ("solid", None, Some("solid"), None),
            ("#333333", None, None, Some("#333333")),
            ("4px solid", Some(4.0), Some("solid"), None),
            ("4px #333333", Some(4.0), None, Some("#333333")),
            ("solid #333333", None, Some("solid"), Some("#333333")),
            ("0", Some(0.0), None, None),
            ("none", None, Some("none"), None),
        ] {
            let parsed = parse_style_value(&json!({ "border": value }));
            assert!(parsed.problems.is_empty(), "{value}: {:?}", parsed.problems);
            assert_eq!(parsed.style.border_width, width, "{value}");
            assert_eq!(parsed.style.border_style.as_deref(), style, "{value}");
            assert_eq!(parsed.style.border_color.as_deref(), color, "{value}");
        }
    }

    #[test]
    fn border_shorthand_tokenises_spaced_color_functions_as_one_token() {
        for color in ["rgb(1, 2, 3)", "oklch(from #bad455 calc(l - 0.15) c h)"] {
            let parsed = parse_style_value(&json!({ "border": format!("4px solid {color}") }));
            assert!(parsed.problems.is_empty(), "{color}: {:?}", parsed.problems);
            assert_eq!(parsed.style.border_color.as_deref(), Some(color), "{color}");
        }
    }

    #[test]
    fn border_side_shorthands_set_only_their_own_width_field() {
        let cases: [(&str, fn(&StyleDesc) -> Option<f64>); 4] = [
            ("borderTop", |s| s.border_top_width),
            ("borderRight", |s| s.border_right_width),
            ("borderBottom", |s| s.border_bottom_width),
            ("borderLeft", |s| s.border_left_width),
        ];
        for (key, width_of) in cases {
            let parsed = parse_style_value(&json!({ key: "4px solid #333333" }));
            assert!(parsed.problems.is_empty(), "{key}: {:?}", parsed.problems);
            assert_eq!(width_of(&parsed.style), Some(4.0), "{key}");
            assert_eq!(parsed.style.border_style.as_deref(), Some("solid"), "{key}");
            assert_eq!(
                parsed.style.border_color.as_deref(),
                Some("#333333"),
                "{key}"
            );
        }
    }

    #[test]
    fn border_width_string_expands_css_style_by_count() {
        let one = parse_style_value(&json!({ "borderWidth": "4px" }));
        assert!(one.problems.is_empty(), "{:?}", one.problems);
        assert_eq!(one.style.border_width, Some(4.0));
        assert_eq!(one.style.border_top_width, None);

        let two = parse_style_value(&json!({ "borderWidth": "4px 8px" }));
        assert!(two.problems.is_empty(), "{:?}", two.problems);
        assert_eq!(two.style.border_width, None);
        assert_eq!(two.style.border_top_width, Some(4.0));
        assert_eq!(two.style.border_bottom_width, Some(4.0));
        assert_eq!(two.style.border_left_width, Some(8.0));
        assert_eq!(two.style.border_right_width, Some(8.0));

        let three = parse_style_value(&json!({ "borderWidth": "4px 8px 12px" }));
        assert!(three.problems.is_empty(), "{:?}", three.problems);
        assert_eq!(three.style.border_width, None);
        assert_eq!(three.style.border_top_width, Some(4.0));
        assert_eq!(three.style.border_left_width, Some(8.0));
        assert_eq!(three.style.border_right_width, Some(8.0));
        assert_eq!(three.style.border_bottom_width, Some(12.0));

        let four = parse_style_value(&json!({ "borderWidth": "4px 8px 12px 16px" }));
        assert!(four.problems.is_empty(), "{:?}", four.problems);
        assert_eq!(four.style.border_width, None);
        assert_eq!(four.style.border_top_width, Some(4.0));
        assert_eq!(four.style.border_right_width, Some(8.0));
        assert_eq!(four.style.border_bottom_width, Some(12.0));
        assert_eq!(four.style.border_left_width, Some(16.0));
    }

    #[test]
    fn border_width_number_form_keeps_working() {
        let parsed = parse_style_value(&json!({ "borderWidth": 4 }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.border_width, Some(4.0));
    }

    // A multi-value `borderWidth` string only fills in sides an explicit
    // per-side longhand or per-side shorthand left untouched; it never
    // overrides one, regardless of where each key falls in the (alphabetical,
    // not source) iteration order.
    #[test]
    fn border_width_list_does_not_override_an_explicit_per_side_longhand() {
        let parsed = parse_style_value(&json!({
            "borderTopWidth": 2,
            "borderWidth": "4px 8px",
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.border_width, None);
        assert_eq!(parsed.style.border_top_width, Some(2.0));
        assert_eq!(parsed.style.border_right_width, Some(8.0));
        assert_eq!(parsed.style.border_bottom_width, Some(4.0));
        assert_eq!(parsed.style.border_left_width, Some(8.0));
    }

    #[test]
    fn border_width_list_does_not_override_an_explicit_per_side_shorthand() {
        let parsed = parse_style_value(&json!({
            "borderLeft": "4px solid red",
            "borderWidth": "1px 2px",
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.border_left_width, Some(4.0));
    }

    #[test]
    fn border_shorthand_rejects_an_unrecognized_token() {
        let parsed = parse_style_value(&json!({ "border": "4px chunky #333333" }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "border");
        assert!(parsed.problems[0].reason.contains("chunky"));
        assert!(parsed.problems[0].reason.contains("border"));
    }

    #[test]
    fn border_shorthand_rejects_a_duplicated_component() {
        let parsed = parse_style_value(&json!({ "border": "4px 8px solid" }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "border");
        assert!(parsed.problems[0].reason.contains("8px"));
        assert!(parsed.problems[0].reason.contains("border"));
    }

    #[test]
    fn border_shorthand_rejects_a_negative_width() {
        let parsed = parse_style_value(&json!({ "border": "-4px solid #333333" }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "border");
        assert!(parsed.problems[0].reason.contains("-4px"));
    }

    // `-0px` is negative zero textually, not a magnitude below zero, so it must
    // be rejected by its leading `-` rather than surviving a `>= 0.0` check.
    #[test]
    fn border_shorthand_rejects_a_leading_minus_zero_width() {
        let parsed = parse_style_value(&json!({ "border": "-0px solid #333333" }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "border");
        assert!(parsed.problems[0].reason.contains("-0px"));
    }

    // Border shorthand color conflicts compare the parsed color, not the
    // authored text, so `#333` and `#333333` — the same color spelled two
    // ways — do not conflict.
    #[test]
    fn border_shorthands_do_not_conflict_on_the_same_color_spelled_differently() {
        let parsed = parse_style_value(&json!({
            "border": "1px solid #333",
            "borderTop": "1px solid #333333",
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.style.border_color.as_deref(), Some("#333333"));
        assert_eq!(parsed.style.border_top_width, Some(1.0));
    }

    // `serde_json::Map` here is a `BTreeMap` (no `preserve_order` feature), so
    // the style object iterates in alphabetical key order, not JS source
    // order — "border" sorts before "borderTop" because it is a prefix of it.
    // This test pins that deterministic map order deliberately, on the one
    // declaration that survives, rather than claiming a source-order contract
    // for authors: the only promise is that exactly one of a disagreeing pair
    // is rejected with a diagnostic naming both.
    #[test]
    fn border_shorthands_reject_a_conflicting_color() {
        let parsed = parse_style_value(&json!({
            "border": "4px solid #333333",
            "borderTop": "4px solid #ff0000",
        }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "borderTop");
        let reason = &parsed.problems[0].reason;
        assert!(reason.contains("borderTop"), "{reason}");
        assert!(reason.contains("border "), "{reason}");
        assert!(reason.contains("color"), "{reason}");
        // The surviving declaration stands; none of the rejected one's components land.
        assert_eq!(parsed.style.border_color.as_deref(), Some("#333333"));
        assert_eq!(parsed.style.border_top_width, None);
    }

    // See the map-order note on `border_shorthands_reject_a_conflicting_color`.
    #[test]
    fn border_shorthands_reject_a_conflicting_style() {
        let parsed = parse_style_value(&json!({
            "border": "4px solid #333333",
            "borderTop": "4px dashed #333333",
        }));
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "borderTop");
        let reason = &parsed.problems[0].reason;
        assert!(reason.contains("borderTop"), "{reason}");
        assert!(reason.contains("border "), "{reason}");
        assert!(reason.contains("style"), "{reason}");
        assert_eq!(parsed.style.border_style.as_deref(), Some("solid"));
        assert_eq!(parsed.style.border_top_width, None);
    }

    #[test]
    fn box_shadow_accepts_a_single_object_and_round_trips_as_an_object() {
        let parsed = parse_style_value(&json!({
            "boxShadow": {
                "offsetX": 0.0,
                "offsetY": 4.0,
                "blurRadius": 12.0,
                "spreadRadius": 0.0,
                "color": "#00000033",
            },
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(parsed.style.box_shadow, Some(BoxShadowValue::One(_))));

        let round_tripped = serde_json::to_value(&parsed.style).unwrap();
        assert!(round_tripped["boxShadow"].is_object());
        assert!(round_tripped["boxShadow"].get("inset").is_none());
    }

    #[test]
    fn box_shadow_accepts_an_array_and_round_trips_as_an_array() {
        let parsed = parse_style_value(&json!({
            "boxShadow": [
                { "offsetX": 0.0, "offsetY": 2.0, "blurRadius": 0.0, "spreadRadius": 0.0, "color": "#ff0000" },
                {
                    "offsetX": 0.0,
                    "offsetY": 0.0,
                    "blurRadius": 0.0,
                    "spreadRadius": 2.0,
                    "color": "#0000ff",
                    "inset": true,
                },
            ],
        }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        let Some(BoxShadowValue::Many(layers)) = &parsed.style.box_shadow else {
            panic!("expected an array of layers, got {:?}", parsed.style.box_shadow);
        };
        assert_eq!(layers.len(), 2);
        assert!(!layers[0].inset);
        assert!(layers[1].inset);

        let round_tripped = serde_json::to_value(&parsed.style).unwrap();
        let shadow = round_tripped["boxShadow"].as_array().expect("array shape");
        assert_eq!(shadow.len(), 2);
        assert!(shadow[0].get("inset").is_none(), "inset omitted when false");
        assert_eq!(shadow[1]["inset"], true);
    }

    #[test]
    fn box_shadow_empty_array_is_a_present_value_that_clears() {
        let parsed = parse_style_value(&json!({ "boxShadow": [] }));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert!(matches!(
            parsed.style.box_shadow,
            Some(BoxShadowValue::Many(ref layers)) if layers.is_empty()
        ));
    }

    #[test]
    fn box_shadow_rejects_the_whole_array_when_one_layer_is_invalid() {
        let parsed = parse_style_value(&json!({
            "boxShadow": [
                { "offsetX": 0.0, "offsetY": 2.0, "blurRadius": 0.0, "spreadRadius": 0.0, "color": "#ff0000" },
                { "offsetX": 0.0, "offsetY": 2.0, "blurRadius": 0.0, "spreadRadius": 0.0, "color": "not-a-color" },
            ],
        }));
        assert_eq!(parsed.style.box_shadow, None, "an invalid layer rejects the whole list");
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "boxShadow[1].color");
    }

    #[test]
    fn box_shadow_rejects_unknown_fields_in_a_layer() {
        let parsed = parse_style_value(&json!({
            "boxShadow": {
                "offsetX": 0.0,
                "offsetY": 4.0,
                "blurRadius": 12.0,
                "spreadRadius": 0.0,
                "color": "#00000033",
                "unknownField": true,
            },
        }));
        assert_eq!(parsed.style.box_shadow, None);
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "boxShadow");
    }

    #[test]
    fn box_shadow_indexes_the_invalid_layer_in_a_single_object_path() {
        let parsed = parse_style_value(&json!({
            "boxShadow": { "offsetX": 0.0, "offsetY": 4.0, "blurRadius": 12.0, "spreadRadius": 0.0, "color": "nope" },
        }));
        assert_eq!(parsed.style.box_shadow, None);
        assert_eq!(parsed.problems.len(), 1, "{:?}", parsed.problems);
        assert_eq!(parsed.problems[0].property, "boxShadow.color");
    }
}
