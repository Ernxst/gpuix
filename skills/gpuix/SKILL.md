---
name: gpuix
description: Build, style, test and debug React apps that render with GPU-IX (the galaxiajs/gpuix fork of GPUIX; packages @gpuix/react, @gpuix/native, @gpuix/plugins), a React renderer that paints with GPUI instead of a DOM. Use this whenever code imports @gpuix/*, uses jsxImportSource "@gpuix/react", renders <text>, <virtual-list>, <anchored> or style.hover, compiles .module.css with @gpuix/plugins, or when choosing a UI library, CSS, event or DOM API for a GPU-IX desktop app, even if the user only says "the desktop app" or "the native build". It lists what GPU-IX supports, what it lacks compared with a browser, and the traps that cost the most debugging time.
license: Apache-2.0
---

# Building with GPU-IX

GPU-IX renders a React tree with GPUI, Zed's GPU UI framework, on Metal, DirectX or Vulkan, and in a browser through WebGPU. There is no DOM and no CSS engine. Host elements are native nodes, `style` is a typed object the native parser checks field by field, and `className` accepts only CSS modules compiled at build time. The public API imitates React DOM, so browser assumptions compile and then fail at runtime, often only with a console warning.

Tooltip composition and timing are part of its contract: put `Tooltip.Popup` inside `Tooltip.Positioner`, keep custom-rendered Trigger children in the returned element, and use `onOpenChange` details `cancel()`/`allowPropagation()` when changing state or Escape propagation. Focus-opened tooltips close immediately when focus leaves their triggers; hover closure still follows `closeDelay`. See [the component reference](references/components.md#tooltip-gpuixreacttooltip) for handle handoffs and limitations.

Before writing code that relies on a browser behaviour, check it in the reference file for that area. Each file lists its traps first. The skill describes the fork's `main` branch. If the installed release disagrees, the installed package's types (`node_modules/@gpuix/react/dist/types/host.d.ts`) and README are the authority for that version.

For built-in compound controls, use the documented named namespace imports and their parts (for example, `import { Select } from "@gpuix/react/select"` and `<Select.Root>`); the component reference lists each control's available parts and differences from Base UI.

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

**There is no DOM.** Do not reach for `document.createElement`, `matchMedia`, `MutationObserver`, `IntersectionObserver`, `window.innerWidth`, or listeners on `window`/`document`. They are absent, or they register and never fire. `window.getComputedStyle()` answers only `display` and `visibility`. Base UI 1.8.0 ToggleGroup, Toolbar, RadioGroup, and Tabs support tested Right Arrow navigation; other headless DOM libraries or components work only in parts. Use `@gpuix/react/dialog`, `/select`, `/combobox`, `/tooltip`, `/floating` and `<anchored>` for supported overlays. There is no general DOM portal; Dialog provides a native full-window `Portal` part. Its Base UI-compatible `container` prop is a no-op in the native renderer.

Select, Combobox, and Tooltip Positioners share anchor, side/alignment offset, collision-boundary, collision-padding, and flip/shift options. Offset callbacks receive the resolved side and alignment, plus anchor and Positioner dimensions. `collisionPadding` defaults to five pixels on each edge; an object applies only its supplied edges. The padding sets the flip boundary and the inset used when shifting a popup. Collision correction uses the native window or supplied boundary; logical `inline-start`/`inline-end` map to left/right without direction resolution. GPU-IX also accepts an explicit `position` that Base UI does not expose. `positionMethod`, `sticky`, `arrowPadding`, `disableAnchorTracking`, and `collisionAvoidance.fallbackAxisSide` are accepted for Base UI compatibility but have no native effect.

**Refs are not elements.** `ref.current.id` is a numeric native id; the authored id is `getAttribute("id")`. Refs have `isConnected`, `focus`, `blur`, `click`, `contains`, `compareDocumentPosition`, `getBoundingClientRect`, `scrollTop`, `matches` (interaction and disabled-state pseudo-classes) and `getAttribute`. They have no `closest`, `dataset`, `style`, `classList`, `children` or `addEventListener`.

**Text lives in `<text>`.** `span`, `strong`, `a`, `p` and the other HTML tags are block boxes that stack vertically. For styled words inside a sentence, nest `<text>` in `<text>`; a `<text>` accepts only strings and `<text>`. Uncoloured text paints light grey `#e2e2e2`, which is invisible on light surfaces. `color`, `fontSize`, `fontFamily`, `fontWeight`, `whiteSpace`, `textTransform`, `fontVariantNumeric` and `userSelect` inherit from ancestors.

**`<title>` sets the window title.** Render one string or number child; text updates are reflected immediately. The last mounted title wins, and unmounting it restores the earlier title. With no mounted title, GPU-IX restores the window option or the last `renderer.setWindowTitle()` value. An element or other child shape sets an empty title, matching React DOM. On the browser target it updates `document.title`; `suppressHydrationWarning` is accepted for shared router head output.

**Style values are narrower than CSS.**
- Spacing, insets, radii, font sizes and `flexBasis` are numbers in px. Among lengths, only `width`/`height`/`min*`/`max*` take strings (`%`, `vw`, `vh`, `ch`, `calc(a ± b)`, `clamp()`, intrinsic keywords).
- A numeric `lineHeight` is a multiple of the font size, so `lineHeight: 20` is twenty lines tall; write `"20px"` for pixels.
- `display` is `none`, `flex` or `grid`; omit it for block flow.
- Grid templates are arrays of track objects. `boxShadow` is an object.
- There is no `var()`, `rem`/`em`, `transform`, `flex` shorthand, `margin: auto` or `box-sizing`.
- A rejected field is dropped. Development builds warn in the console; production and compiled binaries drop it silently. Read the warnings.

**`className` takes compiled CSS modules only.** Import `.module.css` by relative path, combine classes with `cn()` from `@gpuix/react/cn`, never with template strings or `clsx`. A string class throws in development.
- Selectors: `.a`, `.a` with `:hover`, `:active`, `:focus`, `:focus-visible` or `:focus-within`, `.a:hover .b`, `.a:active .b`, and lists of these. No other selectors and no at-rules.
- A module may declare `:root` custom properties and use `var()`; they are substituted at build time.
- Write `box-shadow` in `style`. CSS modules support solid `text-decoration` using the native underline, line-through, and none values; explicit decoration colours and non-solid styles are rejected. Keep `line-height` unitless or `px`.
- `style` beats `className` per property, including inside state styles.

**Interaction styling is built in.** `style.hover`, `active`, `focus`, `focusVisible`, `focusWithin` and `dragOver` style the element itself. `hover` stays active over descendants, including links, painted children and positioned children outside the ancestor's box. `hoverGroup` on an ancestor with `hoverWithin`/`activeWithin` on a descendant (optionally `hoverWithinGroup: "name"`) replaces `.parent:hover .child`. A `hoverWithin` with no `hoverGroup` ancestor silently never applies. CSS modules also support `.a:focus .b`, `.a:focus-visible .b` and `.a:focus-within .b`; one descendant class can use a hover/active ancestor group and a separate focus ancestor group (`references/css-modules.md`). Built-in components expose state through `style={(state) => …}` and matching `data-*` attributes. Select and Combobox inputs, triggers, popups, positioners and items expose their own state; see `references/components.md`.

**Motion is native and respects Reduce Motion.** `style.transition` (CSS shorthand or object) animates changes to opacity, colours, sizes, insets and radii. `motion.div` with `AnimatePresence` animates enter and exit of numeric targets. Both snap automatically when the OS Reduce Motion setting is on; do not add a `matchMedia` check. `render(…, { reducedMotion })` overrides the OS. Animation loops written in JS are not covered.

**Events differ from React DOM in ways that break common patterns.**
- `onFocus`/`onBlur` do not bubble, and `relatedTarget` is always `null`.
- Keyboard events have `key` but no `code` or `keyCode`.
- Enter and Space activate a focused element that has `onClick` or sits inside an element that has one; checkboxes and radios take Space only.
- App shortcuts go on the single top-level element's `onKeyDown`; with several top-level children they are lost.
- An element takes focus only with `tabIndex`, a key or focus listener, or `focusWithin`; inputs and textareas already can. `autoFocus` focuses only an element that is already focusable.

**Overlays need `<anchored>`** (deferred by default, so it paints on top) or the built-in Content parts. `<anchored>` sits beside its direct parent's box, so put it inside the trigger's parent. Give it an opaque background: a translucent one lets the page show through. `zIndex` orders positioned elements and flex/grid items that set it, without changing tree traversal, accessibility, tab or selection order. Ordinary in-flow blocks ignore it.

**Tests need a real native window.** They cannot run inside an agent sandbox, so ask for an unsandboxed run first. Build `dist` before running Vitest directly. `render()` reuses one offscreen window per test file. `requestAnimationFrame` callbacks and async tasks advance only on `advanceAsyncClock`; transitions run on wall time unless you `clockPause()`. A golden can differ between a warm window and a fresh one.

**Install from the fork's GitHub releases, not npm.** `@gpuix/react` on npm is upstream's package. Pin the release tarballs with an `overrides` entry for `@gpuix/native`, and set `"jsxImportSource": "@gpuix/react"`. Run the app with `bun --hot --preload @gpuix/plugins/preload app.tsx`. Build binaries with `Bun.build` and the CSS plugin; the `bun build --compile` CLI drops CSS modules.

## When something does not work

1. Look for a style diagnostic in the console (development), or call `renderer.drainStyleDiagnostics()` in a test. Both need strict styles, which are on by default outside production; pass `strictStyles: true` to `render()` or `createTestRoot()` otherwise.
2. Check the reference file's Traps and its open-issues table; many gaps are tracked on https://github.com/galaxiajs/gpuix/issues.
3. Confirm the prop or value against `StyleDesc`, `Props` and the element prop types in `@gpuix/react`'s `types/host.d.ts`.
4. Reproduce it in a test with `createTestRoot()` and assert numbers (bounds, text, resolved style) rather than pixels.
5. If no issue tracks the gap, raise it with the user before working around it; do not file by default. Give them the
   `@gpuix/react` version, strict-mode warning, reproduction, same-markup browser behaviour and, if available, a link to
   the GPUI `Styled` method or AccessKit setter (showing this is a wiring gap). File only when the user agrees.
6. A workaround must not hide the gap: do not rename files or change config to get past a rule. Comment the workaround
   with the issue number or the user's decision, so it can be removed when the fix ships.
