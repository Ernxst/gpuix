---
'@gpuix/native': minor
'@gpuix/react': minor
---

BREAKING: `ariaValue` is renamed `ariaValueText` to match its DOM alias `aria-valuetext`, with no compatibility path (#355). `role="meter"` and `role="progressbar"` now accept `ariaValueText`, `ariaValueMin`, `ariaValueMax` and `ariaValueNow` and project them into the accessibility tree; they stay read-only, so Increment and Decrement remain slider and spinbutton actions (#368).
