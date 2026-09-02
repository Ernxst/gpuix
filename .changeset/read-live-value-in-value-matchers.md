---
"@gpuix/react": minor
---

`toHaveValue` and `toHaveDisplayValue` now read the **live editor value** of an
`<input>` or `<textarea>`, the way `HTMLInputElement.value` does, instead of the
retained `value` prop. The canonical Testing Library idiom works on an
uncontrolled input:

```ts
await screen.userEvent.type(field, 'hi')
expect(field).toHaveValue('hi')
```

Text the user typed and an imperative `ref.value = 'x'` write both live in the
native editor and never touch the prop, so both matchers used to fail on them.

Only `<input>` and `<textarea>` take the native path, which crosses to Rust and
forces a draw; every other element answers from the retained tree, and so does
an `<input>` whose editor was never materialised — an off-screen
`<virtual-list>` row is in the tree with its declared value but has built no
editor to hold one, and the prop is the only value there is. The queries do not
change: `getByDisplayValue` and `TestElement.semantics.value` still match the
prop the author set.
