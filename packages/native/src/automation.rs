//! Shared automation host: paint bounds and a controllable motion clock.
//!
//! Record bounds during **paint**, not prepaint. The frame reset canvas
//! clears the map in paint, and GPUI prepaint runs for the whole tree
//! before any paint. A prepaint recorder would be wiped by the reset.
//!
//! TestGpuixRenderer and GpuixRenderer both use this so locators, screenshots,
//! and clock control do not fork between headless tests and a live window.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gpui::{
    canvas, point, px, App, Bounds, InputEvent, IntoElement, KeyDownEvent, KeyUpEvent, Keystroke,
    Modifiers, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, ScrollDelta,
    ScrollWheelEvent, Styled, TouchPhase, Window,
};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;
use web_time::Instant;

/// The platform-level fields GPUI records for a scroll-wheel input.
///
/// Keep this at the automation boundary so the test and live renderers inject
/// identical events.
#[derive(Clone, Debug, Default)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct ScrollWheelOptions {
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "\"started\" | \"moved\" | \"ended\" | \"cancelled\"")
    )]
    pub phase: Option<String>,
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "\"started\" | \"moved\" | \"ended\" | \"cancelled\"")
    )]
    pub momentum_phase: Option<String>,
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(ts_type = "\"pixels\" | \"lines\"")
    )]
    pub delta_unit: Option<String>,
    pub modifiers: Option<ScrollWheelModifiers>,
}

#[derive(Clone, Debug, Default)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct ScrollWheelModifiers {
    pub shift: Option<bool>,
    pub ctrl: Option<bool>,
    pub alt: Option<bool>,
    pub cmd: Option<bool>,
    pub function: Option<bool>,
}

