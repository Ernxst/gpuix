---
'@gpuix/native': minor
'@gpuix/react': minor
---

Let component libraries wrap Select without rewriting children, and export the types and measurement APIs they need.

**Select follows Base UI’s split between Root label data and mounted Item interaction data.** `items` on Root is optional. It is a label lookup for `SelectValue` while the menu is closed. Keyboard nav and clicks read the mounted `SelectItem` children, so a styled wrapper around `Item` works. Without `items`, `SelectValue` shows the raw value. `disabled` lives on `SelectItem`.

```tsx
const models = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus', disabled: true },
]

<Select items={models} value={model} onValueChange={setModel}>
  <SelectTrigger>
    <SelectValue placeholder="Select a model" />
  </SelectTrigger>
  <SelectContent>
    {models.map((item) => (
      <SelectItem key={item.value} value={item.value}>
        {item.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Public types.** `@gpuix/react` now exports `Props`, `GpuixTheme`, `GpuixMetrics`, `InputProps`, `AnchoredProps`, and the other host prop types.

**Floating helpers.** Import `FloatingLayer` and `renderSlot` from `@gpuix/react/floating`.

**Bounds.** `getElementBounds(id)` is on the live renderer, not only tests. It returns `{ x, y, width, height }`, or `null`.

`visibility: "hidden"` now maps to GPUI `invisible()`, so a hidden tab stop is skipped.

A filled child of a click target still needs `pointerEvents: "none"`. That is not automatic.
