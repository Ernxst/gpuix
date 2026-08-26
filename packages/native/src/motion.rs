//! Native motion tracks resolved during GPUI rendering, outside React.

use std::time::Duration;

use serde::Deserialize;
use web_time::Instant;

use crate::style::{
    DimensionValue, StyleDesc, StyleTransition, TransitionEasing, TransitionProperty,
};

#[derive(Clone, Debug, PartialEq)]
enum TransitionValue {
    Number(f64),
    Dimension(DimensionValue),
    Color([f32; 4]),
}

impl TransitionValue {
    fn from_style(style: &StyleDesc, property: TransitionProperty) -> Option<Self> {
        use TransitionProperty::*;

        let number = |value: Option<f64>| value.map(Self::Number);
        let dimension = |value: &Option<DimensionValue>| value.clone().map(Self::Dimension);
        let color = |value: &Option<String>| {
            value
                .as_deref()
                .and_then(crate::color::parse_color_rgba)
                .map(|color| Self::Color([color.r, color.g, color.b, color.a]))
        };

        match property {
            Opacity => number(style.opacity),
            BackgroundColor => color(&style.background_color),
            Color => color(&style.color),
            BorderColor => color(&style.border_color),
            OutlineColor => color(&style.outline_color),
            Width => dimension(&style.width),
            Height => dimension(&style.height),
            MinWidth => dimension(&style.min_width),
            MinHeight => dimension(&style.min_height),
            MaxWidth => dimension(&style.max_width),
            MaxHeight => dimension(&style.max_height),
            Top => number(style.top),
            Right => number(style.right),
            Bottom => number(style.bottom),
            Left => number(style.left),
            BorderRadius => number(style.border_radius),
            BorderTopLeftRadius => number(style.border_top_left_radius),
            BorderTopRightRadius => number(style.border_top_right_radius),
            BorderBottomLeftRadius => number(style.border_bottom_left_radius),
            BorderBottomRightRadius => number(style.border_bottom_right_radius),
        }
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        let number = |from: f64, to: f64| from + (to - from) * progress;
        match (self, target) {
            (Self::Number(from), Self::Number(to)) => Self::Number(number(*from, *to)),
            (
                Self::Dimension(DimensionValue::Pixels(from)),
                Self::Dimension(DimensionValue::Pixels(to)),
            ) => Self::Dimension(DimensionValue::Pixels(number(*from, *to))),
            (
                Self::Dimension(DimensionValue::Percentage(from)),
                Self::Dimension(DimensionValue::Percentage(to)),
            ) => Self::Dimension(DimensionValue::Percentage(number(*from, *to))),
            (Self::Color(from), Self::Color(to)) => Self::Color([
                from[0] + (to[0] - from[0]) * progress as f32,
                from[1] + (to[1] - from[1]) * progress as f32,
                from[2] + (to[2] - from[2]) * progress as f32,
                from[3] + (to[3] - from[3]) * progress as f32,
            ]),
            _ => target.clone(),
        }
    }

