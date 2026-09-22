use std::cell::RefCell;
use std::rc::Rc;

use gpui::{
    canvas, px, DispatchPhase, IntoElement, MouseButton, MouseDownEvent, MouseUpEvent, Styled,
};
use crate::element_tree::EventModifiers;
use crate::renderer::{
    emit_event_full, populate_mouse_up_payload, populate_pointer_metadata, EventCallback,
};

#[derive(Clone)]
pub(crate) struct CancelledPointer {
    pub(crate) target: u64,
    pub(crate) x: Option<f64>,
    pub(crate) y: Option<f64>,
    pub(crate) modifiers: Option<EventModifiers>,
}

#[derive(Default)]
pub(crate) struct PointerRouter {
    pressed_button: Option<MouseButton>,
    capture_owner: Option<u64>,
    pressed_target: Option<u64>,
    last_position: Option<(f64, f64)>,
    last_modifiers: Option<EventModifiers>,
}

impl PointerRouter {
    fn begin(&mut self, button: MouseButton) {
        self.pressed_button = Some(button);
        self.capture_owner = None;
        self.pressed_target = None;
        self.last_position = None;
        self.last_modifiers = None;
    }

    pub(crate) fn capture(&mut self, owner: u64) -> bool {
        if self.pressed_button.is_none() {
            return false;
        }
        self.capture_owner = Some(owner);
        true
    }

    pub(crate) fn release(&mut self, owner: u64) -> bool {
        if self.capture_owner != Some(owner) {
            return false;
        }
        self.capture_owner = None;
        true
    }

    fn finish(&mut self, button: MouseButton) -> bool {
        if self.pressed_button != Some(button) {
            return false;
        }
        self.pressed_button = None;
        self.capture_owner = None;
        self.pressed_target = None;
        self.last_position = None;
        self.last_modifiers = None;
        true
    }

    pub(crate) fn is_pressed(&self) -> bool {
        self.pressed_button.is_some()
    }

    pub(crate) fn record_target(&mut self, target: u64) {
        if self.pressed_button.is_some() {
            self.pressed_target = Some(target);
        }
    }

    pub(crate) fn record_sample(&mut self, x: f64, y: f64, modifiers: EventModifiers) {
        if self.pressed_button.is_some() {
            self.last_position = Some((x, y));
            self.last_modifiers = Some(modifiers);
        }
    }

    pub(crate) fn cancel(&mut self) -> Option<CancelledPointer> {
        let cancelled = self.capture_owner.or(self.pressed_target).map(|target| CancelledPointer {
            target,
            x: self.last_position.map(|position| position.0),
            y: self.last_position.map(|position| position.1),
            modifiers: self.last_modifiers.clone(),
        });
        self.pressed_button = None;
        self.capture_owner = None;
        self.pressed_target = None;
        self.last_position = None;
        self.last_modifiers = None;
        cancelled
    }

    #[cfg(test)]
    fn owner(&self) -> Option<u64> {
        self.capture_owner
    }
}

pub(crate) type SharedPointerRouter = Rc<RefCell<PointerRouter>>;

/// Installs one frame's pressed-sequence bookkeeping before element listeners.
/// The actual captured hitbox remains GPUI's responsibility; this state keeps
/// the retained element owner and sequence lifetime coherent across redraws.
///
/// Every mouse up in the window also emits `windowPointerUp` with element id 0,
/// wherever it lands and whether or not an element listens, so React can run
/// the `pointerup` listeners on its `document` facade. It is emitted in the
/// capture phase, ahead of the element's own `pointerUp` and `click`.
pub(crate) fn pointer_router_frame(
    router: SharedPointerRouter,
    event_callback: Option<EventCallback>,
) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |_, _, window, _| {
            let down_router = router.clone();
            window.on_mouse_event(move |event: &MouseDownEvent, phase, window, _cx| {
                if phase != DispatchPhase::Capture {
                    return;
                }
                window.release_pointer();
                down_router.borrow_mut().begin(event.button);
            });

            let up_router = router.clone();
            window.on_mouse_event(move |event: &MouseUpEvent, phase, _window, _cx| {
                if phase == DispatchPhase::Capture {
                    up_router.borrow_mut().finish(event.button);
                    emit_event_full(&event_callback, 0, "windowPointerUp", |payload| {
                        populate_mouse_up_payload(payload, event);
                        populate_pointer_metadata(payload, 0);
                    });
                }
            });
        },
    )
    .absolute()
    .w(px(0.0))
    .h(px(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_requires_a_pressed_sequence_and_ends_with_that_button() {
        let mut router = PointerRouter::default();
        assert!(!router.capture(7));

        router.begin(MouseButton::Left);
        assert!(router.capture(7));
        assert_eq!(router.owner(), Some(7));
        assert!(!router.finish(MouseButton::Right));
        assert_eq!(router.owner(), Some(7));
        assert!(router.finish(MouseButton::Left));
        assert_eq!(router.owner(), None);
    }

    #[test]
    fn explicit_release_only_releases_the_current_owner() {
        let mut router = PointerRouter::default();
        router.begin(MouseButton::Left);
        router.capture(7);

        assert!(!router.release(8));
        assert_eq!(router.owner(), Some(7));
        assert!(router.release(7));
        assert_eq!(router.owner(), None);
    }

    #[test]
    fn cancellation_without_mouse_up_ends_the_pressed_sequence() {
        let mut router = PointerRouter::default();
        router.begin(MouseButton::Left);
        router.capture(7);

        assert!(router.cancel().is_some());
        assert_eq!(router.owner(), None);
        assert!(!router.capture(8));
        assert!(router.cancel().is_none());
    }
}
