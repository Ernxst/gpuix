//! The gpui half of text selection: the per-frame registry, the wash geometry,
//! and the window-level mouse and key listeners.
//!
//! Ported from Comet (https://github.com/zeronsh/comet), MIT.
//! Original: the selection sections of `crates/ui/src/markdown/render.rs`.
//!
//! Why the registry is rebuilt during **paint** rather than during build:
//! paint order is the only place where document order is guaranteed, because a
//! `list()` or `uniform_list()` decides at paint time which rows exist. Comet
//! learned this the hard way; do not move registration into `build_element`.

use std::cell::RefCell;
use std::ops::Range;
use std::sync::Arc;

use parking_lot::Mutex;

use gpui::{
    canvas, div, point, prelude::*, px, quad, size, App, BorderStyle, Bounds, Element, ElementId,
    GlobalElementId, Hsla, InspectorElementId, IntoElement, LayoutId, SharedString, StyledText,
    TextLayout, TextRun, Window,
};

use super::inline::{validate_runs, StyledTextRun};
use super::selection::{self, SelectionState};

/// Shared selection state. `GpuixView` and `GpuixRenderer` both hold clones, and
/// so does every paint closure.
///
/// `Arc<Mutex<..>>` rather than `Rc<RefCell<..>>`: napi requires `GpuixRenderer`
/// to be `Send`, and the renderer needs a handle so `getSelectedText()` works
/// without an App context. All real access is single-threaded, so the mutex is
/// always uncontended.
pub type SharedSelection = Arc<Mutex<SelectionState>>;

/// One painted text element, registered per frame in document order.
struct RegEntry {
    key: Arc<str>,
    text: SharedString,
    layout: TextLayout,
}

/// Full element box that owns whether a press may start a selection.
///
/// `userSelect: "none"` chrome and native inputs register `selectable: false`
/// so a same-row nearest-text clamp cannot steal their press. An explicit
/// `userSelect: "text"` island registers `true` and can override an ancestor.
struct StartRegion {
    bounds: Bounds<gpui::Pixels>,
    selectable: bool,
}

thread_local! {
    static REGISTRY: RefCell<Vec<RegEntry>> = const { RefCell::new(Vec::new()) };
    static START_REGIONS: RefCell<Vec<StartRegion>> = const { RefCell::new(Vec::new()) };
    /// Every string painted this frame, selectable or not, in paint order.
    ///
    /// Native elements draw their text inside gpui, so it never appears in the
    /// retained tree and `getAllText()` cannot see it. Without this log the only
    /// way to assert what `<code>` or `<diff>` rendered is a screenshot, which
    /// tells you something changed but never what.
    static PAINTED: RefCell<Vec<SharedString>> = const { RefCell::new(Vec::new()) };
}

/// A zero-size canvas that clears the per-frame registries and installs the
/// frame's copy and mouse-down listeners. Paint it FIRST in the root, before
/// any text, so each frame holds exactly that frame's visible text elements
/// in paint order.
pub fn selection_frame_reset(selection: SharedSelection) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |_, _, window, _| {
            REGISTRY.with(|r| r.borrow_mut().clear());
            START_REGIONS.with(|r| r.borrow_mut().clear());
            PAINTED.with(|p| p.borrow_mut().clear());
            register_copy_listener(window, &selection);
            register_down_listener(window, &selection);
        },
    )
    .absolute()
    .w(px(0.0))
    .h(px(0.0))
}

/// Record a selection-start region from an element's painted box.
///
/// Called from `bounds_tracker` so the region is the same box automation
/// already uses. Last painted region that contains the point wins.
pub fn record_start_region(bounds: Bounds<gpui::Pixels>, selectable: bool) {
    START_REGIONS.with(|r| r.borrow_mut().push(StartRegion { bounds, selectable }));
}

/// Overlay that records this element's box as a selection-start region.
///
/// The parent must be positioned (`relative` is enough). Used by native
/// inputs, which do not go through `bounds_tracker`.
pub fn selection_start_region(selectable: bool) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, _, _| {
            record_start_region(bounds, selectable);
        },
    )
    .absolute()
    .size_full()
}

/// Last painted start region that contains `position`.
fn start_region_at(position: gpui::Point<gpui::Pixels>) -> Option<bool> {
    START_REGIONS.with(|r| {
        r.borrow()
            .iter()
            .rev()
            .find(|region| region.bounds.contains(&position))
            .map(|region| region.selectable)
    })
}

