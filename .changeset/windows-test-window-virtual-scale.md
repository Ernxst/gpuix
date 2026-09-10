---
'@gpuix/native': patch
---

On Windows, a visual-test window opened with a `scaleFactor` no longer throws at
construction: the window pins its scale to the requested value everywhere GPUI
reads it, instead of following the monitor's DPI, and ignores DPI-change
messages. The default offscreen test window is now 1280x800 logical at scale
factor 2 on every platform, and keeps that physical size even when it exceeds
the host display rather than being capped by Windows' default window maximum.

Refs #442
