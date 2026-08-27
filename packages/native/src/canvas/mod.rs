//! Retained Canvas 2D display lists and typed-array transport decoder.

pub mod opcodes;

use std::fmt;
use std::sync::{Arc, LockResult, Mutex, MutexGuard};

use rustc_hash::FxHashMap;

type DisplayLists = FxHashMap<u64, Arc<DisplayList>>;

#[derive(Clone, Debug)]
pub(crate) struct CanvasPreparationDiagnostic {
    pub element_id: u64,
    pub diagnostic: CanvasDiagnostic,
}

/// Display lists and the diagnostics produced while preparing them share a
/// lifetime so a GPUI paint closure can report back to the owning renderer.
/// Preparation remains at paint time because its tolerance depends on layout
/// and device scale; decoding it eagerly would tessellate every path twice.
#[derive(Clone, Default)]
pub struct SharedDisplayLists {
    lists: Arc<Mutex<DisplayLists>>,
    last_revisions: Arc<Mutex<FxHashMap<u64, u64>>>,
    preparation_diagnostics: Arc<Mutex<Vec<CanvasPreparationDiagnostic>>>,
}

impl SharedDisplayLists {
    pub(crate) fn lock(&self) -> LockResult<MutexGuard<'_, DisplayLists>> {
        self.lists.lock()
    }

    pub(crate) fn report_preparation_diagnostics(
        &self,
        element_id: u64,
        diagnostics: &[CanvasDiagnostic],
    ) {
        self.preparation_diagnostics
            .lock()
            .unwrap()
            .extend(
                diagnostics
                    .iter()
                    .cloned()
                    .map(|diagnostic| CanvasPreparationDiagnostic {
                        element_id,
                        diagnostic,
                    }),
            );
    }

    pub(crate) fn take_preparation_diagnostics(&self) -> Vec<CanvasPreparationDiagnostic> {
        std::mem::take(&mut *self.preparation_diagnostics.lock().unwrap())
    }
}

pub(crate) const DEFAULT_CANVAS_WIDTH: f64 = 300.0;
pub(crate) const DEFAULT_CANVAS_HEIGHT: f64 = 150.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CanvasSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasPoint {
    pub x: f64,
    pub y: f64,
}

pub type CanvasQuad = [CanvasPoint; 4];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EllipseArc {
    pub center: CanvasPoint,
    pub radius_x: f64,
    pub radius_y: f64,
    pub rotation: f64,
    pub start_angle: f64,
    pub sweep: f64,
    pub transform: CanvasTransform,
}

impl EllipseArc {
    pub(crate) fn point_at(self, angle: f64) -> CanvasPoint {
        let (sin_rotation, cos_rotation) = self.rotation.sin_cos();
        let (sin_angle, cos_angle) = angle.sin_cos();
        self.transform.transform_point(
            self.center.x + self.radius_x * cos_angle * cos_rotation
                - self.radius_y * sin_angle * sin_rotation,
            self.center.y
                + self.radius_x * cos_angle * sin_rotation
                + self.radius_y * sin_angle * cos_rotation,
        )
    }

    pub(crate) fn start_point(self) -> CanvasPoint {
        self.point_at(self.start_angle)
    }

