use std::cell::Cell;
use std::sync::{Arc, Mutex};

use gpui::prelude::*;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};

const DEFAULT_WIDTH: f64 = crate::canvas::DEFAULT_CANVAS_WIDTH;
const DEFAULT_HEIGHT: f64 = crate::canvas::DEFAULT_CANVAS_HEIGHT;

#[derive(Clone, Copy)]
struct CanvasGeometry {
    bounds: gpui::Bounds<gpui::Pixels>,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CacheKey {
    revision: u64,
    origin_x: u32,
    origin_y: u32,
    layout_width: u32,
    layout_height: u32,
    scale_factor: u32,
}

impl CacheKey {
    fn new(revision: u64, bounds: gpui::Bounds<gpui::Pixels>, scale_factor: f32) -> Self {
        Self {
            revision,
            origin_x: f32::from(bounds.origin.x).to_bits(),
            origin_y: f32::from(bounds.origin.y).to_bits(),
            layout_width: f32::from(bounds.size.width).to_bits(),
            layout_height: f32::from(bounds.size.height).to_bits(),
            scale_factor: scale_factor.to_bits(),
        }
    }
}

#[derive(Clone)]
struct PreparedDisplayList {
    items: Vec<PreparedItem>,
    diagnostics: Vec<crate::canvas::CanvasDiagnostic>,
    tessellations: u64,
}

#[derive(Clone)]
enum PreparedItem {
    Quad(gpui::PaintQuad),
    Path {
        path: gpui::Path<gpui::Pixels>,
        color: gpui::Rgba,
    },
}

struct PreparedCache {
    key: CacheKey,
    list: Arc<PreparedDisplayList>,
}

#[derive(Default)]
struct CanvasTestState {
    preparation_count: u64,
    tessellation_count: u64,
}

pub struct CanvasElement {
    width: f64,
    height: f64,
    geometry: Arc<Mutex<Option<CanvasGeometry>>>,
    prepared: Arc<Mutex<Option<PreparedCache>>>,
    test_state: Arc<Mutex<CanvasTestState>>,
}

impl Default for CanvasElement {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            geometry: Arc::new(Mutex::new(None)),
            prepared: Arc::new(Mutex::new(None)),
            test_state: Arc::new(Mutex::new(CanvasTestState::default())),
        }
    }
}

fn dimension(value: &serde_json::Value, fallback: f64) -> f64 {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(fallback)
}

fn local_point(
    geometry: &Arc<Mutex<Option<CanvasGeometry>>>,
    point: gpui::Point<gpui::Pixels>,
) -> (f64, f64) {
    let Some(geometry) = *geometry.lock().unwrap() else {
        return (0.0, 0.0);
    };
    let layout_width = f64::from(f32::from(geometry.bounds.size.width));
    let layout_height = f64::from(f32::from(geometry.bounds.size.height));
    let local_x = f64::from(f32::from(point.x - geometry.bounds.origin.x));
    let local_y = f64::from(f32::from(point.y - geometry.bounds.origin.y));
    (
        if layout_width == 0.0 {
            0.0
        } else {
            local_x * geometry.width / layout_width
        },
        if layout_height == 0.0 {
            0.0
        } else {
            local_y * geometry.height / layout_height
        },
    )
}

#[derive(Clone, Copy)]
struct FlatPoint {
    x: f32,
    y: f32,
}

fn flat(point: gpui::Point<gpui::Pixels>) -> FlatPoint {
    FlatPoint {
        x: f32::from(point.x),
        y: f32::from(point.y),
    }
}

fn pixel(point: FlatPoint) -> gpui::Point<gpui::Pixels> {
    gpui::point(gpui::px(point.x), gpui::px(point.y))
}

fn flat_cross(a: FlatPoint, b: FlatPoint, point: FlatPoint) -> f32 {
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

fn polygon_area(points: &[FlatPoint]) -> f32 {
    points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(points.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f32>()
        * 0.5
}

fn clip_half_plane(
    polygon: &[FlatPoint],
    edge_start: FlatPoint,
    edge_end: FlatPoint,
    keep_inside: bool,
) -> Vec<FlatPoint> {
    if polygon.is_empty() {
        return Vec::new();
    }
    let accepted = |point: FlatPoint| {
        let inside = flat_cross(edge_start, edge_end, point) >= -1e-5;
        inside == keep_inside
    };
    let mut output = Vec::new();
    for (&start, &end) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let start_accepted = accepted(start);
        let end_accepted = accepted(end);
        if start_accepted != end_accepted {
            let start_distance = flat_cross(edge_start, edge_end, start);
            let end_distance = flat_cross(edge_start, edge_end, end);
            let t = start_distance / (start_distance - end_distance);
            output.push(FlatPoint {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
            });
        }
        if end_accepted {
            output.push(end);
        }
    }
    output
}

fn push_polygon(path: &mut Option<gpui::Path<gpui::Pixels>>, polygon: &[FlatPoint]) {
    if polygon.len() < 3 || polygon_area(polygon).abs() <= 1e-5 {
        return;
    }
    let path = path.get_or_insert_with(|| gpui::Path::new(pixel(polygon[0])));
    for index in 1..polygon.len() - 1 {
        path.push_triangle(
            (
                pixel(polygon[0]),
                pixel(polygon[index]),
                pixel(polygon[index + 1]),
            ),
            (
                gpui::point(0.0, 1.0),
                gpui::point(0.0, 1.0),
                gpui::point(0.0, 1.0),
            ),
        );
    }
}

fn subtract_convex_quad(
    path: &gpui::Path<gpui::Pixels>,
    mut clear: [FlatPoint; 4],
) -> Option<gpui::Path<gpui::Pixels>> {
    if polygon_area(&clear) < 0.0 {
        clear.reverse();
    }
    let mut output = None;
    for triangle in path.vertices.chunks_exact(3) {
        let mut inside = triangle
            .iter()
            .map(|vertex| flat(vertex.xy_position))
            .collect::<Vec<_>>();
        for (&edge_start, &edge_end) in clear.iter().zip(clear.iter().cycle().skip(1)).take(4) {
            let outside = clip_half_plane(&inside, edge_start, edge_end, false);
            push_polygon(&mut output, &outside);
            inside = clip_half_plane(&inside, edge_start, edge_end, true);
            if inside.is_empty() {
                break;
            }
        }
    }
    output
}

fn subtract_clear_regions(
    mut path: gpui::Path<gpui::Pixels>,
    clear_regions: &[crate::canvas::CanvasQuad],
    layout_point: &impl Fn(crate::canvas::CanvasPoint) -> gpui::Point<gpui::Pixels>,
) -> Option<gpui::Path<gpui::Pixels>> {
    for clear in clear_regions {
        let mapped = clear.map(|point| flat(layout_point(point)));
        path = subtract_convex_quad(&path, mapped)?;
    }
    Some(path)
}

fn ellipse_point_and_derivative(
    arc: crate::canvas::EllipseArc,
    angle: f64,
) -> (crate::canvas::CanvasPoint, crate::canvas::CanvasPoint) {
    let (sin_rotation, cos_rotation) = arc.rotation.sin_cos();
    let (sin_angle, cos_angle) = angle.sin_cos();
    (
        crate::canvas::CanvasPoint {
            x: arc.center.x + arc.radius_x * cos_angle * cos_rotation
                - arc.radius_y * sin_angle * sin_rotation,
            y: arc.center.y
                + arc.radius_x * cos_angle * sin_rotation
                + arc.radius_y * sin_angle * cos_rotation,
        },
        crate::canvas::CanvasPoint {
            x: -arc.radius_x * sin_angle * cos_rotation - arc.radius_y * cos_angle * sin_rotation,
            y: -arc.radius_x * sin_angle * sin_rotation + arc.radius_y * cos_angle * cos_rotation,
        },
    )
}

fn append_adaptive_arc(
    output: &mut Vec<crate::canvas::PathCommand>,
    arc: crate::canvas::EllipseArc,
    layout_scale_x: f64,
    layout_scale_y: f64,
    device_scale: f64,
) {
    const TARGET_DEVICE_TOLERANCE: f64 = 0.25;
    let transform_scale = arc
        .transform
        .max_scale_after_output_scale(layout_scale_x * device_scale, layout_scale_y * device_scale);
    let device_radius = arc.radius_x.abs().max(arc.radius_y.abs()) * transform_scale;
    let maximum_sweep = if device_radius <= TARGET_DEVICE_TOLERANCE {
        std::f64::consts::FRAC_PI_2
    } else {
        // `4 asin(sqrt(error / (2r)))` is the stable form of
        // `2 acos(1 - error / r)` when the transformed radius is large.
        let chord_limit = 4.0
            * (TARGET_DEVICE_TOLERANCE / (2.0 * device_radius))
                .sqrt()
                .clamp(0.0, 1.0)
                .asin();
        chord_limit.min(std::f64::consts::FRAC_PI_2)
    };
    let segment_count = ((arc.sweep.abs() / maximum_sweep.max(1e-6)).ceil() as usize)
        .min(usize::from(u16::MAX) + 1);
    let segment_sweep = arc.sweep / segment_count.max(1) as f64;

    for segment in 0..segment_count.max(1) {
        let from_angle = arc.start_angle + segment_sweep * segment as f64;
        let to_angle = from_angle + segment_sweep;
        let alpha = (4.0 / 3.0) * (segment_sweep / 4.0).tan();
        let (from, from_derivative) = ellipse_point_and_derivative(arc, from_angle);
        let (to, to_derivative) = ellipse_point_and_derivative(arc, to_angle);
        output.push(crate::canvas::PathCommand::CubicTo {
            control_a: arc.transform.transform_point(
                from.x + alpha * from_derivative.x,
                from.y + alpha * from_derivative.y,
            ),
            control_b: arc.transform.transform_point(
                to.x - alpha * to_derivative.x,
                to.y - alpha * to_derivative.y,
            ),
            to: arc.transform.transform_point(to.x, to.y),
        });
    }
}

fn expand_arcs(
    commands: &[crate::canvas::PathCommand],
    layout_scale_x: f64,
    layout_scale_y: f64,
    device_scale: f64,
) -> Vec<crate::canvas::PathCommand> {
    let mut expanded = Vec::with_capacity(commands.len());
    for command in commands {
        match command {
            crate::canvas::PathCommand::Ellipse(arc) => append_adaptive_arc(
                &mut expanded,
                *arc,
                layout_scale_x,
                layout_scale_y,
                device_scale,
            ),
            command => expanded.push(command.clone()),
        }
    }
    expanded
}

fn map_commands_to_stroke_space(
    commands: &[crate::canvas::PathCommand],
    transform: crate::canvas::CanvasTransform,
) -> Result<Option<Vec<crate::canvas::PathCommand>>, &'static str> {
    if !transform.has_invertible_linear_part() {
        return Ok(None);
    }
    let map = |point| {
        let point = transform
            .inverse_transform_point(point)
            .ok_or("inverse stroke geometry is not representable in f64")?;
        let x = point.x as f32;
        let y = point.y as f32;
        if !x.is_finite() || !y.is_finite() {
            return Err("stroke-local geometry is not representable at GPUI's f32 boundary");
        }
        Ok(point)
    };
    let commands = commands
        .iter()
        .map(|command| {
            Ok(match command {
                crate::canvas::PathCommand::MoveTo(point) => {
                    crate::canvas::PathCommand::MoveTo(map(*point)?)
                }
                crate::canvas::PathCommand::LineTo(point) => {
                    crate::canvas::PathCommand::LineTo(map(*point)?)
                }
                crate::canvas::PathCommand::CubicTo {
                    control_a,
                    control_b,
                    to,
                } => crate::canvas::PathCommand::CubicTo {
                    control_a: map(*control_a)?,
                    control_b: map(*control_b)?,
                    to: map(*to)?,
                },
                crate::canvas::PathCommand::QuadraticTo { control, to } => {
                    crate::canvas::PathCommand::QuadraticTo {
                        control: map(*control)?,
                        to: map(*to)?,
                    }
                }
                crate::canvas::PathCommand::Ellipse(_) => unreachable!("arcs expand first"),
                crate::canvas::PathCommand::ClosePath => crate::canvas::PathCommand::ClosePath,
            })
        })
        .collect::<Result<Vec<_>, &'static str>>()?;
    Ok(Some(commands))
}

