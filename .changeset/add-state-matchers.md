---
"@gpuix/react": minor
---

Add `toBeEnabled`, `toBeChecked`, and `toBePartiallyChecked` to
`@gpuix/react/testing/matchers`.

`toBeEnabled()` is the exact inverse of `toBeDisabled()`, over the same
predicate, so `expect(el).toBeEnabled()` replaces `expect(el).not.toBeDisabled()`
without inventing an ancestor rule the desktop does not have.

`toBeChecked()` and `toBePartiallyChecked()` read the checked state GPUI
computed, off the same accessibility node `getByRole` searches, so a checked
assertion and a role query can never disagree. The checkable elements are
jest-dom's — `checkbox`, `menuitemcheckbox`, `menuitemradio`, `option`, `radio`,
`switch`, and `treeitem` for `toBeChecked`, and `checkbox` alone for
`toBePartiallyChecked`, since a switch is binary and WAI-ARIA computes its
`ariaChecked="mixed"` as `false`. There is no `<input type="checkbox">` here, so
the role is the whole rule. An element with no checked state to read is answered
with jest-dom's own sentence and fails, so the negated form of a question that
was never about a checked state passes, exactly as it does in jest-dom.