    pub(crate) fn end_point(self) -> CanvasPoint {
        self.point_at(self.start_angle + self.sweep)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FillRect {
    /// Rectangle corners after applying the current transformation matrix.
    pub points: [CanvasPoint; 4],
    pub color: gpui::Rgba,
    pub op_index: usize,
    pub clear_regions: Vec<CanvasQuad>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PathCommand {
    MoveTo(CanvasPoint),
    LineTo(CanvasPoint),
    CubicTo {
        control_a: CanvasPoint,
        control_b: CanvasPoint,
        to: CanvasPoint,
    },
    QuadraticTo {
        control: CanvasPoint,
        to: CanvasPoint,
    },
    Ellipse(EllipseArc),
    ClosePath,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CanvasFillRule {
    NonZero,
    EvenOdd,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FillPath {
    /// Path coordinates are transformed when the path command is replayed,
    /// matching Canvas 2D's current-path semantics.
    pub commands: Vec<PathCommand>,
    pub color: gpui::Rgba,
    pub fill_rule: CanvasFillRule,
    pub op_index: usize,
    pub clear_regions: Vec<CanvasQuad>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CanvasLineJoin {
    Miter,
    Round,
    Bevel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CanvasLineCap {
    Butt,
    Round,
    Square,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrokeStyle {
    pub color: gpui::Rgba,
    pub line_width: f64,
    pub line_cap: CanvasLineCap,
    pub line_join: CanvasLineJoin,
    pub miter_limit: f64,
    pub line_dash: Vec<f64>,
    pub transform: CanvasTransform,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrokeRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub transform: CanvasTransform,
    pub style: StrokeStyle,
    pub op_index: usize,
    pub clear_regions: Vec<CanvasQuad>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrokePathStyle {
    pub color: gpui::Rgba,
    pub line_width: f64,
    pub line_cap: CanvasLineCap,
    pub line_join: CanvasLineJoin,
    pub miter_limit: f64,
    pub line_dash: Vec<f64>,
    pub transform: CanvasTransform,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrokePath {
    pub commands: Vec<PathCommand>,
    pub style: StrokePathStyle,
    pub op_index: usize,
    pub clear_regions: Vec<CanvasQuad>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DrawImage {
    pub source: crate::custom_elements::img::CanvasImageSource,
    pub source_rect: Option<[f64; 4]>,
    pub destination_rect: [f64; 4],
    pub transform: CanvasTransform,
    pub opacity: f32,
    pub op_index: usize,
    pub clear_regions: Vec<CanvasQuad>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DisplayItem {
    FillRect(FillRect),
    FillPath(FillPath),
    StrokeRect(StrokeRect),
    StrokePath(StrokePath),
    DrawImage(DrawImage),
}

#[derive(Clone, Debug)]
pub struct DisplayList {
    pub revision: u64,
    pub items: Vec<DisplayItem>,
}

impl DisplayList {
    pub(crate) fn image_sources(&self) -> Vec<crate::custom_elements::img::CanvasImageSource> {
        let mut sources = FxHashMap::default();
        for item in &self.items {
            if let DisplayItem::DrawImage(image) = item {
                sources
                    .entry(image.source.key.clone())
                    .or_insert_with(|| image.source.clone());
            }
        }
        sources.into_values().collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanvasDiagnostic {
    pub op_index: usize,
    pub op_name: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeError {
    pub op_index: Option<usize>,
    pub reason: String,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.op_index {
            Some(index) => write!(f, "canvas command op {index}: {}", self.reason),
            None => write!(f, "canvas command stream: {}", self.reason),
        }
    }
}

impl std::error::Error for DecodeError {}

pub(crate) struct DecodedDisplayList {
    items: Vec<DisplayItem>,
    pub(crate) diagnostics: Vec<CanvasDiagnostic>,
    invalidates: bool,
    ignored_empty_restore: bool,
}

#[derive(Debug)]
pub(crate) struct CanvasApplyOutcome {
    pub diagnostics: Vec<CanvasDiagnostic>,
    pub invalidates: bool,
}

#[derive(Clone)]
struct ReplayState {
    fill_style: gpui::Rgba,
    stroke_style: gpui::Rgba,
    line_width: f64,
    global_alpha: f64,
    line_cap: CanvasLineCap,
    line_join: CanvasLineJoin,
    miter_limit: f64,
    line_dash: Vec<f64>,
    transform: CanvasTransform,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

impl CanvasTransform {
    pub(crate) const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub(crate) fn is_axis_aligned(self) -> bool {
        self.b == 0.0 && self.c == 0.0
    }

    pub(crate) fn has_negative_axis_scale(self) -> bool {
        self.a < 0.0 || self.d < 0.0
    }

    #[cfg(test)]
    pub(crate) const fn from_components(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Self {
        Self { a, b, c, d, e, f }
    }

    fn multiply(self, right: Self) -> Self {
        Self {
            a: self.a * right.a + self.c * right.b,
            b: self.b * right.a + self.d * right.b,
            c: self.a * right.c + self.c * right.d,
            d: self.b * right.c + self.d * right.d,
            e: self.a * right.e + self.c * right.f + self.e,
            f: self.b * right.e + self.d * right.f + self.f,
        }
    }

    pub(crate) fn transform_point(self, x: f64, y: f64) -> CanvasPoint {
        CanvasPoint {
            x: self.a * x + self.c * y + self.e,
            y: self.b * x + self.d * y + self.f,
        }
    }

    pub(crate) fn inverse_transform_point(self, point: CanvasPoint) -> Option<CanvasPoint> {
        let x = point.x - self.e;
        let y = point.y - self.f;
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        let solve = |a: f64, b: f64, c: f64, d: f64, x: f64, y: f64| {
            let point = if a.abs() >= b.abs() {
                if a == 0.0 {
                    return None;
                }
                let ratio = b / a;
                let denominator = d - ratio * c;
                if denominator == 0.0 || !denominator.is_finite() {
                    return None;
                }
                let local_y = (y - ratio * x) / denominator;
                CanvasPoint {
                    x: (x - c * local_y) / a,
                    y: local_y,
                }
            } else {
                let ratio = a / b;
                let denominator = c - ratio * d;
                if denominator == 0.0 || !denominator.is_finite() {
                    return None;
                }
                let local_y = (x - ratio * y) / denominator;
                CanvasPoint {
                    x: (y - d * local_y) / b,
                    y: local_y,
                }
            };
            (point.x.is_finite() && point.y.is_finite()).then_some(point)
        };
        if let Some(point) = solve(self.a, self.b, self.c, self.d, x, y) {
            return Some(point);
        }

        let scale = self
            .a
            .abs()
            .max(self.b.abs())
            .max(self.c.abs())
            .max(self.d.abs());
        if !scale.is_finite() || scale == 0.0 {
            return None;
        }
        let a = self.a / scale;
        let b = self.b / scale;
        let c = self.c / scale;
        let d = self.d / scale;
        let determinant = a * d - b * c;
        if !determinant.is_finite() || determinant == 0.0 {
            return None;
        }
        solve(a, b, c, d, x / scale, y / scale)
    }

    pub(crate) fn has_invertible_linear_part(self) -> bool {
        if ![self.a, self.b, self.c, self.d]
            .into_iter()
            .all(f64::is_finite)
        {
            return false;
        }
        if self.a.abs() >= self.b.abs() {
            self.a != 0.0 && self.d - (self.b / self.a) * self.c != 0.0
        } else {
            self.b != 0.0 && self.c - (self.a / self.b) * self.d != 0.0
        }
    }

    pub(crate) fn max_scale_after_output_scale(self, scale_x: f64, scale_y: f64) -> f64 {
        let a = self.a * scale_x;
        let b = self.b * scale_y;
        let c = self.c * scale_x;
        let d = self.d * scale_y;
        let xx = a * a + b * b;
        let yy = c * c + d * d;
        let xy = a * c + b * d;
        let discriminant = ((xx - yy) * (xx - yy) + 4.0 * xy * xy).sqrt();
        ((xx + yy + discriminant) * 0.5).sqrt()
    }
}

fn point_preparation_problem(point: CanvasPoint) -> Option<&'static str> {
    let x = point.x as f32;
    let y = point.y as f32;
    (!point.x.is_finite() || !point.y.is_finite() || !x.is_finite() || !y.is_finite())
        .then_some("transformed geometry must remain finite in GPUI coordinates")
}

fn path_preparation_problem(commands: &[PathCommand]) -> Option<String> {
    let problem = |point| point_preparation_problem(point).map(str::to_string);
    for command in commands {
        let reason = match command {
            PathCommand::MoveTo(point) | PathCommand::LineTo(point) => problem(*point),
            PathCommand::CubicTo {
                control_a,
                control_b,
                to,
            } => problem(*control_a)
                .or_else(|| problem(*control_b))
                .or_else(|| problem(*to)),
            PathCommand::QuadraticTo { control, to } => problem(*control).or_else(|| problem(*to)),
            PathCommand::Ellipse(arc) => problem(arc.start_point())
                .or_else(|| problem(arc.end_point()))
                .or_else(|| problem(arc.point_at(arc.start_angle + arc.sweep * 0.5))),
            PathCommand::ClosePath => None,
        };
        if reason.is_some() {
            return reason;
        }
    }
    None
}

fn same_point(left: CanvasPoint, right: CanvasPoint) -> bool {
    (left.x - right.x).abs() <= f64::EPSILON && (left.y - right.y).abs() <= f64::EPSILON
}

fn normalized_arc_sweep(start: f64, end: f64, counterclockwise: bool) -> f64 {
    let tau = std::f64::consts::TAU;
    let raw = end - start;
    if counterclockwise {
        if raw <= -tau {
            -tau
        } else if raw >= tau {
            -tau
        } else if raw > 0.0 {
            raw - tau
        } else {
            raw
        }
    } else if raw >= tau || raw <= -tau {
        tau
    } else if raw < 0.0 {
        raw + tau
    } else {
        raw
    }
}

#[allow(clippy::too_many_arguments)]
fn append_ellipse(
    commands: &mut Vec<PathCommand>,
    current_point: &mut Option<CanvasPoint>,
    subpath_start: &mut Option<CanvasPoint>,
    transform: CanvasTransform,
    center: CanvasPoint,
    radius_x: f64,
    radius_y: f64,
    rotation: f64,
    start: f64,
    end: f64,
    counterclockwise: bool,
) {
    let sweep = normalized_arc_sweep(start, end, counterclockwise);
    let arc = EllipseArc {
        center,
        radius_x,
        radius_y,
        rotation,
        start_angle: start,
        sweep,
        transform,
    };
    let start_point = arc.start_point();
    match *current_point {
        Some(point) if !same_point(point, start_point) => {
            commands.push(PathCommand::LineTo(start_point))
        }
        None => {
            commands.push(PathCommand::MoveTo(start_point));
            *subpath_start = Some(start_point);
        }
        _ => {}
    }
    *current_point = Some(start_point);

    if sweep == 0.0 || radius_x == 0.0 || radius_y == 0.0 {
        return;
    }
    commands.push(PathCommand::Ellipse(arc));
    *current_point = Some(arc.end_point());
}

fn path_has_segments(commands: &[PathCommand]) -> bool {
    commands.iter().any(|command| {
        matches!(
            command,
            PathCommand::LineTo(_)
                | PathCommand::CubicTo { .. }
                | PathCommand::QuadraticTo { .. }
                | PathCommand::Ellipse(_)
        )
    })
}

fn rect_quad(transform: CanvasTransform, x: f64, y: f64, width: f64, height: f64) -> CanvasQuad {
    [
        transform.transform_point(x, y),
        transform.transform_point(x + width, y),
        transform.transform_point(x + width, y + height),
        transform.transform_point(x, y + height),
    ]
}

fn cross(a: CanvasPoint, b: CanvasPoint, point: CanvasPoint) -> f64 {
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

fn quad_area(quad: &CanvasQuad) -> f64 {
    quad.iter()
        .zip(quad.iter().cycle().skip(1))
        .take(4)
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}

fn quad_contains_point(quad: &CanvasQuad, point: CanvasPoint) -> bool {
    let orientation = quad_area(quad).signum();
    if orientation == 0.0 {
        return false;
    }
    quad.iter()
        .zip(quad.iter().cycle().skip(1))
        .take(4)
        .all(|(&a, &b)| cross(a, b, point) * orientation >= -1e-9)
}

fn segments_intersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) -> bool {
    let ranges_overlap =
        |a: f64, b: f64, c: f64, d: f64| a.min(b) <= c.max(d) + 1e-9 && c.min(d) <= a.max(b) + 1e-9;
    if !ranges_overlap(a.x, b.x, c.x, d.x) || !ranges_overlap(a.y, b.y, c.y, d.y) {
        return false;
    }
    let ab_c = cross(a, b, c);
    let ab_d = cross(a, b, d);
    let cd_a = cross(c, d, a);
    let cd_b = cross(c, d, b);
    ab_c * ab_d <= 1e-9 && cd_a * cd_b <= 1e-9
}

fn quad_edges(quad: &CanvasQuad) -> impl Iterator<Item = (CanvasPoint, CanvasPoint)> + '_ {
    quad.iter()
        .copied()
        .zip(quad.iter().copied().cycle().skip(1))
        .take(4)
}

fn quads_intersect(left: &CanvasQuad, right: &CanvasQuad) -> bool {
    left.iter()
        .copied()
        .any(|point| quad_contains_point(right, point))
        || right
            .iter()
            .copied()
            .any(|point| quad_contains_point(left, point))
        || quad_edges(left)
            .any(|(a, b)| quad_edges(right).any(|(c, d)| segments_intersect(a, b, c, d)))
}

fn path_subpaths(commands: &[PathCommand]) -> Vec<Vec<CanvasPoint>> {
    let mut subpaths = Vec::new();
    let mut current = Vec::new();
    for command in commands {
        match command {
            PathCommand::MoveTo(point) => {
                if current.len() > 1 {
                    subpaths.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
                current.push(*point);
            }
            PathCommand::LineTo(point)
            | PathCommand::CubicTo { to: point, .. }
            | PathCommand::QuadraticTo { to: point, .. } => current.push(*point),
            PathCommand::Ellipse(arc) => current.push(arc.end_point()),
            PathCommand::ClosePath => {
                if current.len() > 1 {
                    subpaths.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
            }
        }
    }
    if current.len() > 1 {
        subpaths.push(current);
    }
    subpaths
}

fn path_winding_at(subpaths: &[Vec<CanvasPoint>], point: CanvasPoint) -> i32 {
    let mut winding = 0;
    for subpath in subpaths {
        for (&a, &b) in subpath
            .iter()
            .zip(subpath.iter().cycle().skip(1))
            .take(subpath.len())
        {
            if a.y <= point.y {
                if b.y > point.y && cross(a, b, point) > 0.0 {
                    winding += 1;
                }
            } else if b.y <= point.y && cross(a, b, point) < 0.0 {
                winding -= 1;
            }
        }
    }
    winding
}

fn path_intersects_quad(commands: &[PathCommand], quad: &CanvasQuad) -> bool {
    let subpaths = path_subpaths(commands);
    subpaths.iter().any(|subpath| {
        subpath
            .iter()
            .copied()
            .any(|point| quad_contains_point(quad, point))
            || subpath
                .iter()
                .copied()
                .zip(subpath.iter().copied().cycle().skip(1))
                .take(subpath.len())
                .any(|(a, b)| quad_edges(quad).any(|(c, d)| segments_intersect(a, b, c, d)))
    }) || quad
        .iter()
        .copied()
        .any(|point| path_winding_at(&subpaths, point) != 0)
}

fn path_control_bounds(commands: &[PathCommand]) -> Option<(f64, f64, f64, f64)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut include = |point: CanvasPoint| {
        min_x = min_x.min(point.x);
        min_y = min_y.min(point.y);
        max_x = max_x.max(point.x);
        max_y = max_y.max(point.y);
    };
    for command in commands {
        match command {
            PathCommand::MoveTo(point) | PathCommand::LineTo(point) => include(*point),
            PathCommand::CubicTo {
                control_a,
                control_b,
                to,
            } => {
                include(*control_a);
                include(*control_b);
                include(*to);
            }
            PathCommand::QuadraticTo { control, to } => {
                include(*control);
                include(*to);
            }
            PathCommand::Ellipse(arc) => {
                let (sin_rotation, cos_rotation) = arc.rotation.sin_cos();
                let x_extent = arc.radius_x.abs() * cos_rotation.abs()
                    + arc.radius_y.abs() * sin_rotation.abs();
                let y_extent = arc.radius_x.abs() * sin_rotation.abs()
                    + arc.radius_y.abs() * cos_rotation.abs();
                for point in [
                    CanvasPoint {
                        x: arc.center.x - x_extent,
                        y: arc.center.y - y_extent,
                    },
                    CanvasPoint {
                        x: arc.center.x + x_extent,
                        y: arc.center.y - y_extent,
                    },
                    CanvasPoint {
                        x: arc.center.x - x_extent,
                        y: arc.center.y + y_extent,
                    },
                    CanvasPoint {
                        x: arc.center.x + x_extent,
                        y: arc.center.y + y_extent,
                    },
                ] {
                    include(arc.transform.transform_point(point.x, point.y));
                }
            }
            PathCommand::ClosePath => {}
        }
    }
    min_x.is_finite().then_some((min_x, min_y, max_x, max_y))
}

fn bounds_intersect_quad(bounds: (f64, f64, f64, f64), expansion: f64, quad: &CanvasQuad) -> bool {
    let (min_x, min_y, max_x, max_y) = bounds;
    let quad_min_x = quad
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let quad_min_y = quad
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let quad_max_x = quad
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let quad_max_y = quad
        .iter()
        .map(|point| point.y)
        .fold(f64::NEG_INFINITY, f64::max);
    min_x - expansion <= quad_max_x
        && max_x + expansion >= quad_min_x
        && min_y - expansion <= quad_max_y
        && max_y + expansion >= quad_min_y
}

fn stroke_path_intersects_quad(path: &StrokePath, quad: &CanvasQuad) -> bool {
    let Some(bounds) = path_control_bounds(&path.commands) else {
        return false;
    };
    let half_width =
        path.style.line_width * path.style.transform.max_scale_after_output_scale(1.0, 1.0) * 0.5;
    bounds_intersect_quad(bounds, half_width, quad)
}

impl DisplayItem {
    fn clear_regions(&self) -> &[CanvasQuad] {
        match self {
            Self::FillRect(rect) => &rect.clear_regions,
            Self::FillPath(path) => &path.clear_regions,
            Self::StrokeRect(rect) => &rect.clear_regions,
            Self::StrokePath(path) => &path.clear_regions,
            Self::DrawImage(image) => &image.clear_regions,
        }
    }

    fn clear_regions_mut(&mut self) -> &mut Vec<CanvasQuad> {
        match self {
            Self::FillRect(rect) => &mut rect.clear_regions,
            Self::FillPath(path) => &mut path.clear_regions,
            Self::StrokeRect(rect) => &mut rect.clear_regions,
            Self::StrokePath(path) => &mut path.clear_regions,
            Self::DrawImage(image) => &mut image.clear_regions,
        }
    }

    fn intersects_quad(&self, quad: &CanvasQuad) -> bool {
        if self
            .clear_regions()
            .iter()
            .any(|clear| quad.iter().all(|point| quad_contains_point(clear, *point)))
        {
            return false;
        }
        match self {
            Self::FillRect(rect) => quads_intersect(&rect.points, quad),
            Self::FillPath(path) => {
                path_intersects_quad(&path.commands, quad)
                    || path_control_bounds(&path.commands)
                        .is_some_and(|bounds| bounds_intersect_quad(bounds, 0.0, quad))
            }
            Self::StrokePath(path) => stroke_path_intersects_quad(path, quad),
            Self::StrokeRect(rect) => {
                let half_width = rect.style.line_width * 0.5;
                if rect.width == 0.0 && rect.height == 0.0 {
                    return false;
                }
                if rect.width == 0.0 {
                    let stroke = rect_quad(
                        rect.transform,
                        rect.x - half_width,
                        rect.y.min(rect.y + rect.height),
                        rect.style.line_width,
                        rect.height.abs(),
                    );
                    return quads_intersect(&stroke, quad);
                }
                if rect.height == 0.0 {
                    let stroke = rect_quad(
                        rect.transform,
                        rect.x.min(rect.x + rect.width),
                        rect.y - half_width,
                        rect.width.abs(),
                        rect.style.line_width,
                    );
                    return quads_intersect(&stroke, quad);
                }
                let left = rect.x.min(rect.x + rect.width);
                let right = rect.x.max(rect.x + rect.width);
                let top = rect.y.min(rect.y + rect.height);
                let bottom = rect.y.max(rect.y + rect.height);
                let outer = rect_quad(
                    rect.transform,
                    left - half_width,
                    top - half_width,
                    right - left + rect.style.line_width,
                    bottom - top + rect.style.line_width,
                );
                if !quads_intersect(&outer, quad) {
                    return false;
                }
                let inner_width = right - left - rect.style.line_width;
                let inner_height = bottom - top - rect.style.line_width;
                if inner_width <= 0.0 || inner_height <= 0.0 {
                    return true;
                }
                let inner = rect_quad(
                    rect.transform,
                    left + half_width,
                    top + half_width,
                    inner_width,
                    inner_height,
                );
                !quad.iter().all(|point| quad_contains_point(&inner, *point))
            }
            Self::DrawImage(image) => quads_intersect(
                &rect_quad(
                    image.transform,
                    image.destination_rect[0],
                    image.destination_rect[1],
                    image.destination_rect[2],
                    image.destination_rect[3],
                ),
                quad,
            ),
        }
    }
}

fn quad_covers_canvas(quad: &CanvasQuad, size: CanvasSize) -> bool {
    rect_quad(CanvasTransform::IDENTITY, 0.0, 0.0, size.width, size.height)
        .iter()
        .all(|point| quad_contains_point(quad, *point))
}

fn malformed(op_index: usize, reason: impl Into<String>) -> DecodeError {
    DecodeError {
        op_index: Some(op_index),
        reason: reason.into(),
    }
}

fn side_table_index(
    value: f64,
    op_index: usize,
    operand_index: usize,
) -> Result<usize, DecodeError> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > usize::MAX as f64 {
        return Err(malformed(
            op_index,
            format!("operand {operand_index} must be an exact non-negative side-table index, got {value}"),
        ));
    }
    Ok(value as usize)
}

pub(crate) fn decode(
    ops: &[u32],
    operands: &[f64],
    strings: &[String],
    canvas_size: CanvasSize,
) -> Result<DecodedDisplayList, DecodeError> {
    if ops.len() < 2 {
        return Err(DecodeError {
            op_index: None,
            reason: format!("expected magic and version header, got {} words", ops.len()),
        });
    }
    if ops[0] != opcodes::STREAM_MAGIC {
        return Err(DecodeError {
            op_index: None,
            reason: format!("invalid magic 0x{:08x}", ops[0]),
        });
    }
    if ops[1] != opcodes::STREAM_VERSION {
        return Err(DecodeError {
            op_index: None,
            reason: format!(
                "unsupported version {}; expected {}",
                ops[1],
                opcodes::STREAM_VERSION
            ),
        });
    }

    let mut op_cursor = 2usize;
    let mut operand_cursor = 0usize;
    let mut op_index = 0usize;
    let mut state = ReplayState {
        fill_style: crate::color::parse_color_rgba("#000000").expect("black is valid"),
        stroke_style: crate::color::parse_color_rgba("#000000").expect("black is valid"),
        line_width: 1.0,
        global_alpha: 1.0,
        line_cap: CanvasLineCap::Butt,
        line_join: CanvasLineJoin::Miter,
        miter_limit: 10.0,
        line_dash: Vec::new(),
        transform: CanvasTransform::IDENTITY,
    };
    let mut stack = Vec::new();
    let mut current_path = Vec::new();
    let mut current_point = None;
    let mut subpath_start = None;
    let mut items = Vec::new();
    let mut diagnostics = Vec::new();
    let mut invalidates = false;
    let mut ignored_empty_restore = false;

    while op_cursor < ops.len() {
        if ops.len() - op_cursor < 2 {
            return Err(malformed(
                op_index,
                "opcode header is truncated; expected opcode and arity",
            ));
        }
        let code = ops[op_cursor];
        let arity = ops[op_cursor + 1] as usize;
        op_cursor += 2;

        let operand_end = operand_cursor
            .checked_add(arity)
            .ok_or_else(|| malformed(op_index, "operand arity overflowed the stream index"))?;
        if operand_end > operands.len() {
            return Err(malformed(
                op_index,
                format!(
                    "declares {arity} operands but only {} remain",
                    operands.len().saturating_sub(operand_cursor)
                ),
            ));
        }
        let command_operands = &operands[operand_cursor..operand_end];
        operand_cursor = operand_end;

        let Some(spec) = opcodes::spec(code) else {
            diagnostics.push(CanvasDiagnostic {
                op_index,
                op_name: format!("unknown(0x{code:08x})"),
                reason: format!(
                    "opcode 0x{code:08x} is not defined by canvas stream version {}",
                    opcodes::STREAM_VERSION
                ),
            });
            op_index += 1;
            continue;
        };

        if let opcodes::OperandArity::Fixed(expected) = spec.arity {
            if arity != expected as usize {
                return Err(malformed(
                    op_index,
                    format!(
                        "{} declares arity {arity}; version {} requires {expected}",
                        spec.name,
                        opcodes::STREAM_VERSION
                    ),
                ));
            }
        }

        for &slot in spec.side_table_slots {
            let slot = usize::from(slot);
            let index = side_table_index(command_operands[slot], op_index, slot)?;
            if index >= strings.len() {
                return Err(malformed(
                    op_index,
                    format!(
                        "{} operand {slot} references side-table slot {index}, but the table has {} entries",
                        spec.name,
                        strings.len()
                    ),
                ));
            }
        }

        match code {
            opcodes::SAVE => stack.push(state.clone()),
            opcodes::RESTORE => {
                if let Some(restored) = stack.pop() {
                    state = restored;
                } else {
                    ignored_empty_restore = true;
                }
                // Canvas restore() on an empty stack is an observable no-op.
            }
            opcodes::TRANSLATE => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    state.transform = state.transform.multiply(CanvasTransform {
                        e: command_operands[0],
                        f: command_operands[1],
                        ..CanvasTransform::IDENTITY
                    });
                }
            }
            opcodes::SCALE => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    state.transform = state.transform.multiply(CanvasTransform {
                        a: command_operands[0],
                        d: command_operands[1],
                        ..CanvasTransform::IDENTITY
                    });
                }
            }
            opcodes::ROTATE => {
                if command_operands[0].is_finite() {
                    let (sin, cos) = command_operands[0].sin_cos();
                    state.transform = state.transform.multiply(CanvasTransform {
                        a: cos,
                        b: sin,
                        c: -sin,
                        d: cos,
                        e: 0.0,
                        f: 0.0,
                    });
                }
            }
            opcodes::TRANSFORM => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    state.transform = state.transform.multiply(CanvasTransform {
                        a: command_operands[0],
                        b: command_operands[1],
                        c: command_operands[2],
                        d: command_operands[3],
                        e: command_operands[4],
                        f: command_operands[5],
                    });
                }
            }
            opcodes::SET_TRANSFORM => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    state.transform = CanvasTransform {
                        a: command_operands[0],
                        b: command_operands[1],
                        c: command_operands[2],
                        d: command_operands[3],
                        e: command_operands[4],
                        f: command_operands[5],
                    };
                }
            }
            opcodes::RESET_TRANSFORM => state.transform = CanvasTransform::IDENTITY,
            opcodes::FILL_STYLE => {
                let index = side_table_index(command_operands[0], op_index, 0)?;
                let value = &strings[index];
                if let Some(color) = crate::color::parse_color_rgba(value) {
                    state.fill_style = color;
                } else {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: spec.name.to_string(),
                        reason: format!("unsupported Canvas 2D color {value:?}"),
                    });
                }
            }
            opcodes::STROKE_STYLE => {
                let index = side_table_index(command_operands[0], op_index, 0)?;
                let value = &strings[index];
                if let Some(color) = crate::color::parse_color_rgba(value) {
                    state.stroke_style = color;
                } else {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: spec.name.to_string(),
                        reason: format!("unsupported Canvas 2D color {value:?}"),
                    });
                }
            }
            opcodes::LINE_WIDTH => {
                let value = command_operands[0];
                if value.is_finite() && value > 0.0 {
                    state.line_width = value;
                }
            }
            opcodes::GLOBAL_ALPHA => {
                let value = command_operands[0];
                if value.is_finite() && (0.0..=1.0).contains(&value) {
                    state.global_alpha = value;
                }
            }
            opcodes::LINE_CAP => {
                let index = side_table_index(command_operands[0], op_index, 0)?;
                state.line_cap = match strings[index].as_str() {
                    "butt" => CanvasLineCap::Butt,
                    "round" => CanvasLineCap::Round,
                    "square" => CanvasLineCap::Square,
                    value => {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason: format!("unsupported Canvas 2D lineCap {value:?}"),
                        });
                        state.line_cap
                    }
                };
            }
            opcodes::LINE_JOIN => {
                let index = side_table_index(command_operands[0], op_index, 0)?;
                state.line_join = match strings[index].as_str() {
                    "miter" => CanvasLineJoin::Miter,
                    "round" => CanvasLineJoin::Round,
                    "bevel" => CanvasLineJoin::Bevel,
                    value => {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason: format!("unsupported Canvas 2D lineJoin {value:?}"),
                        });
                        state.line_join
                    }
                };
            }
            opcodes::MITER_LIMIT => {
                let value = command_operands[0];
                if value.is_finite() && value > 0.0 {
                    state.miter_limit = value;
                }
            }
            opcodes::SET_LINE_DASH => {
                if command_operands
                    .iter()
                    .all(|value| value.is_finite() && *value >= 0.0)
                {
                    state.line_dash = command_operands.to_vec();
                }
            }
            opcodes::LINE_DASH_OFFSET => {
                if command_operands[0] != 0.0 {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: spec.name.to_string(),
                        reason: "lineDashOffset is not supported by GPUI PathBuilder; nonzero offsets cannot be replayed faithfully"
                            .to_string(),
                    });
                }
            }
            opcodes::FILL_RECT => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let x = command_operands[0];
                    let y = command_operands[1];
                    let width = command_operands[2];
                    let height = command_operands[3];
                    let points = rect_quad(state.transform, x, y, width, height);
                    if let Some(reason) = points
                        .iter()
                        .find_map(|point| point_preparation_problem(*point))
                    {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason: reason.to_string(),
                        });
                    } else {
                        items.push(DisplayItem::FillRect(FillRect {
                            points,
                            color: state.fill_style.opacity(state.global_alpha as f32),
                            op_index,
                            clear_regions: Vec::new(),
                        }));
                        invalidates = true;
                    }
                }
                // Browser Canvas treats non-finite rectangle arguments as a no-op.
            }
            opcodes::STROKE_RECT => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let x = command_operands[0];
                    let y = command_operands[1];
                    let width = command_operands[2];
                    let height = command_operands[3];
                    if width == 0.0 && height == 0.0 {
                        // The common loop tail normally advances this index.
                        op_index += 1;
                        continue;
                    }
                    let left = x.min(x + width);
                    let right = x.max(x + width);
                    let top = y.min(y + height);
                    let bottom = y.max(y + height);
                    let outer = rect_quad(
                        state.transform,
                        left - state.line_width * 0.5,
                        top - state.line_width * 0.5,
                        right - left + state.line_width,
                        bottom - top + state.line_width,
                    );
                    if let Some(reason) = outer
                        .iter()
                        .find_map(|point| point_preparation_problem(*point))
                    {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason: reason.to_string(),
                        });
                    } else {
                        items.push(DisplayItem::StrokeRect(StrokeRect {
                            x,
                            y,
                            width,
                            height,
                            transform: state.transform,
                            style: StrokeStyle {
                                color: state.stroke_style.opacity(state.global_alpha as f32),
                                line_width: state.line_width,
                                line_cap: state.line_cap,
                                line_join: state.line_join,
                                miter_limit: state.miter_limit,
                                line_dash: state.line_dash.clone(),
                                transform: state.transform,
                            },
                            op_index,
                            clear_regions: Vec::new(),
                        }));
                        invalidates = true;
                    }
                }
            }
            opcodes::CLEAR_RECT => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let clear = rect_quad(
                        state.transform,
                        command_operands[0],
                        command_operands[1],
                        command_operands[2],
                        command_operands[3],
                    );
                    if let Some(reason) = clear
                        .iter()
                        .find_map(|point| point_preparation_problem(*point))
                    {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason: reason.to_string(),
                        });
                    } else if quad_area(&clear).abs() > 1e-9 {
                        let canvas = rect_quad(
                            CanvasTransform::IDENTITY,
                            0.0,
                            0.0,
                            canvas_size.width,
                            canvas_size.height,
                        );
                        if quads_intersect(&clear, &canvas) {
                            if quad_covers_canvas(&clear, canvas_size) {
                                items.clear();
                                invalidates = true;
                            } else {
                                let mut intersects_prior_content = false;
                                for item in &mut items {
                                    if item.intersects_quad(&clear) {
                                        item.clear_regions_mut().push(clear);
                                        intersects_prior_content = true;
                                    }
                                }
                                if intersects_prior_content {
                                    invalidates = true;
                                } else {
                                    diagnostics.push(CanvasDiagnostic {
                                        op_index,
                                        op_name: spec.name.to_string(),
                                        reason: "partial clearRect does not intersect prior canvas content and would punch through to GPUI content behind the canvas"
                                            .to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            opcodes::BEGIN_PATH => {
                current_path.clear();
                current_point = None;
                subpath_start = None;
            }
            opcodes::MOVE_TO => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let point = state
                        .transform
                        .transform_point(command_operands[0], command_operands[1]);
                    current_path.push(PathCommand::MoveTo(point));
                    current_point = Some(point);
                    subpath_start = Some(point);
                }
            }
            opcodes::LINE_TO => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let point = state
                        .transform
                        .transform_point(command_operands[0], command_operands[1]);
                    if current_point.is_some() {
                        current_path.push(PathCommand::LineTo(point));
                    } else {
                        current_path.push(PathCommand::MoveTo(point));
                        subpath_start = Some(point);
                    }
                    current_point = Some(point);
                }
            }
            opcodes::BEZIER_CURVE_TO => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let control_a = state
                        .transform
                        .transform_point(command_operands[0], command_operands[1]);
                    let control_b = state
                        .transform
                        .transform_point(command_operands[2], command_operands[3]);
                    let to = state
                        .transform
                        .transform_point(command_operands[4], command_operands[5]);
                    if current_point.is_none() {
                        current_path.push(PathCommand::MoveTo(control_a));
                        subpath_start = Some(control_a);
                    }
                    current_path.push(PathCommand::CubicTo {
                        control_a,
                        control_b,
                        to,
                    });
                    current_point = Some(to);
                }
            }
            opcodes::QUADRATIC_CURVE_TO => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let control = state
                        .transform
                        .transform_point(command_operands[0], command_operands[1]);
                    let to = state
                        .transform
                        .transform_point(command_operands[2], command_operands[3]);
                    if current_point.is_none() {
                        current_path.push(PathCommand::MoveTo(control));
                        subpath_start = Some(control);
                    }
                    current_path.push(PathCommand::QuadraticTo { control, to });
                    current_point = Some(to);
                }
            }
            opcodes::ARC => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    append_ellipse(
                        &mut current_path,
                        &mut current_point,
                        &mut subpath_start,
                        state.transform,
                        CanvasPoint {
                            x: command_operands[0],
                            y: command_operands[1],
                        },
                        command_operands[2],
                        command_operands[2],
                        0.0,
                        command_operands[3],
                        command_operands[4],
                        command_operands[5] != 0.0,
                    );
                }
            }
            opcodes::ARC_TO => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let first = CanvasPoint {
                        x: command_operands[0],
                        y: command_operands[1],
                    };
                    let second = CanvasPoint {
                        x: command_operands[2],
                        y: command_operands[3],
                    };
                    let radius = command_operands[4];
                    let Some(transformed_current) = current_point else {
                        let point = state.transform.transform_point(first.x, first.y);
                        current_path.push(PathCommand::MoveTo(point));
                        current_point = Some(point);
                        subpath_start = Some(point);
                        op_index += 1;
                        continue;
                    };
                    let Some(current) =
                        state.transform.inverse_transform_point(transformed_current)
                    else {
                        let point = state.transform.transform_point(first.x, first.y);
                        current_path.push(PathCommand::LineTo(point));
                        current_point = Some(point);
                        op_index += 1;
                        continue;
                    };
                    let first_length =
                        ((current.x - first.x).powi(2) + (current.y - first.y).powi(2)).sqrt();
                    let second_length =
                        ((second.x - first.x).powi(2) + (second.y - first.y).powi(2)).sqrt();
                    let cross_value = (current.x - first.x) * (second.y - first.y)
                        - (current.y - first.y) * (second.x - first.x);
                    if radius == 0.0
                        || first_length <= f64::EPSILON
                        || second_length <= f64::EPSILON
                        || cross_value.abs() <= f64::EPSILON
                    {
                        let point = state.transform.transform_point(first.x, first.y);
                        current_path.push(PathCommand::LineTo(point));
                        current_point = Some(point);
                    } else {
                        let first_unit = CanvasPoint {
                            x: (current.x - first.x) / first_length,
                            y: (current.y - first.y) / first_length,
                        };
                        let second_unit = CanvasPoint {
                            x: (second.x - first.x) / second_length,
                            y: (second.y - first.y) / second_length,
                        };
                        let dot = (first_unit.x * second_unit.x + first_unit.y * second_unit.y)
                            .clamp(-1.0, 1.0);
                        let angle = dot.acos();
                        let distance = radius / (angle * 0.5).tan();
                        let tangent_a = CanvasPoint {
                            x: first.x + first_unit.x * distance,
                            y: first.y + first_unit.y * distance,
                        };
                        let tangent_b = CanvasPoint {
                            x: first.x + second_unit.x * distance,
                            y: first.y + second_unit.y * distance,
                        };
                        let bisector_length = ((first_unit.x + second_unit.x).powi(2)
                            + (first_unit.y + second_unit.y).powi(2))
                        .sqrt();
                        let center_distance = radius / (angle * 0.5).sin();
                        let center = CanvasPoint {
                            x: first.x
                                + (first_unit.x + second_unit.x) / bisector_length
                                    * center_distance,
                            y: first.y
                                + (first_unit.y + second_unit.y) / bisector_length
                                    * center_distance,
                        };
                        let start = (tangent_a.y - center.y).atan2(tangent_a.x - center.x);
                        let end = (tangent_b.y - center.y).atan2(tangent_b.x - center.x);
                        append_ellipse(
                            &mut current_path,
                            &mut current_point,
                            &mut subpath_start,
                            state.transform,
                            center,
                            radius,
                            radius,
                            0.0,
                            start,
                            end,
                            cross_value > 0.0,
                        );
                    }
                }
            }
            opcodes::ELLIPSE => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    append_ellipse(
                        &mut current_path,
                        &mut current_point,
                        &mut subpath_start,
                        state.transform,
                        CanvasPoint {
                            x: command_operands[0],
                            y: command_operands[1],
                        },
                        command_operands[2],
                        command_operands[3],
                        command_operands[4],
                        command_operands[5],
                        command_operands[6],
                        command_operands[7] != 0.0,
                    );
                }
            }
            opcodes::RECT => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    let points = rect_quad(
                        state.transform,
                        command_operands[0],
                        command_operands[1],
                        command_operands[2],
                        command_operands[3],
                    );
                    current_path.push(PathCommand::MoveTo(points[0]));
                    current_path.extend(points[1..].iter().copied().map(PathCommand::LineTo));
                    current_path.push(PathCommand::ClosePath);
                    current_point = Some(points[0]);
                    subpath_start = Some(points[0]);
                }
            }
            opcodes::CLOSE_PATH => {
                if current_point.is_some() && subpath_start.is_some() {
                    current_path.push(PathCommand::ClosePath);
                    current_point = subpath_start;
                }
            }
            opcodes::FILL => {
                let fill_rule = match command_operands[0] {
                    0.0 => CanvasFillRule::NonZero,
                    1.0 => CanvasFillRule::EvenOdd,
                    value => {
                        return Err(malformed(
                            op_index,
                            format!("fill rule must be 0 (nonzero) or 1 (evenodd), got {value}"),
                        ));
                    }
                };
                if path_has_segments(&current_path) {
                    if let Some(reason) = path_preparation_problem(&current_path) {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason,
                        });
                    } else {
                        items.push(DisplayItem::FillPath(FillPath {
                            commands: current_path.clone(),
                            color: state.fill_style.opacity(state.global_alpha as f32),
                            fill_rule,
                            op_index,
                            clear_regions: Vec::new(),
                        }));
                        invalidates = true;
                    }
                }
            }
            opcodes::STROKE => {
                if path_has_segments(&current_path) {
                    if let Some(reason) = path_preparation_problem(&current_path) {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: spec.name.to_string(),
                            reason,
                        });
                    } else {
                        items.push(DisplayItem::StrokePath(StrokePath {
                            commands: current_path.clone(),
                            style: StrokePathStyle {
                                color: state.stroke_style.opacity(state.global_alpha as f32),
                                line_width: state.line_width,
                                line_cap: state.line_cap,
                                line_join: state.line_join,
                                miter_limit: state.miter_limit,
                                line_dash: state.line_dash.clone(),
                                transform: state.transform,
                            },
                            op_index,
                            clear_regions: Vec::new(),
                        }));
                        invalidates = true;
                    }
                }
            }
            opcodes::DRAW_IMAGE_3 | opcodes::DRAW_IMAGE_5 | opcodes::DRAW_IMAGE_9 => {
                if !state.transform.is_axis_aligned() {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: "drawImage".to_string(),
                        reason: "R1: drawImage under a rotated or skewed CTM is not representable by GPUI PolychromeSprite; only axis-aligned translate/scale transforms are supported"
                            .to_string(),
                    });
                    op_index += 1;
                    continue;
                }
                if state.transform.has_negative_axis_scale() {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: "drawImage".to_string(),
                        reason: "R1: drawImage under a reflected CTM is not representable by GPUI PolychromeSprite; negative axis scales are unsupported"
                            .to_string(),
                    });
                    op_index += 1;
                    continue;
                }

                let source_slot = side_table_index(command_operands[0], op_index, 0)?;
                let source_wire = &strings[source_slot];
                let source_value = match serde_json::from_str::<serde_json::Value>(source_wire) {
                    Ok(value) => value,
                    Err(error) => {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: "drawImage".to_string(),
                            reason: format!("image source is not valid JSON: {error}"),
                        });
                        op_index += 1;
                        continue;
                    }
                };
                let source = match crate::custom_elements::img::ImageSource::parse(&source_value) {
                    Ok(source) => source,
                    Err(reason) => {
                        diagnostics.push(CanvasDiagnostic {
                            op_index,
                            op_name: "drawImage".to_string(),
                            reason: format!("invalid image source: {reason}"),
                        });
                        op_index += 1;
                        continue;
                    }
                };
                let (source_rect, destination_rect) = match code {
                    opcodes::DRAW_IMAGE_3 => (
                        None,
                        [command_operands[1], command_operands[2], f64::NAN, f64::NAN],
                    ),
                    opcodes::DRAW_IMAGE_5 => (
                        None,
                        [
                            command_operands[1],
                            command_operands[2],
                            command_operands[3],
                            command_operands[4],
                        ],
                    ),
                    opcodes::DRAW_IMAGE_9 => (
                        Some([
                            command_operands[1],
                            command_operands[2],
                            command_operands[3],
                            command_operands[4],
                        ]),
                        [
                            command_operands[5],
                            command_operands[6],
                            command_operands[7],
                            command_operands[8],
                        ],
                    ),
                    _ => unreachable!(),
                };
                if destination_rect[2..].iter().any(|value| *value == 0.0)
                    || source_rect.is_some_and(|rect| rect[2] == 0.0 || rect[3] == 0.0)
                {
                    op_index += 1;
                    continue;
                }
                items.push(DisplayItem::DrawImage(DrawImage {
                    source: crate::custom_elements::img::CanvasImageSource {
                        key: source_wire.clone(),
                        source,
                    },
                    source_rect,
                    destination_rect,
                    transform: state.transform,
                    opacity: state.global_alpha as f32,
                    op_index,
                    clear_regions: Vec::new(),
                }));
                invalidates = true;
            }
            _ => diagnostics.push(CanvasDiagnostic {
                op_index,
                op_name: spec.name.to_string(),
                reason: "recognized by stream version 1 but not implemented in canvas phase B3"
                    .to_string(),
            }),
        }

        op_index += 1;
    }

    if operand_cursor != operands.len() {
        return Err(malformed(
            op_index,
            format!(
                "{} trailing operands are not owned by an opcode",
                operands.len() - operand_cursor
            ),
        ));
    }

    Ok(DecodedDisplayList {
        items,
        diagnostics,
        invalidates,
        ignored_empty_restore,
    })
}

