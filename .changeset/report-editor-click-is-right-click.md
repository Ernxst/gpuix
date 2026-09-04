---
'@gpuix/native': patch
---

Report `isRightClick` on `<input>` and `<textarea>` click payloads. The editor click path left the
field undefined, so a consumer reading it off the payload could not tell a primary click from a
non-primary one there. `button` and `clickCount` stay unset on this path.
