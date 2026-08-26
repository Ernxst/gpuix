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
GPUI presentation timestamps and observed callbacks, and requires the same 12 ms paced workload to
hold display refresh while its forced-timer control reproduces the missed-refresh cadence. It first
proves the window is receiving CoreVideo callbacks, briefly reactivates an occluded window, and skips
with an explicit diagnostic when the platform cannot provide a measurable window.

The upstream search found GPUI's existing private `PlatformWindow::on_request_frame` path and the
related [ProMotion pacing work](https://github.com/zed-industries/zed/pull/7305), but no public
embedded-host bridge; the pinned fork now exposes only the frame-token handoff GPUIX needs.

Fixes #69
