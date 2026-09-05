---
"@gpuix/react": minor
---

Add `toHaveAccessibleDescription(matcher?)` to the desktop matcher pack, with
jest-dom semantics: with no argument it asserts the element has a non-empty
accessible description, and with a matcher it compares the computed description
through the same rules `toHaveAccessibleName` uses. A card that carries a signal
and a response beside its title is asserted as what it is rather than through a
text query:

```ts
expect(screen.getByRole('button', { name: 'Coal line' })).toHaveAccessibleDescription(
  'Throughput fell 12% Rebalance the belt'
)
```

The description is the accname computation GPUI already ran, read from the
element's AccessKit node through the same host identity `toHaveAccessibleName`
uses: an `ariaDescribedBy` reference resolves to the flattened text of the
elements it names — several ids joined with spaces, in the order they are
written — and wins over an `ariaDescription` written beside it. The node
requirement is the accessible name's, exactly: a description declared on an
element that projects no accessibility node has nowhere to land, and the matcher
reports the empty computation rather than falling back to the raw prop.

Fixes #344
