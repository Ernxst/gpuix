---
"@gpuix/react": minor
---

Add `toHaveAttribute(name, value?)` to the desktop matcher pack, with DOM
`getAttribute` semantics: case-insensitive names, values as text, `<div
disabled>` reading `""` while `disabled={false}` declares nothing, and `aria-*`
and `data-*` booleans carrying the words `"true"` and `"false"`. A test states
what an element was given instead of reading the renderer's record of how it was
built.

Authored HTML attributes now survive to the test surface on the element types
the renderer builds as native divs, so `<a href>`, `<a target>` and
`<button type>` are assertable where they were dropped before. The role the
author wrote is retained beside the resolved role the accessibility projection
uses, so `role` answers as an attribute: an `<img>` with no declared role
reports none, as in a browser.

Fixes #331
