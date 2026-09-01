---
"@gpuix/react": major
---

BREAKING: align retained-tree and automation text/test-ID queries with Testing Library matcher semantics.

String matchers are now exact after trimming and collapsing whitespace. Pass
`{ exact: false }` for case-insensitive substring matching. Queries also accept
regular expressions, predicate matchers, and custom normalizers. Automation
`getByText` now matches a node's own text instead of its prior substring rule.

Fixes #212
