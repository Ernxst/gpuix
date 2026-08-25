use serde::{Deserialize, Deserializer, Serialize};

const MAX_LINEAR_GRADIENT_STOPS: usize = 8;

/// Font weight value — accepts both CSS strings ("bold", "700") and numbers (700).
/// JS style objects commonly use both `fontWeight: "bold"` and `fontWeight: 700`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FontWeightValue {
    Num(f64),
    Str(String),
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
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
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
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
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
    pub grid_template_columns: Option<f64>,
    pub grid_template_rows: Option<f64>,
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

    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub font_weight: Option<FontWeightValue>,
    pub letter_spacing: Option<f64>,
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

    pub hover: Option<Box<StyleDesc>>,
    pub active: Option<Box<StyleDesc>>,
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
        number_field!(key, value, "gridTemplateColumns", grid_template_columns);
        number_field!(key, value, "gridTemplateRows", grid_template_rows);
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

        enum_field!(key, value, "position", position, ["relative", "absolute"]);
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
        enum_field!(key, value, "cursor", cursor, ["default", "pointer"]);
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

        if key == "hover" || key == "active" {
            let property = if key == "hover" {
                property!("hover")
            } else {
                property!("active")
            };
            if !prefix.is_empty() {
                reject(
                    &mut parsed.problems,
                    property,
                    value,
                    "nested hover/active styles are not supported",
                );
            } else if key == "hover" {
                parsed.style.hover = parse_nested_style("hover", value, &mut parsed.problems);
            } else {
                parsed.style.active = parse_nested_style("active", value, &mut parsed.problems);
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
    reject_if!(
        grid_template_columns,
        "gridTemplateColumns",
        |value| value < 1.0 || value > 64.0 || value.fract() != 0.0,
        "expected an integer from 1 through 64"
    );
    reject_if!(
        grid_template_rows,
        "gridTemplateRows",
        |value| value < 1.0 || value > 64.0 || value.fract() != 0.0,
        "expected an integer from 1 through 64"
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

/// Whether this style should insert a mouse hitbox.
pub fn should_occlude(style: &StyleDesc) -> bool {
    match style.pointer_events.as_deref() {
        Some("none") => return false,
        Some("auto") => return true,
        _ => {}
    }
    if style.position.as_deref() == Some("absolute") {
        return true;
    }
    if let Some(color) = style.background_color.as_deref() {
        return crate::color::parse_color_rgba(color).is_none_or(|color| color.a > 0.0);
    }
    let Some(background) = style.background.as_ref() else {
        return false;
    };
    match parse_background(background) {
        Ok(background) => !background.is_transparent(),
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn with_fill(fill: &str) -> StyleDesc {
        StyleDesc {
            background_color: Some(fill.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn transparent_function_does_not_occlude() {
        assert!(!should_occlude(&with_fill("transparent")));
        assert!(!should_occlude(&with_fill("oklch(50% 0.2 30 / 0%)")));
    }

    #[test]
    fn invalid_fill_keeps_conservative_occlusion() {
        assert!(should_occlude(&with_fill("not-a-color")));
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
            "alignItems": "stretch",
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
            "fontSize": 16,
            "fontFamily": "Helvetica",
            "fontWeight": "bold",
            "letterSpacing": 1,
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
            "hover": { "color": "blue" },
            "active": { "color": "green" }
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
}
