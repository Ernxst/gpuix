---
"@gpuix/react": minor
---

Add `@gpuix/react/testing/matchers`, a jest-dom-shaped pack for `expect.extend`:
`toBeInTheDocument`, `toBeVisible`, `toBeDisabled`, `toHaveFocus`,
`toHaveTextContent`, `toHaveValue`, `toHaveDisplayValue`, and
`toHaveAccessibleName`. Every matcher re-resolves its element against the
renderer first, so one captured before a rerender reports current state.

Four behaviours differ from jest-dom because the desktop differs.
`toBeVisible` means *painted in the last frame*: it conflates a virtual-list row
scrolled out of view with a genuinely hidden element, and calls an
`opacity: 0` element visible. `toBeDisabled` reports the element's own state,
since GPUIX has no disabling container to inherit from. `toHaveFocus` reads the
window's focus rather than the accessibility snapshot, so a focused plain
`<input>` is not invisible to it. `toHaveTextContent` takes jest-dom's matching
rules — a bare string is a substring — over the queries' exact matching, while
sharing their normalization.

Also exports `rendererOf` and `describeElement` from `@gpuix/react/testing`, and
`resolveNormalizer` for normalizing text exactly where the queries do.
