---
'@gpuix/native': patch
---

Fix blurry text on Windows when display scaling is above 100%.

GPUI only declares **Per-Monitor V2** DPI awareness in the host executable manifest ([zed#8936](https://github.com/zed-industries/zed/pull/8936)). GPUIX is a napi `.node` loaded into `node.exe` / `bun.exe`, so that manifest never applies and Windows bitmap-stretches the window.

The `gpuix-ui` thread calls `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` before GPUI creates any HWND. If the process is already V2 (a compiled binary with its own manifest), the call is skipped. If process awareness is already locked, that thread still requests V2 so the window is not bitmap-stretched. The Node/bun thread is left unchanged.

Fixes #31
