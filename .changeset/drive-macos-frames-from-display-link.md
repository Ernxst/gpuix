---
"@gpuix/native": patch
"@gpuix/react": patch
---

Drive embedded macOS frames from the native display link with one outstanding JavaScript callback,
then perform exactly one AppKit pump. Retain the timer as the capability and idle-wake fallback so
occluded windows, input, menus, termination, and hot remounts continue to progress without the
idle pump releasing a pending frame token.

GPUI now owns the per-window coalescing lease: consuming or dropping a single-use token admits the
next request, while stop, occlusion, and display migration invalidate escaped tokens. Display-link
observers are snapshotted under the registry lock and invoked outside it. The live pacing smoke uses
GPUI presentation timestamps and observed callbacks. A short forced-timer warmup calibrates one shared
JavaScript workload to roughly 12ms while retaining margin below the local refresh deadline. The smoke
requires the display-link path to hold at least 90% of refresh, both paths to keep presenting, and each
path's pump p95 to stay below one refresh period. It first proves the window is receiving CoreVideo
callbacks, briefly reactivates an occluded window, and skips with an explicit diagnostic when the
platform cannot provide a measurable window.

The embedded AppKit pump never sleeps: it drains up to 256 already-queued events with
`nextEventMatchingMask` against `distantPast`, updates windows, then services ready Core Foundation
sources with a single zero-timeout `CFRunLoopRunInMode`. That bounds the pump whether or not its
pre-posted wake event arrives with a sleep/wake transition. A real native-to-JavaScript race
regression queues a frame callback after the idle precheck and verifies both bounded pump return and
eventual TSFN service. The outstanding-callback check remains a latency optimization, not the pump's
correctness boundary. This bounded pump benefits the timer path too; the display-link clock's
remaining advantage is refresh alignment without polling to choose presentation times. A separate
idle-wake pump remains responsible for input and application lifecycle progress between frames.

The upstream search found GPUI's existing private `PlatformWindow::on_request_frame` path and the
related [ProMotion pacing work](https://github.com/zed-industries/zed/pull/7305), but no public
embedded-host bridge; the pinned fork now exposes only the frame-token handoff GPUIX needs.

Fixes #69