/// Every string painted in the last frame, in paint order. Test-facing.
pub fn painted_text() -> Vec<String> {
    PAINTED.with(|p| p.borrow().iter().map(|s| s.to_string()).collect())
}

/// Record text painted by a custom element that owns its text layout.
pub fn log_painted_text(text: SharedString) {
    PAINTED.with(|painted| painted.borrow_mut().push(text));
}

/// Text that is deliberately NOT selectable: line-number gutters, language
/// tags, diff file headers. It still lands in the paint log so tests can assert
/// on it, but a drag across the block never copies it.
pub fn chrome_text(text: SharedString, runs: Option<Vec<TextRun>>) -> gpui::AnyElement {
    let styled = match runs {
        Some(runs) => StyledText::new(text.clone()).with_runs(runs),
        None => StyledText::new(text.clone()),
    };
    let log = canvas(
        |_, _, _| (),
        move |_, _, _, _| PAINTED.with(|p| p.borrow_mut().push(text.clone())),
    )
    .absolute()
    .w(px(0.0))
    .h(px(0.0));
    div().relative().child(log).child(styled).into_any_element()
}

/// Selection key for an element. `sub` distinguishes multiple text runs painted
/// by one element, such as the lines of a code block.
pub fn selection_key(element_id: u64, sub: usize) -> Arc<str> {
    format!("{element_id}:{sub}").into()
}

/// Inputs for [`selectable_text`].
pub struct SelectableText {
    pub text: SharedString,
    /// `None` is the important case for plain `<text>` nodes: gpui then derives
    /// one run from `window.text_style()`, so colour, weight and family keep
    /// inheriting from ancestor `style` props. Pass `Some(..)` only when the
    /// element owns its own colours, as `<code>` and `<diff>` do.
    pub runs: Option<Vec<TextRun>>,
    /// Deferred run styles resolved against the inherited GPUI text style during
    /// layout. Unlike prebuilt `TextRun`s, these can inherit the outer text's
    /// font while overriding letter spacing inside selected byte ranges.
    pub run_styles: Option<Vec<StyledTextRun>>,
    pub key: Arc<str>,
    pub selection: SharedSelection,
    pub wash_color: Hsla,
    /// Paints additional quads under the glyphs before the selection wash:
    /// inline-code pills, word-diff highlights. Receives the laid-out text so
    /// it can turn byte ranges into rects with [`range_rects`].
    pub extra_wash: Option<Box<dyn Fn(&TextLayout, &mut Window)>>,
    /// Clickable byte ranges and their payloads, typically link URLs.
    pub links: Vec<(Range<usize>, String)>,
    /// Called with the payload of the range under a click.
    pub on_link: Option<Arc<dyn Fn(&str)>>,
    /// Nested React text hosts whose glyph ranges should have automation bounds.
    pub tracked_ranges: Vec<(Range<usize>, u64)>,
    /// Nested React text hosts with an `onClick` handler.
    pub clickable_ranges: Vec<(Range<usize>, u64)>,
    /// Called with the most specific clickable host under a mouse-up.
    pub on_inline_click: Option<Arc<dyn Fn(u64, &gpui::MouseUpEvent)>>,
    /// False under `userSelect: "none"`: the text is still painted, logged and
    /// clickable, but it does not join the selection registry.
    pub selectable: bool,
}

impl SelectableText {
    pub fn new(
        text: SharedString,
        runs: Option<Vec<TextRun>>,
        key: Arc<str>,
        selection: SharedSelection,
        wash_color: Hsla,
    ) -> Self {
        Self {
            text,
            runs,
            run_styles: None,
            key,
            selection,
            wash_color,
            extra_wash: None,
            links: Vec::new(),
            on_link: None,
            tracked_ranges: Vec::new(),
            clickable_ranges: Vec::new(),
            on_inline_click: None,
            selectable: true,
        }
    }
}

/// A `StyledText` whose exact-cover run refinements resolve after the parent
/// div has pushed its inherited `TextStyle` onto the GPUI window stack.
struct RunStyledText {
    text: SharedString,
    runs: Vec<StyledTextRun>,
    styled: StyledText,
}