fn split_subpaths(commands: &[crate::canvas::PathCommand]) -> Vec<Vec<crate::canvas::PathCommand>> {
    let mut subpaths = Vec::new();
    let mut current = Vec::new();
    let mut start = None;
    let mut closed = false;
    let finish = |subpaths: &mut Vec<Vec<crate::canvas::PathCommand>>,
                  current: &mut Vec<crate::canvas::PathCommand>| {
        if current.len() > 1 {
            subpaths.push(std::mem::take(current));
        } else {
            current.clear();
        }
    };

    for command in commands {
        match command {
            crate::canvas::PathCommand::MoveTo(point) => {
                finish(&mut subpaths, &mut current);
                current.push(command.clone());
                start = Some(*point);
                closed = false;
            }
            crate::canvas::PathCommand::ClosePath => {
                current.push(command.clone());
                closed = true;
            }
            command => {
                if closed {
                    finish(&mut subpaths, &mut current);
                    if let Some(start) = start {
                        current.push(crate::canvas::PathCommand::MoveTo(start));
                    }
                    closed = false;
                }
                current.push(command.clone());
            }
        }
    }
    finish(&mut subpaths, &mut current);
    subpaths
}

fn append_transformed_triangles(
    output: &mut Option<gpui::Path<gpui::Pixels>>,
    local: &gpui::Path<gpui::Pixels>,
    transform: crate::canvas::CanvasTransform,
    layout_point: &impl Fn(crate::canvas::CanvasPoint) -> gpui::Point<gpui::Pixels>,
) -> Result<(), &'static str> {
    let current_len = output.as_ref().map_or(0, |path| path.vertices.len());
    if current_len + local.vertices.len() > usize::from(u16::MAX) {
        return Err("combined subpaths exceed GPUI's u16 path vertex limit");
    }
    for triangle in local.vertices.chunks_exact(3) {
        let map_vertex = |vertex: &gpui::PathVertex<gpui::Pixels>| {
            let point = vertex.xy_position;
            layout_point(
                transform
                    .transform_point(f64::from(f32::from(point.x)), f64::from(f32::from(point.y))),
            )
        };
        let mapped = [
            map_vertex(&triangle[0]),
            map_vertex(&triangle[1]),
            map_vertex(&triangle[2]),
        ];
        let path = output.get_or_insert_with(|| gpui::Path::new(mapped[0]));
        path.push_triangle(
            (mapped[0], mapped[1], mapped[2]),
            (
                triangle[0].st_position,
                triangle[1].st_position,
                triangle[2].st_position,
            ),
        );
    }
    Ok(())
}

fn build_solid_stroke_rect(
    rect: &crate::canvas::StrokeRect,
    tolerance: f32,
    layout_point: &impl Fn(crate::canvas::CanvasPoint) -> gpui::Point<gpui::Pixels>,
) -> Result<Option<gpui::Path<gpui::Pixels>>, crate::canvas::CanvasDiagnostic> {
    let is_segment = rect.width == 0.0 || rect.height == 0.0;
    let options = gpui::FillOptions::default()
        .with_fill_rule(gpui::FillRule::NonZero)
        .with_tolerance(tolerance);
    let mut builder = gpui::PathBuilder::fill().with_style(gpui::PathStyle::Fill(options));
    let point = |x, y| layout_point(rect.transform.transform_point(x, y));
    let half = rect.style.line_width * 0.5;
    let left = rect.x.min(rect.x + rect.width);
    let right = rect.x.max(rect.x + rect.width);
    let top = rect.y.min(rect.y + rect.height);
    let bottom = rect.y.max(rect.y + rect.height);

    if rect.width == 0.0 {
        builder.move_to(point(left - half, top));
        builder.line_to(point(left + half, top));
        builder.line_to(point(left + half, bottom));
        builder.line_to(point(left - half, bottom));
        builder.close();
    } else if rect.height == 0.0 {
        builder.move_to(point(left, top - half));
        builder.line_to(point(right, top - half));
        builder.line_to(point(right, top + half));
        builder.line_to(point(left, top + half));
        builder.close();
    } else {
        let join = match rect.style.line_join {
            crate::canvas::CanvasLineJoin::Miter
                if rect.style.miter_limit >= std::f64::consts::SQRT_2 =>
            {
                crate::canvas::CanvasLineJoin::Miter
            }
            crate::canvas::CanvasLineJoin::Miter => crate::canvas::CanvasLineJoin::Bevel,
            join => join,
        };
        match join {
            crate::canvas::CanvasLineJoin::Miter => {
                builder.move_to(point(left - half, top - half));
                builder.line_to(point(right + half, top - half));
                builder.line_to(point(right + half, bottom + half));
                builder.line_to(point(left - half, bottom + half));
            }
            crate::canvas::CanvasLineJoin::Bevel => {
                builder.move_to(point(left, top - half));
                builder.line_to(point(right, top - half));
                builder.line_to(point(right + half, top));
                builder.line_to(point(right + half, bottom));
                builder.line_to(point(right, bottom + half));
                builder.line_to(point(left, bottom + half));
                builder.line_to(point(left - half, bottom));
                builder.line_to(point(left - half, top));
            }
            crate::canvas::CanvasLineJoin::Round => {
                const KAPPA: f64 = 0.552_284_749_830_793_6;
                let control = half * KAPPA;
                builder.move_to(point(left, top - half));
                builder.line_to(point(right, top - half));
                builder.cubic_bezier_to(
                    point(right + half, top),
                    point(right + control, top - half),
                    point(right + half, top - control),
                );
                builder.line_to(point(right + half, bottom));
                builder.cubic_bezier_to(
                    point(right, bottom + half),
                    point(right + half, bottom + control),
                    point(right + control, bottom + half),
                );
                builder.line_to(point(left, bottom + half));
                builder.cubic_bezier_to(
                    point(left - half, bottom),
                    point(left - control, bottom + half),
                    point(left - half, bottom + control),
                );
                builder.line_to(point(left - half, top));
                builder.cubic_bezier_to(
                    point(left, top - half),
                    point(left - half, top - control),
                    point(left - control, top - half),
                );
            }
        }
        builder.close();

        if right - left > rect.style.line_width && bottom - top > rect.style.line_width {
            builder.move_to(point(left + half, top + half));
            builder.line_to(point(left + half, bottom - half));
            builder.line_to(point(right - half, bottom - half));
            builder.line_to(point(right - half, top + half));
            builder.close();
        }
    }

    builder
        .build()
        .map(|path| subtract_clear_regions(path, &rect.clear_regions, layout_point))
        .map_err(|error| {
            path_build_diagnostic(
                rect.op_index,
                "strokeRect",
                if is_segment {
                    "open rectangle segment stroke"
                } else {
                    "closed rectangle stroke"
                },
                &error,
            )
        })
}

