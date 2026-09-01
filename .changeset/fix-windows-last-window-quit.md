---
'@gpuix/native': patch
'@gpuix/react': patch
---

Quit the process when the last window closes on Windows and Linux, matching macOS.

Closing the window already stopped the GPUI UI thread. The Node/bun process stayed alive because JavaScript never saw that, so `process.exit` never ran.

`tick()` now returns `false` after that thread ends. `render()` already exits on that signal.

Fixes #32