impl RunStyledText {
    fn new(text: SharedString, runs: Vec<StyledTextRun>) -> Self {
        Self {
            styled: StyledText::new(text.clone()),
            text,
            runs,
        }
    }

    fn layout(&self) -> &TextLayout {
        self.styled.layout()
    }

    fn resolve_runs(&self, window: &Window) -> Vec<TextRun> {
        let inherited = window.text_style();
        self.runs
            .iter()
            .map(|run| {
                let mut style = inherited.clone();
                if let Some(color) = run.style.color {
                    style.color = color;
                }
                if let Some(family) = &run.style.font_family {
                    style.font_family = family.clone();
                }
                if let Some(weight) = run.style.font_weight {
                    style.font_weight = weight;
                }
                if let Some(spacing) = run.style.letter_spacing {
                    style.letter_spacing = spacing;
                }
                if let Some(background) = run.style.background_color {
                    style.background_color = Some(background);
                }
                if let Some(underline) = run.style.underline {
                    style.underline = Some(underline);
                }
                if let Some(strikethrough) = run.style.strikethrough {
                    style.strikethrough = Some(strikethrough);
                }
                style.to_run(run.range.len())
            })
            .collect()
    }
}

impl Element for RunStyledText {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let runs = self.resolve_runs(window);
        let styled = std::mem::replace(&mut self.styled, StyledText::new(self.text.clone()));
        self.styled = styled.with_runs(runs);
        self.styled.request_layout(id, inspector_id, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<gpui::Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled
            .prepaint(id, inspector_id, bounds, request_layout, window, cx)
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<gpui::Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.styled.paint(
            id,
            inspector_id,
            bounds,
            request_layout,
            prepaint,
            window,
            cx,
        );
    }
}

