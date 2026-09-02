---
"@gpuix/react": major
---

BREAKING: align retained-tree and automation text/test-ID/role queries with Testing Library matcher semantics.

String matchers are now exact after trimming and collapsing whitespace. Pass
`{ exact: false }` for case-insensitive substring matching. Queries also accept
regular expressions, predicate matchers, `{ trim }`, `{ collapseWhitespace }`,
and custom normalizers composed from the newly exported `getDefaultNormalizer`,
whose `NormalizerOptions` and `NormalizerFn` types are exported alongside it.
`getByRole`'s `name` option goes through the same matcher, so the accessible
name is normalized before comparison. Automation `getByText` now matches a
node's own text instead of its prior substring rule, and `renderer.findByText`
matches on the shared semantics instead of a raw substring.

BREAKING: an element has exactly one test ID. `data-testid` wins; the legacy
`testId` prop answers only for elements that carry no `data-testid`. The
in-process queries previously matched the union of both props while the
automation locators preferred whichever prop matched anywhere in the tree, so
one mixed tree returned different counts through the two paths.

Fixes #212
