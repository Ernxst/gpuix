---
'@gpuix/native': patch
'@gpuix/react': patch
---

An intrinsic-size probe (`width: "max-content"` and friends) now measures a
transitioning descendant at its current declared style — the current value
for every untransitioned property, the currently interpolated value for
every transitioned one — instead of the whole style the descendant's last
completed transition frame painted. A `max-content` ancestor whose descendant
changes an untransitioned property, such as `width`, while some other
property on it transitions no longer sizes itself to the descendant's stale
pre-change layout.

Fixes #461