impl IntoElement for RunStyledText {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

/// A selectable text element: `StyledText` with a canvas underlay that paints
/// the selection wash, registers into the frame registry, and installs the
/// mouse listeners.
pub fn selectable_text(opts: SelectableText) -> gpui::AnyElement {
    let SelectableText {
        text,
        runs,
        run_styles,
        key,
        selection,
        wash_color,
        extra_wash,
        links,
        on_link,
        tracked_ranges,
        clickable_ranges,
        on_inline_click,
        selectable,
    } = opts;

    debug_assert!(runs.is_none() || run_styles.is_none());
    let (layout, styled) = match run_styles {
        Some(run_styles) => match validate_runs(&text, &run_styles) {
            Ok(()) => {
                let styled = RunStyledText::new(text.clone(), run_styles);
                (styled.layout().clone(), styled.into_any_element())
            }
            Err(error) => {
                log::error!("Invalid inline text runs: {error}");
                let styled = StyledText::new(text.clone());
                (styled.layout().clone(), styled.into_any_element())
            }
        },
        None => {
            let styled = match runs {
                Some(runs) => StyledText::new(text.clone()).with_runs(runs),
                None => StyledText::new(text.clone()),
            };
            (styled.layout().clone(), styled.into_any_element())
        }
    };

    let underlay = canvas(
        |_, _, _| (),
        move |_, _, window, _| {
            if let Some(paint) = &extra_wash {
                paint(&layout, window);
            }
            if let Some(range) = selectable
                .then(|| selection.lock().wash_range(&key))
                .flatten()
            {
                for rect in range_rects(&layout, &range, 0.0, 0.0) {
                    window.paint_quad(quad(
                        rect,
                        px(0.0),
                        wash_color,
                        px(0.0),
                        gpui::transparent_black(),
                        BorderStyle::default(),
                    ));
                }
            }
            if selectable {
                REGISTRY.with(|r| {
                    r.borrow_mut().push(RegEntry {
                        key: key.clone(),
                        text: text.clone(),
                        layout: layout.clone(),
                    })
                });
                register_listeners(window, &key, &selection);
            }
            PAINTED.with(|p| p.borrow_mut().push(text.clone()));
            for (range, element_id) in &tracked_ranges {
                if let Some(bounds) = range_rects(&layout, range, 0.0, 0.0)
                    .into_iter()
                    .reduce(|bounds, next| bounds.union(&next))
                {
                    crate::automation::record_bounds(*element_id, bounds);
                }
            }
            if let Some(on_link) = &on_link {
                register_link_listener(window, &layout, &links, on_link, &selection);
            }
            if let Some(on_inline_click) = &on_inline_click {
                register_inline_click_listener(
                    window,
                    &layout,
                    &clickable_ranges,
                    on_inline_click,
                    &selection,
                );
            }
        },
    )
    .absolute()
    .size_full();

    div()
        .relative()
        .child(underlay)
        .child(styled)
        .into_any_element()
}

fn register_inline_click_listener(
    window: &mut Window,
    layout: &TextLayout,
    targets: &[(Range<usize>, u64)],
    on_click: &Arc<dyn Fn(u64, &gpui::MouseUpEvent)>,
    selection: &SharedSelection,
) {
    use gpui::{DispatchPhase, MouseButton, MouseUpEvent};

    if targets.is_empty() {
        return;
    }
    let (layout, targets, on_click, selection) = (
        layout.clone(),
        targets.to_vec(),
        on_click.clone(),
        selection.clone(),
    );
    window.on_mouse_event(move |event: &MouseUpEvent, phase, _window, cx| {
        if phase != DispatchPhase::Bubble || event.button != MouseButton::Left {
            return;
        }
        if !layout.bounds().contains(&event.position) || selection.lock().selected_text().is_some()
        {
            return;
        }
        let Ok(index) = layout.index_for_position(event.position) else {
            return;
        };
        if let Some((_, element_id)) = targets
            .iter()
            .filter(|(range, _)| range.contains(&index))
            .min_by_key(|(range, _)| range.len())
        {
            on_click(*element_id, event);
            // React owns propagation from the most specific inline target.
            // Without this, a native ancestor hitbox also emits its own click.
            cx.stop_propagation();
        }
    });
}

/// Fire `on_link` for the range under a click.
///
/// Registered on mouse UP and skipped when a selection exists, so a drag that
/// happens to end on a link selects text instead of navigating. gpui's
/// `InteractiveText` does per-range hit testing too, but it owns the
/// `StyledText` and would displace the selection underlay.
fn register_link_listener(
    window: &mut Window,
    layout: &TextLayout,
    links: &[(Range<usize>, String)],
    on_link: &Arc<dyn Fn(&str)>,
    selection: &SharedSelection,
) {
    use gpui::{DispatchPhase, MouseButton, MouseUpEvent};

    if links.is_empty() {
        return;
    }
    let (layout, links, on_link, selection) = (
        layout.clone(),
        links.to_vec(),
        on_link.clone(),
        selection.clone(),
    );
    window.on_mouse_event(move |e: &MouseUpEvent, phase, _window, _cx| {
        if phase != DispatchPhase::Bubble || e.button != MouseButton::Left {
            return;
        }
        if !layout.bounds().contains(&e.position) {
            return;
        }
        // A drag that ends on a link is a selection, not a navigation. gpui
        // dispatches bubble listeners in reverse registration order, so the
        // spans from the drag's mouse-moves are already resolved here.
        if selection.lock().selected_text().is_some() {
            return;
        }
        // `index_for_position` returns Err with the nearest index when the
        // point is past the end of a line. Only an exact hit counts, otherwise
        // clicking the empty space after a paragraph would open its last link.
        let Ok(ix) = layout.index_for_position(e.position) else {
            return;
        };
        if let Some((_, payload)) = links.iter().find(|(range, _)| range.contains(&ix)) {
            on_link(payload);
        }
    });
}

/// `(element index, byte offset)` for a window position.
///
/// Prefers the element whose full bounds contain the point, taking the LAST
/// such element in paint order so an overlay wins over what it covers. Only
/// when the point is outside every text does it fall back to the nearest by
/// vertical then horizontal distance. `index_for_position` then clamps: left
/// of a line is the line start, right of a line is the line end.
///
/// Mouse-down uses [`registry_point_on_line`] so a press in a composer or
/// titlebar does not start a selection on the nearest paragraph. The drag
/// head keeps the unbounded clamp so a selection that already started can
/// still run into the gutter or past the last line.
///
/// Comet compares Y only, because its transcript is a single column where two
/// texts never share a vertical band. GPUIX lays out arbitrary React trees: a
/// Y-only match picks the leftmost text in a flex row no matter where the
/// pointer actually is.
fn registry_point(position: gpui::Point<gpui::Pixels>) -> Option<(usize, usize)> {
    REGISTRY.with(|r| {
        let reg = r.borrow();
        let mut contained: Option<usize> = None;
        let mut nearest: Option<(usize, (f32, f32))> = None;

        for (ei, entry) in reg.iter().enumerate() {
            let b = entry.layout.bounds();
            if b.contains(&position) {
                contained = Some(ei);
                continue;
            }
            let dy = if position.y < b.top() {
                f32::from(b.top() - position.y)
            } else if position.y > b.bottom() {
                f32::from(position.y - b.bottom())
            } else {
                0.0
            };
            // Within a shared band, break the tie on horizontal distance so a
            // drag in the right-hand column does not snap to the left one.
            // Compared lexicographically: vertical distance dominates outright,
            // because a weighted sum lets a huge dx beat a 1px dy.
            let dx = if position.x < b.left() {
                f32::from(b.left() - position.x)
            } else if position.x > b.right() {
                f32::from(position.x - b.right())
            } else {
                0.0
            };
            let distance = (dy, dx);
            if nearest.is_none_or(|(_, best): (usize, (f32, f32))| {
                (distance.0, distance.1) < (best.0, best.1)
            }) {
                nearest = Some((ei, distance));
            }
        }

        let ei = contained.or(nearest.map(|(ei, _)| ei))?;
        let ix = match reg[ei].layout.index_for_position(position) {
            Ok(ix) | Err(ix) => ix,
        };
        Some((ei, ix))
    })
}

/// Like [`registry_point`], but only when the pointer shares a text's vertical
/// band. That is the empty start or end of the line, a gutter, or parent
/// padding on that row. A press above or below every line is chrome.
fn registry_point_on_line(position: gpui::Point<gpui::Pixels>) -> Option<(usize, usize)> {
    let (ei, ix) = registry_point(position)?;
    REGISTRY.with(|r| {
        let b = r.borrow().get(ei)?.layout.bounds();
        (position.y >= b.top() && position.y <= b.bottom()).then_some((ei, ix))
    })
}

/// Resolve anchor + head into document-ordered spans over the frame's registry.
/// True when the selection changed.
fn resolve_drag(
    selection: &SharedSelection,
    anchor_key: &str,
    anchor_ix: usize,
    head: (usize, usize),
) -> bool {
    REGISTRY.with(|r| {
        let reg = r.borrow();
        let Some(anchor_ei) = reg.iter().position(|e| e.key.as_ref() == anchor_key) else {
            // Anchor scrolled out of this frame — keep the spans we have.
            return false;
        };
        let elements: Vec<(&str, &str)> = reg
            .iter()
            .map(|e| (e.key.as_ref(), e.text.as_ref()))
            .collect();
        let spans = selection::resolve_spans(&elements, (anchor_ei, anchor_ix), head);
        selection.lock().update_spans(spans)
    })
}

/// One window-level mouse-down for the whole frame.
///
/// Per-element downs required the press to land inside a `TextLayout` box,
/// which is the glyph bounds, not the parent padding. A single listener
/// clamps with [`registry_point_on_line`].
fn register_down_listener(window: &mut Window, selection: &SharedSelection) {
    use gpui::{DispatchPhase, MouseButton, MouseDownEvent};

    let selection = selection.clone();
    window.on_mouse_event(move |e: &MouseDownEvent, phase, window, _cx| {
        if phase != DispatchPhase::Bubble || e.button != MouseButton::Left {
            return;
        }
        if start_region_at(e.position) == Some(false) {
            let mut sel = selection.lock();
            if !sel.is_active() {
                return;
            }
            sel.clear();
            drop(sel);
            window.refresh();
            return;
        }
        let hit = registry_point_on_line(e.position).and_then(|(ei, ix)| {
            REGISTRY.with(|r| {
                r.borrow()
                    .get(ei)
                    .map(|entry| (entry.key.clone(), entry.text.clone(), ix))
            })
        });
        let mut sel = selection.lock();
        let was_active = sel.is_active();
        if let Some((key, text, ix)) = hit {
            match e.click_count {
                2 => {
                    window.blur();
                    let range = selection::word_range(&text, ix);
                    sel.begin_with_span(&key, &text, range);
                }
                n if n >= 3 => {
                    window.blur();
                    sel.begin_with_span(&key, &text, 0..text.len());
                }
                // A tap must not select or blur. iOS uses that gesture to
                // scroll or to focus an input; the first dragging move
                // promotes this press into a real selection.
                _ => sel.arm(&key, ix),
            }
        } else if sel.is_active() || sel.is_pending() {
            sel.clear();
        } else {
            return;
        }
        let needs_refresh = was_active || sel.is_active();
        drop(sel);
        if needs_refresh {
            window.refresh();
        }
    });
}

/// Register this frame's window-level move and up listeners for one text
/// element. Down is registered once on the frame reset.
///
/// Window-level, not element-level, so a drag keeps tracking after the mouse
/// leaves the element's bounds. Frame-scoped, so paint re-registers every frame.
fn register_listeners(window: &mut Window, key: &Arc<str>, selection: &SharedSelection) {
    use gpui::{DispatchPhase, MouseMoveEvent, MouseUpEvent};

    {
        let (key, selection) = (key.clone(), selection.clone());
        window.on_mouse_event(move |e: &MouseMoveEvent, phase, window, _cx| {
            if phase != DispatchPhase::Bubble || !e.dragging() {
                return;
            }
            if selection.lock().promote_pending_for(&key) {
                window.blur();
            }
            // Only the anchor element's listener drives the drag.
            let Some(anchor_ix) = selection.lock().drag_anchor(&key) else {
                return;
            };
            let Some(head) = registry_point(e.position) else {
                return;
            };
            if resolve_drag(&selection, &key, anchor_ix, head) {
                window.refresh();
            }
        });
    }
    {
        let (key, selection) = (key.clone(), selection.clone());
        window.on_mouse_event(move |_: &MouseUpEvent, phase, _window, _cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }
            let mut sel = selection.lock();
            sel.cancel_pending();
            sel.end_drag(&key);
        });
    }
}

