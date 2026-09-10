---
'@gpuix/native': minor
'@gpuix/react': minor
---

Accept `repeat(auto-fill, …)` and `repeat(auto-fit, …)` grid tracks:
`gridTemplateColumns` / `gridTemplateRows`'s `repeat` count now takes
`"auto-fill"` or `"auto-fit"` in addition to a fixed number, repeating tracks
as many times as the container permits, with `auto-fit` collapsing empty
repetitions and `auto-fill` keeping them. A template may contain at most one
auto repetition, and every track in it must include a fixed length or
percentage; otherwise the declaration is rejected, matching how CSS itself
collapses an invalid `<auto-track-list>` to zero explicit tracks.

Fixes #252
