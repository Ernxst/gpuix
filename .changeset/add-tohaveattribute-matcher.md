---
"@gpuix/react": minor
---

Add `toHaveAttribute(name, value?)` to the desktop matcher pack, with DOM
`getAttribute` semantics: case-insensitive names, values as text, `<div
disabled>` reading `""` while `disabled={false}` declares nothing, and `aria-*`
and `data-*` booleans carrying the words `"true"` and `"false"`. A test states
what an element was given instead of reading the renderer's record of how it was
built. `class` and `autofocus` throw a directed error rather than answering:
this tree has no class attribute, and `autoFocus` is lifted onto the element as
a flag rather than retained as a prop, so neither could be answered honestly.

Authored HTML attributes now survive to the test surface on the element types
the renderer builds as native divs, so `<a href>`, `<a target>` and
`<button type>` are assertable where they were dropped before. Deliberately not
`value` or `placeholder`: the native side reads both custom-prop keys with no
element-type gate, so retaining them there would give a `<div value="7">` the
queryable value semantics the DOM gives inputs alone. `<input>` and `<textarea>`
forward every prop regardless, so their attributes answer as before.

The role the author wrote is retained beside the resolved role the accessibility
projection uses, so `role` answers as an attribute: an `<img>` with no declared
role reports none, as in a browser.

Fixes #331
