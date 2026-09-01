---
"@gpuix/native": minor
"@gpuix/react": minor
---

Expose `focus()` and `blur()` on host element refs so shared React components can use the standard HTMLElement-shaped imperative focus API. `focus()` accepts `FocusOptions` and honors `preventScroll`, so react-dom code that focuses without revealing behaves the same here. `blur()` only drops focus it can confirm the element owns.

Fixes #218
