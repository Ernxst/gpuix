---
"@gpuix/native": patch
"@gpuix/react": patch
---

Drive embedded macOS frames from the native display link with one outstanding JavaScript callback,
then perform exactly one AppKit pump. Retain the timer as the capability and idle-wake fallback so
occluded windows, input, menus, termination, and hot remounts continue to progress without the
idle pump releasing a pending frame token.

The upstream search found GPUI's existing private `PlatformWindow::on_request_frame` path and the
related [ProMotion pacing work](https://github.com/zed-industries/zed/pull/7305), but no public
embedded-host bridge; the pinned fork now exposes only the frame-token handoff GPUIX needs.

Fixes #69
