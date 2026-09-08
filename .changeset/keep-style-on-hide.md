---
"@gpuix/react": patch
---

Keep an element's style when React hides it.

`hideInstance` used to send `{ visibility: "hidden" }` and drop every other
declaration. Suspense retries and hidden Activity trees then lost their layout
box. The hide now keeps the existing style and only adds `visibility: "hidden"`.
Hover and active still drop, so a hover style cannot paint an element React
asked to hide. `unhideInstance` restores the style React passed in.
