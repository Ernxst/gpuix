---
'@gpuix/native': patch
---

An element mounted with `autoFocus` is now scrolled into view by the next layout pass, so a read taken after the commit sees the revealed position. Fixes #407