pub(crate) fn install_decoded_display_list(
    display_lists: &SharedDisplayLists,
    element_id: u64,
    decoded: DecodedDisplayList,
) -> CanvasApplyOutcome {
    let DecodedDisplayList {
        items,
        diagnostics,
        invalidates,
        ignored_empty_restore,
    } = decoded;
    if !invalidates {
        return CanvasApplyOutcome {
            diagnostics,
            invalidates: false,
        };
    }
    let mut lists = display_lists.lock().unwrap();
    if ignored_empty_restore
        && lists
            .get(&element_id)
            .is_some_and(|list| list.items == items)
    {
        return CanvasApplyOutcome {
            diagnostics,
            invalidates: false,
        };
    }
    if items.is_empty() {
        let removed = lists.remove(&element_id).is_some();
        return CanvasApplyOutcome {
            diagnostics,
            invalidates: removed,
        };
    }
    let revision = {
        let mut revisions = display_lists.last_revisions.lock().unwrap();
        let revision = revisions.entry(element_id).or_default();
        *revision = revision.saturating_add(1);
        *revision
    };
    lists.insert(element_id, Arc::new(DisplayList { revision, items }));
    CanvasApplyOutcome {
        diagnostics,
        invalidates: true,
    }
}

#[cfg(test)]
pub fn replace_display_list(
    display_lists: &SharedDisplayLists,
    element_id: u64,
    ops: &[u32],
    operands: &[f64],
    strings: &[String],
) -> Result<CanvasApplyOutcome, DecodeError> {
    replace_display_list_with_size(
        display_lists,
        element_id,
        ops,
        operands,
        strings,
        CanvasSize {
            width: DEFAULT_CANVAS_WIDTH,
            height: DEFAULT_CANVAS_HEIGHT,
        },
    )
}

