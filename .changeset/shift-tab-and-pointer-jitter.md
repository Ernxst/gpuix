---
'@gpuix/native': patch
---

Shift+Tab now moves focus out of an `<input>` or `<textarea>`. The editor tracks its focus handle on a wrapper and on the text element inside it, and GPUI's tab order counted that as two stops, so moving backwards landed on the same field.

A hand resting on a trackpad, or a bumped mouse, no longer hides focus-visible styles mid keyboard navigation: an idle mouse move within 8px of where keyboard input began now keeps keyboard modality.
