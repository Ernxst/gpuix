---
'@gpuix/native': minor
'@gpuix/react': minor
---

`background` accepts `repeating-linear-gradient(135deg, <color> 0 <w>px, transparent <w>px <p>px)`, the two-stop pixel hatch, painted with GPUI's native slash pattern; every other repeating gradient is still rejected with a strict-style diagnostic naming the accepted shape.

Refs #361
