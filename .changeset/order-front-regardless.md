---
'@gpuix/native': patch
---

Raise the window above other windows after every activation request (opening
a window with `focus` and `show` both default, and `activateWindow()`), even
when the OS refuses to activate the app itself. On macOS this calls
`orderFrontRegardless`; on Windows it briefly makes the HWND topmost, which
Windows' foreground-activation lock does not gate the way it gates
`SetForegroundWindow`; on Linux/FreeBSD the compositor decides and GPUI
already makes the platform's normal request. Previously a window opened while
a sibling process raced for activation could land behind the active app with
no way to bring it forward from JS.

Refs #322
