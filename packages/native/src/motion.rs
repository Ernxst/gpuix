//! Native motion tracks resolved during GPUI rendering, outside React.

use std::time::Duration;

use serde::Deserialize;
use web_time::Instant;

use crate::style::{
    DimensionValue, SpringEasing, StyleDesc, StyleTransition, TransitionEasing, TransitionProperty,
};

#[derive(Clone, Debug, PartialEq)]
enum TransitionValue {
    Number(f64),
    Dimension(DimensionValue),
    Color([f32; 4]),
}

#[derive(Clone, Debug, PartialEq)]
enum TransitionVelocity {
    Number(f64),
    Dimension(f64),
    Color([f64; 4]),
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
            (Self::Color(from), Self::Color(to)) => {
                let progress = progress as f32;
                let alpha = from[3] + (to[3] - from[3]) * progress;
                let mut color = [0.0; 4];
                for channel in 0..3 {
                    let from_premultiplied = from[channel] * from[3];
                    let to_premultiplied = to[channel] * to[3];
                    let premultiplied =
                        from_premultiplied + (to_premultiplied - from_premultiplied) * progress;
                    color[channel] = if alpha > f32::EPSILON {
                        premultiplied / alpha
                    } else {
                        // A fully transparent result has no visible RGB. Keep
                        // the destination channels so a later retarget does not
                        // revive arbitrary colour from the transparent source.
                        to[channel]
                    };
                }
                color[3] = alpha;
                Self::Color(color)
            }
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

    fn initial_spring_velocity_to(
        &self,
        target: &Self,
        velocity: f64,
    ) -> Option<TransitionVelocity> {
        match (self, target) {
            (Self::Number(from), Self::Number(to)) if from != to => {
                Some(TransitionVelocity::Number(velocity))
            }
            (
                Self::Dimension(DimensionValue::Pixels(from)),
                Self::Dimension(DimensionValue::Pixels(to)),
            )
            | (
                Self::Dimension(DimensionValue::Percentage(from)),
                Self::Dimension(DimensionValue::Percentage(to)),
            ) if from != to => Some(TransitionVelocity::Dimension(velocity)),
            (Self::Color(from), Self::Color(to)) if from != to => {
                Some(TransitionVelocity::Color([velocity; 4]))
            }
            _ => None,
        }
    }

    fn accepts_spring_velocity(&self, target: &Self, velocity: &TransitionVelocity) -> bool {
        matches!(
            (self, target, velocity),
            (
                Self::Number(_),
                Self::Number(_),
                TransitionVelocity::Number(_)
            ) | (
                Self::Dimension(DimensionValue::Pixels(_)),
                Self::Dimension(DimensionValue::Pixels(_)),
                TransitionVelocity::Dimension(_)
            ) | (
                Self::Dimension(DimensionValue::Percentage(_)),
                Self::Dimension(DimensionValue::Percentage(_)),
                TransitionVelocity::Dimension(_)
            ) | (Self::Color(_), Self::Color(_), TransitionVelocity::Color(_))
        )
    }

    fn spring_to(
        &self,
        target: &Self,
        velocity: Option<&TransitionVelocity>,
        elapsed: f64,
        spring: &SpringEasing,
        property: TransitionProperty,
    ) -> (Self, Option<TransitionVelocity>, bool) {
        match (self, target) {
            (Self::Number(from), Self::Number(to)) => {
                let velocity = match velocity {
                    Some(TransitionVelocity::Number(velocity)) => *velocity,
                    _ => 0.0,
                };
                let epsilon = if property == TransitionProperty::Opacity {
                    0.000_5
                } else {
                    0.05
                };
                let sample = sample_spring(*from, *to, velocity, elapsed, spring, epsilon);
                (
                    Self::Number(sample.position),
                    Some(TransitionVelocity::Number(sample.velocity)),
                    sample.active,
                )
            }
            (
                Self::Dimension(DimensionValue::Pixels(from)),
                Self::Dimension(DimensionValue::Pixels(to)),
            ) => {
                let velocity = match velocity {
                    Some(TransitionVelocity::Dimension(velocity)) => *velocity,
                    _ => 0.0,
                };
                let sample = sample_spring(*from, *to, velocity, elapsed, spring, 0.05);
                (
                    Self::Dimension(DimensionValue::Pixels(sample.position)),
                    Some(TransitionVelocity::Dimension(sample.velocity)),
                    sample.active,
                )
            }
            (
                Self::Dimension(DimensionValue::Percentage(from)),
                Self::Dimension(DimensionValue::Percentage(to)),
            ) => {
                let velocity = match velocity {
                    Some(TransitionVelocity::Dimension(velocity)) => *velocity,
                    _ => 0.0,
                };
                let sample = sample_spring(*from, *to, velocity, elapsed, spring, 0.000_5);
                (
                    Self::Dimension(DimensionValue::Percentage(sample.position)),
                    Some(TransitionVelocity::Dimension(sample.velocity)),
                    sample.active,
                )
            }
            (Self::Color(from), Self::Color(to)) => {
                let from = premultiply(*from);
                let to = premultiply(*to);
                let velocity = match velocity {
                    Some(TransitionVelocity::Color(velocity)) => *velocity,
                    _ => [0.0; 4],
                };
                let mut sampled = [0.0; 4];
                let mut sampled_velocity = [0.0; 4];
                let mut active = false;
                for channel in 0..4 {
                    let sample = sample_spring(
                        from[channel],
                        to[channel],
                        velocity[channel],
                        elapsed,
                        spring,
                        0.000_5,
                    );
                    sampled[channel] = sample.position;
                    sampled_velocity[channel] = sample.velocity;
                    active |= sample.active;
                }
                (
                    Self::Color(unpremultiply(sampled, to)),
                    Some(TransitionVelocity::Color(sampled_velocity)),
                    active,
                )
            }
            _ => (target.clone(), None, false),
        }
    }
}

