---
name: gpuix
description: Build, style, test and debug React apps that render with GPU-IX (the Ernxst/gpuix fork of GPUIX; packages @gpuix/react, @gpuix/native, @gpuix/plugins), a React renderer that paints with GPUI instead of a DOM. Use this whenever code imports @gpuix/*, uses jsxImportSource "@gpuix/react", renders <text>, <virtual-list>, <anchored> or style.hover, compiles .module.css with @gpuix/plugins, or when choosing a UI library, CSS, event or DOM API for a GPU-IX desktop app, even if the user only says "the desktop app" or "the native build". It lists what GPU-IX supports, what it lacks compared with a browser, and the traps that cost the most debugging time.
license: Apache-2.0
---

# Building with GPU-IX

GPU-IX renders a React tree with GPUI, Zed's GPU UI framework, on Metal, DirectX or Vulkan, and in a browser through WebGPU. There is no DOM and no CSS engine. Host elements are native nodes, `style` is a typed object the native parser checks field by field, and `className` accepts only CSS modules compiled at build time. The public API imitates React DOM, so browser assumptions compile and then fail at runtime, often only with a console warning.

Before writing code that relies on a browser behaviour, check it in the reference file for that area. Each file lists its traps first. The skill describes the fork's `main` branch. If the installed release disagrees, the installed package's types (`node_modules/@gpuix/react/dist/types/host.d.ts`) and README are the authority for that version.

## Reference files

| Read | When |
|---|---|
| [references/elements.md](references/elements.md) | Choosing elements; text layout; inputs, forms, images, SVG, canvas; `code`/`diff`/`markdown`; overlays; `virtual-list`; accessibility props |
| [references/styles.md](references/styles.md) | Any `style` value; units; colours; borders and shadows; state styles and hover groups; transitions; `motion.div`; reduced motion |
| [references/css-modules.md](references/css-modules.md) | Writing `.module.css`; `className`; `cn()`; `composes`; `:root` variables; the Bun and Vite plugins |
| [references/events-and-dom.md](references/events-and-dom.md) | Event props and objects; focus and keyboard; refs; `document`/`window`; whether a third-party library can work |
| [references/components.md](references/components.md) | Select, Combobox, Tooltip, floating layer, file pickers, hooks |
| [references/testing.md](references/testing.md) | Writing or running tests; screenshots; clocks; the automation client |
| [references/platform.md](references/platform.md) | Installing; TypeScript setup; import paths; `render()` options; hot reload; building a binary; menus and window controls |

## Rules that prevent most mistakes

**There is no DOM.** Do not reach for `document.createElement`, `getComputedStyle`, `matchMedia`, `MutationObserver`, `IntersectionObserver`, `window.innerWidth`, or listeners on `window`/`document`. They are absent, or they register and never fire. Headless DOM libraries (Base UI, Radix, Floating UI, React Aria) do not work, or work only in parts; use `@gpuix/react/select`, `/combobox`, `/tooltip`, `/floating` and `<anchored>`. Portals do not exist.

**Refs are not elements.** `ref.current.id` is a numeric native id; the authored id is `getAttribute("id")`. Refs have `focus`, `blur`, `click`, `contains`, `getBoundingClientRect`, `scrollTop`, `matches` (four pseudo-classes) and `getAttribute`. They have no `isConnected`, `closest`, `dataset`, `style`, `classList`, `children` or `addEventListener`.

**Text lives in `<text>`.** `span`, `strong`, `a`, `p` and the other HTML tags are block boxes that stack vertically. For styled words inside a sentence, nest `<text>` in `<text>`; a `<text>` accepts only strings and `<text>`. Uncoloured text paints light grey `#e2e2e2`, which is invisible on light surfaces. `color`, `fontSize`, `fontFamily` and `fontWeight` inherit from ancestors.

**Style values are narrower than CSS.**
- Spacing, insets, radii, font sizes and `flexBasis` are numbers in px. Only `width`/`height`/`min*`/`max*` take strings (`%`, `vw`, `vh`, `ch`, `calc(a ± b)`, `clamp()`, intrinsic keywords).
- `display` is `none`, `flex` or `grid`; omit it for block flow.
- Grid templates are arrays of track objects. `boxShadow` is an object.
- There is no `var()`, `rem`/`em`, `zIndex`, `transform`, `flex` shorthand, `margin: auto` or `box-sizing`.
- A rejected field is dropped. Development builds warn in the console; production and compiled binaries drop it silently. Read the warnings.

**`className` takes compiled CSS modules only.** Import `.module.css` by relative path, combine classes with `cn()` from `@gpuix/react/cn`, never with template strings or `clsx`. A string class throws in development.
- Selectors: `.a`, `.a` with `:hover`, `:active`, `:focus`, `:focus-visible` or `:focus-within`, `.a:hover .b`, `.a:active .b`, and lists of these. No other selectors and no at-rules.
- A module may declare `:root` custom properties and use `var()`; they are substituted at build time.
- Write `box-shadow` and `text-decoration` in `style`. Keep `line-height` unitless or `px`.
- `style` beats `className` per property, including inside state styles.

**Interaction styling is built in.** `style.hover`, `active`, `focus`, `focusVisible`, `focusWithin` and `dragOver` style the element itself. `hoverGroup` on an ancestor with `hoverWithin`/`activeWithin` on a descendant (optionally `hoverWithinGroup: "name"`) replaces `.parent:hover .child`. A `hoverWithin` with no `hoverGroup` ancestor silently never applies. Nothing styles a descendant from its ancestor's focus; drive that from React state. Built-in components expose state through `style={(state) => …}`, not `data-*` attributes.

**Motion is native and respects Reduce Motion.** `style.transition` (CSS shorthand or object) animates changes to opacity, colours, sizes, insets and radii. `motion.div` with `AnimatePresence` animates enter and exit of numeric targets. Both snap automatically when the OS Reduce Motion setting is on; do not add a `matchMedia` check. `render(…, { reducedMotion })` overrides the OS. Animation loops written in JS are not covered.

**Events differ from React DOM in ways that break common patterns.**
- `onFocus`/`onBlur` do not bubble, and `relatedTarget` is always `null`.
- Keyboard events have `key` but no `code` or `keyCode`.
- Enter and Space activate any focused element that has `onClick`.
- App shortcuts go on the single top-level element's `onKeyDown`; with several top-level children they are lost.
- An element takes focus only with `tabIndex`, `autoFocus`, a key or focus listener, or `focusWithin`.

**Overlays need `<anchored deferred>`** or the built-in Content parts, with an opaque background. Absolutely positioned cards paint in tree order, and there is no `zIndex`.

**Tests need a real native window.** They cannot run inside an agent sandbox, so ask for an unsandboxed run first. Build `dist` before running Vitest directly. `render()` reuses one offscreen window per test file. Frames advance only when told to (`advanceAsyncClock`). A golden can differ between a warm window and a fresh one.

**Install from the fork's GitHub releases, not npm.** `@gpuix/react` on npm is upstream's package. Pin the release tarballs with an `overrides` entry for `@gpuix/native`, and set `"jsxImportSource": "@gpuix/react"`. Run the app with `bun --hot --preload @gpuix/plugins/preload app.tsx`. Build binaries with `Bun.build` and the CSS plugin; the `bun build --compile` CLI drops CSS modules.

## When something does not work

1. Look for a style diagnostic in the console (development), or call `renderer.drainStyleDiagnostics()` in a test.
2. Check the reference file's Traps and its open-issues table; many gaps are tracked on https://github.com/Ernxst/gpuix/issues.
3. Confirm the prop or value against `StyleDesc`, `Props` and the element prop types in `@gpuix/react`'s `types/host.d.ts`.
4. Reproduce it in a test with `createTestRoot()` and assert numbers (bounds, text, resolved style) rather than pixels.