fn prepare_with_scale(
    list: &crate::canvas::DisplayList,
    bounds: gpui::Bounds<gpui::Pixels>,
    width: f64,
    height: f64,
    device_scale: f32,
) -> PreparedDisplayList {
    if width == 0.0 || height == 0.0 {
        return PreparedDisplayList {
            items: Vec::new(),
            diagnostics: Vec::new(),
            tessellations: 0,
        };
    }
    let scale_x = f64::from(f32::from(bounds.size.width)) / width;
    let scale_y = f64::from(f32::from(bounds.size.height)) / height;
    let origin_x = f64::from(f32::from(bounds.origin.x));
    let origin_y = f64::from(f32::from(bounds.origin.y));
    let mut items = Vec::with_capacity(list.items.len());
    let mut diagnostics = Vec::new();
    let tessellations = Cell::new(0u64);
    // Fill commands are expressed in layout coordinates before they reach
    // GPUI. Converting a quarter device pixel through the window scale keeps
    // the remaining curve tessellation error stable across DPR changes.
    let tolerance = (0.25 / device_scale.max(0.000_1)).max(0.000_1);

    let layout_point = |point: crate::canvas::CanvasPoint| {
        gpui::point(
            gpui::px((origin_x + point.x * scale_x) as f32),
            gpui::px((origin_y + point.y * scale_y) as f32),
        )
    };

    let append_commands = |builder: &mut gpui::PathBuilder,
                           commands: &[crate::canvas::PathCommand]| {
        for command in commands {
            match command {
                crate::canvas::PathCommand::MoveTo(point) => builder.move_to(layout_point(*point)),
                crate::canvas::PathCommand::LineTo(point) => builder.line_to(layout_point(*point)),
                crate::canvas::PathCommand::CubicTo {
                    control_a,
                    control_b,
                    to,
                } => builder.cubic_bezier_to(
                    layout_point(*to),
                    layout_point(*control_a),
                    layout_point(*control_b),
                ),
                crate::canvas::PathCommand::QuadraticTo { control, to } => {
                    builder.curve_to(layout_point(*to), layout_point(*control))
                }
                crate::canvas::PathCommand::Ellipse(_) => {
                    unreachable!("arcs expand before GPUI path construction")
                }
                crate::canvas::PathCommand::ClosePath => builder.close(),
            }
        }
    };
    let append_local_commands =
        |builder: &mut gpui::PathBuilder, commands: &[crate::canvas::PathCommand]| {
            let local_point = |point: crate::canvas::CanvasPoint| {
                gpui::point(gpui::px(point.x as f32), gpui::px(point.y as f32))
            };
            for command in commands {
                match command {
                    crate::canvas::PathCommand::MoveTo(point) => {
                        builder.move_to(local_point(*point))
                    }
                    crate::canvas::PathCommand::LineTo(point) => {
                        builder.line_to(local_point(*point))
                    }
                    crate::canvas::PathCommand::CubicTo {
                        control_a,
                        control_b,
                        to,
                    } => builder.cubic_bezier_to(
                        local_point(*to),
                        local_point(*control_a),
                        local_point(*control_b),
                    ),
                    crate::canvas::PathCommand::QuadraticTo { control, to } => {
                        builder.curve_to(local_point(*to), local_point(*control))
                    }
                    crate::canvas::PathCommand::Ellipse(_) => {
                        unreachable!("arcs expand before GPUI path construction")
                    }
                    crate::canvas::PathCommand::ClosePath => builder.close(),
                }
            }
        };

    let build_fill_path =
        |op_index: usize,
         op_name: &'static str,
         commands: &[crate::canvas::PathCommand],
         fill_rule: crate::canvas::CanvasFillRule,
         clear_regions: &[crate::canvas::CanvasQuad]|
         -> Result<Option<gpui::Path<gpui::Pixels>>, crate::canvas::CanvasDiagnostic> {
            let fill_rule = match fill_rule {
                crate::canvas::CanvasFillRule::NonZero => gpui::FillRule::NonZero,
                crate::canvas::CanvasFillRule::EvenOdd => gpui::FillRule::EvenOdd,
            };
            let options = gpui::FillOptions::default()
                .with_fill_rule(fill_rule)
                .with_tolerance(tolerance);
            let mut builder = gpui::PathBuilder::fill().with_style(gpui::PathStyle::Fill(options));
            let commands = expand_arcs(commands, scale_x, scale_y, f64::from(device_scale));
            append_commands(&mut builder, &commands);
            tessellations.set(tessellations.get() + 1);
            builder
                .build()
                .map(|path| subtract_clear_regions(path, clear_regions, &layout_point))
                .map_err(|error| path_build_diagnostic(op_index, op_name, "fill", &error))
        };

    let build_stroke_path = |op_index: usize,
                             op_name: &'static str,
                             commands: &[crate::canvas::PathCommand],
                             style: &crate::canvas::StrokePathStyle,
                             clear_regions: &[crate::canvas::CanvasQuad]|
     -> Result<
        Option<gpui::Path<gpui::Pixels>>,
        crate::canvas::CanvasDiagnostic,
    > {
        let cap = match style.line_cap {
            crate::canvas::CanvasLineCap::Butt => lyon::path::LineCap::Butt,
            crate::canvas::CanvasLineCap::Round => lyon::path::LineCap::Round,
            crate::canvas::CanvasLineCap::Square => lyon::path::LineCap::Square,
        };
        let canvas_miter_limit = style.miter_limit;
        let lyon_miter_limit = canvas_miter_limit * 0.5;
        let join = match style.line_join {
            crate::canvas::CanvasLineJoin::Miter => lyon::path::LineJoin::Miter,
            crate::canvas::CanvasLineJoin::Round => lyon::path::LineJoin::Round,
            crate::canvas::CanvasLineJoin::Bevel => lyon::path::LineJoin::Bevel,
        };
        let stroke_device_scale = style.transform.max_scale_after_output_scale(
            scale_x * f64::from(device_scale),
            scale_y * f64::from(device_scale),
        );
        if stroke_device_scale == 0.0 {
            tessellations.set(tessellations.get() + 1);
            return Ok(None);
        }
        let stroke_tolerance = (0.25 / stroke_device_scale).max(0.000_1) as f32;
        let mut options = gpui::StrokeOptions::default()
            .with_line_width(style.line_width as f32)
            .with_line_cap(cap)
            .with_line_join(join)
            .with_tolerance(stroke_tolerance);
        // Canvas measures the complete inner-to-outer miter against lineWidth;
        // Lyon measures the center-to-tip distance, so its ratio is half. Its
        // setter rejects ratios below 1, but miter_limit is public,
        // PathBuilder passes StrokeOptions through unchanged, and Lyon's
        // per-join predicate supports Canvas' required 0.5..1 range.
        options.miter_limit = lyon_miter_limit as f32;
        let commands = expand_arcs(commands, scale_x, scale_y, f64::from(device_scale));
        tessellations.set(tessellations.get() + 1);
        if commands.len() > usize::from(u16::MAX) {
            return Err(crate::canvas::CanvasDiagnostic {
                    op_index,
                    op_name: op_name.to_string(),
                    reason: "GPUI PathBuilder failed to build stroke geometry: path commands exceed GPUI's u16 path vertex limit"
                        .to_string(),
                });
        }
        let Some(commands) =
            map_commands_to_stroke_space(&commands, style.transform).map_err(|reason| {
                crate::canvas::CanvasDiagnostic {
                    op_index,
                    op_name: op_name.to_string(),
                    reason: format!("GPUI PathBuilder failed to build stroke geometry: {reason}"),
                }
            })?
        else {
            return Ok(None);
        };
        let dash = style
            .line_dash
            .iter()
            .map(|segment| gpui::px(*segment as f32))
            .collect::<Vec<_>>();
        let uses_dash = style.line_dash.iter().any(|segment| *segment > 0.0);
        let mut combined = None;
        for subpath in split_subpaths(&commands) {
            let mut builder = gpui::PathBuilder::stroke(gpui::px(1.0))
                .with_style(gpui::PathStyle::Stroke(options));
            if uses_dash {
                builder = builder.dash_array(&dash);
            }
            append_local_commands(&mut builder, &subpath);
            let local = builder
                .build()
                .map_err(|error| path_build_diagnostic(op_index, op_name, "stroke", &error))?;
            append_transformed_triangles(&mut combined, &local, style.transform, &layout_point)
                .map_err(|reason| crate::canvas::CanvasDiagnostic {
                    op_index,
                    op_name: op_name.to_string(),
                    reason: format!("GPUI PathBuilder failed to build stroke geometry: {reason}"),
                })?;
        }
        Ok(combined.and_then(|path| subtract_clear_regions(path, clear_regions, &layout_point)))
    };

    for item in &list.items {
        match item {
            crate::canvas::DisplayItem::FillRect(rect) => {
                let [top_left, top_right, bottom_right, bottom_left] = rect.points;
                let axis_aligned = top_left.y == top_right.y
                    && top_right.x == bottom_right.x
                    && bottom_right.y == bottom_left.y
                    && bottom_left.x == top_left.x;
                if axis_aligned && rect.clear_regions.is_empty() {
                    let x1 = rect
                        .points
                        .iter()
                        .map(|point| point.x)
                        .fold(f64::INFINITY, f64::min);
                    let x2 = rect
                        .points
                        .iter()
                        .map(|point| point.x)
                        .fold(f64::NEG_INFINITY, f64::max);
                    let y1 = rect
                        .points
                        .iter()
                        .map(|point| point.y)
                        .fold(f64::INFINITY, f64::min);
                    let y2 = rect
                        .points
                        .iter()
                        .map(|point| point.y)
                        .fold(f64::NEG_INFINITY, f64::max);
                    let quad_bounds = gpui::bounds(
                        layout_point(crate::canvas::CanvasPoint { x: x1, y: y1 }),
                        gpui::size(
                            gpui::px(((x2 - x1) * scale_x) as f32),
                            gpui::px(((y2 - y1) * scale_y) as f32),
                        ),
                    )
                    .intersect(&bounds);
                    if !quad_bounds.is_empty() {
                        items.push(PreparedItem::Quad(gpui::fill(quad_bounds, rect.color)));
                    }
                } else {
                    let commands = [
                        crate::canvas::PathCommand::MoveTo(top_left),
                        crate::canvas::PathCommand::LineTo(top_right),
                        crate::canvas::PathCommand::LineTo(bottom_right),
                        crate::canvas::PathCommand::LineTo(bottom_left),
                        crate::canvas::PathCommand::ClosePath,
                    ];
                    match build_fill_path(
                        rect.op_index,
                        "fillRect",
                        &commands,
                        crate::canvas::CanvasFillRule::NonZero,
                        &rect.clear_regions,
                    ) {
                        Ok(Some(path)) => items.push(PreparedItem::Path {
                            path,
                            color: rect.color,
                        }),
                        Ok(None) => {}
                        Err(diagnostic) => diagnostics.push(diagnostic),
                    }
                }
            }
            crate::canvas::DisplayItem::FillPath(path) => {
                match build_fill_path(
                    path.op_index,
                    "fill",
                    &path.commands,
                    path.fill_rule,
                    &path.clear_regions,
                ) {
                    Ok(Some(prepared)) => items.push(PreparedItem::Path {
                        path: prepared,
                        color: path.color,
                    }),
                    Ok(None) => {}
                    Err(diagnostic) => diagnostics.push(diagnostic),
                }
            }
            crate::canvas::DisplayItem::StrokeRect(rect) => {
                if rect.width == 0.0 && rect.height == 0.0 {
                    continue;
                }
                let is_segment = rect.width == 0.0 || rect.height == 0.0;
                let solid = !rect.style.line_dash.iter().any(|segment| *segment > 0.0);
                if solid
                    && (!is_segment || rect.style.line_cap == crate::canvas::CanvasLineCap::Butt)
                {
                    tessellations.set(tessellations.get() + 1);
                    match build_solid_stroke_rect(rect, tolerance, &layout_point) {
                        Ok(Some(path)) => items.push(PreparedItem::Path {
                            path,
                            color: rect.style.color,
                        }),
                        Ok(None) => {}
                        Err(diagnostic) => diagnostics.push(diagnostic),
                    }
                    continue;
                }
                let points = crate::canvas::CanvasQuad::from([
                    rect.transform.transform_point(rect.x, rect.y),
                    rect.transform.transform_point(rect.x + rect.width, rect.y),
                    rect.transform
                        .transform_point(rect.x + rect.width, rect.y + rect.height),
                    rect.transform.transform_point(rect.x, rect.y + rect.height),
                ]);
                let mut commands = vec![crate::canvas::PathCommand::MoveTo(points[0])];
                if rect.width == 0.0 || rect.height == 0.0 {
                    commands.push(crate::canvas::PathCommand::LineTo(points[2]));
                } else {
                    commands.extend(
                        points[1..]
                            .iter()
                            .copied()
                            .map(crate::canvas::PathCommand::LineTo),
                    );
                    commands.push(crate::canvas::PathCommand::ClosePath);
                }
                let style = crate::canvas::StrokePathStyle {
                    color: rect.style.color,
                    line_width: rect.style.line_width,
                    line_cap: rect.style.line_cap,
                    line_join: rect.style.line_join,
                    miter_limit: rect.style.miter_limit,
                    line_dash: rect.style.line_dash.clone(),
                    transform: rect.style.transform,
                };
                match build_stroke_path(
                    rect.op_index,
                    "strokeRect",
                    &commands,
                    &style,
                    &rect.clear_regions,
                ) {
                    Ok(Some(path)) => items.push(PreparedItem::Path {
                        path,
                        color: rect.style.color,
                    }),
                    Ok(None) => {}
                    Err(diagnostic) => diagnostics.push(diagnostic),
                }
            }
            crate::canvas::DisplayItem::StrokePath(path) => match build_stroke_path(
                path.op_index,
                "stroke",
                &path.commands,
                &path.style,
                &path.clear_regions,
            ) {
                Ok(Some(prepared)) => items.push(PreparedItem::Path {
                    path: prepared,
                    color: path.style.color,
                }),
                Ok(None) => {}
                Err(diagnostic) => diagnostics.push(diagnostic),
            },
        }
    }

    PreparedDisplayList {
        items,
        diagnostics,
        tessellations: tessellations.get(),
    }
}