fn register_copy_listener(window: &mut Window, selection: &SharedSelection) {
    use gpui::{ClipboardItem, DispatchPhase, KeyDownEvent};

    let selection = selection.clone();
    window.on_root_key_event(move |e: &KeyDownEvent, phase, _window, cx| {
        if phase != DispatchPhase::Bubble {
            return;
        }
        let modifiers = &e.keystroke.modifiers;
        if e.keystroke.key != "c" || !(modifiers.platform || modifiers.control) {
            return;
        }
        // Release the selection lock before entering the platform clipboard.
        let text = selection.lock().selected_text();
        if let Some(text) = text {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
            cx.stop_propagation();
        }
    });
}

/// The wash boxes for one byte range: one box per visual line the range covers,
/// since soft wraps split it, in window coordinates from the laid-out text's own
/// geometry.
///
/// `pad_x` overhangs the box horizontally (inline code); `inset_y` shrinks it
/// vertically. Both are 0 for a selection wash, which wants full-line-height
/// boxes that tile seamlessly across wrapped rows.
pub fn range_rects(
    layout: &TextLayout,
    range: &Range<usize>,
    pad_x: f32,
    inset_y: f32,
) -> Vec<Bounds<gpui::Pixels>> {
    let mut rects = Vec::new();
    let line_height = layout.line_height();
    let mut cur = range.start;
    // Walk the range one visual row at a time: binary search for the furthest
    // index that still sits on the current row.
    let mut guard = 0;
    while cur < range.end && guard < 256 {
        guard += 1;
        let Some(p1) = layout.position_for_index(cur) else {
            break;
        };
        // `seg_end` closes the wash on this row; `next` is the first index on the
        // following row. They differ because a row-end index's position still
        // reports the earlier row, and we need strict progress.
        let (seg_end, next) = match layout.position_for_index(range.end) {
            Some(pe) if pe.y == p1.y => (range.end, range.end),
            _ => {
                let (mut lo, mut hi) = (cur, range.end);
                while hi - lo > 1 {
                    let mid = lo + (hi - lo) / 2;
                    match layout.position_for_index(mid) {
                        Some(pm) if pm.y == p1.y => lo = mid,
                        _ => hi = mid,
                    }
                }
                (lo, hi)
            }
        };
        if let Some(p2) = layout.position_for_index(seg_end) {
            if p2.x > p1.x {
                rects.push(Bounds::new(
                    point(p1.x - px(pad_x), p1.y + px(inset_y)),
                    size(
                        p2.x - p1.x + px(2.0 * pad_x),
                        line_height - px(2.0 * inset_y),
                    ),
                ));
            }
        }
        if next <= cur {
            break;
        }
        cur = next;
    }
    rects
}
