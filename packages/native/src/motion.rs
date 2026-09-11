//! Native motion tracks resolved during GPUI rendering, outside React.

use std::time::Duration;

use serde::{Deserialize, Deserializer};
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

/// The three numbers an intrinsic-keyword endpoint can resolve from: the
/// content's min-content width, its max-content width, and its content
/// height under the width it will paint at. `auto`, `min-content`,
/// `max-content` and `fit-content` on the width axis each need one or two of
/// the first two fields; every keyword on the height axis needs only the
/// third.
///
/// `None` on a field means nothing needs the number, either because
/// `interpolateSize` is `"numeric-only"` or because no declared endpoint asks
/// for it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicSize {
    pub min_width: Option<f64>,
    pub max_width: Option<f64>,
    pub content_height: Option<f64>,
}

/// A pair of per-axis flags, for the two axes an intrinsic size can travel on.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicAxes {
    pub width: bool,
    pub height: bool,
}

/// What the renderer resolved about this element's intrinsic endpoints for one
/// frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicInput {
    /// Axes whose `auto` resolves from the element's own content. An axis
    /// outside this set is stretched by its parent, so no content measurement
    /// describes it and an `auto` endpoint keeps CSS's step. An explicit
    /// keyword (`min-content`, `max-content`, `fit-content`) is not gated by
    /// this: it resolves to its own definition regardless of how the parent
    /// lays the element out.
    pub content_sized: IntrinsicAxes,
    /// This frame's fresh measurement, per field. Absent on every frame the
    /// renderer did not probe, which is every frame except an endpoint edge.
    pub measured: IntrinsicSize,
    /// The containing block's content-box width: the parent's last painted
    /// bounds minus its padding and border. This is the clamp basis for a
    /// bare `fit-content` endpoint and the resolution basis for a percentage
    /// `fit-content(<limit>)`. `None` before the parent has painted, which
    /// steps the endpoint.
    pub basis: Option<f64>,
}

/// The style whose layout supplies the numbers in [`IntrinsicSize`], plus the
/// fields that need measuring. The renderer builds this style, lays it out
/// with GPUI, and hands the result back to [`StyleTransitionState::sync`].
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct IntrinsicProbe {
    pub style: StyleDesc,
    pub min_width: bool,
    pub max_width: bool,
    pub height: bool,
}

/// Which of CSS's intrinsic sizing keywords a dimension declares, `auto`
/// included. `None` means the dimension is a plain length or percentage,
/// which never interpolates from a measurement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IntrinsicKeyword {
    Auto,
    MinContent,
    MaxContent,
    FitContent,
    FitContentLimit,
}

pub(crate) fn intrinsic_keyword(dimension: &Option<DimensionValue>) -> Option<IntrinsicKeyword> {
    match dimension {
        Some(DimensionValue::Auto) => Some(IntrinsicKeyword::Auto),
        Some(DimensionValue::MinContent) => Some(IntrinsicKeyword::MinContent),
        Some(DimensionValue::MaxContent) => Some(IntrinsicKeyword::MaxContent),
        Some(DimensionValue::FitContent) => Some(IntrinsicKeyword::FitContent),
        Some(DimensionValue::FitContentLimit { .. }) => Some(IntrinsicKeyword::FitContentLimit),
        _ => None,
    }
}