#[cfg(test)]
fn prepare(
    list: &crate::canvas::DisplayList,
    bounds: gpui::Bounds<gpui::Pixels>,
    width: f64,
    height: f64,
) -> PreparedDisplayList {
    prepare_with_scale(list, bounds, width, height, 1.0)
}

fn path_build_diagnostic(
    op_index: usize,
    op_name: &str,
    geometry: &str,
    error: &dyn std::fmt::Display,
) -> crate::canvas::CanvasDiagnostic {
    crate::canvas::CanvasDiagnostic {
        op_index,
        op_name: op_name.to_string(),
        reason: format!("GPUI PathBuilder failed to build {geometry} geometry: {error}"),
    }
}

impl CanvasElement {
    fn attach_mouse_events(
        &self,
        mut element: gpui::Stateful<gpui::Div>,
        ctx: &CustomRenderContext,
    ) -> gpui::Stateful<gpui::Div> {
        let id = ctx.id;
        for event_type in ctx.events {
            let callback = ctx.event_callback.clone();
            let geometry = self.geometry.clone();
            match event_type.as_str() {
                "click" => {
                    element = element.on_click(move |event, _window, cx| {
                        let (x, y) = local_point(&geometry, event.position());
                        crate::renderer::emit_event_full(&callback, id, "click", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers().into());
                            payload.click_count = Some(event.click_count() as u32);
                            payload.is_right_click = Some(event.is_right_click());
                            payload.button = Some(match event {
                                gpui::ClickEvent::Mouse(event) => {
                                    crate::renderer::mouse_button_to_u32(event.down.button)
                                }
                                gpui::ClickEvent::Keyboard(_) | gpui::ClickEvent::Touch(_) => 0,
                            });
                            payload.input_source = Some(
                                match event {
                                    gpui::ClickEvent::Mouse(_) => "mouse",
                                    gpui::ClickEvent::Keyboard(_) => "keyboard",
                                    gpui::ClickEvent::Touch(_) => "touch",
                                }
                                .to_string(),
                            );
                        });
                        cx.stop_propagation();
                    });
                }
                "auxClick" => {
                    element = element.on_aux_click(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position());
                        crate::renderer::emit_event_full(&callback, id, "auxClick", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers().into());
                            payload.click_count = Some(event.click_count() as u32);
                            payload.is_right_click = Some(event.is_right_click());
                            payload.button = Some(if event.is_right_click() { 2 } else { 1 });
                        });
                    });
                }
                "mouseDown" => {
                    for &button in &[
                        gpui::MouseButton::Left,
                        gpui::MouseButton::Middle,
                        gpui::MouseButton::Right,
                    ] {
                        let callback = callback.clone();
                        let geometry = geometry.clone();
                        element = element.on_mouse_down(button, move |event, _window, _cx| {
                            let (x, y) = local_point(&geometry, event.position);
                            crate::renderer::emit_event_full(
                                &callback,
                                id,
                                "mouseDown",
                                |payload| {
                                    payload.x = Some(x);
                                    payload.y = Some(y);
                                    payload.button =
                                        Some(crate::renderer::mouse_button_to_u32(event.button));
                                    payload.click_count = Some(event.click_count as u32);
                                    payload.modifiers = Some(event.modifiers.into());
                                },
                            );
                        });
                    }
                }
                "mouseUp" => {
                    for &button in &[
                        gpui::MouseButton::Left,
                        gpui::MouseButton::Middle,
                        gpui::MouseButton::Right,
                    ] {
                        let callback = callback.clone();
                        let geometry = geometry.clone();
                        element = element.on_mouse_up(button, move |event, _window, _cx| {
                            let (x, y) = local_point(&geometry, event.position);
                            crate::renderer::emit_event_full(&callback, id, "mouseUp", |payload| {
                                payload.x = Some(x);
                                payload.y = Some(y);
                                payload.button =
                                    Some(crate::renderer::mouse_button_to_u32(event.button));
                                payload.click_count = Some(event.click_count as u32);
                                payload.modifiers = Some(event.modifiers.into());
                            });
                        });
                    }
                }
                "mouseMove" => {
                    element = element.on_mouse_move(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(&callback, id, "mouseMove", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers.into());
                            payload.pressed_button = event
                                .pressed_button
                                .map(crate::renderer::mouse_button_to_u32);
                        });
                    });
                }
                "mouseDownOutside" => {
                    element = element.on_mouse_down_out(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(
                            &callback,
                            id,
                            "mouseDownOutside",
                            |payload| {
                                payload.x = Some(x);
                                payload.y = Some(y);
                                payload.button =
                                    Some(crate::renderer::mouse_button_to_u32(event.button));
                                payload.modifiers = Some(event.modifiers.into());
                            },
                        );
                    });
                }
                "scroll" => {
                    element = element.on_scroll_wheel(move |event, _window, _cx| {
                        let (x, y) = local_point(&geometry, event.position);
                        crate::renderer::emit_event_full(&callback, id, "scroll", |payload| {
                            payload.x = Some(x);
                            payload.y = Some(y);
                            payload.modifiers = Some(event.modifiers.into());
                            payload.precise = Some(event.delta.precise());
                            let delta = event.delta.pixel_delta(gpui::px(20.0));
                            payload.delta_x = Some(f64::from(f32::from(delta.x)));
                            payload.delta_y = Some(f64::from(f32::from(delta.y)));
                            payload.touch_phase = Some(
                                match event.touch_phase {
                                    gpui::TouchPhase::Started => "started",
                                    gpui::TouchPhase::Moved => "moved",
                                    gpui::TouchPhase::Ended => "ended",
                                    gpui::TouchPhase::Cancelled => "cancelled",
                                }
                                .to_string(),
                            );
                        });
                    });
                }
                "mouseEnter" | "mouseLeave" => {}
                _ => {}
            }
        }

        if ctx.events.contains("mouseDown") && ctx.events.contains("mouseMove") {
            element = element.capture_pointer();
        }
        let has_enter = ctx.events.contains("mouseEnter");
        let has_leave = ctx.events.contains("mouseLeave");
        if has_enter || has_leave {
            let callback_enter = has_enter.then(|| ctx.event_callback.clone()).flatten();
            let callback_leave = has_leave.then(|| ctx.event_callback.clone()).flatten();
            element = element.on_hover(move |hovered, _window, _cx| {
                if *hovered {
                    crate::renderer::emit_event_full(
                        &callback_enter,
                        id,
                        "mouseEnter",
                        |payload| {
                            payload.hovered = Some(true);
                        },
                    );
                } else {
                    crate::renderer::emit_event_full(
                        &callback_leave,
                        id,
                        "mouseLeave",
                        |payload| {
                            payload.hovered = Some(false);
                        },
                    );
                }
            });
        }

        element
    }
}