impl From<ScrollWheelModifiers> for Modifiers {
    fn from(modifiers: ScrollWheelModifiers) -> Self {
        Self {
            shift: modifiers.shift.unwrap_or_default(),
            control: modifiers.ctrl.unwrap_or_default(),
            alt: modifiers.alt.unwrap_or_default(),
            platform: modifiers.cmd.unwrap_or_default(),
            function: modifiers.function.unwrap_or_default(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ElementBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ElementBounds {
    fn from_gpui(bounds: Bounds<Pixels>) -> Self {
        Self {
            x: f64::from(f32::from(bounds.origin.x)),
            y: f64::from(f32::from(bounds.origin.y)),
            width: f64::from(f32::from(bounds.size.width)),
            height: f64::from(f32::from(bounds.size.height)),
        }
    }
}

thread_local! {
    static BOUNDS: RefCell<HashMap<u64, ElementBounds>> = RefCell::new(HashMap::new());
}

/// Zero-size canvas. Keep it ahead of the app subtree under the root.
///
/// Everything here is recorded during **paint**, never prepaint: gpui's
/// `List::prepaint` speculatively prepaints a row range and can roll the window
/// back and prepaint a different one, so a prepaint-recorded box can belong to a
/// row that never reached the screen.
pub fn bounds_frame_reset() -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |_, _, _, _| {
            BOUNDS.with(|cell| cell.borrow_mut().clear());
        },
    )
    .absolute()
    .w(px(0.0))
    .h(px(0.0))
}

/// Record this element's own painted box, with no extra element in the tree.
///
/// `bounds_tracker` needs a positioned parent and one canvas child, which a leaf
/// such as `gpui::img` cannot have. Wrapping the leaf in a div instead would
/// move the layout box: the wrapper would become the flex item and the image
/// would lose intrinsic sizing and corner clipping.
pub fn track_own_bounds<E: gpui::InteractiveElement>(el: E, id: u64) -> E {
    el.on_painted(move |bounds, _, _| record_bounds(id, bounds))
}

pub fn record_bounds(id: u64, bounds: Bounds<Pixels>) {
    BOUNDS.with(|cell| {
        cell.borrow_mut()
            .insert(id, ElementBounds::from_gpui(bounds));
    });
}

pub fn get_bounds(id: u64) -> Option<ElementBounds> {
    BOUNDS.with(|cell| cell.borrow().get(&id).copied())
}

pub fn all_bounds() -> HashMap<u64, ElementBounds> {
    BOUNDS.with(|cell| cell.borrow().clone())
}

pub fn bounds_tracker(id: u64, selection_start: Option<bool>) -> impl IntoElement {
    canvas(
        |bounds, _, _| bounds,
        move |bounds, _, _, _| {
            record_bounds(id, bounds);
            if let Some(selectable) = selection_start {
                crate::text::record_start_region(bounds, selectable);
            }
        },
    )
    .absolute()
    .size_full()
}

enum ClockMode {
    Live,
    Frozen { now: Instant },
}

struct ClockInner {
    origin: Instant,
    mode: ClockMode,
}

#[derive(Clone)]
pub struct AutomationClock {
    inner: Arc<Mutex<ClockInner>>,
}

impl Default for AutomationClock {
    fn default() -> Self {
        Self::new()
    }
}

impl AutomationClock {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ClockInner {
                origin: Instant::now(),
                mode: ClockMode::Live,
            })),
        }
    }

    pub fn now(&self) -> Instant {
        let inner = self.inner.lock().unwrap();
        match inner.mode {
            ClockMode::Live => Instant::now(),
            ClockMode::Frozen { now } => now,
        }
    }

    #[allow(dead_code)]
    pub fn now_ms(&self) -> f64 {
        let inner = self.inner.lock().unwrap();
        current_instant(&inner)
            .saturating_duration_since(inner.origin)
            .as_secs_f64()
            * 1000.0
    }

    pub fn pause(&self) -> f64 {
        let mut inner = self.inner.lock().unwrap();
        let now = current_instant(&inner);
        inner.mode = ClockMode::Frozen { now };
        now.saturating_duration_since(inner.origin).as_secs_f64() * 1000.0
    }

    pub fn set_ms(&self, now_ms: f64) -> f64 {
        let mut inner = self.inner.lock().unwrap();
        let now = inner.origin + duration_ms(now_ms);
        inner.mode = ClockMode::Frozen { now };
        now_ms
    }

    pub fn fast_forward_ms(&self, delta_ms: f64) -> f64 {
        let mut inner = self.inner.lock().unwrap();
        let now = current_instant(&inner) + duration_ms(delta_ms);
        inner.mode = ClockMode::Frozen { now };
        now.saturating_duration_since(inner.origin).as_secs_f64() * 1000.0
    }

    /// Advance only when a test has explicitly paused or set the animation
    /// clock. This lets the combined async-clock helper drive timers and
    /// animation frames without unexpectedly freezing a live renderer.
    pub fn fast_forward_if_frozen_ms(&self, delta_ms: f64) -> Option<f64> {
        let mut inner = self.inner.lock().unwrap();
        let ClockMode::Frozen { now } = inner.mode else {
            return None;
        };
        let now = now + duration_ms(delta_ms);
        inner.mode = ClockMode::Frozen { now };
        Some(now.saturating_duration_since(inner.origin).as_secs_f64() * 1000.0)
    }

    pub fn resume(&self) -> f64 {
        let mut inner = self.inner.lock().unwrap();
        let elapsed = current_instant(&inner).saturating_duration_since(inner.origin);
        inner.origin = Instant::now() - elapsed;
        inner.mode = ClockMode::Live;
        elapsed.as_secs_f64() * 1000.0
    }
}

fn current_instant(inner: &ClockInner) -> Instant {
    match inner.mode {
        ClockMode::Live => Instant::now(),
        ClockMode::Frozen { now } => now,
    }
}

fn duration_ms(ms: f64) -> Duration {
    Duration::from_secs_f64((ms / 1000.0).max(0.0))
}

pub fn mouse_button(button: u32) -> MouseButton {
    match button {
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        _ => MouseButton::Left,
    }
}