    fn apply_to(&self, style: &mut StyleDesc, property: TransitionProperty) {
        use TransitionProperty::*;

        let color = |channels: [f32; 4]| {
            format!(
                "rgba({} {} {} / {})",
                channels[0] * 255.0,
                channels[1] * 255.0,
                channels[2] * 255.0,
                channels[3]
            )
        };

        match (property, self) {
            (Opacity, Self::Number(value)) => style.opacity = Some(*value),
            (BackgroundColor, Self::Color(value)) => style.background_color = Some(color(*value)),
            (Color, Self::Color(value)) => style.color = Some(color(*value)),
            (BorderColor, Self::Color(value)) => style.border_color = Some(color(*value)),
            (OutlineColor, Self::Color(value)) => style.outline_color = Some(color(*value)),
            (Width, Self::Dimension(value)) => style.width = Some(value.clone()),
            (Height, Self::Dimension(value)) => style.height = Some(value.clone()),
            (MinWidth, Self::Dimension(value)) => style.min_width = Some(value.clone()),
            (MinHeight, Self::Dimension(value)) => style.min_height = Some(value.clone()),
            (MaxWidth, Self::Dimension(value)) => style.max_width = Some(value.clone()),
            (MaxHeight, Self::Dimension(value)) => style.max_height = Some(value.clone()),
            (Top, Self::Number(value)) => style.top = Some(*value),
            (Right, Self::Number(value)) => style.right = Some(*value),
            (Bottom, Self::Number(value)) => style.bottom = Some(*value),
            (Left, Self::Number(value)) => style.left = Some(*value),
            (BorderRadius, Self::Number(value)) => style.border_radius = Some(*value),
            (BorderTopLeftRadius, Self::Number(value)) => {
                style.border_top_left_radius = Some(*value)
            }
            (BorderTopRightRadius, Self::Number(value)) => {
                style.border_top_right_radius = Some(*value)
            }
            (BorderBottomLeftRadius, Self::Number(value)) => {
                style.border_bottom_left_radius = Some(*value)
            }
            (BorderBottomRightRadius, Self::Number(value)) => {
                style.border_bottom_right_radius = Some(*value)
            }
            _ => {}
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct TransitionValues(Vec<(TransitionProperty, Option<TransitionValue>)>);

impl TransitionValues {
    fn from_style(style: &StyleDesc, transition: &StyleTransition) -> Self {
        Self(
            transition
                .properties
                .iter()
                .copied()
                .map(|property| (property, TransitionValue::from_style(style, property)))
                .collect(),
        )
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        Self(
            target
                .0
                .iter()
                .map(|(property, target)| {
                    let from = self
                        .0
                        .iter()
                        .find(|(candidate, _)| candidate == property)
                        .and_then(|(_, value)| value.as_ref());
                    let value = match (from, target.as_ref()) {
                        (Some(from), Some(target)) => Some(from.interpolate(target, progress)),
                        (_, target) => target.cloned(),
                    };
                    (*property, value)
                })
                .collect(),
        )
    }

    fn apply_to(&self, style: &mut StyleDesc) {
        for (property, value) in &self.0 {
            if let Some(value) = value {
                value.apply_to(style, *property);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct StyleState {
    pub focused: bool,
    pub focus_visible: bool,
}

pub(crate) struct StyleTransitionFrame {
    pub style: StyleDesc,
    pub active: bool,
}

pub(crate) struct StyleTransitionState {
    from: TransitionValues,
    target: TransitionValues,
    target_style: StyleDesc,
    transition: StyleTransition,
    started: Instant,
    hovered: bool,
    active: bool,
}

impl StyleTransitionState {
    pub(crate) fn new(style: &StyleDesc, state: StyleState, now: Instant) -> Self {
        let target_style = resolve_transition_target(style, state, false, false);
        let transition = style
            .transition
            .clone()
            .expect("a transition state is created only for a declared transition");
        let target = TransitionValues::from_style(&target_style, &transition);
        Self {
            from: target.clone(),
            target,
            target_style,
            transition,
            started: now,
            hovered: false,
            active: false,
        }
    }

    pub(crate) fn sync(
        &mut self,
        style: &StyleDesc,
        state: StyleState,
        now: Instant,
        reduce_motion: bool,
    ) {
        let target_style = resolve_transition_target(style, state, self.hovered, self.active);
        let transition = style
            .transition
            .clone()
            .expect("a transition state is retained only for a declared transition");
        let target = TransitionValues::from_style(&target_style, &transition);

        if target != self.target || transition != self.transition {
            let visible = self.values(now);
            self.from = visible.interpolate(&target, 0.0);
            self.target = target;
            self.started = now;
        }
        self.target_style = target_style;
        self.transition = transition;
        if reduce_motion {
            self.from = self.target.clone();
        }
    }

    pub(crate) fn frame(&self, now: Instant, reduce_motion: bool) -> StyleTransitionFrame {
        if reduce_motion || self.from == self.target {
            return StyleTransitionFrame {
                style: self.target_style.clone(),
                active: false,
            };
        }

        let delay = milliseconds(self.transition.delay_ms);
        let duration = milliseconds(self.transition.duration_ms);
        let elapsed = now.saturating_duration_since(self.started);
        let raw = if elapsed < delay {
            0.0
        } else if duration.is_zero() {
            1.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        if raw >= 1.0 {
            return StyleTransitionFrame {
                style: self.target_style.clone(),
                active: false,
            };
        }

        let mut style = self.target_style.clone();
        self.from
            .interpolate(
                &self.target,
                transition_ease(raw.clamp(0.0, 1.0), &self.transition.easing),
            )
            .apply_to(&mut style);
        StyleTransitionFrame {
            style,
            active: true,
        }
    }

    pub(crate) fn set_hovered(&mut self, hovered: bool) -> bool {
        if self.hovered == hovered {
            return false;
        }
        self.hovered = hovered;
        true
    }

    pub(crate) fn set_active(&mut self, active: bool) -> bool {
        if self.active == active {
            return false;
        }
        self.active = active;
        true
    }

    fn values(&self, now: Instant) -> TransitionValues {
        let delay = milliseconds(self.transition.delay_ms);
        let duration = milliseconds(self.transition.duration_ms);
        let elapsed = now.saturating_duration_since(self.started);
        let raw = if elapsed < delay {
            0.0
        } else if duration.is_zero() {
            1.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        self.from.interpolate(
            &self.target,
            transition_ease(raw.clamp(0.0, 1.0), &self.transition.easing),
        )
    }
}

fn resolve_transition_target(
    style: &StyleDesc,
    state: StyleState,
    hovered: bool,
    active: bool,
) -> StyleDesc {
    let mut resolved = style.clone();
    let Some(transition) = style.transition.as_ref() else {
        return resolved;
    };

    for property in transition.properties.iter().copied() {
        if state.focused {
            refine_transition_property(&mut resolved, style.focus.as_deref(), property);
        }
        if state.focus_visible {
            refine_transition_property(&mut resolved, style.focus_visible.as_deref(), property);
        }
        if hovered {
            refine_transition_property(&mut resolved, style.hover.as_deref(), property);
        }
        if active {
            refine_transition_property(&mut resolved, style.active.as_deref(), property);
        }

        if let Some(refinement) = resolved.focus.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
        if let Some(refinement) = resolved.focus_visible.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
        if let Some(refinement) = resolved.hover.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
        if let Some(refinement) = resolved.active.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
    }
    resolved
}

fn refine_transition_property(
    style: &mut StyleDesc,
    refinement: Option<&StyleDesc>,
    property: TransitionProperty,
) {
    if let Some(value) = refinement.and_then(|style| TransitionValue::from_style(style, property)) {
        value.apply_to(style, property);
    }
}

fn clear_transition_property(style: &mut StyleDesc, property: TransitionProperty) {
    use TransitionProperty::*;
    match property {
        Opacity => style.opacity = None,
        BackgroundColor => style.background_color = None,
        Color => style.color = None,
        BorderColor => style.border_color = None,
        OutlineColor => style.outline_color = None,
        Width => style.width = None,
        Height => style.height = None,
        MinWidth => style.min_width = None,
        MinHeight => style.min_height = None,
        MaxWidth => style.max_width = None,
        MaxHeight => style.max_height = None,
        Top => style.top = None,
        Right => style.right = None,
        Bottom => style.bottom = None,
        Left => style.left = None,
        BorderRadius => style.border_radius = None,
        BorderTopLeftRadius => style.border_top_left_radius = None,
        BorderTopRightRadius => style.border_top_right_radius = None,
        BorderBottomLeftRadius => style.border_bottom_left_radius = None,
        BorderBottomRightRadius => style.border_bottom_right_radius = None,
    }
}

fn transition_ease(progress: f64, easing: &TransitionEasing) -> f64 {
    let curve = match easing {
        TransitionEasing::CubicBezier(curve) => *curve,
        TransitionEasing::Name(name) => match name.as_str() {
            "linear" => return progress,
            "easeIn" => [0.42, 0.0, 1.0, 1.0],
            "easeInOut" => [0.42, 0.0, 0.58, 1.0],
            "easeOut" => [0.0, 0.0, 0.58, 1.0],
            _ => [0.25, 0.1, 0.25, 1.0],
        },
    };
    cubic_bezier(progress, curve)
}

fn milliseconds(value: f64) -> Duration {
    Duration::try_from_secs_f64(value / 1000.0)
        .expect("style transition durations are validated when parsed")
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionStyle {
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub opacity: Option<f64>,
    pub top: Option<f64>,
    pub right: Option<f64>,
    pub bottom: Option<f64>,
    pub left: Option<f64>,
    pub border_radius: Option<f64>,
}

impl MotionStyle {
    fn interpolate(self, target: Self, progress: f64) -> Self {
        fn value(from: Option<f64>, to: Option<f64>, progress: f64) -> Option<f64> {
            to.map(|to| from.unwrap_or(to) + (to - from.unwrap_or(to)) * progress)
        }

        Self {
            width: value(self.width, target.width, progress),
            height: value(self.height, target.height, progress),
            opacity: value(self.opacity, target.opacity, progress),
            top: value(self.top, target.top, progress),
            right: value(self.right, target.right, progress),
            bottom: value(self.bottom, target.bottom, progress),
            left: value(self.left, target.left, progress),
            border_radius: value(self.border_radius, target.border_radius, progress),
        }
    }

    pub(crate) fn apply_to(self, style: &mut StyleDesc) {
        if let Some(value) = self.width {
            style.width = Some(DimensionValue::Pixels(value));
        }
        if let Some(value) = self.height {
            style.height = Some(DimensionValue::Pixels(value));
        }
        if let Some(value) = self.opacity {
            style.opacity = Some(value);
        }
        if let Some(value) = self.top {
            style.top = Some(value);
        }
        if let Some(value) = self.right {
            style.right = Some(value);
        }
        if let Some(value) = self.bottom {
            style.bottom = Some(value);
        }
        if let Some(value) = self.left {
            style.left = Some(value);
        }
        if let Some(value) = self.border_radius {
            style.border_radius = Some(value);
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionInitial {
    Disabled(bool),
    Style(MotionStyle),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionEase {
    Name(String),
    CubicBezier([f64; 4]),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionTransition {
    #[serde(default = "default_duration")]
    duration: f64,
    #[serde(default)]
    delay: f64,
    #[serde(default = "default_ease")]
    ease: MotionEase,
}

impl Default for MotionTransition {
    fn default() -> Self {
        Self {
            duration: default_duration(),
            delay: 0.0,
            ease: default_ease(),
        }
    }
}

fn default_duration() -> f64 {
    0.3
}

fn default_ease() -> MotionEase {
    MotionEase::Name("easeOut".to_string())
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct MotionDescription {
    #[serde(default)]
    initial: Option<MotionInitial>,
    animate: MotionStyle,
    #[serde(default)]
    transition: MotionTransition,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct MotionFrame {
    pub style: MotionStyle,
    pub active: bool,
}

pub(crate) struct MotionState {
    source: serde_json::Value,
    from: MotionStyle,
    target: MotionStyle,
    transition: MotionTransition,
    started: Instant,
    valid: bool,
}

impl MotionState {
    pub(crate) fn new(source: &serde_json::Value, now: Instant) -> Result<Self, String> {
        let description = parse_description(source)?;
        let from = match description.initial {
            Some(MotionInitial::Style(style)) => style,
            Some(MotionInitial::Disabled(false)) | None => description.animate,
            Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
        };

        Ok(Self {
            source: source.clone(),
            from,
            target: description.animate,
            transition: description.transition,
            started: now,
            valid: true,
        })
    }

    pub(crate) fn invalid(source: &serde_json::Value, now: Instant) -> Self {
        Self {
            source: source.clone(),
            from: MotionStyle::default(),
            target: MotionStyle::default(),
            transition: MotionTransition::default(),
            started: now,
            valid: false,
        }
    }

    pub(crate) fn is_valid(&self) -> bool {
        self.valid
    }

    pub(crate) fn sync(&mut self, source: &serde_json::Value, now: Instant) -> Result<(), String> {
        if self.source == *source {
            return Ok(());
        }

        let description = match parse_description(source) {
            Ok(description) => description,
            Err(error) => {
                self.source = source.clone();
                self.valid = false;
                return Err(error);
            }
        };
        self.from = if self.valid {
            self.frame(now).style
        } else {
            match description.initial {
                Some(MotionInitial::Style(style)) => style,
                Some(MotionInitial::Disabled(false)) | None => description.animate,
                Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
            }
        };
        self.target = description.animate;
        self.transition = description.transition;
        self.started = now;
        self.source = source.clone();
        self.valid = true;
        Ok(())
    }

    pub(crate) fn frame(&self, now: Instant) -> MotionFrame {
        let delay = seconds(self.transition.delay);
        let duration = seconds(self.transition.duration);
        let elapsed = now.saturating_duration_since(self.started);
        let raw = if elapsed <= delay {
            0.0
        } else if duration.is_zero() {
            1.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        let active = self.from != self.target && raw < 1.0;
        let progress = ease(raw.clamp(0.0, 1.0), &self.transition.ease);

        MotionFrame {
            style: self.from.interpolate(self.target, progress),
            active,
        }
    }
}

fn parse_description(source: &serde_json::Value) -> Result<MotionDescription, String> {
    let description: MotionDescription =
        serde_json::from_value(source.clone()).map_err(|error| error.to_string())?;

    if matches!(description.initial, Some(MotionInitial::Disabled(true))) {
        return Err("motion initial only accepts false or a style object".to_string());
    }
    validate_style(&description.animate)?;
    if let Some(MotionInitial::Style(initial)) = &description.initial {
        validate_style(initial)?;
    }
    validate_seconds(description.transition.duration, "duration")?;
    validate_seconds(description.transition.delay, "delay")?;
    validate_ease(&description.transition.ease)?;
    Ok(description)
}

fn validate_style(style: &MotionStyle) -> Result<(), String> {
    for (name, value) in [
        ("width", style.width),
        ("height", style.height),
        ("opacity", style.opacity),
        ("top", style.top),
        ("right", style.right),
        ("bottom", style.bottom),
        ("left", style.left),
        ("borderRadius", style.border_radius),
    ] {
        if value.is_some_and(|value| !value.is_finite() || value.abs() > f32::MAX as f64) {
            return Err(format!("motion {name} must fit a finite 32-bit float"));
        }
    }
    if style.width.is_some_and(|value| value < 0.0)
        || style.height.is_some_and(|value| value < 0.0)
        || style.border_radius.is_some_and(|value| value < 0.0)
    {
        return Err("motion sizes and borderRadius must be non-negative".to_string());
    }
    if style
        .opacity
        .is_some_and(|value| !(0.0..=1.0).contains(&value))
    {
        return Err("motion opacity must be between 0 and 1".to_string());
    }
    Ok(())
}

fn validate_seconds(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 || Duration::try_from_secs_f64(value).is_err() {
        return Err(format!(
            "motion {name} must be a supported finite non-negative number"
        ));
    }
    Ok(())
}

fn validate_ease(ease: &MotionEase) -> Result<(), String> {
    match ease {
        MotionEase::Name(name)
            if matches!(
                name.as_str(),
                "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut"
            ) => {}
        MotionEase::Name(name) => return Err(format!("unknown motion easing: {name}")),
        MotionEase::CubicBezier([x1, y1, x2, y2]) => {
            if ![x1, y1, x2, y2].iter().all(|value| value.is_finite())
                || !(0.0..=1.0).contains(x1)
                || !(0.0..=1.0).contains(x2)
            {
                return Err(
                    "motion cubic bezier values must be finite and x values must be 0..1"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

fn seconds(value: f64) -> Duration {
    Duration::try_from_secs_f64(value).expect("motion durations are validated when parsed")
}

fn ease(progress: f64, ease: &MotionEase) -> f64 {
    let curve = match ease {
        MotionEase::CubicBezier(curve) => *curve,
        MotionEase::Name(name) => match name.as_str() {
            "linear" => return progress,
            "easeIn" => [0.42, 0.0, 1.0, 1.0],
            "easeInOut" => [0.42, 0.0, 0.58, 1.0],
            "ease" => [0.25, 0.1, 0.25, 1.0],
            _ => [0.0, 0.0, 0.58, 1.0],
        },
    };
    cubic_bezier(progress, curve)
}

fn cubic_bezier(x: f64, [x1, y1, x2, y2]: [f64; 4]) -> f64 {
    fn sample(t: f64, a: f64, b: f64) -> f64 {
        let c = 3.0 * a;
        let b = 3.0 * (b - a) - c;
        let a = 1.0 - c - b;
        ((a * t + b) * t + c) * t
    }

    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..20 {
        let middle = (low + high) / 2.0;
        if sample(middle, x1, x2) < x {
            low = middle;
        } else {
            high = middle;
        }
    }
    sample((low + high) / 2.0, y1, y2).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(value: serde_json::Value) -> StyleDesc {
        let parsed = crate::style::parse_style_value(&value);
        assert_eq!(parsed.problems, []);
        parsed.style
    }

    #[test]
    fn style_transition_interpolates_state_refinements_and_retargets() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "opacity": 0.0,
            "backgroundColor": "#000000",
            "width": 100,
            "top": 0,
            "borderRadius": 0,
            "hover": {
                "opacity": 1.0,
                "backgroundColor": "#ffffff",
                "width": 200,
                "top": 20,
                "borderRadius": 16
            },
            "transition": {
                "properties": ["opacity", "backgroundColor", "width", "top", "borderRadius"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), started);
        assert!(state.set_hovered(true));
        state.sync(&style, StyleState::default(), started, false);

        let middle_at = started + Duration::from_millis(50);
        let middle = state.frame(middle_at, false);
        assert_eq!(middle.style.opacity, Some(0.5));
        assert_eq!(middle.style.width, Some(DimensionValue::Pixels(150.0)));
        assert_eq!(middle.style.top, Some(10.0));
        assert_eq!(middle.style.border_radius, Some(8.0));
        assert_eq!(
            TransitionValue::from_style(&middle.style, TransitionProperty::BackgroundColor),
            Some(TransitionValue::Color([0.5, 0.5, 0.5, 1.0]))
        );
        assert!(middle.active);

        assert!(state.set_hovered(false));
        state.sync(&style, StyleState::default(), middle_at, false);
        assert_eq!(state.frame(middle_at, false).style.opacity, Some(0.5));
        assert_eq!(
            state
                .frame(middle_at + Duration::from_millis(50), false)
                .style
                .opacity,
            Some(0.25)
        );
    }

    #[test]
    fn style_transition_uses_state_precedence_and_reduced_motion() {
        let now = Instant::now();
        let style = style(serde_json::json!({
            "opacity": 0.0,
            "focus": { "opacity": 0.2 },
            "focusVisible": { "opacity": 0.4 },
            "hover": { "opacity": 0.6 },
            "active": { "opacity": 1.0 },
            "transition": {
                "properties": ["opacity"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let focus = StyleState {
            focused: true,
            focus_visible: true,
        };
        let mut state = StyleTransitionState::new(&style, focus, now);
        assert_eq!(state.frame(now, false).style.opacity, Some(0.4));

        state.set_hovered(true);
        state.set_active(true);
        state.sync(&style, focus, now, true);
        let reduced = state.frame(now, true);
        assert_eq!(reduced.style.opacity, Some(1.0));
        assert!(!reduced.active);
    }

    #[test]
    fn style_transition_snaps_incompatible_dimensions() {
        let now = Instant::now();
        let style = style(serde_json::json!({
            "width": "auto",
            "hover": { "width": 200 },
            "transition": {
                "properties": ["width"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), now, false);

        assert_eq!(
            state
                .frame(now + Duration::from_millis(50), false)
                .style
                .width,
            Some(DimensionValue::Pixels(200.0))
        );
    }

    #[test]
    fn zero_duration_style_transition_finishes_on_the_retarget_frame() {
        let now = Instant::now();
        let style = style(serde_json::json!({
            "opacity": 0.0,
            "hover": { "opacity": 1.0 },
            "transition": { "properties": ["opacity"], "durationMs": 0 }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), now, false);

        let frame = state.frame(now, false);
        assert_eq!(frame.style.opacity, Some(1.0));
        assert!(!frame.active);
    }

    #[test]
    fn style_transition_holds_during_its_delay() {
        let now = Instant::now();
        let style = style(serde_json::json!({
            "opacity": 0.0,
            "hover": { "opacity": 1.0 },
            "transition": {
                "properties": ["opacity"],
                "durationMs": 100,
                "delayMs": 50,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), now, false);

        assert_eq!(
            state
                .frame(now + Duration::from_millis(49), false)
                .style
                .opacity,
            Some(0.0)
        );
        assert_eq!(
            state
                .frame(now + Duration::from_millis(100), false)
                .style
                .opacity,
            Some(0.5)
        );
    }

    #[test]
    fn interpolates_and_retargets_from_the_visible_value() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let middle = state.frame(started + Duration::from_millis(500));
        assert_eq!(middle.style.width, Some(50.0));
        assert!(middle.active);

        let reversed = serde_json::json!({
            "initial": false,
            "animate": { "width": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let reversed_at = started + Duration::from_millis(500);
        state.sync(&reversed, reversed_at).unwrap();
        assert_eq!(state.frame(reversed_at).style.width, Some(50.0));
        assert_eq!(
            state
                .frame(reversed_at + Duration::from_millis(500))
                .style
                .width,
            Some(25.0)
        );
    }

    #[test]
    fn disabled_initial_state_starts_at_the_target() {
        let now = Instant::now();
        let description = serde_json::json!({
            "initial": false,
            "animate": { "width": 260.0 },
            "transition": { "duration": 0.2 }
        });
        let frame = MotionState::new(&description, now).unwrap().frame(now);

        assert_eq!(frame.style.width, Some(260.0));
        assert!(!frame.active);
    }

    #[test]
    fn rejects_unsafe_numbers_and_invalid_initial_booleans() {
        let now = Instant::now();
        for description in [
            serde_json::json!({ "animate": { "width": 1e300 }, "transition": {} }),
            serde_json::json!({ "animate": { "opacity": 2.0 }, "transition": {} }),
            serde_json::json!({ "animate": {}, "transition": { "duration": 1e300 } }),
            serde_json::json!({ "initial": true, "animate": {}, "transition": {} }),
        ] {
            assert!(MotionState::new(&description, now).is_err());
        }
    }

    #[test]
    fn finishes_at_the_exact_target() {
        let started = Instant::now();
        let description = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 0.2, "ease": "linear" }
        });
        let state = MotionState::new(&description, started).unwrap();
        let frame = state.frame(started + Duration::from_millis(200));

        assert_eq!(frame.style.width, Some(100.0));
        assert!(!frame.active);
    }
}
