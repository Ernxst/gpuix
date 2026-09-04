---
"@gpuix/react": patch
---

Add `toHaveAttribute(name, value?)` to the desktop matcher pack, with jest-dom's
name-only, name-and-value, and negated forms. Attributes are asked for by their
DOM name — `id`, `data-*`, `aria-*`, and host props such as `<img src>` — so a
test states what an element was given instead of reading the renderer's record
of how it was built.

Fixes #331
