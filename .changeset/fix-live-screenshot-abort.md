---
"@gpuix/native": patch
---

`app.screenshot()` on a live window no longer aborts the app process. The
macOS capture path drew the frame while holding a typed lease on the root
view; drawing renders that same view, so GPUI panicked ("cannot update …
while it is already being updated") and the panic aborted across the napi
boundary — the automation client then hung forever waiting on a reply. The
capture now draws under an untyped window lease, matching every other
live-window read path.

Fixes #291