impl CustomElement for CanvasElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        let width = self.width;
        let height = self.height;
        let geometry = self.geometry.clone();
        let prepared_cache = self.prepared.clone();
        let test_state = self.test_state.clone();
        let display_lists = ctx.canvas_display_lists.clone();
        let id = ctx.id;
        let drawing = gpui::canvas(
            move |bounds, window, _cx| {
                *geometry.lock().unwrap() = Some(CanvasGeometry {
                    bounds,
                    width,
                    height,
                });
                let list = display_lists.lock().unwrap().get(&id).cloned();
                let revision = list.as_ref().map_or(0, |list| list.revision);
                let key = CacheKey::new(revision, bounds, window.scale_factor());
                let mut cache = prepared_cache.lock().unwrap();
                if let Some(cached) = cache.as_ref().filter(|cached| cached.key == key) {
                    return cached.list.clone();
                }
                let prepared = Arc::new(list.as_deref().map_or(
                    PreparedDisplayList {
                        items: Vec::new(),
                        diagnostics: Vec::new(),
                        tessellations: 0,
                    },
                    |list| prepare_with_scale(list, bounds, width, height, window.scale_factor()),
                ));
                {
                    let mut state = test_state.lock().unwrap();
                    state.preparation_count += 1;
                    state.tessellation_count += prepared.tessellations;
                }
                display_lists.report_preparation_diagnostics(id, &prepared.diagnostics);
                *cache = Some(PreparedCache {
                    key,
                    list: prepared.clone(),
                });
                prepared
            },
            move |_bounds, prepared, window, _cx| {
                for item in &prepared.items {
                    match item {
                        PreparedItem::Quad(quad) => window.paint_quad(quad.clone()),
                        PreparedItem::Path { path, color } => {
                            window.paint_path(path.clone(), *color)
                        }
                    }
                }
            },
        )
        .size_full()
        .overflow_hidden();

        let element_id = gpui::SharedString::from(format!("__gpuix_{}", ctx.id));
        let mut root = gpui::div()
            .id(element_id)
            .relative()
            .w(gpui::px(self.width as f32))
            .h(gpui::px(self.height as f32));
        if let Some(style) = ctx.style {
            root = crate::renderer::apply_styles(root, style);
            if style.pointer_events.as_deref() == Some("none") {
                root = root.ignore_mouse();
            } else if crate::style::should_occlude(Some(style), !ctx.events.is_empty()) {
                root = root.block_mouse_except_scroll();
            }
        }
        root = root
            .child(crate::automation::bounds_tracker(ctx.id, None))
            .child(drawing);
        self.attach_mouse_events(root, &ctx).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "width" => self.width = dimension(&value, DEFAULT_WIDTH),
            "height" => self.height = dimension(&value, DEFAULT_HEIGHT),
            _ => {}
        }
        *self.prepared.lock().unwrap() = None;
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["width", "height"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[
            "click",
            "auxClick",
            "mouseDown",
            "mouseUp",
            "mouseMove",
            "mouseEnter",
            "mouseLeave",
            "mouseDownOutside",
            "scroll",
        ]
    }

    fn test_state(&self) -> Option<serde_json::Value> {
        let state = self.test_state.lock().unwrap();
        Some(serde_json::json!({
            "preparationCount": state.preparation_count,
            "tessellationCount": state.tessellation_count,
        }))
    }

    fn destroy(&mut self) {
        *self.geometry.lock().unwrap() = None;
        *self.prepared.lock().unwrap() = None;
    }
}

pub struct CanvasFactory;

