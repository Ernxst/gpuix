---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `TestRenderer.getResolvedStyle(elementId)` for reading the declared style after the offscreen renderer applies its current hover, hoverWithin, active, focus, and focusVisible refinements.

`TestElement.style` remains the unchanged declared descriptor, so tests can now distinguish declaration assertions from interaction-state assertions without screenshots.

Fixes #52
