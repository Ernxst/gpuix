---
'@gpuix/react': major
---

Expose UI Events key names and `repeat` on synthetic keyboard events, so shared
DOM-style handlers observe values such as `Enter`, `ArrowDown`, and `Escape`.

BREAKING: `event.key` now carries the DOM key value instead of the GPUI key
name. Named keys change spelling (`enter` → `Enter`, `down` → `ArrowDown`,
`escape` → `Escape`, `space` → `" "`, `platform` → `Meta`), and printable keys
report the character the layout produced (`Shift+A` → `"A"`, `Shift+1` → `"!"`).

Migration: compare against the DOM name, as a browser handler already does. The
untranslated GPUI key remains available on `event.nativeEvent.key`.

Fixes #217
