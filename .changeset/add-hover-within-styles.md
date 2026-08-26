---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add native hover-driven descendant styling.

Put `hoverGroup` on a container and add a `hoverWithin` nested style to any descendant that should react when that container is hovered. GPUI resolves the nearest group and repaints the descendant without React state or a JavaScript round trip.

Pointer capture does not pin hover to its owner: `hoverWithin` follows whether the pointer remains inside the group's hit-test bounds.

Fixes #9
