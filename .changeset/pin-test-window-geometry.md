---
"@gpuix/native": patch
---

Open the offscreen test window at a fixed geometry instead of the host
display's. The window already asked for 1280x800, but AppKit clamped it to
whatever the machine's visible frame allowed — 744 logical pixels tall on a
laptop screen — and, with no scale factor requested, the window reported the
attached display's. The same test could therefore measure 1280x800 at 1x in one
run and 1280x744 at 2x in the next on one machine. Visual test windows now keep
the frame they ask for, and an omitted `scaleFactor` means 2 rather than "ask
the display". Windows still follows the monitor's DPI, where GPUI has no virtual
display scale.

Fixes #330