impl CustomElementFactory for CanvasFactory {
    fn element_type(&self) -> &str {
        "canvas"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(CanvasElement::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::{
        CanvasFillRule, CanvasLineCap, CanvasLineJoin, CanvasPoint, CanvasTransform, DisplayItem,
        EllipseArc, FillPath, FillRect, PathCommand, StrokePath, StrokePathStyle, StrokeRect,
        StrokeStyle,
    };

    fn color() -> gpui::Rgba {
        crate::color::parse_color_rgba("#2563eb").unwrap()
    }

    fn test_bounds() -> gpui::Bounds<gpui::Pixels> {
        gpui::bounds(
            gpui::point(gpui::px(0.0), gpui::px(0.0)),
            gpui::size(gpui::px(320.0), gpui::px(240.0)),
        )
    }

    fn prepared_quad(list: &PreparedDisplayList) -> &gpui::PaintQuad {
        let PreparedItem::Quad(quad) = &list.items[0] else {
            panic!("expected a prepared quad");
        };
        quad
    }

    fn prepared_path(list: &PreparedDisplayList) -> &gpui::Path<gpui::Pixels> {
        let PreparedItem::Path { path, .. } = &list.items[0] else {
            panic!("expected a prepared path");
        };
        path
    }

    fn vertex_positions(path: &gpui::Path<gpui::Pixels>) -> Vec<(u32, u32)> {
        path.vertices
            .iter()
            .map(|vertex| {
                (
                    f32::from(vertex.xy_position.x).to_bits(),
                    f32::from(vertex.xy_position.y).to_bits(),
                )
            })
            .collect()
    }

    fn dashed_stroke(commands: Vec<PathCommand>, op_index: usize) -> DisplayItem {
        DisplayItem::StrokePath(StrokePath {
            commands,
            style: StrokePathStyle {
                color: color(),
                line_width: 2.0,
                line_cap: CanvasLineCap::Butt,
                line_join: CanvasLineJoin::Miter,
                miter_limit: 10.0,
                line_dash: vec![10.0, 10.0],
                transform: CanvasTransform::IDENTITY,
            },
            op_index,
            clear_regions: Vec::new(),
        })
    }

    fn assert_dash_restart_matches_separate_paths(
        combined: Vec<PathCommand>,
        first: Vec<PathCommand>,
        second: Vec<PathCommand>,
    ) {
        let combined = prepare(
            &crate::canvas::DisplayList {
                revision: 1,
                items: vec![dashed_stroke(combined, 0)],
            },
            test_bounds(),
            320.0,
            240.0,
        );
        let separate = prepare(
            &crate::canvas::DisplayList {
                revision: 1,
                items: vec![dashed_stroke(first, 0), dashed_stroke(second, 1)],
            },
            test_bounds(),
            320.0,
            240.0,
        );
        let separate_positions = separate
            .items
            .iter()
            .flat_map(|item| match item {
                PreparedItem::Path { path, .. } => vertex_positions(path),
                PreparedItem::Quad(_) => panic!("expected only paths"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            vertex_positions(prepared_path(&combined)),
            separate_positions
        );
        assert_eq!(combined.tessellations, 1);
        assert_eq!(separate.tessellations, 2);
    }

    #[test]
    fn dpr_scaled_backing_geometry_maps_to_the_same_layout_geometry() {
        let logical = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::FillRect(FillRect {
                points: [
                    CanvasPoint { x: 24.0, y: 18.0 },
                    CanvasPoint { x: 80.0, y: 18.0 },
                    CanvasPoint { x: 80.0, y: 58.0 },
                    CanvasPoint { x: 24.0, y: 58.0 },
                ],
                color: color(),
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let dpr_scaled = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::FillRect(FillRect {
                points: [
                    CanvasPoint { x: 48.0, y: 36.0 },
                    CanvasPoint { x: 160.0, y: 36.0 },
                    CanvasPoint { x: 160.0, y: 116.0 },
                    CanvasPoint { x: 48.0, y: 116.0 },
                ],
                color: color(),
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };

        let logical = prepare(&logical, test_bounds(), 320.0, 240.0);
        let dpr_scaled = prepare(&dpr_scaled, test_bounds(), 640.0, 480.0);

        assert_eq!(
            prepared_quad(&logical).bounds,
            prepared_quad(&dpr_scaled).bounds
        );
    }

    #[test]
    fn dpr_scaled_path_geometry_maps_to_the_same_logical_gpui_path() {
        let path = |scale: f64| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::FillPath(FillPath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint {
                        x: 12.0 * scale,
                        y: 18.0 * scale,
                    }),
                    PathCommand::LineTo(CanvasPoint {
                        x: 64.0 * scale,
                        y: 70.0 * scale,
                    }),
                    PathCommand::LineTo(CanvasPoint {
                        x: 116.0 * scale,
                        y: 18.0 * scale,
                    }),
                    PathCommand::ClosePath,
                ],
                color: color(),
                fill_rule: crate::canvas::CanvasFillRule::NonZero,
                op_index: 4,
                clear_regions: Vec::new(),
            })],
        };
        let logical = prepare(&path(1.0), test_bounds(), 320.0, 240.0);
        let dpr_scaled = prepare(&path(2.0), test_bounds(), 640.0, 480.0);
        let logical = prepared_path(&logical);
        let dpr_scaled = prepared_path(&dpr_scaled);

        assert_eq!(logical.bounds, dpr_scaled.bounds);
        assert_eq!(logical.vertices.len(), dpr_scaled.vertices.len());
        for (logical, dpr_scaled) in logical.vertices.iter().zip(&dpr_scaled.vertices) {
            assert_eq!(logical.xy_position, dpr_scaled.xy_position);
        }
    }

    #[test]
    fn dpr_scaled_stroke_geometry_maps_to_the_same_logical_gpui_path() {
        let path = |scale: f64| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint {
                        x: 24.0 * scale,
                        y: 18.0 * scale,
                    }),
                    PathCommand::LineTo(CanvasPoint {
                        x: 116.0 * scale,
                        y: 70.0 * scale,
                    }),
                ],
                style: StrokePathStyle {
                    color: color(),
                    line_width: 7.0,
                    line_cap: CanvasLineCap::Round,
                    line_join: CanvasLineJoin::Round,
                    miter_limit: 10.0,
                    line_dash: vec![14.0, 8.0],
                    transform: CanvasTransform::from_components(scale, 0.0, 0.0, scale, 0.0, 0.0),
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let logical = prepare(&path(1.0), test_bounds(), 320.0, 240.0);
        let dpr_scaled = prepare(&path(2.0), test_bounds(), 640.0, 480.0);
        assert_eq!(
            prepared_path(&logical).bounds,
            prepared_path(&dpr_scaled).bounds
        );
        assert_eq!(
            vertex_positions(prepared_path(&logical)),
            vertex_positions(prepared_path(&dpr_scaled))
        );
    }

    #[test]
    fn rotated_and_skewed_rectangles_are_tessellated_as_paths_not_quads() {
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::FillRect(FillRect {
                points: [
                    CanvasPoint { x: 40.0, y: 20.0 },
                    CanvasPoint { x: 92.0, y: 42.0 },
                    CanvasPoint { x: 78.0, y: 84.0 },
                    CanvasPoint { x: 26.0, y: 62.0 },
                ],
                color: color(),
                op_index: 7,
                clear_regions: Vec::new(),
            })],
        };

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        assert!(matches!(prepared.items[0], PreparedItem::Path { .. }));
        assert!(prepared.diagnostics.is_empty());
    }

    #[test]
    fn partial_clear_subtracts_triangles_without_reordering_the_later_item() {
        let clear = [
            CanvasPoint { x: 40.0, y: 30.0 },
            CanvasPoint { x: 60.0, y: 30.0 },
            CanvasPoint { x: 60.0, y: 50.0 },
            CanvasPoint { x: 40.0, y: 50.0 },
        ];
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![
                DisplayItem::FillRect(FillRect {
                    points: [
                        CanvasPoint { x: 0.0, y: 0.0 },
                        CanvasPoint { x: 100.0, y: 0.0 },
                        CanvasPoint { x: 100.0, y: 80.0 },
                        CanvasPoint { x: 0.0, y: 80.0 },
                    ],
                    color: color().opacity(0.5),
                    op_index: 0,
                    clear_regions: vec![clear],
                }),
                DisplayItem::FillRect(FillRect {
                    points: [
                        CanvasPoint { x: 44.0, y: 34.0 },
                        CanvasPoint { x: 56.0, y: 34.0 },
                        CanvasPoint { x: 56.0, y: 46.0 },
                        CanvasPoint { x: 44.0, y: 46.0 },
                    ],
                    color: color(),
                    op_index: 2,
                    clear_regions: Vec::new(),
                }),
            ],
        };
        let prepared = prepare(
            &list,
            gpui::bounds(
                gpui::point(gpui::px(0.0), gpui::px(0.0)),
                gpui::size(gpui::px(100.0), gpui::px(80.0)),
            ),
            100.0,
            80.0,
        );

        assert_eq!(prepared.items.len(), 2);
        let PreparedItem::Path { path, color: first } = &prepared.items[0] else {
            panic!("cleared quad should be prepared as clipped triangles");
        };
        assert!((first.a - 0.5).abs() < 1e-6);
        for triangle in path.vertices.chunks_exact(3) {
            let centroid_x = triangle
                .iter()
                .map(|vertex| f32::from(vertex.xy_position.x))
                .sum::<f32>()
                / 3.0;
            let centroid_y = triangle
                .iter()
                .map(|vertex| f32::from(vertex.xy_position.y))
                .sum::<f32>()
                / 3.0;
            assert!(
                centroid_x <= 40.0
                    || centroid_x >= 60.0
                    || centroid_y <= 30.0
                    || centroid_y >= 50.0
            );
        }
        assert!(matches!(prepared.items[1], PreparedItem::Quad(_)));
    }

    #[test]
    fn stroke_rect_uses_the_requested_closed_corner_join() {
        let make = |line_join, miter_limit| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokeRect(StrokeRect {
                x: 20.0,
                y: 20.0,
                width: 60.0,
                height: 40.0,
                transform: CanvasTransform::IDENTITY,
                style: StrokeStyle {
                    color: color(),
                    line_width: 10.0,
                    line_cap: crate::canvas::CanvasLineCap::Butt,
                    line_join,
                    miter_limit,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let miter = prepare(
            &make(CanvasLineJoin::Miter, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let low_miter = prepare(
            &make(CanvasLineJoin::Miter, 1.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let bevel = prepare(
            &make(CanvasLineJoin::Bevel, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let miter = prepared_path(&miter);
        let low_miter = prepared_path(&low_miter);
        let bevel = prepared_path(&bevel);

        assert_ne!(miter.vertices.len(), bevel.vertices.len());
        assert_eq!(vertex_positions(low_miter), vertex_positions(bevel));
        assert_eq!(f32::from(miter.bounds.origin.x), 15.0);
        assert_eq!(f32::from(miter.bounds.origin.y), 15.0);
    }

    #[test]
    fn nonuniform_stroke_keeps_local_width_and_affines_round_caps() {
        let transform = CanvasTransform::from_components(4.0, 0.0, 0.0, 1.0, 0.0, 0.0);
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint { x: 40.0, y: 20.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 200.0, y: 20.0 }),
                ],
                style: StrokePathStyle {
                    color: color(),
                    line_width: 2.0,
                    line_cap: CanvasLineCap::Round,
                    line_join: CanvasLineJoin::Round,
                    miter_limit: 10.0,
                    line_dash: Vec::new(),
                    transform,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        let path = prepared_path(&prepared);
        assert!((f32::from(path.bounds.origin.x) - 36.0).abs() < 0.01);
        assert!((f32::from(path.bounds.origin.y) - 19.0).abs() < 0.01);
        assert!((f32::from(path.bounds.size.width) - 168.0).abs() < 0.01);
        assert!((f32::from(path.bounds.size.height) - 2.0).abs() < 0.01);
    }

    #[test]
    fn tiny_but_invertible_stroke_transform_remains_visible() {
        let underflowing_determinant =
            CanvasTransform::from_components(1e-200, 0.0, 0.0, 1e-200, 0.0, 0.0);
        let local = underflowing_determinant
            .inverse_transform_point(CanvasPoint {
                x: 1e-199,
                y: 2e-199,
            })
            .expect("a finite nonzero scale remains invertible");
        assert!((local.x - 10.0).abs() < 1e-12);
        assert!((local.y - 20.0).abs() < 1e-12);
        let smallest = f64::from_bits(1);
        let extreme = CanvasTransform::from_components(f64::MAX, 0.0, 0.0, smallest, 0.0, 0.0);
        assert_eq!(
            extreme.inverse_transform_point(CanvasPoint {
                x: f64::MAX,
                y: smallest,
            }),
            Some(CanvasPoint { x: 1.0, y: 1.0 })
        );
        assert!(map_commands_to_stroke_space(
            &[PathCommand::MoveTo(CanvasPoint { x: 0.0, y: 0.0 })],
            CanvasTransform::from_components(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        )
        .expect("a singular CTM is a supported no-op")
        .is_none());

        let display_lists = crate::canvas::SharedDisplayLists::default();
        crate::canvas::replace_display_list(
            &display_lists,
            1,
            &[
                crate::canvas::opcodes::STREAM_MAGIC,
                crate::canvas::opcodes::STREAM_VERSION,
                crate::canvas::opcodes::SCALE,
                2,
                crate::canvas::opcodes::LINE_WIDTH,
                1,
                crate::canvas::opcodes::BEGIN_PATH,
                0,
                crate::canvas::opcodes::MOVE_TO,
                2,
                crate::canvas::opcodes::LINE_TO,
                2,
                crate::canvas::opcodes::STROKE,
                0,
            ],
            &[1e-20, 1.0, 2.0, 10.0, 20.0, 200.0, 20.0],
            &[],
        )
        .unwrap();
        let list = display_lists.lock().unwrap().get(&1).unwrap().clone();

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        assert!(prepared.diagnostics.is_empty());
        let path = prepared_path(&prepared);
        assert!(!path.vertices.is_empty());
        assert!(f32::from(path.bounds.size.width) > 0.0);
        assert!((f32::from(path.bounds.size.height) - 2.0).abs() < 0.01);
    }

    #[test]
    fn unrepresentable_stroke_local_coordinates_are_a_named_diagnostic() {
        let transform = CanvasTransform::from_components(1e-40, 0.0, 0.0, 1.0, 0.0, 0.0);
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint { x: 1.0, y: 20.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 2.0, y: 20.0 }),
                ],
                style: StrokePathStyle {
                    color: color(),
                    line_width: 2.0,
                    line_cap: CanvasLineCap::Butt,
                    line_join: CanvasLineJoin::Miter,
                    miter_limit: 10.0,
                    line_dash: Vec::new(),
                    transform,
                },
                op_index: 9,
                clear_regions: Vec::new(),
            })],
        };

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        assert!(prepared.items.is_empty());
        assert_eq!(prepared.diagnostics.len(), 1);
        assert_eq!(prepared.diagnostics[0].op_index, 9);
        assert_eq!(prepared.diagnostics[0].op_name, "stroke");
        assert!(prepared.diagnostics[0]
            .reason
            .contains("stroke-local geometry is not representable"));
    }

    #[test]
    fn dash_phase_restarts_for_each_subpath_and_zero_dash_is_solid() {
        let style = |line_dash| StrokePathStyle {
            color: color(),
            line_width: 2.0,
            line_cap: CanvasLineCap::Butt,
            line_join: CanvasLineJoin::Miter,
            miter_limit: 10.0,
            line_dash,
            transform: CanvasTransform::IDENTITY,
        };
        let first = vec![
            PathCommand::MoveTo(CanvasPoint { x: 0.0, y: 10.0 }),
            PathCommand::LineTo(CanvasPoint { x: 15.0, y: 10.0 }),
        ];
        let second = vec![
            PathCommand::MoveTo(CanvasPoint { x: 0.0, y: 30.0 }),
            PathCommand::LineTo(CanvasPoint { x: 15.0, y: 30.0 }),
        ];
        assert_dash_restart_matches_separate_paths(
            first.iter().chain(&second).cloned().collect(),
            first.clone(),
            second,
        );

        let solid = |line_dash| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: first.clone(),
                style: style(line_dash),
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let empty = prepare(&solid(Vec::new()), test_bounds(), 320.0, 240.0);
        let zeros = prepare(&solid(vec![0.0, 0.0]), test_bounds(), 320.0, 240.0);
        assert_eq!(
            vertex_positions(prepared_path(&empty)),
            vertex_positions(prepared_path(&zeros))
        );
    }

    #[test]
    fn dash_phase_restarts_after_close_path_and_rect() {
        let closed = vec![
            PathCommand::MoveTo(CanvasPoint { x: 20.0, y: 20.0 }),
            PathCommand::LineTo(CanvasPoint { x: 35.0, y: 20.0 }),
            PathCommand::LineTo(CanvasPoint { x: 35.0, y: 35.0 }),
            PathCommand::ClosePath,
        ];
        let after_closed = vec![
            PathCommand::MoveTo(CanvasPoint { x: 20.0, y: 20.0 }),
            PathCommand::LineTo(CanvasPoint { x: 55.0, y: 20.0 }),
        ];
        let mut combined = closed.clone();
        combined.push(PathCommand::LineTo(CanvasPoint { x: 55.0, y: 20.0 }));
        assert_dash_restart_matches_separate_paths(combined, closed, after_closed);

        let rect = vec![
            PathCommand::MoveTo(CanvasPoint { x: 80.0, y: 40.0 }),
            PathCommand::LineTo(CanvasPoint { x: 97.0, y: 40.0 }),
            PathCommand::LineTo(CanvasPoint { x: 97.0, y: 51.0 }),
            PathCommand::LineTo(CanvasPoint { x: 80.0, y: 51.0 }),
            PathCommand::ClosePath,
        ];
        let after_rect = vec![
            PathCommand::MoveTo(CanvasPoint { x: 80.0, y: 40.0 }),
            PathCommand::LineTo(CanvasPoint { x: 115.0, y: 40.0 }),
        ];
        let mut combined = rect.clone();
        combined.push(PathCommand::LineTo(CanvasPoint { x: 115.0, y: 40.0 }));
        assert_dash_restart_matches_separate_paths(combined, rect, after_rect);
    }

    #[test]
    fn adaptive_arc_subdivision_tracks_full_device_transform() {
        let arc = EllipseArc {
            center: CanvasPoint { x: 0.0, y: 0.0 },
            radius_x: 10.0,
            radius_y: 6.0,
            rotation: 0.25,
            start_angle: 0.0,
            sweep: std::f64::consts::TAU,
            transform: CanvasTransform::IDENTITY,
        };
        let commands = vec![
            PathCommand::MoveTo(arc.start_point()),
            PathCommand::Ellipse(arc),
        ];
        let one_x = expand_arcs(&commands, 1.0, 1.0, 1.0);
        let hundred_x = expand_arcs(&commands, 100.0, 100.0, 1.0);
        assert!(hundred_x.len() > one_x.len());
        assert!(one_x
            .iter()
            .skip(1)
            .all(|command| matches!(command, PathCommand::CubicTo { .. })));

        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands,
                style: StrokePathStyle {
                    color: color(),
                    line_width: 1.0,
                    line_cap: CanvasLineCap::Butt,
                    line_join: CanvasLineJoin::Miter,
                    miter_limit: 10.0,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        assert_eq!(prepare(&list, test_bounds(), 320.0, 240.0).tessellations, 1);
    }

    #[test]
    fn canvas_miter_limit_is_converted_to_lyons_ratio() {
        let make = |line_join, miter_limit| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint { x: 20.0, y: 60.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 20.0, y: 20.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 60.0, y: 20.0 }),
                ],
                style: StrokePathStyle {
                    color: color(),
                    line_width: 10.0,
                    line_cap: CanvasLineCap::Butt,
                    line_join,
                    miter_limit,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let miter = prepare(
            &make(CanvasLineJoin::Miter, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let low_miter = prepare(
            &make(CanvasLineJoin::Miter, 1.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let bevel = prepare(
            &make(CanvasLineJoin::Bevel, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );

        assert_eq!(
            vertex_positions(prepared_path(&low_miter)),
            vertex_positions(prepared_path(&bevel))
        );
        assert_ne!(
            vertex_positions(prepared_path(&miter)),
            vertex_positions(prepared_path(&bevel))
        );

        let shallow = |line_join, miter_limit| crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint { x: 20.0, y: 40.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 60.0, y: 40.0 }),
                    PathCommand::LineTo(CanvasPoint { x: 100.0, y: 50.0 }),
                ],
                style: StrokePathStyle {
                    color: color(),
                    line_width: 10.0,
                    line_cap: CanvasLineCap::Butt,
                    line_join,
                    miter_limit,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let shallow_low = prepare(
            &shallow(CanvasLineJoin::Miter, 1.5),
            test_bounds(),
            320.0,
            240.0,
        );
        let shallow_default = prepare(
            &shallow(CanvasLineJoin::Miter, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );
        let shallow_bevel = prepare(
            &shallow(CanvasLineJoin::Bevel, 10.0),
            test_bounds(),
            320.0,
            240.0,
        );
        assert_eq!(
            vertex_positions(prepared_path(&shallow_low)),
            vertex_positions(prepared_path(&shallow_default))
        );
        assert_ne!(
            vertex_positions(prepared_path(&shallow_low)),
            vertex_positions(prepared_path(&shallow_bevel))
        );
    }

    #[test]
    fn rect_path_and_stroke_rect_apply_the_same_canvas_miter_limit() {
        let make = |miter_limit| crate::canvas::DisplayList {
            revision: 1,
            items: vec![
                DisplayItem::StrokeRect(StrokeRect {
                    x: 20.0,
                    y: 20.0,
                    width: 60.0,
                    height: 40.0,
                    transform: CanvasTransform::IDENTITY,
                    style: StrokeStyle {
                        color: color(),
                        line_width: 10.0,
                        line_cap: CanvasLineCap::Butt,
                        line_join: CanvasLineJoin::Miter,
                        miter_limit,
                        line_dash: Vec::new(),
                        transform: CanvasTransform::IDENTITY,
                    },
                    op_index: 0,
                    clear_regions: Vec::new(),
                }),
                DisplayItem::StrokePath(StrokePath {
                    commands: vec![
                        PathCommand::MoveTo(CanvasPoint { x: 20.0, y: 20.0 }),
                        PathCommand::LineTo(CanvasPoint { x: 80.0, y: 20.0 }),
                        PathCommand::LineTo(CanvasPoint { x: 80.0, y: 60.0 }),
                        PathCommand::LineTo(CanvasPoint { x: 20.0, y: 60.0 }),
                        PathCommand::ClosePath,
                    ],
                    style: StrokePathStyle {
                        color: color(),
                        line_width: 10.0,
                        line_cap: CanvasLineCap::Butt,
                        line_join: CanvasLineJoin::Miter,
                        miter_limit,
                        line_dash: Vec::new(),
                        transform: CanvasTransform::IDENTITY,
                    },
                    op_index: 1,
                    clear_regions: Vec::new(),
                }),
            ],
        };
        let has_outer_miter = |path: &gpui::Path<gpui::Pixels>| {
            path.vertices.iter().any(|vertex| {
                (f32::from(vertex.xy_position.x) - 15.0).abs() < 0.01
                    && (f32::from(vertex.xy_position.y) - 15.0).abs() < 0.01
            })
        };

        for (limit, expected_miter) in [(1.0, false), (1.5, true)] {
            let prepared = prepare(&make(limit), test_bounds(), 320.0, 240.0);
            let PreparedItem::Path {
                path: stroke_rect, ..
            } = &prepared.items[0]
            else {
                panic!("expected strokeRect path")
            };
            let PreparedItem::Path {
                path: rect_stroke, ..
            } = &prepared.items[1]
            else {
                panic!("expected rect stroke path")
            };
            assert_eq!(has_outer_miter(stroke_rect), expected_miter);
            assert_eq!(has_outer_miter(rect_stroke), expected_miter);
        }
    }

    #[test]
    fn stroke_rect_preserves_f64_dimensions_and_width_through_the_ctm() {
        let display_lists = crate::canvas::SharedDisplayLists::default();
        crate::canvas::replace_display_list(
            &display_lists,
            1,
            &[
                crate::canvas::opcodes::STREAM_MAGIC,
                crate::canvas::opcodes::STREAM_VERSION,
                crate::canvas::opcodes::LINE_WIDTH,
                1,
                crate::canvas::opcodes::SET_TRANSFORM,
                6,
                crate::canvas::opcodes::STROKE_RECT,
                4,
            ],
            &[
                1e-8,
                1e8,
                0.0,
                0.0,
                1.0,
                -1e8,
                0.0,
                0.0,
                10.0,
                1.000_000_2,
                10.0,
            ],
            &[],
        )
        .unwrap();
        let list = display_lists.lock().unwrap().get(&1).unwrap().clone();

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        let path = prepared_path(&prepared);
        let rightmost = path
            .vertices
            .iter()
            .map(|vertex| f32::from(vertex.xy_position.x))
            .fold(f32::NEG_INFINITY, f32::max);
        // The rectangle edge is x=20 after the CTM and its transformed
        // half-stroke is 0.5. Narrowing 1.0000002 first produced x=23.84.
        assert!((rightmost - 20.5).abs() < 0.01, "rightmost={rightmost}");
    }

    #[test]
    fn one_axis_degenerate_stroke_rect_is_one_butt_capped_segment() {
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokeRect(StrokeRect {
                x: 20.0,
                y: 20.0,
                width: 0.0,
                height: 40.0,
                transform: CanvasTransform::IDENTITY,
                style: StrokeStyle {
                    color: color(),
                    line_width: 10.0,
                    line_cap: crate::canvas::CanvasLineCap::Butt,
                    line_join: CanvasLineJoin::Miter,
                    miter_limit: 10.0,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };

        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        let path = prepared_path(&prepared);
        assert_eq!(f32::from(path.bounds.origin.x), 15.0);
        assert_eq!(f32::from(path.bounds.origin.y), 20.0);
        assert_eq!(f32::from(path.bounds.size.width), 10.0);
        assert_eq!(f32::from(path.bounds.size.height), 40.0);
    }

    #[test]
    fn cache_key_keeps_revision_bounds_and_device_scale() {
        let bounds = test_bounds();
        let baseline = CacheKey::new(3, bounds, 2.0);

        assert_ne!(baseline, CacheKey::new(4, bounds, 2.0));
        assert_ne!(baseline, CacheKey::new(3, bounds, 1.0));
        assert_ne!(
            baseline,
            CacheKey::new(
                3,
                gpui::bounds(gpui::point(gpui::px(1.0), gpui::px(0.0)), bounds.size,),
                2.0,
            )
        );
    }

    #[test]
    fn path_build_failures_keep_the_operation_name_and_a_loud_reason() {
        let diagnostic =
            path_build_diagnostic(9, "fillRect", "nonzero fill", &"vertex limit exceeded");

        assert_eq!(diagnostic.op_index, 9);
        assert_eq!(diagnostic.op_name, "fillRect");
        assert_eq!(
            diagnostic.reason,
            "GPUI PathBuilder failed to build nonzero fill geometry: vertex limit exceeded"
        );
    }

    #[test]
    fn device_scale_tightens_curve_tolerance() {
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::FillPath(FillPath {
                commands: vec![
                    PathCommand::MoveTo(CanvasPoint { x: 10.0, y: 120.0 }),
                    PathCommand::CubicTo {
                        control_a: CanvasPoint { x: 40.0, y: -80.0 },
                        control_b: CanvasPoint { x: 280.0, y: 320.0 },
                        to: CanvasPoint { x: 310.0, y: 120.0 },
                    },
                    PathCommand::LineTo(CanvasPoint { x: 10.0, y: 120.0 }),
                    PathCommand::ClosePath,
                ],
                color: color(),
                fill_rule: CanvasFillRule::NonZero,
                op_index: 0,
                clear_regions: Vec::new(),
            })],
        };
        let one_x = prepare_with_scale(&list, test_bounds(), 320.0, 240.0, 1.0);
        let four_x = prepare_with_scale(&list, test_bounds(), 320.0, 240.0, 4.0);
        assert!(prepared_path(&four_x).vertices.len() > prepared_path(&one_x).vertices.len());
    }

    #[test]
    fn u16_vertex_overflow_is_a_loud_preparation_diagnostic() {
        let mut commands = Vec::with_capacity(70_001);
        for index in 0..70_000 {
            let x = (index % 300) as f64;
            let y = (index / 300) as f64;
            commands.push(PathCommand::MoveTo(CanvasPoint { x, y }));
            commands.push(PathCommand::LineTo(CanvasPoint { x: x + 0.5, y }));
        }
        let list = crate::canvas::DisplayList {
            revision: 1,
            items: vec![DisplayItem::StrokePath(StrokePath {
                commands,
                style: StrokePathStyle {
                    color: color(),
                    line_width: 1.0,
                    line_cap: CanvasLineCap::Butt,
                    line_join: CanvasLineJoin::Miter,
                    miter_limit: 10.0,
                    line_dash: Vec::new(),
                    transform: CanvasTransform::IDENTITY,
                },
                op_index: 7,
                clear_regions: Vec::new(),
            })],
        };
        let prepared = prepare(&list, test_bounds(), 320.0, 240.0);
        assert!(prepared.items.is_empty());
        assert_eq!(prepared.diagnostics.len(), 1);
        assert_eq!(prepared.diagnostics[0].op_name, "stroke");
        assert!(prepared.diagnostics[0]
            .reason
            .contains("PathBuilder failed"));
    }
}
