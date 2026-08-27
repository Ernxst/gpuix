---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add first-class style transitions for opacity, solid colours, compatible size
dimensions, insets, and corner radii. React-driven changes and native hover,
active, focus, and focus-visible refinements interpolate in the retained tree
on GPUI's display-link frame clock, retarget from the current visible value,
and honor the renderer's reduced-motion policy without JavaScript timers.

Malformed transition declarations report precise strict-style diagnostics, and
the offscreen renderer can advance paused transitions through its deterministic
clock API.

Fixes #15
