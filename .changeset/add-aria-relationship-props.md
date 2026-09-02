---
"@gpuix/native": minor
"@gpuix/react": minor
---

Add `ariaLabelledBy` and `ariaDescribedBy`. Both take space-separated author
`id`s and resolve against the retained tree as it is built, so a name follows
the text it references as that text changes. Each reference contributes its own
`ariaLabel` when it has one and its flattened contents otherwise, joined in the
order written; unresolvable ids are skipped, and a list that resolves to nothing
falls back to `ariaLabel`. A reference wins over `ariaLabel` /
`ariaDescription`, as the accname order requires. Both DOM spellings
(`aria-labelledby`, `aria-describedby`) are accepted, and a referenced name is
enough to make a `<section>` a `region`.

Fixes #226
