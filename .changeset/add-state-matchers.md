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
assertion and a role query can never disagree. There is no
`<input type="checkbox">` here, so the checkable elements are the ones carrying
a role that computes a checked state: `checkbox` and `switch` for `toBeChecked`,
and `checkbox` alone for `toBePartiallyChecked`, since a switch is binary and
WAI-ARIA computes its `ariaChecked="mixed"` as `false`. Anything else throws
jest-dom's sentence rather than failing, so `.not.toBeChecked()` cannot quietly
pass on an element that could never have been checked — and
`ariaChecked="mixed"` throws from `toBeChecked` exactly as it does in jest-dom,
because mixed is not a checked state.