fn premultiply(color: [f32; 4]) -> [f64; 4] {
    let alpha = f64::from(color[3]);
    [
        f64::from(color[0]) * alpha,
        f64::from(color[1]) * alpha,
        f64::from(color[2]) * alpha,
        alpha,
    ]
}

fn unpremultiply(color: [f64; 4], target: [f64; 4]) -> [f32; 4] {
    let alpha = color[3];
    let channel = |index: usize| {
        if alpha.abs() > f64::from(f32::EPSILON) {
            (color[index] / alpha) as f32
        } else if target[3].abs() > f64::from(f32::EPSILON) {
            (target[index] / target[3]) as f32
        } else {
            0.0
        }
    };
    [channel(0), channel(1), channel(2), alpha as f32]
}

#[derive(Clone, Debug, PartialEq)]
struct TransitionValues(Vec<(TransitionProperty, Option<TransitionValue>)>);

#[derive(Clone, Debug, Default, PartialEq)]
struct TransitionVelocities(Vec<(TransitionProperty, Option<TransitionVelocity>)>);

impl TransitionValues {
    fn from_style(style: &StyleDesc, transition: &StyleTransition) -> Self {
        let properties = canonical_transition_properties(transition);
        let canonical_style = properties
            .iter()
            .any(|property| is_corner_radius(*property))
            .then(|| {
                let mut style = style.clone();
                canonicalize_base_radii(&mut style);
                style
            });
        let style = canonical_style.as_ref().unwrap_or(style);
        Self(
            properties
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

    fn spring_velocities(
        &self,
        target: &Self,
        previous: &TransitionVelocities,
        carry_previous: bool,
        initial_velocity: f64,
    ) -> TransitionVelocities {
        TransitionVelocities(
            target
                .0
                .iter()
                .map(|(property, target)| {
                    let from = self
                        .0
                        .iter()
                        .find(|(candidate, _)| candidate == property)
                        .and_then(|(_, value)| value.as_ref());
                    let target = target.as_ref();
                    let carried = carry_previous
                        .then(|| previous.get(*property))
                        .flatten()
                        .filter(|velocity| {
                            from.zip(target).is_some_and(|(from, target)| {
                                from.accepts_spring_velocity(target, velocity)
                            })
                        })
                        .cloned();
                    let velocity = carried.or_else(|| {
                        from.zip(target).and_then(|(from, target)| {
                            from.initial_spring_velocity_to(target, initial_velocity)
                        })
                    });
                    (*property, velocity)
                })
                .collect(),
        )
    }

    fn spring_sample(
        &self,
        target: &Self,
        velocities: &TransitionVelocities,
        elapsed: f64,
        spring: &SpringEasing,
    ) -> (Self, TransitionVelocities, bool) {
        let mut active = false;
        let mut sampled_velocities = Vec::with_capacity(target.0.len());
        let values = target
            .0
            .iter()
            .map(|(property, target)| {
                let from = self
                    .0
                    .iter()
                    .find(|(candidate, _)| candidate == property)
                    .and_then(|(_, value)| value.as_ref());
                let velocity = velocities.get(*property);
                let (value, velocity, value_active) = match (from, target.as_ref()) {
                    (Some(from), Some(target)) => {
                        let (value, velocity, active) =
                            from.spring_to(target, velocity, elapsed, spring, *property);
                        (Some(value), velocity, active)
                    }
                    (_, target) => (target.cloned(), None, false),
                };
                active |= value_active;
                sampled_velocities.push((*property, velocity));
                (*property, value)
            })
            .collect();
        (
            Self(values),
            TransitionVelocities(sampled_velocities),
            active,
        )
    }
}

impl TransitionVelocities {
    fn get(&self, property: TransitionProperty) -> Option<&TransitionVelocity> {
        self.0
            .iter()
            .find(|(candidate, _)| *candidate == property)
            .and_then(|(_, velocity)| velocity.as_ref())
    }

    fn is_zero(&self) -> bool {
        self.0.iter().all(|(_, velocity)| match velocity {
            None => true,
            Some(TransitionVelocity::Number(value))
            | Some(TransitionVelocity::Dimension(value)) => *value == 0.0,
            Some(TransitionVelocity::Color(values)) => values.iter().all(|value| *value == 0.0),
        })
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
    velocities: TransitionVelocities,
    target_style: StyleDesc,
    transition: StyleTransition,
    started: Instant,
    hovered: bool,
    active: bool,
}

impl StyleTransitionState {
    pub(crate) fn new(
        style: &StyleDesc,
        state: StyleState,
        hover_within: bool,
        now: Instant,
    ) -> Self {
        let target_style = resolve_transition_target(style, state, hover_within, false, false);
        let transition = style
            .transition
            .clone()
            .expect("a transition state is created only for a declared transition");
        let target = TransitionValues::from_style(&target_style, &transition);
        Self {
            from: target.clone(),
            target,
            velocities: TransitionVelocities::default(),
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
        hover_within: bool,
        now: Instant,
        reduce_motion: bool,
    ) {
        let target_style =
            resolve_transition_target(style, state, hover_within, self.hovered, self.active);
        let transition = style
            .transition
            .clone()
            .expect("a transition state is retained only for a declared transition");
        let target = TransitionValues::from_style(&target_style, &transition);

        if target != self.target || transition != self.transition {
            // Resolve the whole painted style before adopting the new property
            // list. A property added to that list must start at the value it
            // was already painting, not at its new target.
            let (visible_frame, previous_velocities) = self.frame_with_velocities(now, false);
            let carry_velocity = matches!(self.transition.easing, TransitionEasing::Spring(_))
                && visible_frame.active;
            let visible_style = visible_frame.style;
            let visible_style = resolve_transition_properties(
                &visible_style,
                state,
                hover_within,
                self.hovered,
                self.active,
                &transition,
            );
            let visible = TransitionValues::from_style(&visible_style, &transition);
            self.from = visible.interpolate(&target, 0.0);
            self.velocities = match &transition.easing {
                TransitionEasing::Spring(spring) => self.from.spring_velocities(
                    &target,
                    &previous_velocities,
                    carry_velocity,
                    spring.velocity,
                ),
                _ => TransitionVelocities::default(),
            };
            self.target = target;
            self.started = now;
        }
        self.target_style = target_style;
        self.transition = transition;
        if reduce_motion {
            self.from = self.target.clone();
            self.velocities = TransitionVelocities::default();
        }
    }

    pub(crate) fn frame(&self, now: Instant, reduce_motion: bool) -> StyleTransitionFrame {
        self.frame_with_velocities(now, reduce_motion).0
    }

    fn frame_with_velocities(
        &self,
        now: Instant,
        reduce_motion: bool,
    ) -> (StyleTransitionFrame, TransitionVelocities) {
        if reduce_motion || (self.from == self.target && self.velocities.is_zero()) {
            return (
                StyleTransitionFrame {
                    style: self.target_style.clone(),
                    active: false,
                },
                TransitionVelocities::default(),
            );
        }

        let delay = milliseconds(self.transition.delay_ms);
        let elapsed = now.saturating_duration_since(self.started);
        if let TransitionEasing::Spring(spring) = &self.transition.easing {
            let spring_elapsed = elapsed
                .checked_sub(delay)
                .unwrap_or(Duration::ZERO)
                .as_secs_f64();
            let (values, velocities, active) =
                self.from
                    .spring_sample(&self.target, &self.velocities, spring_elapsed, spring);
            if !active {
                return (
                    StyleTransitionFrame {
                        style: self.target_style.clone(),
                        active: false,
                    },
                    velocities,
                );
            }
            let mut style = self.target_style.clone();
            values.apply_to(&mut style);
            return (
                StyleTransitionFrame {
                    style,
                    active: true,
                },
                velocities,
            );
        }

        let duration = milliseconds(self.transition.duration_ms);
        let raw = if elapsed < delay {
            0.0
        } else if duration.is_zero() {
            1.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        if raw >= 1.0 {
            return (
                StyleTransitionFrame {
                    style: self.target_style.clone(),
                    active: false,
                },
                TransitionVelocities::default(),
            );
        }

        let mut style = self.target_style.clone();
        self.from
            .interpolate(
                &self.target,
                transition_ease(raw.clamp(0.0, 1.0), &self.transition.easing),
            )
            .apply_to(&mut style);
        (
            StyleTransitionFrame {
                style,
                active: true,
            },
            TransitionVelocities::default(),
        )
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
}

const CORNER_RADIUS_PROPERTIES: [TransitionProperty; 4] = [
    TransitionProperty::BorderTopLeftRadius,
    TransitionProperty::BorderTopRightRadius,
    TransitionProperty::BorderBottomLeftRadius,
    TransitionProperty::BorderBottomRightRadius,
];

fn is_corner_radius(property: TransitionProperty) -> bool {
    CORNER_RADIUS_PROPERTIES.contains(&property)
}

fn canonical_transition_properties(transition: &StyleTransition) -> Vec<TransitionProperty> {
    let mut properties = Vec::with_capacity(transition.properties.len() + 3);
    for property in transition.properties.iter().copied() {
        let expanded: &[TransitionProperty] = if property == TransitionProperty::BorderRadius {
            &CORNER_RADIUS_PROPERTIES
        } else {
            std::slice::from_ref(&property)
        };
        for property in expanded.iter().copied() {
            if !properties.contains(&property) {
                properties.push(property);
            }
        }
    }
    properties
}

/// Resolve the shorthand/longhand cascade into the four values GPUI paints.
/// Missing base corners are GPUI's zero-radius default; missing refinement
/// corners remain absent because a refinement only overrides what it declares.
fn canonicalize_base_radii(style: &mut StyleDesc) {
    let shorthand = style.border_radius.take().unwrap_or(0.0);
    style.border_top_left_radius = Some(style.border_top_left_radius.unwrap_or(shorthand));
    style.border_top_right_radius = Some(style.border_top_right_radius.unwrap_or(shorthand));
    style.border_bottom_left_radius = Some(style.border_bottom_left_radius.unwrap_or(shorthand));
    style.border_bottom_right_radius = Some(style.border_bottom_right_radius.unwrap_or(shorthand));
}

fn canonicalize_refinement_radii(style: &mut StyleDesc) {
    let Some(shorthand) = style.border_radius.take() else {
        return;
    };
    style.border_top_left_radius.get_or_insert(shorthand);
    style.border_top_right_radius.get_or_insert(shorthand);
    style.border_bottom_left_radius.get_or_insert(shorthand);
    style.border_bottom_right_radius.get_or_insert(shorthand);
}

fn canonicalize_transition_radii(style: &mut StyleDesc) {
    canonicalize_base_radii(style);
    if let Some(refinement) = style.focus.as_deref_mut() {
        canonicalize_refinement_radii(refinement);
    }
    if let Some(refinement) = style.focus_visible.as_deref_mut() {
        canonicalize_refinement_radii(refinement);
    }
    if let Some(refinement) = style.hover.as_deref_mut() {
        canonicalize_refinement_radii(refinement);
    }
    if let Some(refinement) = style.hover_within.as_deref_mut() {
        canonicalize_refinement_radii(refinement);
    }
    if let Some(refinement) = style.active.as_deref_mut() {
        canonicalize_refinement_radii(refinement);
    }
}

fn resolve_transition_target(
    style: &StyleDesc,
    state: StyleState,
    hover_within: bool,
    hovered: bool,
    active: bool,
) -> StyleDesc {
    let Some(transition) = style.transition.as_ref() else {
        return style.clone();
    };
    resolve_transition_properties(style, state, hover_within, hovered, active, transition)
}

fn resolve_transition_properties(
    style: &StyleDesc,
    state: StyleState,
    hover_within: bool,
    hovered: bool,
    active: bool,
    transition: &StyleTransition,
) -> StyleDesc {
    let properties = canonical_transition_properties(transition);
    let mut declared = style.clone();
    if properties
        .iter()
        .any(|property| is_corner_radius(*property))
    {
        canonicalize_transition_radii(&mut declared);
    }
    let mut resolved = declared.clone();

    for property in properties {
        if state.focused {
            refine_transition_property(&mut resolved, declared.focus.as_deref(), property);
        }
        if state.focus_visible {
            refine_transition_property(&mut resolved, declared.focus_visible.as_deref(), property);
        }
        if hover_within {
            refine_transition_property(&mut resolved, declared.hover_within.as_deref(), property);
        }
        if hovered {
            refine_transition_property(&mut resolved, declared.hover.as_deref(), property);
        }
        if active {
            refine_transition_property(&mut resolved, declared.active.as_deref(), property);
        }

        if let Some(refinement) = resolved.focus.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
        if let Some(refinement) = resolved.focus_visible.as_deref_mut() {
            clear_transition_property(refinement, property);
        }
        if let Some(refinement) = resolved.hover_within.as_deref_mut() {
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
        TransitionEasing::Spring(_) => {
            unreachable!("spring easings are sampled by the native spring track")
        }
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

#[derive(Clone, Copy, Debug)]
struct SpringSample {
    position: f64,
    velocity: f64,
    active: bool,
}

fn sample_spring(
    from: f64,
    target: f64,
    velocity: f64,
    elapsed: f64,
    spring: &SpringEasing,
    epsilon: f64,
) -> SpringSample {
    let displacement = from - target;
    let natural_frequency = (spring.stiffness / spring.mass).sqrt();
    let damping_ratio = spring.damping / (2.0 * (spring.stiffness * spring.mass).sqrt());
    let (offset, velocity) = if damping_ratio < 1.0 - 1e-7 {
        let damped_frequency = natural_frequency * (1.0 - damping_ratio.powi(2)).sqrt();
        let decay = (-damping_ratio * natural_frequency * elapsed).exp();
        let a = displacement;
        let b = (velocity + damping_ratio * natural_frequency * displacement) / damped_frequency;
        let sin = (damped_frequency * elapsed).sin();
        let cos = (damped_frequency * elapsed).cos();
        let wave = a * cos + b * sin;
        let wave_velocity = -a * damped_frequency * sin + b * damped_frequency * cos;
        (
            decay * wave,
            decay * (wave_velocity - damping_ratio * natural_frequency * wave),
        )
    } else if damping_ratio <= 1.0 + 1e-7 {
        let decay = (-natural_frequency * elapsed).exp();
        let a = displacement;
        let b = velocity + natural_frequency * displacement;
        let wave = a + b * elapsed;
        (decay * wave, decay * (b - natural_frequency * wave))
    } else {
        let root = (damping_ratio.powi(2) - 1.0).sqrt();
        let slow = -natural_frequency * (damping_ratio - root);
        let fast = -natural_frequency * (damping_ratio + root);
        let slow_amplitude = (velocity - fast * displacement) / (slow - fast);
        let fast_amplitude = displacement - slow_amplitude;
        let slow_wave = slow_amplitude * (slow * elapsed).exp();
        let fast_wave = fast_amplitude * (fast * elapsed).exp();
        (slow_wave + fast_wave, slow * slow_wave + fast * fast_wave)
    };
    let active = offset.abs() > epsilon || velocity.abs() > epsilon;
    SpringSample {
        position: if active { target + offset } else { target },
        velocity: if active { velocity } else { 0.0 },
        active,
    }
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

    fn spring_sample(
        self,
        target: Self,
        velocities: MotionVelocity,
        elapsed: f64,
        spring: &SpringEasing,
    ) -> (Self, MotionVelocity, bool) {
        let mut active = false;
        let mut channel =
            |from: Option<f64>, target: Option<f64>, velocity: Option<f64>, epsilon: f64| {
                let Some(target) = target else {
                    return (None, None);
                };
                let sample = sample_spring(
                    from.unwrap_or(target),
                    target,
                    velocity.unwrap_or(0.0),
                    elapsed,
                    spring,
                    epsilon,
                );
                active |= sample.active;
                (Some(sample.position), Some(sample.velocity))
            };
        let (width, width_velocity) = channel(self.width, target.width, velocities.width, 0.05);
        let (height, height_velocity) =
            channel(self.height, target.height, velocities.height, 0.05);
        let (opacity, opacity_velocity) =
            channel(self.opacity, target.opacity, velocities.opacity, 0.000_5);
        let (top, top_velocity) = channel(self.top, target.top, velocities.top, 0.05);
        let (right, right_velocity) = channel(self.right, target.right, velocities.right, 0.05);
        let (bottom, bottom_velocity) =
            channel(self.bottom, target.bottom, velocities.bottom, 0.05);
        let (left, left_velocity) = channel(self.left, target.left, velocities.left, 0.05);
        let (border_radius, border_radius_velocity) = channel(
            self.border_radius,
            target.border_radius,
            velocities.border_radius,
            0.05,
        );
        (
            Self {
                width,
                height,
                opacity,
                top,
                right,
                bottom,
                left,
                border_radius,
            },
            MotionVelocity {
                width: width_velocity,
                height: height_velocity,
                opacity: opacity_velocity,
                top: top_velocity,
                right: right_velocity,
                bottom: bottom_velocity,
                left: left_velocity,
                border_radius: border_radius_velocity,
            },
            active,
        )
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct MotionVelocity {
    width: Option<f64>,
    height: Option<f64>,
    opacity: Option<f64>,
    top: Option<f64>,
    right: Option<f64>,
    bottom: Option<f64>,
    left: Option<f64>,
    border_radius: Option<f64>,
}

impl MotionVelocity {
    fn retarget(
        from: MotionStyle,
        target: MotionStyle,
        previous: Self,
        carry_previous: bool,
        initial_velocity: f64,
    ) -> Self {
        let channel = |from: Option<f64>, target: Option<f64>, previous: Option<f64>| {
            target.and_then(|target| {
                let from = from.unwrap_or(target);
                if carry_previous && previous.is_some() {
                    previous
                } else if from != target {
                    Some(initial_velocity)
                } else {
                    None
                }
            })
        };
        Self {
            width: channel(from.width, target.width, previous.width),
            height: channel(from.height, target.height, previous.height),
            opacity: channel(from.opacity, target.opacity, previous.opacity),
            top: channel(from.top, target.top, previous.top),
            right: channel(from.right, target.right, previous.right),
            bottom: channel(from.bottom, target.bottom, previous.bottom),
            left: channel(from.left, target.left, previous.left),
            border_radius: channel(
                from.border_radius,
                target.border_radius,
                previous.border_radius,
            ),
        }
    }

    fn is_zero(self) -> bool {
        [
            self.width,
            self.height,
            self.opacity,
            self.top,
            self.right,
            self.bottom,
            self.left,
            self.border_radius,
        ]
        .into_iter()
        .all(|velocity| velocity.is_none_or(|velocity| velocity == 0.0))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionInitial {
    Disabled(bool),
    Style(MotionStyle),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionTransition {
    #[serde(default = "default_duration")]
    duration: f64,
    #[serde(default)]
    delay: f64,
    #[serde(default = "default_ease")]
    ease: TransitionEasing,
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

fn default_ease() -> TransitionEasing {
    TransitionEasing::Name("easeOut".to_string())
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
    velocity: MotionVelocity,
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
        let velocity = match &description.transition.ease {
            TransitionEasing::Spring(spring) => MotionVelocity::retarget(
                from,
                description.animate,
                MotionVelocity::default(),
                false,
                spring.velocity,
            ),
            _ => MotionVelocity::default(),
        };

        Ok(Self {
            source: source.clone(),
            from,
            target: description.animate,
            velocity,
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
            velocity: MotionVelocity::default(),
            transition: MotionTransition::default(),
            started: now,
            valid: false,
        }
    }

    pub(crate) fn is_valid(&self) -> bool {
        self.valid
    }

    pub(crate) fn sync(
        &mut self,
        source: &serde_json::Value,
        now: Instant,
        reduce_motion: bool,
    ) -> Result<(), String> {
        if self.source == *source {
            if reduce_motion {
                self.from = self.target;
                self.velocity = MotionVelocity::default();
            }
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
        let previous_was_spring = matches!(self.transition.ease, TransitionEasing::Spring(_));
        let (previous_frame, previous_velocity) = if self.valid {
            self.frame_with_velocity(now, reduce_motion)
        } else {
            (
                MotionFrame {
                    style: match description.initial {
                        Some(MotionInitial::Style(style)) => style,
                        Some(MotionInitial::Disabled(false)) | None => description.animate,
                        Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
                    },
                    active: false,
                },
                MotionVelocity::default(),
            )
        };
        self.from = previous_frame.style;
        self.target = description.animate;
        self.velocity = match &description.transition.ease {
            TransitionEasing::Spring(spring) => MotionVelocity::retarget(
                self.from,
                self.target,
                previous_velocity,
                previous_was_spring && previous_frame.active,
                spring.velocity,
            ),
            _ => MotionVelocity::default(),
        };
        self.transition = description.transition;
        self.started = now;
        self.source = source.clone();
        self.valid = true;
        if reduce_motion {
            self.from = self.target;
            self.velocity = MotionVelocity::default();
        }
        Ok(())
    }

    pub(crate) fn frame(&self, now: Instant, reduce_motion: bool) -> MotionFrame {
        self.frame_with_velocity(now, reduce_motion).0
    }

    fn frame_with_velocity(
        &self,
        now: Instant,
        reduce_motion: bool,
    ) -> (MotionFrame, MotionVelocity) {
        if reduce_motion {
            return (
                MotionFrame {
                    style: self.target,
                    active: false,
                },
                MotionVelocity::default(),
            );
        }

        let delay = seconds(self.transition.delay);
        let elapsed = now.saturating_duration_since(self.started);
        if let TransitionEasing::Spring(spring) = &self.transition.ease {
            if self.from == self.target && self.velocity.is_zero() {
                return (
                    MotionFrame {
                        style: self.target,
                        active: false,
                    },
                    MotionVelocity::default(),
                );
            }
            let spring_elapsed = elapsed
                .checked_sub(delay)
                .unwrap_or(Duration::ZERO)
                .as_secs_f64();
            let (style, velocity, active) =
                self.from
                    .spring_sample(self.target, self.velocity, spring_elapsed, spring);
            return (MotionFrame { style, active }, velocity);
        }

        let duration = seconds(self.transition.duration);
        let raw = if elapsed <= delay {
            0.0
        } else if duration.is_zero() {
            1.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        let active = self.from != self.target && raw < 1.0;
        let progress = transition_ease(raw.clamp(0.0, 1.0), &self.transition.ease);

        (
            MotionFrame {
                style: self.from.interpolate(self.target, progress),
                active,
            },
            MotionVelocity::default(),
        )
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
    validate_seconds(description.transition.delay, "delay")?;
    validate_ease(&description.transition.ease)?;
    if !matches!(description.transition.ease, TransitionEasing::Spring(_)) {
        validate_seconds(description.transition.duration, "duration")?;
    }
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

fn validate_ease(ease: &TransitionEasing) -> Result<(), String> {
    match ease {
        TransitionEasing::Name(name)
            if matches!(
                name.as_str(),
                "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut"
            ) => {}
        TransitionEasing::Name(name) => return Err(format!("unknown motion easing: {name}")),
        TransitionEasing::CubicBezier([x1, y1, x2, y2]) => {
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
        TransitionEasing::Spring(spring) if spring.is_valid() => {}
        TransitionEasing::Spring(_) => {
            return Err(
                "motion spring stiffness, damping, and mass must be positive finite 32-bit numbers and velocity must be finite"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn seconds(value: f64) -> Duration {
    Duration::try_from_secs_f64(value).expect("motion durations are validated when parsed")
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
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, started);
        assert!(state.set_hovered(true));
        state.sync(&style, StyleState::default(), false, started, false);

        let middle_at = started + Duration::from_millis(50);
        let middle = state.frame(middle_at, false);
        assert_eq!(middle.style.opacity, Some(0.5));
        assert_eq!(middle.style.width, Some(DimensionValue::Pixels(150.0)));
        assert_eq!(middle.style.top, Some(10.0));
        assert_eq!(middle.style.border_radius, None);
        assert_eq!(middle.style.border_top_left_radius, Some(8.0));
        assert_eq!(middle.style.border_top_right_radius, Some(8.0));
        assert_eq!(
            TransitionValue::from_style(&middle.style, TransitionProperty::BackgroundColor),
            Some(TransitionValue::Color([0.5, 0.5, 0.5, 1.0]))
        );
        assert!(middle.active);

        assert!(state.set_hovered(false));
        state.sync(&style, StyleState::default(), false, middle_at, false);
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
            "hoverWithin": { "opacity": 0.5 },
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
        let mut state = StyleTransitionState::new(&style, focus, true, now);
        assert_eq!(state.frame(now, false).style.opacity, Some(0.5));

        state.set_hovered(true);
        state.set_active(true);
        state.sync(&style, focus, true, now, true);
        let reduced = state.frame(now, true);
        assert_eq!(reduced.style.opacity, Some(1.0));
        assert!(!reduced.active);
    }

    #[test]
    fn hover_within_transition_refines_at_the_shared_precedence_and_clears_the_track() {
        let style = style(serde_json::json!({
            "opacity": 0.0,
            "focus": { "opacity": 0.2 },
            "focusVisible": { "opacity": 0.4 },
            "hoverWithin": { "opacity": 0.5 },
            "hover": { "opacity": 0.6 },
            "active": { "opacity": 1.0 },
            "transition": {
                "properties": ["opacity"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let transition = style.transition.as_ref().unwrap();
        let focus = StyleState {
            focused: true,
            focus_visible: true,
        };

        let hover_within =
            resolve_transition_properties(&style, focus, true, false, false, transition);
        assert_eq!(hover_within.opacity, Some(0.5));
        assert_eq!(
            hover_within
                .hover_within
                .as_deref()
                .and_then(|style| style.opacity),
            None
        );

        let hovered = resolve_transition_properties(&style, focus, true, true, false, transition);
        assert_eq!(hovered.opacity, Some(0.6));
        let active = resolve_transition_properties(&style, focus, true, true, true, transition);
        assert_eq!(active.opacity, Some(1.0));
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
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, now, false);

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
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, now, false);

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
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, now);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, now, false);

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
    fn style_transition_canonicalizes_radius_shorthand_and_longhands_both_ways() {
        let started = Instant::now();
        let shorthand_target = style(serde_json::json!({
            "borderTopLeftRadius": 10,
            "hover": { "borderRadius": 20 },
            "transition": {
                "properties": ["borderRadius"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state =
            StyleTransitionState::new(&shorthand_target, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(
            &shorthand_target,
            StyleState::default(),
            false,
            started,
            false,
        );
        let midpoint = state.frame(started + Duration::from_millis(50), false);
        assert_eq!(midpoint.style.border_radius, None);
        assert_eq!(midpoint.style.border_top_left_radius, Some(15.0));
        assert_eq!(midpoint.style.border_top_right_radius, Some(10.0));
        assert_eq!(midpoint.style.border_bottom_left_radius, Some(10.0));
        assert_eq!(midpoint.style.border_bottom_right_radius, Some(10.0));

        let longhand_target = style(serde_json::json!({
            "borderRadius": 10,
            "hover": { "borderTopLeftRadius": 20 },
            "transition": {
                "properties": ["borderTopLeftRadius"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state =
            StyleTransitionState::new(&longhand_target, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(
            &longhand_target,
            StyleState::default(),
            false,
            started,
            false,
        );
        let midpoint = state.frame(started + Duration::from_millis(50), false);
        assert_eq!(midpoint.style.border_radius, None);
        assert_eq!(midpoint.style.border_top_left_radius, Some(15.0));
        assert_eq!(midpoint.style.border_top_right_radius, Some(10.0));
        assert_eq!(midpoint.style.border_bottom_left_radius, Some(10.0));
        assert_eq!(midpoint.style.border_bottom_right_radius, Some(10.0));
    }

    #[test]
    fn adding_a_transition_property_starts_from_its_painted_value() {
        let started = Instant::now();
        let initial = style(serde_json::json!({
            "opacity": 0,
            "width": 100,
            "hover": { "opacity": 1, "width": 150 },
            "transition": {
                "properties": ["opacity"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&initial, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(&initial, StyleState::default(), false, started, false);

        let retargeted_at = started + Duration::from_millis(50);
        let second_target = style(serde_json::json!({
            "opacity": 0,
            "width": 100,
            "hover": { "opacity": 1, "width": 250 },
            "transition": {
                "properties": ["opacity", "width"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        state.sync(
            &second_target,
            StyleState::default(),
            false,
            retargeted_at,
            false,
        );

        assert_eq!(
            state.frame(retargeted_at, false).style.width,
            Some(DimensionValue::Pixels(150.0))
        );
        assert_eq!(
            state
                .frame(retargeted_at + Duration::from_millis(50), false)
                .style
                .width,
            Some(DimensionValue::Pixels(200.0))
        );
    }

    #[test]
    fn transparent_to_white_uses_a_premultiplied_alpha_midpoint() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "backgroundColor": "transparent",
            "hover": { "backgroundColor": "#ffffff" },
            "transition": {
                "properties": ["backgroundColor"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, started, false);

        let midpoint = state.frame(started + Duration::from_millis(50), false);
        assert_eq!(
            TransitionValue::from_style(&midpoint.style, TransitionProperty::BackgroundColor),
            Some(TransitionValue::Color([1.0, 1.0, 1.0, 0.5]))
        );
    }

    #[test]
    fn style_spring_retarget_carries_the_visible_velocity() {
        let started = Instant::now();
        let initial = style(serde_json::json!({
            "width": 100,
            "hover": { "width": 200 },
            "transition": {
                "properties": ["width"],
                "easing": { "type": "spring" }
            }
        }));
        let mut carried =
            StyleTransitionState::new(&initial, StyleState::default(), false, started);
        carried.set_hovered(true);
        carried.sync(&initial, StyleState::default(), false, started, false);

        let retargeted_at = started + Duration::from_millis(100);
        let visible = match carried.frame(retargeted_at, false).style.width {
            Some(DimensionValue::Pixels(width)) => width,
            width => panic!("expected a visible pixel width, got {width:?}"),
        };
        let reversed = style(serde_json::json!({
            "width": 100,
            "hover": { "width": 50 },
            "transition": {
                "properties": ["width"],
                "easing": { "type": "spring" }
            }
        }));
        carried.sync(
            &reversed,
            StyleState::default(),
            false,
            retargeted_at,
            false,
        );

        let zero_restart_style = style(serde_json::json!({
            "width": visible,
            "hover": { "width": 50 },
            "transition": {
                "properties": ["width"],
                "easing": { "type": "spring", "velocity": 0 }
            }
        }));
        let mut zero_restart = StyleTransitionState::new(
            &zero_restart_style,
            StyleState::default(),
            false,
            retargeted_at,
        );
        zero_restart.set_hovered(true);
        zero_restart.sync(
            &zero_restart_style,
            StyleState::default(),
            false,
            retargeted_at,
            false,
        );

        let sampled_at = retargeted_at + Duration::from_millis(16);
        let width = |state: &StyleTransitionState| match state.frame(sampled_at, false).style.width
        {
            Some(DimensionValue::Pixels(width)) => width,
            width => panic!("expected a sampled pixel width, got {width:?}"),
        };
        let carried_width = width(&carried);
        let restarted_width = width(&zero_restart);
        assert!(
            carried_width > restarted_width + 1.0,
            "state-style interruption must carry velocity: {carried_width} vs {restarted_width}"
        );
    }

    #[test]
    fn style_spring_holds_during_its_delay() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "opacity": 0,
            "hover": { "opacity": 1 },
            "transition": {
                "properties": ["opacity"],
                "delayMs": 50,
                "easing": { "type": "spring" }
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, started, false);

        assert_eq!(
            state
                .frame(started + Duration::from_millis(49), false)
                .style
                .opacity,
            Some(0.0)
        );
        let after_delay = state.frame(started + Duration::from_millis(100), false);
        assert!(after_delay.style.opacity.unwrap() > 0.0);
        assert!(after_delay.style.opacity.unwrap() < 1.0);
        assert!(after_delay.active);
    }

    #[test]
    fn style_spring_settles_proportional_channels_without_a_visible_snap() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "width": "0%",
            "opacity": 0,
            "backgroundColor": "transparent",
            "hover": {
                "width": "100%",
                "opacity": 1,
                "backgroundColor": "#ffffff"
            },
            "transition": {
                "properties": ["width", "opacity", "backgroundColor"],
                "easing": { "type": "spring" }
            }
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(&style, StyleState::default(), false, started, false);

        let mut last_active = None;
        let mut settled = None;
        for tick in 1..=5_000 {
            let frame = state.frame(started + Duration::from_millis(tick), false);
            if frame.active {
                let width = match frame.style.width {
                    Some(DimensionValue::Percentage(width)) => width,
                    width => panic!("expected a percentage width, got {width:?}"),
                };
                let color =
                    TransitionValue::from_style(&frame.style, TransitionProperty::BackgroundColor)
                        .expect("the spring must keep painting a valid colour");
                last_active = Some((width, frame.style.opacity.unwrap(), color));
            } else {
                settled = Some(frame);
                break;
            }
        }

        let (width, opacity, color) = last_active.expect("the spring must paint active frames");
        assert!((width - 1.0).abs() <= 0.000_51);
        assert!((opacity - 1.0).abs() <= 0.000_51);
        let TransitionValue::Color(color) = color else {
            panic!("expected a colour transition value")
        };
        assert!((color[3] - 1.0).abs() <= 0.000_51);

        let settled = settled.expect("the default spring must settle");
        assert_eq!(settled.style.width, Some(DimensionValue::Percentage(1.0)));
        assert_eq!(settled.style.opacity, Some(1.0));
        assert_eq!(
            TransitionValue::from_style(&settled.style, TransitionProperty::BackgroundColor,),
            Some(TransitionValue::Color([1.0, 1.0, 1.0, 1.0]))
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

        let middle = state.frame(started + Duration::from_millis(500), false);
        assert_eq!(middle.style.width, Some(50.0));
        assert!(middle.active);

        let reversed = serde_json::json!({
            "initial": false,
            "animate": { "width": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let reversed_at = started + Duration::from_millis(500);
        state.sync(&reversed, reversed_at, false).unwrap();
        assert_eq!(state.frame(reversed_at, false).style.width, Some(50.0));
        assert_eq!(
            state
                .frame(reversed_at + Duration::from_millis(500), false)
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
        let frame = MotionState::new(&description, now)
            .unwrap()
            .frame(now, false);

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
        let frame = state.frame(started + Duration::from_millis(200), false);

        assert_eq!(frame.style.width, Some(100.0));
        assert!(!frame.active);
    }

    #[test]
    fn reduced_motion_interrupts_without_resurrecting_motion() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let midpoint = started + Duration::from_millis(500);
        assert_eq!(state.frame(midpoint, false).style.width, Some(50.0));

        state.sync(&initial, midpoint, true).unwrap();
        let reduced = state.frame(midpoint, true);
        assert_eq!(reduced.style.width, Some(100.0));
        assert!(!reduced.active);

        let after_preference_is_disabled = state.frame(midpoint, false);
        assert_eq!(after_preference_is_disabled.style.width, Some(100.0));
        assert!(!after_preference_is_disabled.active);

        let next_target = serde_json::json!({
            "initial": false,
            "animate": { "width": 200.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        state.sync(&next_target, midpoint, false).unwrap();
        let next_midpoint = state.frame(midpoint + Duration::from_millis(500), false);
        assert_eq!(next_midpoint.style.width, Some(150.0));
        assert!(next_midpoint.active);
    }

    #[test]
    fn motion_spring_overshoots_and_settles_without_a_visible_channel_snap() {
        let started = Instant::now();
        let description = serde_json::json!({
            "initial": { "width": 0.0, "opacity": 0.0 },
            "animate": { "width": 100.0, "opacity": 1.0 },
            "transition": {
                "duration": 1e300,
                "ease": { "type": "spring" }
            }
        });
        let state = MotionState::new(&description, started).unwrap();
        let mut saw_width_overshoot = false;
        let mut last_active = None;
        let mut settled = None;

        for tick in 1..=5_000 {
            let frame = state.frame(started + Duration::from_millis(tick), false);
            saw_width_overshoot |= frame.style.width.is_some_and(|width| width > 100.0);
            if frame.active {
                last_active = Some(frame);
            } else {
                settled = Some(frame);
                break;
            }
        }

        assert!(
            saw_width_overshoot,
            "the sampled width trajectory must overshoot"
        );
        let last_active = last_active.expect("the spring must emit intermediate frames");
        assert!(
            (last_active.style.width.unwrap() - 100.0).abs() <= 0.051,
            "the final width snap must stay below 0.05px plus tick precision"
        );
        assert!(
            (last_active.style.opacity.unwrap() - 1.0).abs() <= 0.000_51,
            "opacity needs a proportionally smaller settling window"
        );
        let settled = settled.expect("the default spring must settle");
        assert_eq!(settled.style.width, Some(100.0));
        assert_eq!(settled.style.opacity, Some(1.0));
        assert!(!settled.active);
    }

    #[test]
    fn motion_spring_delay_applies_while_duration_is_ignored() {
        let started = Instant::now();
        let description = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": {
                "duration": 0.0,
                "delay": 0.1,
                "ease": { "type": "spring", "stiffness": 100, "damping": 10, "mass": 1 }
            }
        });
        let state = MotionState::new(&description, started).unwrap();

        assert_eq!(
            state
                .frame(started + Duration::from_millis(99), false)
                .style
                .width,
            Some(0.0)
        );
        let after_delay = state.frame(started + Duration::from_millis(150), false);
        assert!(after_delay.style.width.unwrap() > 0.0);
        assert!(after_delay.style.width.unwrap() < 100.0);
        assert!(after_delay.active);
    }

    #[test]
    fn motion_spring_retarget_carries_the_visible_velocity() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "ease": { "type": "spring" } }
        });
        let mut carried = MotionState::new(&initial, started).unwrap();
        let retargeted_at = started + Duration::from_millis(100);
        let visible = carried.frame(retargeted_at, false).style.width.unwrap();
        let reversed = serde_json::json!({
            "initial": false,
            "animate": { "width": 0.0 },
            "transition": { "ease": { "type": "spring" } }
        });
        carried.sync(&reversed, retargeted_at, false).unwrap();

        let zero_restart_description = serde_json::json!({
            "initial": { "width": visible },
            "animate": { "width": 0.0 },
            "transition": { "ease": { "type": "spring", "velocity": 0.0 } }
        });
        let zero_restart = MotionState::new(&zero_restart_description, retargeted_at).unwrap();
        let sampled_at = retargeted_at + Duration::from_millis(16);
        let carried_width = carried.frame(sampled_at, false).style.width.unwrap();
        let restarted_width = zero_restart.frame(sampled_at, false).style.width.unwrap();

        assert!(
            carried_width > restarted_width + 1.0,
            "carried velocity must produce a different post-retarget trajectory: {carried_width} vs {restarted_width}"
        );
    }

    #[test]
    fn motion_rejects_unknown_and_malformed_spring_easings() {
        let now = Instant::now();
        for ease in [
            serde_json::json!({ "type": "bounce" }),
            serde_json::json!({ "type": "spring", "stiffness": 0 }),
            serde_json::json!({ "type": "spring", "damping": -1 }),
            serde_json::json!({ "type": "spring", "mass": 0 }),
            serde_json::json!({ "type": "spring", "velocity": 1e300 }),
            serde_json::json!({ "type": "spring", "unknown": 1 }),
        ] {
            let description = serde_json::json!({
                "animate": { "width": 100 },
                "transition": { "ease": ease }
            });
            assert!(
                MotionState::new(&description, now).is_err(),
                "{description}"
            );
        }
    }
}