/// Which fields of [`IntrinsicSize`] a width-axis keyword needs.
fn width_needs(keyword: Option<IntrinsicKeyword>) -> (bool, bool) {
    match keyword {
        Some(IntrinsicKeyword::Auto | IntrinsicKeyword::MaxContent) => (false, true),
        Some(IntrinsicKeyword::MinContent) => (true, false),
        Some(IntrinsicKeyword::FitContent | IntrinsicKeyword::FitContentLimit) => (true, true),
        None => (false, false),
    }
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

    /// Give an intrinsic endpoint the number GPUI laid it out at.
    ///
    /// CSS interpolates an intrinsic keyword only under `interpolate-size:
    /// allow-keywords`, so a keyword the renderer could not resolve a number
    /// for keeps its keyword here and falls through `interpolate` to the step
    /// it takes today. Only `width` and `height` carry a measurement: `min-*`
    /// and `max-*` keywords keep stepping.
    fn with_intrinsic(
        self,
        property: TransitionProperty,
        intrinsic: IntrinsicSize,
        basis: Option<f64>,
    ) -> Self {
        let Self::Dimension(dimension) = &self else {
            return self;
        };
        let Some(keyword) = intrinsic_keyword(&Some(dimension.clone())) else {
            return self;
        };
        let resolved = match property {
            TransitionProperty::Width => {
                resolve_width_keyword(keyword, dimension, intrinsic, basis)
            }
            TransitionProperty::Height => intrinsic.content_height,
            _ => None,
        };
        match resolved {
            Some(pixels) => Self::Dimension(DimensionValue::Pixels(pixels)),
            None => self,
        }
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        if progress == 0.0 {
            return self.clone();
        }
        if progress == 1.0 {
            return target.clone();
        }
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

/// Resolve a width-axis intrinsic keyword to a pixel number, per the table in
/// README's `interpolateSize` section. `fit-content` and `fit-content(<limit>)`
/// need the clamp basis: the containing block's content-box width, for the
/// bare keyword and for a percentage limit. A `ch`/`vw`/`vh` limit, or a
/// basis this element does not have yet, leaves the endpoint unresolved and
/// it steps.
fn resolve_width_keyword(
    keyword: IntrinsicKeyword,
    dimension: &DimensionValue,
    intrinsic: IntrinsicSize,
    basis: Option<f64>,
) -> Option<f64> {
    match keyword {
        IntrinsicKeyword::Auto | IntrinsicKeyword::MaxContent => intrinsic.max_width,
        IntrinsicKeyword::MinContent => intrinsic.min_width,
        IntrinsicKeyword::FitContent => {
            let (min, max) = (intrinsic.min_width?, intrinsic.max_width?);
            Some(basis?.max(min).min(max))
        }
        IntrinsicKeyword::FitContentLimit => {
            let DimensionValue::FitContentLimit { limit, .. } = dimension else {
                unreachable!("`intrinsic_keyword` matched a `FitContentLimit` dimension");
            };
            let (min, max) = (intrinsic.min_width?, intrinsic.max_width?);
            let limit = match limit.as_ref() {
                DimensionValue::Pixels(limit) => Some(*limit),
                DimensionValue::Percentage(fraction) => basis.map(|basis| basis * fraction),
                _ => None,
            }?;
            Some(limit.max(min).min(max))
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
    fn from_style(
        style: &StyleDesc,
        properties: &[TransitionProperty],
        intrinsic: IntrinsicSize,
        basis: Option<f64>,
    ) -> Self {
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
                .map(|property| {
                    let value = TransitionValue::from_style(style, property)
                        .map(|value| value.with_intrinsic(property, intrinsic, basis));
                    (property, value)
                })
                .collect(),
        )
    }

}

impl TransitionValues {
    fn get(&self, property: TransitionProperty) -> Option<&TransitionValue> {
        self.0
            .iter()
            .find(|(candidate, _)| *candidate == property)
            .and_then(|(_, value)| value.as_ref())
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

#[derive(Clone, Debug, PartialEq)]
struct StyleTransitionTrack {
    property: TransitionProperty,
    from: Option<TransitionValue>,
    target: Option<TransitionValue>,
    velocity: Option<TransitionVelocity>,
    started: Instant,
    duration_ms: f64,
    delay_ms: f64,
    easing: TransitionEasing,
}

impl StyleTransitionTrack {
    fn timing_equals(&self, spec: &TransitionSpec) -> bool {
        self.duration_ms == spec.duration_ms
            && self.delay_ms == spec.delay_ms
            && self.easing == spec.easing
    }

    fn settled(&self) -> bool {
        self.from == self.target && self.velocity_is_zero()
    }

    fn velocity_is_zero(&self) -> bool {
        match &self.velocity {
            None => true,
            Some(TransitionVelocity::Number(value))
            | Some(TransitionVelocity::Dimension(value)) => *value == 0.0,
            Some(TransitionVelocity::Color(values)) => values.iter().all(|value| *value == 0.0),
        }
    }

    fn sample(
        &self,
        now: Instant,
        reduce_motion: bool,
    ) -> (Option<TransitionValue>, Option<TransitionVelocity>, bool) {
        if reduce_motion || self.settled() {
            return (self.target.clone(), None, false);
        }
        let elapsed = now.saturating_duration_since(self.started);
        let delay = milliseconds(self.delay_ms);
        if let TransitionEasing::Spring(spring) = &self.easing {
            let spring_elapsed = elapsed
                .checked_sub(delay)
                .unwrap_or(Duration::ZERO)
                .as_secs_f64();
            let Some((from, target)) = self.from.as_ref().zip(self.target.as_ref()) else {
                return (self.target.clone(), None, false);
            };
            let (value, velocity, active) = from.spring_to(
                target,
                self.velocity.as_ref(),
                spring_elapsed,
                spring,
                self.property,
            );
            return (Some(value), velocity, active);
        }

        let duration = milliseconds(self.duration_ms);
        let raw = if duration.is_zero() {
            if elapsed < delay { 0.0 } else { 1.0 }
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        let eased = if raw <= 0.0 {
            0.0
        } else if raw >= 1.0 {
            1.0
        } else {
            transition_ease(raw, &self.easing)
        };
        let value = self
            .from
            .as_ref()
            .zip(self.target.as_ref())
            .map(|(from, target)| from.interpolate(target, eased))
            .or_else(|| self.target.clone());
        (value, None, raw < 1.0)
    }

    fn timing_active(&self, now: Instant, reduce_motion: bool) -> bool {
        self.sample(now, reduce_motion).2
    }

    fn travels(&self) -> bool {
        self.from != self.target || !self.velocity_is_zero()
    }
}

#[derive(Clone, Debug, PartialEq)]
struct TransitionSpec {
    property: TransitionProperty,
    duration_ms: f64,
    delay_ms: f64,
    easing: TransitionEasing,
}

pub(crate) struct StyleTransitionState {
    tracks: Vec<StyleTransitionTrack>,
    target_style: StyleDesc,
    hovered: bool,
    active: bool,
    /// The measurement of this element's intrinsic endpoints, latched when the
    /// endpoint last changed. It is not re-taken while a run is in flight:
    /// a target that followed the content — a nested transition, streaming
    /// text — would push the finish line away on every frame and the declared
    /// duration would never elapse.
    intrinsic: IntrinsicSize,
    /// The `fit-content` clamp basis, latched alongside `intrinsic` for the
    /// same reason.
    intrinsic_basis: Option<f64>,
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
        let specs = transition_specs(&transition);
        // No measurement on the frame an element mounts: the renderer calls
        // `sync` before the first `frame`, and a state whose `from` equals its
        // `target` paints the target style either way.
        let target = TransitionValues::from_style(
            &target_style,
            &specs.iter().map(|spec| spec.property).collect::<Vec<_>>(),
            IntrinsicSize::default(),
            None,
        );
        Self {
            tracks: specs
                .into_iter()
                .map(|spec| StyleTransitionTrack {
                    property: spec.property,
                    from: target.get(spec.property).cloned(),
                    target: target.get(spec.property).cloned(),
                    velocity: None,
                    started: now,
                    duration_ms: spec.duration_ms,
                    delay_ms: spec.delay_ms,
                    easing: spec.easing,
                })
                .collect(),
            target_style,
            hovered: false,
            active: false,
            intrinsic: IntrinsicSize::default(),
            intrinsic_basis: None,
        }
    }

    /// `intrinsic` carries the axes whose `auto` is content-sized and any fresh
    /// measurement the renderer took this frame. A fresh number is latched for
    /// the run; a stretched axis drops its latch. Either way the number reaches
    /// the from/target values only: `target_style` keeps the declared `auto`,
    /// so a settled element paints content-sized again rather than a pinned
    /// pixel width.
    pub(crate) fn sync(
        &mut self,
        style: &StyleDesc,
        state: StyleState,
        hover_within: bool,
        now: Instant,
        reduce_motion: bool,
        intrinsic: IntrinsicInput,
    ) {
        // A stretched axis has no content number, latched or fresh. A
        // content-sized one keeps the number it latched at the last edge until
        // a fresh probe replaces it.
        self.intrinsic.min_width = intrinsic
            .content_sized
            .width
            .then(|| intrinsic.measured.min_width.or(self.intrinsic.min_width))
            .flatten();
        self.intrinsic.max_width = intrinsic
            .content_sized
            .width
            .then(|| intrinsic.measured.max_width.or(self.intrinsic.max_width))
            .flatten();
        self.intrinsic.content_height = intrinsic
            .content_sized
            .height
            .then(|| {
                intrinsic
                    .measured
                    .content_height
                    .or(self.intrinsic.content_height)
            })
            .flatten();
        // The basis latches with the triple, off the same signal: a fresh
        // probe this frame. Gating on `content_sized.width` alone would
        // re-adopt whatever basis a caller passed on every frame, even one
        // where nothing was actually measured — retargeting every frame a
        // containing block resizes mid-run, never letting a run finish.
        let probed_width =
            intrinsic.measured.min_width.is_some() || intrinsic.measured.max_width.is_some();
        self.intrinsic_basis = if probed_width {
            intrinsic.basis.or(self.intrinsic_basis)
        } else {
            self.intrinsic_basis
        };
        let intrinsic = self.intrinsic;
        let basis = self.intrinsic_basis;
        let target_style =
            resolve_transition_target(style, state, hover_within, self.hovered, self.active);
        let transitions = style
            .transition
            .clone()
            .expect("a transition state is retained only for a declared transition");
        let specs = transition_specs(&transitions);
        let properties = specs.iter().map(|spec| spec.property).collect::<Vec<_>>();
        let target = TransitionValues::from_style(&target_style, &properties, intrinsic, basis);
        let visible_frame = self.frame_with_velocities(&self.target_style, now, false).0;

        let visible_style = visible_frame.style;
        let visible_style = resolve_transition_properties(
            &visible_style,
            state,
            hover_within,
            self.hovered,
            self.active,
            &transitions,
        );
        let visible = TransitionValues::from_style(&visible_style, &properties, intrinsic, basis);
        let old_tracks = std::mem::take(&mut self.tracks);
        self.tracks = specs
            .into_iter()
            .map(|spec| {
                let from = visible.get(spec.property).cloned();
                let target_value = target.get(spec.property).cloned();
                if let Some(old) = old_tracks
                    .iter()
                    .find(|track| track.property == spec.property)
                {
                    if old.target == target_value && old.timing_equals(&spec) {
                        return old.clone();
                    }
                }

                let old = old_tracks
                    .iter()
                    .find(|track| track.property == spec.property);
                let (old_velocity, old_active) = old
                    .map(|track| {
                        let (_value, velocity, active) = track.sample(now, false);
                        (velocity, active)
                    })
                    .unwrap_or((None, false));
                let velocity = match &spec.easing {
                    TransitionEasing::Spring(spring) => {
                        let carried = old
                            .filter(|track| {
                                matches!(track.easing, TransitionEasing::Spring(_)) && old_active
                            })
                            .and_then(|_| old_velocity)
                            .filter(|velocity| {
                                from.as_ref().zip(target_value.as_ref()).is_some_and(
                                    |(from, target)| from.accepts_spring_velocity(target, velocity),
                                )
                            });
                        carried.or_else(|| {
                            from.as_ref()
                                .zip(target_value.as_ref())
                                .and_then(|(from, target)| {
                                    from.initial_spring_velocity_to(target, spring.velocity)
                                })
                        })
                    }
                    _ => None,
                };
                StyleTransitionTrack {
                    property: spec.property,
                    from,
                    target: target_value,
                    velocity,
                    started: now,
                    duration_ms: spec.duration_ms,
                    delay_ms: spec.delay_ms,
                    easing: spec.easing,
                }
            })
            .collect();

        self.target_style = target_style;
        if reduce_motion {
            for track in &mut self.tracks {
                track.from = track.target.clone();
                track.velocity = None;
            }
        } else {
            for track in &mut self.tracks {
                if matches!(&track.easing, TransitionEasing::Spring(_)) {
                    let (_, _, active) = track.sample(now, false);
                    if !active {
                        track.from = track.target.clone();
                        track.velocity = None;
                    }
                }
            }
        }
    }

    pub(crate) fn frame(&self, now: Instant, reduce_motion: bool) -> StyleTransitionFrame {
        self.frame_with_velocities(&self.target_style, now, reduce_motion)
            .0
    }

    /// The frame this transition resolves to against `base` instead of the
    /// retained `target_style`.
    pub(crate) fn frame_against(
        &self,
        base: &StyleDesc,
        state: StyleState,
        hover_within: bool,
        now: Instant,
        reduce_motion: bool,
    ) -> StyleTransitionFrame {
        let target_style =
            resolve_transition_target(base, state, hover_within, self.hovered, self.active);
        self.frame_with_velocities(&target_style, now, reduce_motion)
            .0
    }

    fn frame_with_velocities(
        &self,
        target_style: &StyleDesc,
        now: Instant,
        reduce_motion: bool,
    ) -> (StyleTransitionFrame, TransitionVelocities) {
        let mut style = target_style.clone();
        let mut active = false;
        let mut velocities = Vec::with_capacity(self.tracks.len());
        for track in &self.tracks {
            let (value, velocity, track_active) = track.sample(now, reduce_motion);
            if let Some(value) = value {
                value.apply_to(&mut style, track.property);
            }
            velocities.push((track.property, velocity));
            active |= track_active;
        }
        if !active {
            return (
                StyleTransitionFrame {
                    style: target_style.clone(),
                    active: false,
                },
                TransitionVelocities(velocities),
            );
        }
        self.keep_settled_intrinsic_axes(&mut style, target_style);
        (
            StyleTransitionFrame { style, active },
            TransitionVelocities(velocities),
        )
    }

    fn keep_settled_intrinsic_axes(&self, style: &mut StyleDesc, base: &StyleDesc) {
        let (width, height) = self.settles_intrinsic(base);
        if width && !self.travels(TransitionProperty::Width) {
            style.width = base.width.clone();
        }
        if height && !self.travels(TransitionProperty::Height) {
            style.height = base.height.clone();
        }
    }

    fn travels(&self, property: TransitionProperty) -> bool {
        self.tracks
            .iter()
            .find(|track| track.property == property)
            .is_some_and(StyleTransitionTrack::travels)
    }

    pub(crate) fn active_layout_tween(&self, now: Instant, reduce_motion: bool) -> bool {
        const LAYOUT_PROPERTIES: [TransitionProperty; 10] = [
            TransitionProperty::Width,
            TransitionProperty::Height,
            TransitionProperty::MinWidth,
            TransitionProperty::MinHeight,
            TransitionProperty::MaxWidth,
            TransitionProperty::MaxHeight,
            TransitionProperty::Top,
            TransitionProperty::Right,
            TransitionProperty::Bottom,
            TransitionProperty::Left,
        ];
        LAYOUT_PROPERTIES.iter().any(|property| {
            self.tracks
                .iter()
                .find(|track| track.property == *property)
                .is_some_and(|track| track.timing_active(now, reduce_motion) && track.travels())
        })
    }

    fn settles_intrinsic(&self, base: &StyleDesc) -> (bool, bool) {
        (
            intrinsic_keyword(&base.width).is_some(),
            intrinsic_keyword(&base.height).is_some(),
        )
    }

    pub(crate) fn target_style(&self) -> &StyleDesc {
        &self.target_style
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

fn transition_specs(transitions: &[StyleTransition]) -> Vec<TransitionSpec> {
    let mut specs: Vec<TransitionSpec> = Vec::new();
    for transition in transitions {
        for property in canonical_transition_properties(transition) {
            let spec = TransitionSpec {
                property,
                duration_ms: transition.duration_ms,
                delay_ms: transition.delay_ms,
                easing: transition.easing.clone(),
            };
            if let Some(existing) = specs
                .iter_mut()
                .find(|existing| existing.property == property)
            {
                *existing = spec;
            } else {
                specs.push(spec);
            }
        }
    }
    specs
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

/// Decide whether this element needs an intrinsic measurement this frame, and
/// which style to measure.
///
/// `target` is the resolved transition target from
/// [`transition_target_style`], so the state refinements this element currently
/// matches are already applied. The measured style is that target with the
/// intrinsic axes forced back to `auto`, so one layout serves both directions:
/// opening (`0` -> `auto`) needs the number as its target, closing
/// (`auto` -> `0`) needs the same number as its start.
pub(crate) fn intrinsic_probe(
    target: &StyleDesc,
    transitions: &[StyleTransition],
    content_sized: IntrinsicAxes,
    retained: Option<&StyleTransitionState>,
) -> Option<IntrinsicProbe> {
    if !content_sized.width && !content_sized.height {
        return None;
    }
    let properties = transition_specs(transitions)
        .into_iter()
        .map(|spec| spec.property)
        .collect::<Vec<_>>();
    if !properties.contains(&TransitionProperty::Width)
        && !properties.contains(&TransitionProperty::Height)
    {
        return None;
    }
    let (settled_width, settled_height) = retained
        .map_or((false, false), |state| state.settles_intrinsic(&state.target_style));
    let latched = retained.map_or(IntrinsicSize::default(), |state| state.intrinsic);
    let previous_width = retained.and_then(|state| intrinsic_keyword(&state.target_style.width));
    let previous_height = retained.and_then(|state| intrinsic_keyword(&state.target_style.height));

    // An axis is at an edge when it is becoming intrinsic or ceasing to be,
    // when the keyword it needs a number for changed mid-run (a retarget from
    // `min-content` to `max-content` while still opening), or when a field the
    // active keyword needs is not yet latched. In between — every other frame
    // of a run, and every frame of a settled element — the latch stands and no
    // layout is paid for.
    let axis_edge = |property: TransitionProperty,
                     axis_content_sized: bool,
                     axis_target: &Option<DimensionValue>,
                     settled: bool,
                     previous: Option<IntrinsicKeyword>,
                     field_latched: &dyn Fn(IntrinsicKeyword) -> bool| {
        if !axis_content_sized || !properties.contains(&property) {
            return None;
        }
        let now = intrinsic_keyword(axis_target);
        let intrinsic_now = now.is_some();
        if !intrinsic_now && !settled {
            return None;
        }
        let active = now.or(previous);
        let Some(active) = active else {
            return None;
        };
        let is_edge = intrinsic_now != settled
            || (intrinsic_now && settled && now != previous)
            || !field_latched(active);
        is_edge.then_some(active)
    };

    let width_active = axis_edge(
        TransitionProperty::Width,
        content_sized.width,
        &target.width,
        settled_width,
        previous_width,
        &|keyword| {
            let (needs_min, needs_max) = width_needs(Some(keyword));
            (!needs_min || latched.min_width.is_some())
                && (!needs_max || latched.max_width.is_some())
        },
    );
    let height_active = axis_edge(
        TransitionProperty::Height,
        content_sized.height,
        &target.height,
        settled_height,
        previous_height,
        &|_keyword| latched.content_height.is_some(),
    );

    let (needs_min_width, needs_max_width) = width_needs(width_active);
    let needs_height = height_active.is_some();
    if !needs_min_width && !needs_max_width && !needs_height {
        return None;
    }

    let mut probe = target.clone();
    if needs_min_width || needs_max_width {
        probe.width = Some(DimensionValue::Auto);
    }
    if needs_height {
        probe.height = Some(DimensionValue::Auto);
    }
    Some(IntrinsicProbe {
        style: probe,
        min_width: needs_min_width,
        max_width: needs_max_width,
        height: needs_height,
    })
}

/// The style this element's transition is aiming at, with the state
/// refinements it currently matches applied.
///
/// The renderer resolves this once per frame for an element that opted into
/// keyword size interpolation: both the decision about which axes are
/// content-sized and the probe style itself are properties of the target, not
/// of the base declaration, so a `hover: { width: "auto" }` or an inset
/// refinement is accounted for. Only transitionable properties are refined
/// here; layout-mode properties such as `alignSelf`, `position`, `flexGrow`
/// and `flexBasis` still come from the base declaration.
pub(crate) fn transition_target_style(
    style: &StyleDesc,
    state: StyleState,
    hover_within: bool,
    retained: Option<&StyleTransitionState>,
) -> StyleDesc {
    resolve_transition_target(
        style,
        state,
        hover_within,
        retained.is_some_and(|state| state.hovered),
        retained.is_some_and(|state| state.active),
    )
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
    transitions: &[StyleTransition],
) -> StyleDesc {
    let properties = transition_specs(transitions)
        .into_iter()
        .map(|spec| spec.property)
        .collect::<Vec<_>>();
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
    #[serde(default, deserialize_with = "deserialize_motion_repeat")]
    repeat: MotionRepeat,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum MotionRepeat {
    Finite(u32),
    Infinite,
}

impl Default for MotionRepeat {
    fn default() -> Self {
        Self::Finite(0)
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MotionRepeatInput {
    Number(f64),
    String(String),
}

fn deserialize_motion_repeat<'de, D>(deserializer: D) -> Result<MotionRepeat, D::Error>
where
    D: Deserializer<'de>,
{
    match MotionRepeatInput::deserialize(deserializer)? {
        MotionRepeatInput::Number(value)
            if value.is_finite()
                && value >= 0.0
                && value.fract() == 0.0
                && value <= u32::MAX as f64 => Ok(MotionRepeat::Finite(value as u32)),
        MotionRepeatInput::String(value) if value == "Infinity" => Ok(MotionRepeat::Infinite),
        MotionRepeatInput::Number(_) | MotionRepeatInput::String(_) => Err(
            serde::de::Error::custom("motion repeat must be a non-negative integer or Infinity"),
        ),
    }
}

impl Default for MotionTransition {
    fn default() -> Self {
        Self {
            duration: default_duration(),
            delay: 0.0,
            ease: default_ease(),
            repeat: MotionRepeat::default(),
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
            } else if matches!(&self.transition.ease, TransitionEasing::Spring(_)) {
                // A spring can briefly report rest before its numerical tail
                // re-enters the epsilon window. Latch the endpoint once the
                // real frame path observes rest so an unchanged source cannot
                // resurrect the original spring later.
                let frame = self.frame_with_velocity(now, false).0;
                if !frame.active {
                    self.from = self.target;
                    self.velocity = MotionVelocity::default();
                }
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
        let (active, progress) = match self.transition.repeat {
            MotionRepeat::Finite(repeats) => {
                let total = repeats as f64 + 1.0;
                let active = self.from != self.target && raw < total;
                let progress = if active {
                    raw.fract()
                } else if raw >= total {
                    1.0
                } else {
                    0.0
                };
                (active, progress)
            }
            MotionRepeat::Infinite => (self.from != self.target, raw.fract()),
        };
        let progress = transition_ease(progress.clamp(0.0, 1.0), &self.transition.ease);

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
    fn style_transition_tracks_have_independent_clocks() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "width": 100,
            "opacity": 0.0,
            "hover": { "width": 200, "opacity": 1.0 },
            "transition": "width 100ms linear, opacity 200ms linear"
        }));
        let mut state = StyleTransitionState::new(&style, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

        let middle = state.frame(started + Duration::from_millis(50), false);
        assert_eq!(middle.style.width, Some(DimensionValue::Pixels(150.0)));
        assert_eq!(middle.style.opacity, Some(0.25));
        let width_done = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(width_done.style.width, Some(DimensionValue::Pixels(200.0)));
        assert_eq!(width_done.style.opacity, Some(0.5));
    }

    #[test]
    fn retargeting_one_style_transition_track_keeps_the_other_clock() {
        let started = Instant::now();
        let first = style(serde_json::json!({
            "width": 100,
            "opacity": 0.0,
            "hover": { "width": 200, "opacity": 1.0 },
            "transition": "width 100ms linear, opacity 200ms linear"
        }));
        let second = style(serde_json::json!({
            "width": 100,
            "opacity": 0.0,
            "hover": { "width": 300, "opacity": 1.0 },
            "transition": "width 100ms linear, opacity 200ms linear"
        }));
        let mut state = StyleTransitionState::new(&first, StyleState::default(), false, started);
        state.set_hovered(true);
        state.sync(
            &first,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );
        let retargeted_at = started + Duration::from_millis(50);
        state.sync(
            &second,
            StyleState::default(),
            false,
            retargeted_at,
            false,
            IntrinsicInput::default(),
        );
        let frame = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(frame.style.width, Some(DimensionValue::Pixels(225.0)));
        assert_eq!(frame.style.opacity, Some(0.5));
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
        state.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
        state.sync(
            &style,
            StyleState::default(),
            false,
            middle_at,
            false,
            IntrinsicInput::default(),
        );
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
        state.sync(&style, focus, true, now, true, IntrinsicInput::default());
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
        state.sync(
            &style,
            StyleState::default(),
            false,
            now,
            false,
            IntrinsicInput::default(),
        );

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
        state.sync(
            &style,
            StyleState::default(),
            false,
            now,
            false,
            IntrinsicInput::default(),
        );

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
        state.sync(
            &style,
            StyleState::default(),
            false,
            now,
            false,
            IntrinsicInput::default(),
        );

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
            IntrinsicInput::default(),
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
            IntrinsicInput::default(),
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
        state.sync(
            &initial,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
            IntrinsicInput::default(),
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
        state.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
        carried.sync(
            &initial,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
            IntrinsicInput::default(),
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
            IntrinsicInput::default(),
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
    fn style_spring_sync_does_not_resample_an_unchanged_track() {
        let started = Instant::now();
        let style = style(serde_json::json!({
            "width": 100,
            "hover": { "width": 200 },
            "transition": {
                "properties": ["width"],
                "easing": { "type": "spring" }
            }
        }));
        let mut without_sync =
            StyleTransitionState::new(&style, StyleState::default(), false, started);
        let mut with_sync =
            StyleTransitionState::new(&style, StyleState::default(), false, started);
        without_sync.set_hovered(true);
        with_sync.set_hovered(true);
        without_sync.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );
        with_sync.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );
        with_sync.sync(
            &style,
            StyleState::default(),
            false,
            started + Duration::from_millis(50),
            false,
            IntrinsicInput::default(),
        );

        assert_eq!(
            without_sync
                .frame(started + Duration::from_millis(100), false)
                .style
                .width,
            with_sync
                .frame(started + Duration::from_millis(100), false)
                .style
                .width
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
        state.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
        state.sync(
            &style,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );

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
    fn width_transition(width: serde_json::Value) -> StyleDesc {
        style(serde_json::json!({
            "width": width,
            "overflow": "hidden",
            "minWidth": 0,
            "transition": {
                "properties": ["width"],
                "durationMs": 100,
                "easing": "linear"
            }
        }))
    }

    fn sampled_width(state: &StyleTransitionState, at: Instant) -> Option<DimensionValue> {
        state.frame(at, false).style.width
    }

    fn max_content(width: f64) -> IntrinsicSize {
        IntrinsicSize {
            max_width: Some(width),
            ..IntrinsicSize::default()
        }
    }

    fn min_content(width: f64) -> IntrinsicSize {
        IntrinsicSize {
            min_width: Some(width),
            ..IntrinsicSize::default()
        }
    }

    fn min_max_content(min_width: f64, max_width: f64) -> IntrinsicSize {
        IntrinsicSize {
            min_width: Some(min_width),
            max_width: Some(max_width),
            ..IntrinsicSize::default()
        }
    }

    const CONTENT_WIDTH: IntrinsicAxes = IntrinsicAxes {
        width: true,
        height: false,
    };

    /// The renderer's probe decision, made the way the renderer makes it: from
    /// the resolved transition target rather than the base declaration.
    fn probe_of(
        style: &StyleDesc,
        content_sized: IntrinsicAxes,
        retained: Option<&StyleTransitionState>,
    ) -> Option<IntrinsicProbe> {
        let target = transition_target_style(style, StyleState::default(), false, retained);
        intrinsic_probe(
            &target,
            style.transition.as_ref().expect("a declared transition"),
            content_sized,
            retained,
        )
    }

    /// One frame of the renderer's loop: probe only when the state asks for it,
    /// then sync. Returns whether a probe was taken, which is what the
    /// steady-state cost assertions are about.
    fn drive(
        state: &mut StyleTransitionState,
        style: &StyleDesc,
        now: Instant,
        measure: impl FnOnce() -> IntrinsicSize,
    ) -> bool {
        drive_with_basis(state, style, now, None, measure)
    }

    /// `drive`, with the `fit-content` clamp basis a parent would supply.
    fn drive_with_basis(
        state: &mut StyleTransitionState,
        style: &StyleDesc,
        now: Instant,
        basis: Option<f64>,
        measure: impl FnOnce() -> IntrinsicSize,
    ) -> bool {
        drive_axes(state, style, CONTENT_WIDTH, now, basis, measure)
    }

    /// `drive`, generalized to any set of content-sized axes: the renderer
    /// bundles whichever fields a probe needs — a `max-content` width and a
    /// content height alike — into the *one* probe an edge frame takes, so
    /// this drives them through the same single measurement call.
    fn drive_axes(
        state: &mut StyleTransitionState,
        style: &StyleDesc,
        content_sized: IntrinsicAxes,
        now: Instant,
        basis: Option<f64>,
        measure: impl FnOnce() -> IntrinsicSize,
    ) -> bool {
        let probe = probe_of(style, content_sized, Some(state));
        let measured = probe.is_some().then(measure).unwrap_or_default();
        state.sync(
            style,
            StyleState::default(),
            false,
            now,
            false,
            IntrinsicInput {
                content_sized,
                measured,
                basis,
            },
        );
        probe.is_some()
    }

    #[test]
    fn measured_intrinsic_width_opens_and_settles_back_to_auto() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));
        let measure = || max_content(120.0);

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive(&mut state, &closed, started, measure);
        assert!(drive(&mut state, &opened, started, measure));

        assert_eq!(
            sampled_width(&state, started),
            Some(DimensionValue::Pixels(0.0))
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(60.0))
        );
        assert!(
            state
                .frame(started + Duration::from_millis(50), false)
                .active
        );
        // The settled style is the declared one again, so later content changes
        // resize the element with no pinned pixel width to release.
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::Auto));
        assert!(!settled.active);

        // Without a measurement the endpoint steps, exactly as it does with
        // `interpolateSize` absent or `"numeric-only"`.
        let mut stepped = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        stepped.sync(
            &closed,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );
        stepped.sync(
            &opened,
            StyleState::default(),
            false,
            started,
            false,
            IntrinsicInput::default(),
        );
        assert_eq!(
            sampled_width(&stepped, started + Duration::from_millis(50)),
            Some(DimensionValue::Auto)
        );
    }

    #[test]
    fn measured_intrinsic_width_closes_from_the_laid_out_size() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));
        let measure = || max_content(120.0);

        let mut state = StyleTransitionState::new(&opened, StyleState::default(), false, started);
        assert!(drive(&mut state, &opened, started, measure));
        assert_eq!(sampled_width(&state, started), Some(DimensionValue::Auto));

        assert!(drive(&mut state, &closed, started, measure));
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(60.0))
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(100)),
            Some(DimensionValue::Pixels(0.0))
        );
    }

    #[test]
    fn measured_intrinsic_width_is_kept_during_a_closing_delay() {
        let started = Instant::now();
        let opened = style(serde_json::json!({
            "width": "auto",
            "overflow": "hidden",
            "minWidth": 0,
            "transition": {
                "properties": ["width"],
                "durationMs": 100,
                "delayMs": 50,
                "easing": "linear"
            }
        }));
        let closed = style(serde_json::json!({
            "width": 0,
            "overflow": "hidden",
            "minWidth": 0,
            "transition": {
                "properties": ["width"],
                "durationMs": 100,
                "delayMs": 50,
                "easing": "linear"
            }
        }));
        let mut state = StyleTransitionState::new(&opened, StyleState::default(), false, started);
        assert!(drive(&mut state, &opened, started, || max_content(500.0)));
        assert!(drive(&mut state, &closed, started, || max_content(500.0)));

        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(25)),
            Some(DimensionValue::Pixels(500.0))
        );
    }

    #[test]
    fn intrinsic_endpoint_is_measured_only_at_an_edge() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));
        let measure = || max_content(120.0);

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        // Mounted closed: nothing is intrinsic, so nothing is measured.
        assert!(!drive(&mut state, &closed, started, measure));
        // Opening is an edge.
        assert!(drive(&mut state, &opened, started, measure));
        // Every frame of the run, and every frame after it settles at `auto`,
        // reuses the latch.
        for elapsed in [16, 32, 48, 100, 400, 4_000] {
            let now = started + Duration::from_millis(elapsed);
            assert!(
                !drive(&mut state, &opened, now, measure),
                "settled or in-flight frames must not re-measure ({elapsed}ms)"
            );
        }
        // Closing is the other edge.
        let closing_at = started + Duration::from_millis(4_000);
        assert!(drive(&mut state, &closed, closing_at, measure));
        assert!(!drive(&mut state, &closed, closing_at, measure));

        // A retarget between two different keywords while still settled at an
        // intrinsic value is also an edge, even though the axis never stops
        // being intrinsic: the new keyword needs a field the old one did not.
        let min = width_transition(serde_json::json!("min-content"));
        let max = width_transition(serde_json::json!("max-content"));
        let mut keyword_state =
            StyleTransitionState::new(&min, StyleState::default(), false, started);
        assert!(drive(&mut keyword_state, &min, started, || min_content(
            80.0
        )));
        assert!(
            !drive(&mut keyword_state, &min, started, || min_content(80.0)),
            "the same keyword must reuse its latch"
        );
        assert!(
            drive(&mut keyword_state, &max, started, || max_content(200.0)),
            "min-content -> max-content must re-measure the newly needed field"
        );
    }

    #[test]
    fn both_axes_to_auto_share_one_probe_and_measure_the_unwrapped_height() {
        let started = Instant::now();
        let closed = style(serde_json::json!({
            "width": 0,
            "height": 0,
            "overflow": "hidden",
            "minWidth": 0,
            "minHeight": 0,
            "transition": {
                "properties": ["width", "height"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let opened = style(serde_json::json!({
            "width": "auto",
            "height": "auto",
            "overflow": "hidden",
            "minWidth": 0,
            "minHeight": 0,
            "transition": {
                "properties": ["width", "height"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        const BOTH_AXES: IntrinsicAxes = IntrinsicAxes {
            width: true,
            height: true,
        };
        let probes = std::cell::Cell::new(0);
        let measure = || {
            probes.set(probes.get() + 1);
            IntrinsicSize {
                max_width: Some(120.0),
                content_height: Some(40.0),
                ..IntrinsicSize::default()
            }
        };

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive_axes(&mut state, &closed, BOTH_AXES, started, None, measure);
        // Both axes become intrinsic on the same edge frame: the renderer's
        // `measure_intrinsic_triple` answers the max-content width and the
        // content height from the *same* probe subtree, so the whole edge
        // costs one build and one `layout_as_root`, not two.
        assert!(drive_axes(
            &mut state, &opened, BOTH_AXES, started, None, measure
        ));
        assert_eq!(probes.get(), 1, "one edge must take exactly one probe");

        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::Auto));
        assert_eq!(settled.style.height, Some(DimensionValue::Auto));
    }

    #[test]
    fn fit_content_basis_is_latched_not_refetched_every_frame() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("fit-content"));

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive_with_basis(&mut state, &closed, started, Some(150.0), || {
            min_max_content(40.0, 300.0)
        });
        assert!(drive_with_basis(
            &mut state,
            &opened,
            started,
            Some(150.0),
            || min_max_content(40.0, 300.0)
        ));

        // Mid-run, as if the containing block resized: a caller that passed a
        // *different* basis on a frame with no fresh measurement must not
        // retarget the run — `started` stays put, and the clamp the run is
        // travelling to stays the one latched at the edge.
        let mid_run = started + Duration::from_millis(50);
        state.sync(
            &opened,
            StyleState::default(),
            false,
            mid_run,
            false,
            IntrinsicInput {
                content_sized: CONTENT_WIDTH,
                measured: IntrinsicSize::default(),
                basis: Some(999.0),
            },
        );
        assert_eq!(
            sampled_width(&state, mid_run),
            Some(DimensionValue::Pixels(75.0)),
            "an un-probed frame's basis must not retarget the run"
        );
        // If the fake basis had retargeted the run, `started` would have
        // moved to `mid_run` and the clamp would have become 300 (`999`
        // clamped to `[40, 300]`), giving a different number here. The
        // original trajectory toward 150, on the original clock, must hold.
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(90)),
            Some(DimensionValue::Pixels(135.0))
        );
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::FitContent));
    }

    #[test]
    fn a_content_change_mid_run_keeps_the_declared_duration() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive(&mut state, &closed, started, IntrinsicSize::default);
        drive(&mut state, &opened, started, || max_content(120.0));

        // Content grows on every frame, the way streaming text does. The run
        // keeps the endpoint it latched, so the clock is never pushed out.
        let mut growing = 120.0;
        for frame in 1..=6 {
            let now = started + Duration::from_millis(frame * 16);
            growing += 40.0;
            let measured = growing;
            assert!(!drive(&mut state, &opened, now, || max_content(measured)));
        }
        let end = started + Duration::from_millis(100);
        let settled = state.frame(end, false);
        assert!(
            !settled.active,
            "the run must finish within its declared duration"
        );
        // Finishing means the declared style again, so the element paints the
        // content it has now rather than the size it was aiming at.
        assert_eq!(settled.style.width, Some(DimensionValue::Auto));
    }

    #[test]
    fn another_property_does_not_pin_a_settled_intrinsic_axis() {
        let started = Instant::now();
        let lane = |opacity: f64| {
            style(serde_json::json!({
                "width": "auto",
                "opacity": opacity,
                "overflow": "hidden",
                "minWidth": 0,
                "transition": {
                    "properties": ["width", "opacity"],
                    "durationMs": 100,
                    "easing": "linear"
                }
            }))
        };

        let mut state =
            StyleTransitionState::new(&lane(1.0), StyleState::default(), false, started);
        assert!(drive(&mut state, &lane(1.0), started, || max_content(
            120.0
        )));
        assert_eq!(sampled_width(&state, started), Some(DimensionValue::Auto));

        // An opacity-only change retargets the run. Width has nowhere to
        // travel, and its latched pixel is already stale, so the frame must
        // keep the declared `auto` rather than pin the element to it.
        assert!(!drive(&mut state, &lane(0.0), started, || max_content(
            400.0
        )));
        let middle = state.frame(started + Duration::from_millis(50), false);
        assert!(middle.active);
        assert_eq!(middle.style.opacity, Some(0.5));
        assert_eq!(middle.style.width, Some(DimensionValue::Auto));
    }

    /// The same property/opacity lane, with the width endpoint a `max-content`
    /// keyword instead of `auto`. An explicit keyword settles and keeps not
    /// pinning the axis exactly the way `auto` does.
    #[test]
    fn another_property_does_not_pin_a_settled_keyword_axis() {
        let started = Instant::now();
        let lane = |opacity: f64| {
            style(serde_json::json!({
                "width": "max-content",
                "opacity": opacity,
                "overflow": "hidden",
                "minWidth": 0,
                "transition": {
                    "properties": ["width", "opacity"],
                    "durationMs": 100,
                    "easing": "linear"
                }
            }))
        };

        let mut state =
            StyleTransitionState::new(&lane(1.0), StyleState::default(), false, started);
        assert!(drive(&mut state, &lane(1.0), started, || max_content(
            120.0
        )));
        assert_eq!(
            sampled_width(&state, started),
            Some(DimensionValue::MaxContent)
        );

        assert!(!drive(&mut state, &lane(0.0), started, || max_content(
            400.0
        )));
        let middle = state.frame(started + Duration::from_millis(50), false);
        assert!(middle.active);
        assert_eq!(middle.style.opacity, Some(0.5));
        assert_eq!(middle.style.width, Some(DimensionValue::MaxContent));
    }

    #[test]
    fn intrinsic_probe_measures_the_auto_axis_in_both_directions() {
        let now = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));
        let probe_for = |style: &StyleDesc, retained: Option<&StyleTransitionState>| {
            probe_of(style, CONTENT_WIDTH, retained)
        };

        // Opening: the declared target is already intrinsic.
        let probe = probe_for(&opened, None).expect("an auto target needs a measurement");
        assert!(probe.max_width && !probe.min_width && !probe.height);
        assert_eq!(probe.style.width, Some(DimensionValue::Auto));

        // Nothing intrinsic on either side, and no retained intrinsic state.
        assert!(probe_for(&closed, None).is_none());

        // A stretched axis has no content measurement that describes it.
        assert!(probe_of(&opened, IntrinsicAxes::default(), None).is_none());

        // Closing: React has already swapped `auto` for a number, so only the
        // retained target still says the element was content-sized.
        let mut state = StyleTransitionState::new(&opened, StyleState::default(), false, now);
        drive(&mut state, &opened, now, || max_content(120.0));
        let probe =
            probe_for(&closed, Some(&state)).expect("a retained auto endpoint needs a measurement");
        assert!(probe.max_width);
        assert_eq!(probe.style.width, Some(DimensionValue::Auto));

        // A state refinement goes through the same resolution.
        let hovered = style(serde_json::json!({
            "width": 0,
            "hover": { "width": "auto" },
            "transition": { "properties": ["width"], "durationMs": 100 }
        }));
        let mut hover_state =
            StyleTransitionState::new(&hovered, StyleState::default(), false, now);
        assert!(probe_for(&hovered, Some(&hover_state)).is_none());
        assert!(hover_state.set_hovered(true));
        let probe = probe_for(&hovered, Some(&hover_state))
            .expect("a hovered auto refinement needs a measurement");
        assert!(probe.max_width);
        assert_eq!(probe.style.width, Some(DimensionValue::Auto));
    }

    /// `hover: { width: "max-content" }` mirrors the `auto` refinement case
    /// above.
    #[test]
    fn intrinsic_probe_measures_a_hovered_keyword_refinement() {
        let now = Instant::now();
        let hovered = style(serde_json::json!({
            "width": 0,
            "hover": { "width": "max-content" },
            "transition": { "properties": ["width"], "durationMs": 100 }
        }));
        let mut hover_state =
            StyleTransitionState::new(&hovered, StyleState::default(), false, now);
        assert!(probe_of(&hovered, CONTENT_WIDTH, Some(&hover_state)).is_none());
        assert!(hover_state.set_hovered(true));
        let probe = probe_of(&hovered, CONTENT_WIDTH, Some(&hover_state))
            .expect("a hovered keyword refinement needs a measurement");
        assert!(probe.max_width);
        assert_eq!(probe.style.width, Some(DimensionValue::Auto));
    }

    #[test]
    fn a_stretched_axis_keeps_the_step_even_with_a_measurement() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("auto"));
        let stretched = IntrinsicInput {
            content_sized: IntrinsicAxes::default(),
            measured: max_content(120.0),
            basis: None,
        };

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        state.sync(
            &closed,
            StyleState::default(),
            false,
            started,
            false,
            stretched,
        );
        state.sync(
            &opened,
            StyleState::default(),
            false,
            started,
            false,
            stretched,
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Auto)
        );
    }

    #[test]
    fn intrinsic_sizes_never_reach_min_or_max_size_keywords() {
        let started = Instant::now();
        let keyword_bounds = |value: serde_json::Value| {
            style(serde_json::json!({
                "minWidth": value,
                "transition": {
                    "properties": ["minWidth"],
                    "durationMs": 100,
                    "easing": "linear"
                }
            }))
        };
        let from = keyword_bounds(serde_json::json!(0));
        let to = keyword_bounds(serde_json::json!("auto"));
        let measured = IntrinsicInput {
            content_sized: IntrinsicAxes {
                width: true,
                height: true,
            },
            measured: IntrinsicSize {
                max_width: Some(120.0),
                content_height: Some(40.0),
                ..IntrinsicSize::default()
            },
            basis: None,
        };

        // `minWidth` is not an intrinsic-size axis, so no measurement is asked
        // for and the endpoint keeps stepping even if one is supplied.
        assert!(probe_of(
            &to,
            IntrinsicAxes {
                width: true,
                height: true
            },
            None
        )
        .is_none());
        let mut state = StyleTransitionState::new(&from, StyleState::default(), false, started);
        state.sync(
            &from,
            StyleState::default(),
            false,
            started,
            false,
            measured,
        );
        state.sync(&to, StyleState::default(), false, started, false, measured);
        assert_eq!(
            state
                .frame(started + Duration::from_millis(50), false)
                .style
                .min_width,
            Some(DimensionValue::Auto)
        );
    }

    #[test]
    fn min_content_endpoint_opens_from_zero() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("min-content"));
        let measure = || min_content(80.0);

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive(&mut state, &closed, started, measure);
        assert!(drive(&mut state, &opened, started, measure));

        assert_eq!(
            sampled_width(&state, started),
            Some(DimensionValue::Pixels(0.0))
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(40.0))
        );
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::MinContent));
        assert!(!settled.active);
    }

    #[test]
    fn min_content_endpoint_interpolates_to_max_content() {
        let started = Instant::now();
        let min = width_transition(serde_json::json!("min-content"));
        let max = width_transition(serde_json::json!("max-content"));

        let mut state = StyleTransitionState::new(&min, StyleState::default(), false, started);
        assert!(drive(&mut state, &min, started, || min_content(80.0)));
        assert_eq!(
            sampled_width(&state, started),
            Some(DimensionValue::MinContent)
        );

        // The retarget needs only the field the new keyword adds: `max_width`.
        // `min_width` stays latched from the previous edge.
        assert!(drive(&mut state, &max, started, || max_content(200.0)));
        assert_eq!(
            sampled_width(&state, started),
            Some(DimensionValue::Pixels(80.0))
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(140.0))
        );
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::MaxContent));
    }

    #[test]
    fn fit_content_endpoint_clamps_to_the_parent_basis() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let opened = width_transition(serde_json::json!("fit-content"));

        // The parent is narrower than max-content, so the clamp lands on the
        // basis rather than either bound.
        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive_with_basis(&mut state, &closed, started, Some(150.0), || {
            min_max_content(40.0, 300.0)
        });
        assert!(drive_with_basis(
            &mut state,
            &opened,
            started,
            Some(150.0),
            || min_max_content(40.0, 300.0)
        ));
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.width, Some(DimensionValue::FitContent));
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(75.0))
        );

        // Without a painted parent there is no basis, so the endpoint steps.
        let mut unbased = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive(&mut unbased, &closed, started, || {
            min_max_content(40.0, 300.0)
        });
        drive(&mut unbased, &opened, started, || {
            min_max_content(40.0, 300.0)
        });
        assert_eq!(
            sampled_width(&unbased, started + Duration::from_millis(50)),
            Some(DimensionValue::FitContent)
        );
    }

    #[test]
    fn fit_content_limit_clamps_to_a_pixel_or_percentage_limit() {
        let started = Instant::now();
        let closed = width_transition(serde_json::json!(0));
        let pixel_limit = width_transition(serde_json::json!("fit-content(80px)"));

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive(&mut state, &closed, started, || {
            min_max_content(40.0, 300.0)
        });
        assert!(drive(&mut state, &pixel_limit, started, || {
            min_max_content(40.0, 300.0)
        }));
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(
            settled.style.width,
            Some(DimensionValue::FitContentLimit {
                source: "fit-content(80px)".to_owned(),
                limit: Box::new(DimensionValue::Pixels(80.0)),
            })
        );
        assert_eq!(
            sampled_width(&state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(40.0))
        );

        // A percentage limit resolves against the parent basis.
        let percent_limit = width_transition(serde_json::json!("fit-content(50%)"));
        let mut percent_state =
            StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive_with_basis(&mut percent_state, &closed, started, Some(200.0), || {
            min_max_content(40.0, 300.0)
        });
        assert!(drive_with_basis(
            &mut percent_state,
            &percent_limit,
            started,
            Some(200.0),
            || min_max_content(40.0, 300.0)
        ));
        assert_eq!(
            sampled_width(&percent_state, started + Duration::from_millis(50)),
            Some(DimensionValue::Pixels(50.0))
        );
    }

    #[test]
    fn height_max_content_endpoint_interpolates() {
        let started = Instant::now();
        let closed = style(serde_json::json!({
            "height": 0,
            "overflow": "hidden",
            "minHeight": 0,
            "transition": {
                "properties": ["height"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        let opened = style(serde_json::json!({
            "height": "max-content",
            "overflow": "hidden",
            "minHeight": 0,
            "transition": {
                "properties": ["height"],
                "durationMs": 100,
                "easing": "linear"
            }
        }));
        const CONTENT_HEIGHT: IntrinsicAxes = IntrinsicAxes {
            width: false,
            height: true,
        };
        let drive_height = |state: &mut StyleTransitionState,
                            style: &StyleDesc,
                            now: Instant,
                            content_height: f64| {
            let target = transition_target_style(style, StyleState::default(), false, Some(state));
            let probe = intrinsic_probe(
                &target,
                style.transition.as_ref().expect("a declared transition"),
                CONTENT_HEIGHT,
                Some(state),
            );
            let measured = probe.is_some().then(|| IntrinsicSize {
                content_height: Some(content_height),
                ..IntrinsicSize::default()
            });
            state.sync(
                style,
                StyleState::default(),
                false,
                now,
                false,
                IntrinsicInput {
                    content_sized: CONTENT_HEIGHT,
                    measured: measured.unwrap_or_default(),
                    basis: None,
                },
            );
            probe.is_some()
        };

        let mut state = StyleTransitionState::new(&closed, StyleState::default(), false, started);
        drive_height(&mut state, &closed, started, 80.0);
        assert!(drive_height(&mut state, &opened, started, 80.0));

        assert_eq!(
            state.frame(started, false).style.height,
            Some(DimensionValue::Pixels(0.0))
        );
        assert_eq!(
            state
                .frame(started + Duration::from_millis(50), false)
                .style
                .height,
            Some(DimensionValue::Pixels(40.0))
        );
        let settled = state.frame(started + Duration::from_millis(100), false);
        assert_eq!(settled.style.height, Some(DimensionValue::MaxContent));
    }
}
