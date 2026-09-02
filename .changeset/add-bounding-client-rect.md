---
"@gpuix/react": minor
---

`TestElement.getBoundingClientRect()` reports an element's painted box in the
DOM's `DOMRect` shape, so a browser suite and a desktop suite can assert
alignment and motion with the same code:

```ts
const rect = screen.getByTestId('panel').getBoundingClientRect()
expect(rect.left).toBe(sidebar.getBoundingClientRect().right)
```

Coordinates are the ones `renderer.getElementBounds` already reports — logical
pixels, window-relative, the desktop's analogue of viewport-relative — and the
derived fields follow the browser exactly: `right = x + width`,
`bottom = y + height`, `top = y`, `left = x`. The element is re-resolved on
every call, so a reference captured before a rerender reports the box it paints
now.

One departure from the DOM: a browser always has a rect for a connected
element, but bounds here are recorded during paint. An element that painted
nothing in the last frame — scrolled out of a virtual list, visually hidden,
even `visibility: "hidden"` (which still occupies layout, and a browser would
give a rect) — has no rect at all, so this throws and names the element
rather than quietly returning zeros that no assertion can distinguish from a
collapsed box.

Closes #284
