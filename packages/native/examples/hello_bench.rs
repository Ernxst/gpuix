//! Native-GPUI baseline for `scripts/app-bench.ts`.
//!
//! Same shape as `examples/bench/hello-gpuix.tsx` — one window, one line of
//! text, 400x300 — built with our GPUI checkout directly, no JS, no napi
//! bridge. Prints the same `GPUIX_BENCH` marker line, from the same point
//! (the frame after the window's second presented frame), so
//! `scripts/app-bench.ts` parses both fixtures identically.
//!
//! Run with: cargo run -p gpuix-native --release --example hello_bench

use gpui::{div, prelude::*, px, size, App, Bounds, Context, Window, WindowBounds, WindowOptions};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

struct HelloBench;

impl Render for HelloBench {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("root")
            .flex()
            .items_center()
            .justify_center()
            .size_full()
            .bg(gpui::rgb(0x1e1e2e))
            .child(
                div()
                    .text_color(gpui::rgb(0xcdd6f4))
                    .text_size(px(20.))
                    .child("Hello, GPUIX"),
            )
    }
}

fn main() {
    let process_start = Instant::now();

    gpui_platform::application().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(400.), px(300.)), cx);
        let before_open = Instant::now();

        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                |_window, cx| cx.new(|_| HelloBench),
            )
            .unwrap();

        let after_open = Instant::now();

        // Plain GPUI has no JS "import" phase to report; the harness treats
        // a `null` import phase as "not applicable" rather than zero cost.
        window
            .update(cx, |_, window, _cx| {
                window.on_next_frame(move |window, _cx| {
                    window.on_next_frame(move |_window, _cx| {
                        let ready_at = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_secs_f64()
                            * 1000.0;
                        let since_start = process_start.elapsed().as_secs_f64() * 1000.0;
                        let render_ms = (after_open - before_open).as_secs_f64() * 1000.0;
                        let to_frame_ms = before_open.elapsed().as_secs_f64() * 1000.0 - render_ms;
                        println!(
                            "GPUIX_BENCH {{\"event\":\"ready\",\"readyAtEpochMs\":{ready_at},\"sinceStartMs\":{since_start},\"phases\":{{\"import\":null,\"render\":{render_ms},\"toFrame\":{to_frame_ms}}}}}"
                        );
                    });
                });
            })
            .unwrap();

        cx.activate(true);
    });
}