#[cfg(test)]
fn replace_display_list_with_size(
    display_lists: &SharedDisplayLists,
    element_id: u64,
    ops: &[u32],
    operands: &[f64],
    strings: &[String],
    canvas_size: CanvasSize,
) -> Result<CanvasApplyOutcome, DecodeError> {
    Ok(install_decoded_display_list(
        display_lists,
        element_id,
        decode(ops, operands, strings, canvas_size)?,
    ))
}

pub fn remove_display_lists(display_lists: &SharedDisplayLists, element_ids: &[u64]) {
    let mut lists = display_lists.lock().unwrap();
    for id in element_ids {
        lists.remove(id);
    }
    drop(lists);
    if !element_ids.is_empty() {
        let mut revisions = display_lists.last_revisions.lock().unwrap();
        for id in element_ids {
            revisions.remove(id);
        }
        display_lists
            .preparation_diagnostics
            .lock()
            .unwrap()
            .retain(|diagnostic| !element_ids.contains(&diagnostic.element_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_point(point: CanvasPoint, expected: (f64, f64)) {
        assert!((point.x - expected.0).abs() < 1e-9, "x: {point:?}");
        assert!((point.y - expected.1).abs() < 1e-9, "y: {point:?}");
    }

    fn fill_rect(item: &DisplayItem) -> &FillRect {
        let DisplayItem::FillRect(rect) = item else {
            panic!("expected fillRect, got {item:?}");
        };
        rect
    }

    fn stream(commands: &[(u32, &[f64])]) -> (Vec<u32>, Vec<f64>) {
        let mut ops = vec![opcodes::STREAM_MAGIC, opcodes::STREAM_VERSION];
        let mut operands = Vec::new();
        for (opcode, values) in commands {
            ops.extend([*opcode, values.len() as u32]);
            operands.extend_from_slice(values);
        }
        (ops, operands)
    }

    #[test]
    fn decoder_round_trips_fill_style_and_fill_rect() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_STYLE, &[0.0]),
            (opcodes::FILL_RECT, &[12.0, 18.0, 40.0, 24.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 7, &ops, &operands, &["#2563eb".into()])
            .expect("valid stream");

        assert!(outcome.diagnostics.is_empty());
        assert!(outcome.invalidates);
        let list = store.lock().unwrap().get(&7).unwrap().clone();
        assert_eq!(list.revision, 1);
        let rect = fill_rect(&list.items[0]);
        assert_eq!(
            rect.points,
            [
                CanvasPoint { x: 12.0, y: 18.0 },
                CanvasPoint { x: 52.0, y: 18.0 },
                CanvasPoint { x: 52.0, y: 42.0 },
                CanvasPoint { x: 12.0, y: 42.0 },
            ]
        );
        assert_eq!(
            u32::from(rect.color),
            u32::from(crate::color::parse_color_rgba("#2563eb").unwrap())
        );

        replace_display_list(&store, 7, &ops, &operands, &["#2563eb".into()])
            .expect("valid replacement");
        assert_eq!(store.lock().unwrap().get(&7).unwrap().revision, 2);
    }

    #[test]
    fn draw_image_retains_global_alpha_and_diagnoses_negative_axis_scale() {
        let source = r#"{"kind":"path","path":"/tmp/canvas.png"}"#.to_string();
        let (ops, operands) = stream(&[
            (opcodes::GLOBAL_ALPHA, &[0.375]),
            (opcodes::DRAW_IMAGE_5, &[0.0, 2.0, 3.0, 20.0, 10.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 71, &ops, &operands, &[source.clone()])
            .expect("valid image stream");

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&71).unwrap().clone();
        let DisplayItem::DrawImage(image) = &list.items[0] else {
            panic!("expected drawImage");
        };
        assert_eq!(image.opacity, 0.375);

        let (ops, operands) = stream(&[
            (opcodes::SCALE, &[-1.0, 1.0]),
            (opcodes::DRAW_IMAGE_5, &[0.0, 2.0, 3.0, 20.0, 10.0]),
        ]);
        let outcome = replace_display_list(&store, 72, &ops, &operands, &[source])
            .expect("well-formed reflected stream");
        assert_eq!(outcome.diagnostics.len(), 1);
        assert_eq!(outcome.diagnostics[0].op_name, "drawImage");
        assert!(outcome.diagnostics[0].reason.contains("R1"));
        assert!(outcome.diagnostics[0].reason.contains("negative axis scales"));
        assert!(!outcome.invalidates);
    }

    #[test]
    fn decoder_replays_the_fill_style_save_restore_stack() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_STYLE, &[0.0]),
            (opcodes::SAVE, &[]),
            (opcodes::FILL_STYLE, &[1.0]),
            (opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0]),
            (opcodes::RESTORE, &[]),
            (opcodes::FILL_RECT, &[10.0, 0.0, 10.0, 10.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(
            &store,
            8,
            &ops,
            &operands,
            &["#ef4444".into(), "#2563eb".into()],
        )
        .expect("valid stream");

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&8).unwrap().clone();
        assert_eq!(list.items.len(), 2);
        let first = fill_rect(&list.items[0]);
        let second = fill_rect(&list.items[1]);
        assert_eq!(
            u32::from(first.color),
            u32::from(crate::color::parse_color_rgba("#2563eb").unwrap())
        );
        assert_eq!(
            u32::from(second.color),
            u32::from(crate::color::parse_color_rgba("#ef4444").unwrap())
        );
    }

    #[test]
    fn decoder_composes_every_transform_and_restores_the_saved_ctm() {
        let (ops, operands) = stream(&[
            (opcodes::TRANSLATE, &[10.0, 20.0]),
            (opcodes::SCALE, &[2.0, 3.0]),
            (opcodes::FILL_RECT, &[1.0, 2.0, 4.0, 5.0]),
            (opcodes::SAVE, &[]),
            (opcodes::ROTATE, &[std::f64::consts::FRAC_PI_2]),
            (opcodes::FILL_RECT, &[1.0, 0.0, 2.0, 1.0]),
            (opcodes::RESTORE, &[]),
            (opcodes::TRANSFORM, &[1.0, 0.5, 0.25, 1.0, 4.0, 5.0]),
            (opcodes::FILL_RECT, &[0.0, 0.0, 2.0, 2.0]),
            (opcodes::SET_TRANSFORM, &[1.0, 0.0, 0.5, 1.0, 7.0, 8.0]),
            (opcodes::FILL_RECT, &[0.0, 0.0, 2.0, 2.0]),
            (opcodes::RESET_TRANSFORM, &[]),
            (opcodes::FILL_RECT, &[3.0, 4.0, 2.0, 1.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 12, &ops, &operands, &[]).unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&12).unwrap().clone();
        assert_eq!(list.items.len(), 5);

        let composed = fill_rect(&list.items[0]);
        assert_eq!(
            composed.points,
            [
                CanvasPoint { x: 12.0, y: 26.0 },
                CanvasPoint { x: 20.0, y: 26.0 },
                CanvasPoint { x: 20.0, y: 41.0 },
                CanvasPoint { x: 12.0, y: 41.0 },
            ]
        );

        let rotated = fill_rect(&list.items[1]);
        assert_point(rotated.points[0], (10.0, 23.0));
        assert_point(rotated.points[1], (10.0, 29.0));
        assert_point(rotated.points[2], (8.0, 29.0));
        assert_point(rotated.points[3], (8.0, 23.0));

        let transformed = fill_rect(&list.items[2]);
        assert_eq!(
            transformed.points,
            [
                CanvasPoint { x: 18.0, y: 35.0 },
                CanvasPoint { x: 22.0, y: 38.0 },
                CanvasPoint { x: 23.0, y: 44.0 },
                CanvasPoint { x: 19.0, y: 41.0 },
            ]
        );

        let set = fill_rect(&list.items[3]);
        assert_eq!(
            set.points,
            [
                CanvasPoint { x: 7.0, y: 8.0 },
                CanvasPoint { x: 9.0, y: 8.0 },
                CanvasPoint { x: 10.0, y: 10.0 },
                CanvasPoint { x: 8.0, y: 10.0 },
            ]
        );

        let reset = fill_rect(&list.items[4]);
        assert_eq!(
            reset.points,
            [
                CanvasPoint { x: 3.0, y: 4.0 },
                CanvasPoint { x: 5.0, y: 4.0 },
                CanvasPoint { x: 5.0, y: 5.0 },
                CanvasPoint { x: 3.0, y: 5.0 },
            ]
        );
    }

    #[test]
    fn decoder_bakes_the_ctm_when_path_points_are_added_and_fills_nonzero() {
        let (ops, operands) = stream(&[
            (opcodes::BEGIN_PATH, &[]),
            (opcodes::TRANSLATE, &[10.0, 20.0]),
            (opcodes::MOVE_TO, &[1.0, 2.0]),
            (opcodes::SCALE, &[2.0, 3.0]),
            (opcodes::LINE_TO, &[4.0, 5.0]),
            (opcodes::LINE_TO, &[8.0, 5.0]),
            (opcodes::CLOSE_PATH, &[]),
            (opcodes::RESET_TRANSFORM, &[]),
            (opcodes::FILL, &[0.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 13, &ops, &operands, &[]).unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&13).unwrap().clone();
        let DisplayItem::FillPath(path) = &list.items[0] else {
            panic!("expected a filled path");
        };
        assert_eq!(
            path.commands,
            vec![
                PathCommand::MoveTo(CanvasPoint { x: 11.0, y: 22.0 }),
                PathCommand::LineTo(CanvasPoint { x: 18.0, y: 35.0 }),
                PathCommand::LineTo(CanvasPoint { x: 26.0, y: 35.0 }),
                PathCommand::ClosePath,
            ]
        );
    }

    #[test]
    fn non_finite_transformed_fill_rect_is_a_named_diagnostic() {
        let (ops, operands) = stream(&[
            (opcodes::TRANSFORM, &[f64::MAX, 0.0, 0.0, 1.0, 0.0, 0.0]),
            (opcodes::FILL_RECT, &[2.0, 0.0, 1.0, 1.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 15, &ops, &operands, &[]).unwrap();

        assert_eq!(outcome.diagnostics.len(), 1);
        assert_eq!(outcome.diagnostics[0].op_name, "fillRect");
        assert!(outcome.diagnostics[0].reason.contains("finite"));
        assert!(!outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&15));
    }

    #[test]
    fn paths_larger_than_the_old_b1_cap_are_retained_for_tessellation() {
        let mut commands = vec![
            (opcodes::BEGIN_PATH, vec![]),
            (opcodes::MOVE_TO, vec![0.0, 0.0]),
        ];
        for index in 0..129 {
            commands.push((opcodes::LINE_TO, vec![index as f64, (index % 2) as f64]));
        }
        commands.push((opcodes::FILL, vec![0.0]));
        let borrowed = commands
            .iter()
            .map(|(opcode, operands)| (*opcode, operands.as_slice()))
            .collect::<Vec<_>>();
        let (ops, operands) = stream(&borrowed);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 16, &ops, &operands, &[]).unwrap();

        assert!(outcome.diagnostics.is_empty());
        assert!(outcome.invalidates);
        assert_eq!(store.lock().unwrap().get(&16).unwrap().items.len(), 1);
    }

    #[test]
    fn global_alpha_and_stroke_rect_state_compose_with_save_restore() {
        let strings = vec![
            "#ef444480".to_string(),
            "#2563eb".to_string(),
            "round".to_string(),
        ];
        let (ops, operands) = stream(&[
            (opcodes::FILL_STYLE, &[0.0]),
            (opcodes::GLOBAL_ALPHA, &[0.5]),
            (opcodes::FILL_RECT, &[0.0, 0.0, 20.0, 10.0]),
            (opcodes::SAVE, &[]),
            (opcodes::GLOBAL_ALPHA, &[0.25]),
            (opcodes::STROKE_STYLE, &[1.0]),
            (opcodes::LINE_WIDTH, &[8.0]),
            (opcodes::LINE_JOIN, &[2.0]),
            (opcodes::MITER_LIMIT, &[3.0]),
            (opcodes::STROKE_RECT, &[30.0, 30.0, -20.0, -12.0]),
            (opcodes::RESTORE, &[]),
            (opcodes::STROKE_RECT, &[60.0, 10.0, 16.0, 12.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 17, &ops, &operands, &strings).unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&17).unwrap().clone();
        let DisplayItem::FillRect(fill) = &list.items[0] else {
            panic!("expected fillRect first");
        };
        assert!((fill.color.a - (128.0 / 255.0 * 0.5)).abs() < 1e-6);
        let DisplayItem::StrokeRect(saved) = &list.items[1] else {
            panic!("expected saved strokeRect second");
        };
        assert_eq!(saved.width, -20.0);
        assert_eq!(saved.height, -12.0);
        assert_eq!(saved.style.line_width, 8.0);
        assert_eq!(saved.style.line_join, CanvasLineJoin::Round);
        assert_eq!(saved.style.miter_limit, 3.0);
        assert!((saved.style.color.a - 0.25).abs() < 1e-6);
        let DisplayItem::StrokeRect(restored) = &list.items[2] else {
            panic!("expected restored strokeRect third");
        };
        assert_eq!(restored.style.line_width, 1.0);
        assert_eq!(restored.style.line_join, CanvasLineJoin::Miter);
        assert_eq!(restored.style.miter_limit, 10.0);
        assert!((restored.style.color.a - 0.5).abs() < 1e-6);
    }

    #[test]
    fn degenerate_stroke_rects_keep_browser_shape_and_clear_classification() {
        let (ops, operands) = stream(&[
            (opcodes::STROKE_RECT, &[10.0, 10.0, 0.0, 0.0]),
            (opcodes::CLEAR_RECT, &[9.0, 9.0, 2.0, 2.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 23, &ops, &operands, &[]).unwrap();

        assert!(!outcome.invalidates);
        assert_eq!(outcome.diagnostics.len(), 1);
        assert_eq!(outcome.diagnostics[0].op_index, 1);
        assert_eq!(outcome.diagnostics[0].op_name, "clearRect");
        assert!(outcome.diagnostics[0].reason.contains("punch through"));
        assert!(!store.lock().unwrap().contains_key(&23));

        let (ops, operands) = stream(&[(opcodes::STROKE_RECT, &[10.0, 10.0, 0.0, 20.0])]);
        let outcome = replace_display_list(&store, 24, &ops, &operands, &[]).unwrap();
        assert!(outcome.invalidates);
        let list = store.lock().unwrap().get(&24).unwrap().clone();
        let DisplayItem::StrokeRect(segment) = &list.items[0] else {
            panic!("expected a retained stroke segment");
        };
        assert_eq!(segment.width, 0.0);
        assert_eq!(segment.height, 20.0);
    }

    #[test]
    fn transformed_negative_full_clear_drops_prior_items_but_not_later_draws() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_RECT, &[0.0, 0.0, 100.0, 80.0]),
            (opcodes::SCALE, &[2.0, 2.0]),
            (opcodes::CLEAR_RECT, &[50.0, 40.0, -50.0, -40.0]),
            (opcodes::RESET_TRANSFORM, &[]),
            (opcodes::FILL_RECT, &[8.0, 6.0, 20.0, 10.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list_with_size(
            &store,
            18,
            &ops,
            &operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 80.0,
            },
        )
        .unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&18).unwrap().clone();
        assert_eq!(list.items.len(), 1);
        assert_eq!(
            fill_rect(&list.items[0]).points[0],
            CanvasPoint { x: 8.0, y: 6.0 }
        );
    }

    #[test]
    fn full_clear_with_no_later_draw_removes_the_retained_list() {
        let store = SharedDisplayLists::default();
        let (initial_ops, initial_operands) =
            stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 100.0, 80.0])]);
        replace_display_list_with_size(
            &store,
            21,
            &initial_ops,
            &initial_operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 80.0,
            },
        )
        .unwrap();

        let (cleared_ops, cleared_operands) = stream(&[
            (opcodes::FILL_RECT, &[0.0, 0.0, 100.0, 80.0]),
            (opcodes::CLEAR_RECT, &[0.0, 0.0, 100.0, 80.0]),
        ]);
        let outcome = replace_display_list_with_size(
            &store,
            21,
            &cleared_ops,
            &cleared_operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 80.0,
            },
        )
        .unwrap();

        assert!(outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&21));
    }

    #[test]
    fn redraw_after_full_clear_uses_a_fresh_cache_revision() {
        let store = SharedDisplayLists::default();
        let (draw_ops, draw_operands) = stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0])]);
        replace_display_list(&store, 22, &draw_ops, &draw_operands, &[]).unwrap();
        assert_eq!(store.lock().unwrap().get(&22).unwrap().revision, 1);

        let (clear_ops, clear_operands) = stream(&[(
            opcodes::CLEAR_RECT,
            &[0.0, 0.0, DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT],
        )]);
        replace_display_list(&store, 22, &clear_ops, &clear_operands, &[]).unwrap();
        assert!(!store.lock().unwrap().contains_key(&22));

        replace_display_list(&store, 22, &draw_ops, &draw_operands, &[]).unwrap();
        assert_eq!(store.lock().unwrap().get(&22).unwrap().revision, 2);
    }

    #[test]
    fn partial_clear_surgery_only_marks_prior_intersecting_items() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_RECT, &[0.0, 0.0, 100.0, 80.0]),
            (opcodes::CLEAR_RECT, &[60.0, 50.0, -24.0, -20.0]),
            (opcodes::FILL_RECT, &[40.0, 34.0, 12.0, 8.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list_with_size(
            &store,
            19,
            &ops,
            &operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 80.0,
            },
        )
        .unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&19).unwrap().clone();
        assert_eq!(list.items.len(), 2);
        assert_eq!(fill_rect(&list.items[0]).clear_regions.len(), 1);
        assert!(fill_rect(&list.items[1]).clear_regions.is_empty());
    }

    #[test]
    fn partial_clear_without_prior_canvas_content_is_a_named_diagnostic() {
        let (ops, operands) = stream(&[(opcodes::CLEAR_RECT, &[10.0, 10.0, 20.0, 20.0])]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list_with_size(
            &store,
            20,
            &ops,
            &operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 80.0,
            },
        )
        .unwrap();

        assert_eq!(outcome.diagnostics.len(), 1);
        assert_eq!(outcome.diagnostics[0].op_name, "clearRect");
        assert!(outcome.diagnostics[0].reason.contains("punch through"));
        assert!(!outcome.invalidates);
    }

    #[test]
    fn evenodd_fill_is_retained_with_its_rule() {
        let (ops, operands) = stream(&[
            (opcodes::BEGIN_PATH, &[]),
            (opcodes::MOVE_TO, &[0.0, 0.0]),
            (opcodes::LINE_TO, &[10.0, 0.0]),
            (opcodes::LINE_TO, &[0.0, 10.0]),
            (opcodes::FILL, &[1.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 14, &ops, &operands, &[]).unwrap();

        assert!(outcome.diagnostics.is_empty());
        assert!(outcome.invalidates);
        let list = store.lock().unwrap().get(&14).unwrap().clone();
        let DisplayItem::FillPath(path) = &list.items[0] else {
            panic!("expected fill path")
        };
        assert_eq!(path.fill_rule, CanvasFillRule::EvenOdd);
    }

    #[test]
    fn restore_on_an_empty_stack_is_not_a_diagnostic() {
        let (ops, operands) = stream(&[(opcodes::RESTORE, &[])]);
        let store = SharedDisplayLists::default();

        let outcome = replace_display_list(&store, 10, &ops, &operands, &[])
            .expect("restore on an empty stack is valid");

        assert!(outcome.diagnostics.is_empty());
        assert!(!outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&10));
    }

    #[test]
    fn trailing_restore_on_an_empty_stack_does_not_bump_the_display_list() {
        let store = SharedDisplayLists::default();
        let (first_ops, first_operands) = stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0])]);
        replace_display_list(&store, 11, &first_ops, &first_operands, &[])
            .expect("initial drawing is valid");

        let (restored_ops, restored_operands) = stream(&[
            (opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0]),
            (opcodes::RESTORE, &[]),
        ]);
        let outcome = replace_display_list(&store, 11, &restored_ops, &restored_operands, &[])
            .expect("restore on an empty stack is valid");

        assert!(outcome.diagnostics.is_empty());
        assert!(!outcome.invalidates);
        assert_eq!(store.lock().unwrap().get(&11).unwrap().revision, 1);
    }

    #[test]
    fn empty_stroke_is_a_noop_and_unknown_opcodes_stay_loud() {
        let (ops, operands) = stream(&[(opcodes::STROKE, &[]), (0xffff, &[1.0, 2.0, 3.0])]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 9, &ops, &operands, &[]).unwrap();
        assert_eq!(outcome.diagnostics.len(), 1);
        assert_eq!(outcome.diagnostics[0].op_name, "unknown(0x0000ffff)");
        assert!(!outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&9));
    }

    #[test]
    fn malformed_streams_are_rejected_by_op_index_without_replacing_the_list() {
        let store = SharedDisplayLists::default();
        let (valid_ops, valid_operands) = stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 1.0, 1.0])]);
        replace_display_list(&store, 3, &valid_ops, &valid_operands, &[]).unwrap();

        let cases = [
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                ],
                vec![],
                "opcode header is truncated",
            ),
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                    3,
                ],
                vec![0.0, 0.0, 1.0],
                "declares arity 3",
            ),
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                    4,
                ],
                vec![0.0, 0.0],
                "only 2 remain",
            ),
        ];

        for (ops, operands, message) in cases {
            let error = replace_display_list(&store, 3, &ops, &operands, &[]).unwrap_err();
            assert_eq!(error.op_index, Some(0));
            assert!(error.reason.contains(message), "{}", error.reason);
            assert_eq!(store.lock().unwrap().get(&3).unwrap().revision, 1);
        }
    }

    #[test]
    fn malformed_header_side_table_and_trailing_operands_are_rejected() {
        let store = SharedDisplayLists::default();
        let header =
            replace_display_list(&store, 1, &[opcodes::STREAM_MAGIC], &[], &[]).unwrap_err();
        assert_eq!(header.op_index, None);

        let (ops, operands) = stream(&[(opcodes::FILL_STYLE, &[2.0])]);
        let side = replace_display_list(&store, 1, &ops, &operands, &["red".into()]).unwrap_err();
        assert_eq!(side.op_index, Some(0));

        let trailing = replace_display_list(
            &store,
            1,
            &[opcodes::STREAM_MAGIC, opcodes::STREAM_VERSION],
            &[1.0],
            &[],
        )
        .unwrap_err();
        assert_eq!(trailing.op_index, Some(0));
    }

    #[test]
    fn b3_replays_curves_arcs_rects_and_stroke_state() {
        let strings = vec!["round".to_string(), "bevel".to_string()];
        let (ops, operands) = stream(&[
            (opcodes::LINE_CAP, &[0.0]),
            (opcodes::LINE_JOIN, &[1.0]),
            (opcodes::LINE_WIDTH, &[3.0]),
            (opcodes::MITER_LIMIT, &[2.0]),
            (opcodes::SET_LINE_DASH, &[4.0, 2.0]),
            (opcodes::BEGIN_PATH, &[]),
            (opcodes::BEZIER_CURVE_TO, &[2.0, 3.0, 4.0, 5.0, 6.0, 7.0]),
            (opcodes::QUADRATIC_CURVE_TO, &[8.0, 9.0, 10.0, 11.0]),
            (
                opcodes::ARC,
                &[20.0, 20.0, 5.0, 0.0, std::f64::consts::PI, 0.0],
            ),
            (
                opcodes::ELLIPSE,
                &[30.0, 20.0, 8.0, 4.0, 0.25, 0.0, std::f64::consts::PI, 1.0],
            ),
            (opcodes::ARC_TO, &[40.0, 20.0, 44.0, 28.0, 3.0]),
            (opcodes::RECT, &[4.0, 5.0, 8.0, 9.0]),
            (opcodes::STROKE, &[]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 31, &ops, &operands, &strings).unwrap();

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&31).unwrap().clone();
        let DisplayItem::StrokePath(path) = &list.items[0] else {
            panic!("expected stroke path")
        };
        assert_eq!(path.style.line_cap, CanvasLineCap::Round);
        assert_eq!(path.style.line_join, CanvasLineJoin::Bevel);
        assert_eq!(path.style.line_dash, vec![4.0, 2.0]);
        assert!(path
            .commands
            .iter()
            .any(|command| matches!(command, PathCommand::CubicTo { .. })));
        assert!(path
            .commands
            .iter()
            .any(|command| matches!(command, PathCommand::QuadraticTo { .. })));
        assert!(path
            .commands
            .iter()
            .any(|command| matches!(command, PathCommand::Ellipse(_))));
        assert!(path
            .commands
            .iter()
            .any(|command| matches!(command, PathCommand::ClosePath)));
    }

    #[test]
    fn path_is_not_part_of_the_saved_drawing_state() {
        let (ops, operands) = stream(&[
            (opcodes::BEGIN_PATH, &[]),
            (opcodes::MOVE_TO, &[1.0, 2.0]),
            (opcodes::SAVE, &[]),
            (opcodes::TRANSLATE, &[10.0, 20.0]),
            (opcodes::LINE_TO, &[3.0, 4.0]),
            (opcodes::RESTORE, &[]),
            (opcodes::LINE_TO, &[5.0, 6.0]),
            (opcodes::STROKE, &[]),
        ]);
        let decoded = decode(
            &ops,
            &operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 100.0,
            },
        )
        .unwrap();
        let DisplayItem::StrokePath(path) = &decoded.items[0] else {
            panic!("expected stroke path")
        };
        assert_eq!(
            path.commands,
            vec![
                PathCommand::MoveTo(CanvasPoint { x: 1.0, y: 2.0 }),
                PathCommand::LineTo(CanvasPoint { x: 13.0, y: 24.0 }),
                PathCommand::LineTo(CanvasPoint { x: 5.0, y: 6.0 }),
            ]
        );
    }

    #[test]
    fn line_dash_offset_is_a_named_diagnostic() {
        let (ops, operands) = stream(&[(opcodes::LINE_DASH_OFFSET, &[2.0])]);
        let decoded = decode(
            &ops,
            &operands,
            &[],
            CanvasSize {
                width: 100.0,
                height: 100.0,
            },
        )
        .unwrap();
        assert_eq!(decoded.diagnostics.len(), 1);
        assert_eq!(decoded.diagnostics[0].op_name, "lineDashOffset");
        assert!(decoded.diagnostics[0]
            .reason
            .contains("cannot be replayed faithfully"));
    }
}