/// Parse the held modifiers of a simulated mouse event from the same
/// hyphenated syntax `press("cmd-a")` already uses: `"cmd"`, `"cmd-shift"`,
/// `"alt"`. `None` and `""` mean no modifier. Unknown names are ignored, so a
/// typo weakens the gesture instead of failing the whole automation call.
///
/// A string, not an object, because the same value has to cross the napi, the
/// wasm and the stdio boundary, and only wasm makes objects awkward.
pub fn parse_modifiers(modifiers: Option<&str>) -> Modifiers {
    let mut parsed = Modifiers::default();
    let Some(text) = modifiers else {
        return parsed;
    };
    for part in text.split('-') {
        match part.trim().to_ascii_lowercase().as_str() {
            "cmd" | "meta" | "super" | "win" | "platform" => parsed.platform = true,
            "ctrl" | "control" => parsed.control = true,
            "alt" | "option" => parsed.alt = true,
            "shift" => parsed.shift = true,
            "fn" | "function" => parsed.function = true,
            _ => {}
        }
    }
    parsed
}

pub fn dispatch_keystrokes(
    window: &mut Window,
    cx: &mut App,
    keystrokes: &str,
) -> Result<(), String> {
    for keystroke in keystrokes.split(' ') {
        window.dispatch_keystroke(parse_keystroke(keystroke)?, cx);
    }
    Ok(())
}

pub fn dispatch_key_down(
    window: &mut Window,
    cx: &mut App,
    keystroke: &str,
    is_held: bool,
) -> Result<(), String> {
    window.dispatch_event(
        KeyDownEvent {
            keystroke: parse_keystroke(keystroke)?,
            is_held,
            prefer_character_input: false,
        }
        .to_platform_input(),
        cx,
    );
    Ok(())
}

pub fn dispatch_key_up(window: &mut Window, cx: &mut App, keystroke: &str) -> Result<(), String> {
    window.dispatch_event(
        KeyUpEvent {
            keystroke: parse_keystroke(keystroke)?,
        }
        .to_platform_input(),
        cx,
    );
    Ok(())
}

fn parse_keystroke(keystroke: &str) -> Result<Keystroke, String> {
    Keystroke::parse(keystroke).map_err(|error| format!("Invalid keystroke '{keystroke}': {error}"))
}

/// Every automation mouse dispatcher takes modifiers, so a test can drive
/// cmd-wheel zoom, shift-click range selection, or alt-drag duplication.
pub fn dispatch_click(
    window: &mut Window,
    cx: &mut App,
    x: f64,
    y: f64,
    button: u32,
    modifiers: Modifiers,
) {
    let position = point(px(x as f32), px(y as f32));
    let button = mouse_button(button);
    window.dispatch_event(
        MouseDownEvent {
            button,
            position,
            modifiers,
            click_count: 1,
            first_mouse: false,
        }
        .to_platform_input(),
        cx,
    );
    window.dispatch_event(
        MouseUpEvent {
            button,
            position,
            modifiers,
            click_count: 1,
        }
        .to_platform_input(),
        cx,
    );
}

pub fn dispatch_mouse_down(
    window: &mut Window,
    cx: &mut App,
    x: f64,
    y: f64,
    button: u32,
    modifiers: Modifiers,
) {
    window.dispatch_event(
        MouseDownEvent {
            button: mouse_button(button),
            position: point(px(x as f32), px(y as f32)),
            modifiers,
            click_count: 1,
            first_mouse: false,
        }
        .to_platform_input(),
        cx,
    );
}

pub fn dispatch_mouse_up(
    window: &mut Window,
    cx: &mut App,
    x: f64,
    y: f64,
    button: u32,
    modifiers: Modifiers,
) {
    window.dispatch_event(
        MouseUpEvent {
            button: mouse_button(button),
            position: point(px(x as f32), px(y as f32)),
            modifiers,
            click_count: 1,
        }
        .to_platform_input(),
        cx,
    );
}

