---
"@gpuix/react": minor
---

A controlled `<input>` or `<textarea>` now rejects an edit its handler declined,
as a browser does. After every change dispatch the reconciler compares the value
the editor emitted with the element's current `value` prop and, when they
differ, writes the prop back — React DOM's `restoreControlledState`, ported.

Until now the editor kept text the application had refused. React cannot correct
it on its own: an `onChange` that stores nothing (or that filters what it
stores, and so lands on the state it already had) triggers no re-render, and an
unchanged prop is diffed away before it reaches the renderer, so nothing ever
told the editor to rewind.

```tsx
// Read-only in a browser, and now here too.
<input value="locked" onChange={() => {}} />

// Keeps the letters, rewinds the digits.
<input value={value} onChange={(event) => setValue((event.value ?? '').replace(/[0-9]/g, ''))} />
```

An editor with no `value` prop is uncontrolled and untouched — the same test
React uses — so typed text and imperative `ref.value` writes still stand. The
check costs nothing when the edit was accepted: the emitted value and the prop
agree, and no native call is made.
