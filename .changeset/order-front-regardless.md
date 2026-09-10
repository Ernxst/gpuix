---
'@gpuix/native': patch
---

Order the window to the front on macOS after every activation request
(`focus: true`/default window open, and `activateWindow()`), even when macOS
14+ cooperative activation refuses to activate the app. Previously a window
opened while a sibling process raced for activation could land behind the
active app with no way to bring it forward from JS.

Fixes #322
