---
"@gpuix/react": major
---

BREAKING: align retained-tree and automation text/test-ID/role queries with Testing Library matcher semantics.

String matchers are now exact after trimming and collapsing whitespace. Pass
`{ exact: false }` for case-insensitive substring matching. Queries also accept
regular expressions, predicate matchers, `{ trim }`, `{ collapseWhitespace }`,
and custom normalizers composed from the newly exported `getDefaultNormalizer`,
whose `DefaultNormalizerOptions` and `NormalizerFn` types are exported
alongside it.
`getByRole`'s `name` option goes through the same matcher, so the accessible
name is normalized before comparison. Automation `getByText` now matches a
node's own text instead of its prior substring rule, and `renderer.findByText`
matches on the shared semantics instead of a raw substring.

BREAKING: an element has exactly one test ID, read from `data-testid`. (The
legacy `testId` prop briefly survived as a fallback here and was then removed
outright in the same release — see the remove-testing-aliases changeset.) The
in-process queries previously matched the union of both props while the
automation locators preferred whichever prop matched anywhere in the tree, so
one mixed tree returned different counts through the two paths.

Fixes #212
