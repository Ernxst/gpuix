---
"@gpuix/react": minor
---

Add `toBeEmptyDOMElement` to the desktop matcher pack. It passes for an element
with no retained children and no text of its own, so a suite states "this
renders nothing" by name instead of spelling it as `toHaveTextContent(/^$/)` —
and catches the case that regular expression misses, an element holding a child
that has no text. `<code>`, `<diff>`, and `<markdown>` render from the `code`,
`patch`, and `source` props rather than from children, so a declared one counts
as content.

Fixes #335
