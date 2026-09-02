---
"@gpuix/react": minor
---

Add `@gpuix/react/testing/matchers`, a jest-dom-shaped pack for `expect.extend`:
`toBeInTheDocument`, `toBeVisible`, `toBeDisabled`, `toHaveFocus`,
`toHaveTextContent`, `toHaveValue`, `toHaveDisplayValue`, and
`toHaveAccessibleName`. Every matcher re-resolves its element against the
renderer first, so one captured before a rerender reports current state, and an
element that has since been removed fails the assertion rather than throwing —
`expect(removed).not.toBeVisible()` works after an unmount, as it does in
jest-dom.

Five behaviours differ from jest-dom because the desktop differs.
`toBeVisible` means *painted in the last frame*: it conflates a virtual-list row
scrolled out of view with a genuinely hidden element, and calls an
`opacity: 0` element visible. `toBeDisabled` counts `ariaDisabled`, which
jest-dom ignores, and inherits nothing, since GPUIX has no disabling container.
`toHaveFocus` reads the window's focus rather than the accessibility snapshot,
so a focused plain `<input>` is not invisible to it. `toHaveTextContent` takes
jest-dom's matching rules — a bare string is a substring — over the queries'
exact matching, while sharing their normalization, and rejects `''` because that
assertion could never fail. `toHaveValue` takes a string only: there is no
numeric input or multi-select to coerce for.

Also exports `rendererOf` and `describeElement` from `@gpuix/react/testing`, and
`resolveNormalizer` for normalizing text exactly where the queries do.
