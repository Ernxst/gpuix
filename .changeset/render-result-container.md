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

**Breaking: a top-level `height: "100%"` or `flexGrow: 1` no longer fills the
window under `render()`.** The tree used to be the window's root and resolved
percentages against the window itself. It now sits inside `container`, whose
height comes from the tree, so a top-level percentage height resolves against
auto and measures nothing — exactly as it does in a browser, where the same
declaration inside an auto-height container collapses. **Size the window
instead, or give the tree an explicit height:**

```tsx
render(<Panel />, { height: 600 })         // the window is the fixed thing
render(<Panel style={{ height: 600 }} />)  // or the tree is
```

`createTestRoot()` is unaffected: it still renders the node as the window's
root.

Two smaller changes fall out of having a container to append into. A top-level
fragment now mounts **every** child — each one used to overwrite the window's
single root, so only the last survived. And both handles are remembered after
`unmount()`, the way Testing Library's `container` outlives its tree, so
`expect(screen.container).not.toBeInTheDocument()` answers rather than the
property read throwing.

Closes #347
