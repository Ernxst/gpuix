---
"@gpuix/react": patch
---

`toBeInTheDocument` takes the `null` a `queryBy…` returns when negated, so
`expect(screen.queryByText('gone')).not.toBeInTheDocument()` passes instead of
throwing from the receiver guard. The positive form still rejects `null`, and
every other matcher still rejects it in both forms, exactly as jest-dom does.

Fixes #327