pub fn dispatch_mouse_move(
    window: &mut Window,
    cx: &mut App,
    x: f64,
    y: f64,
    pressed_button: Option<u32>,
    modifiers: Modifiers,
) {
    window.dispatch_event(
        MouseMoveEvent {
            position: point(px(x as f32), px(y as f32)),
            pressed_button: pressed_button.map(mouse_button),
            modifiers,
        }
        .to_platform_input(),
        cx,
    );
}

pub fn scroll_wheel_event(
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
    options: Option<ScrollWheelOptions>,
) -> Result<ScrollWheelEvent, String> {
    let options = options.unwrap_or_default();
    let delta = match options.delta_unit.as_deref().unwrap_or("pixels") {
        "pixels" => ScrollDelta::Pixels(point(px(delta_x as f32), px(delta_y as f32))),
        "lines" => ScrollDelta::Lines(point(delta_x as f32, delta_y as f32)),
        unit => return Err(format!("Unknown scroll-wheel delta unit: {unit}")),
    };
    let touch_phase = match options.phase.as_deref().unwrap_or("moved") {
        "started" => TouchPhase::Started,
        "moved" => TouchPhase::Moved,
        "ended" => TouchPhase::Ended,
        "cancelled" => TouchPhase::Cancelled,
        phase => return Err(format!("Unknown scroll-wheel phase: {phase}")),
    };
    let momentum_phase = options
        .momentum_phase
        .as_deref()
        .map(|phase| match phase {
            "started" => Ok(TouchPhase::Started),
            "moved" => Ok(TouchPhase::Moved),
            "ended" => Ok(TouchPhase::Ended),
            "cancelled" => Ok(TouchPhase::Cancelled),
            phase => Err(format!("Unknown scroll-wheel momentum phase: {phase}")),
        })
        .transpose()?;

    Ok(ScrollWheelEvent {
        position: point(px(x as f32), px(y as f32)),
        delta,
        modifiers: options.modifiers.map(Modifiers::from).unwrap_or_default(),
        touch_phase,
        momentum_phase,
    })
}

pub fn dispatch_scroll_wheel(
    window: &mut Window,
    cx: &mut App,
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
    options: Option<ScrollWheelOptions>,
) -> Result<(), String> {
    window.dispatch_event(
        scroll_wheel_event(x, y, delta_x, delta_y, options)?.to_platform_input(),
        cx,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_clock_holds_and_fast_forwards() {
        let clock = AutomationClock::new();
        clock.set_ms(0.0);
        assert!((clock.now_ms() - 0.0).abs() < 0.001);
        clock.fast_forward_ms(150.0);
        assert!((clock.now_ms() - 150.0).abs() < 0.001);
        let later = clock.now();
        clock.fast_forward_ms(150.0);
        assert_eq!(
            clock.now().saturating_duration_since(later),
            Duration::from_millis(150)
        );
    }

    #[test]
    fn scroll_wheel_event_preserves_platform_scroll_fields() {
        let event = scroll_wheel_event(
            12.5,
            34.25,
            -8.0,
            16.0,
            Some(ScrollWheelOptions {
                phase: Some("started".into()),
                momentum_phase: Some("moved".into()),
                delta_unit: Some("lines".into()),
                modifiers: Some(ScrollWheelModifiers {
                    shift: Some(true),
                    ctrl: Some(true),
                    alt: Some(true),
                    cmd: Some(true),
                    function: Some(true),
                }),
            }),
        )
        .unwrap();

        assert_eq!(f32::from(event.position.x), 12.5);
        assert_eq!(f32::from(event.position.y), 34.25);
        assert!(matches!(event.touch_phase, TouchPhase::Started));
        assert!(matches!(event.momentum_phase, Some(TouchPhase::Moved)));
        let ScrollDelta::Lines(delta) = event.delta else {
            panic!("automation scroll must preserve a line delta")
        };
        assert_eq!(f32::from(delta.x), -8.0);
        assert_eq!(f32::from(delta.y), 16.0);
        assert!(event.modifiers.shift);
        assert!(event.modifiers.control);
        assert!(event.modifiers.alt);
        assert!(event.modifiers.platform);
        assert!(event.modifiers.function);
    }
}
