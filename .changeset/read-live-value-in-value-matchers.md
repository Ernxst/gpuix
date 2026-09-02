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
Any element that does not edit text still falls back to the retained prop, which
for such an element is the value. Each assertion now costs one native read and a
forced draw — a fair price in test code, and the reason the queries keep reading
the declaration: `getByDisplayValue` and `TestElement.semantics.value` still
match the prop the author set.
