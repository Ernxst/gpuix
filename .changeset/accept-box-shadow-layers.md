---
'@gpuix/native': minor
'@gpuix/react': minor
---

`boxShadow` accepts an array of layers, matching CSS `box-shadow`'s
comma-separated list, and each layer accepts `inset`. Layers paint in CSS
order (the first layer on top); `inset` layers paint inside the padding box
(the border box inset by the border widths) and are clipped to it, so a
border hides the part of the shadow that would otherwise fall underneath it.
An empty array (`[]`) is a present value meaning no shadow, so it clears an
inherited shadow when authored on a state override such as `hover`. As
before, an invalid layer rejects the whole `boxShadow` declaration; array
diagnostics are indexed (`boxShadow[1].color`).

Fixes #380
