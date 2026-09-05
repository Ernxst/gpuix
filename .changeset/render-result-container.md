---
"@gpuix/react": minor
---

`render()` now returns Testing Library's two mount handles, `container` and
`baseElement`, so a rendered tree has a handle no query has to reach:

```tsx
const screen = render(<Sparkline />)

screen.within(screen.container).getByRole('img')
await expect(screen.container).toMatchScreenshot()
```

The tree is mounted the way Testing Library mounts it — into a `container`
element, itself inside a `baseElement` that stands in for `document.body` — so
the rendered nodes are the container's *children*, not the container itself.
Both are ordinary `TestElement`s that every query, matcher and
`getBoundingClientRect()` accepts, and both are re-read on each access, so they
stay valid across a `rerender`.

`baseElement` fills the window, as the viewport sizes `document.body`, and is
the scope the result's own `getBy*` already search. `container` is the DOM's
block box inside it: the window's width, and the height of the tree inside it.
So `expect(screen.container).toMatchScreenshot()` captures the rendered
component's band of the window where `expect(screen).toMatchScreenshot()`
captures the whole window — the golden a component that is `aria-hidden`, or
carries no text, previously had no way to take.

Closes #347
