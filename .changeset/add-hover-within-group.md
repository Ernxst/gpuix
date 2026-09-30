---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `hoverWithinGroup`, a name that binds `hoverWithin` to the nearest
ancestor whose `hoverGroup` equals it instead of the outermost marked
ancestor, matching Tailwind's `group-hover/name`. Unset, `hoverWithin` keeps
following the outermost marked ancestor. A `hoverWithinGroup` naming no
ancestor `hoverGroup` produces a style diagnostic.

Fixes #571
