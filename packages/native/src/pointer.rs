use std::cell::RefCell;
use std::rc::Rc;

use gpui::{
    canvas, px, DispatchPhase, IntoElement, MouseButton, MouseDownEvent, MouseUpEvent, Pixels,
    Point, Styled,
};

#[derive(Default)]
pub(crate) struct PointerRouter {
    pressed_button: Option<MouseButton>,
    pressed_origin: Option<Point<Pixels>>,
    capture_owner: Option<u64>,
}

impl PointerRouter {
    fn begin(&mut self, button: MouseButton, origin: Point<Pixels>) {
        self.pressed_button = Some(button);
        self.pressed_origin = Some(origin);
        self.capture_owner = None;
    }

    pub(crate) fn pressed_origin(&self) -> Option<Point<Pixels>> {
        self.pressed_origin
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
        self.pressed_origin = None;
        self.capture_owner = None;
        true
    }

    pub(crate) fn cancel(&mut self) -> bool {
        let had_sequence = self.pressed_button.take().is_some();
        self.pressed_origin = None;
        let had_capture = self.capture_owner.take().is_some();
        had_sequence || had_capture
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
pub(crate) fn pointer_router_frame(router: SharedPointerRouter) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |_, _, window, _| {
            let down_router = router.clone();
            window.on_mouse_event(move |event: &MouseDownEvent, phase, window, _cx| {
                if phase != DispatchPhase::Capture {
                    return;
                }
                window.release_pointer();
                down_router.borrow_mut().begin(event.button, event.position);
            });

            let up_router = router.clone();
            window.on_mouse_event(move |event: &MouseUpEvent, phase, _window, _cx| {
                if phase == DispatchPhase::Capture {
                    up_router.borrow_mut().finish(event.button);
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

        router.begin(MouseButton::Left, gpui::point(px(0.), px(0.)));
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
        router.begin(MouseButton::Left, gpui::point(px(0.), px(0.)));
        router.capture(7);

        assert!(!router.release(8));
        assert_eq!(router.owner(), Some(7));
        assert!(router.release(7));
        assert_eq!(router.owner(), None);
    }

    #[test]
    fn cancellation_without_mouse_up_ends_the_pressed_sequence() {
        let mut router = PointerRouter::default();
        router.begin(MouseButton::Left, gpui::point(px(0.), px(0.)));
        router.capture(7);

        assert!(router.cancel());
        assert_eq!(router.owner(), None);
        assert!(!router.capture(8));
        assert!(!router.cancel());
    }
}
