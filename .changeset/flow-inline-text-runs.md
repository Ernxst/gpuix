---
'@gpuix/native': minor
'@gpuix/react': minor
---

Render nested `<text>` elements as styled byte ranges inside one flowing GPUI text layout. Inline runs support colour, font family and weight, letter spacing, background colour, text decoration, inherited text transforms, selection, wrapping, truncation, automation bounds, and nested click targets.

Block and custom descendants are rejected, and styles that cannot vary inside a text layout produce strict-style diagnostics instead of being silently ignored.

Fixes #13
