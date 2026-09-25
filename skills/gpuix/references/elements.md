# Host elements and their props

The intrinsic elements are the `ElementType` union in `packages/react/src/types/host.ts`, exposed as `JSX.IntrinsicElements` through `jsxImportSource: "@gpuix/react"`. Anything else type-errors, and at runtime paints nothing.

## Contents

- Traps
- Element table
- `<text>` and inline runs
- `input` and `textarea`
- Labels, buttons, forms
- `img` and `svg`
- `canvas`
- `code`, `diff`, `markdown`
- `anchored` and overlays
- `virtual-list`
- Accessibility props
- `hidden` and `display: none`
- Portals and roots
- Text selection and search

## Traps

- **HTML-looking tags are block boxes, not inline flow.** `span`, `strong`, `em`, `a`, `b`, `i`, `p`, `button`, `label` and the other aliases are created natively as `div`s. With no `display`, a parent stacks its children vertically, each full width. `<p>Hello <strong>world</strong></p>` paints "Hello" and "world" on separate rows (probe: the `span` at y=0 and the `strong` at y=52, both 400px wide in a 400px `p`). For styled runs inside a sentence, nest `<text>` in `<text>`.
- **A `<text>` accepts only strings and nested `<text>`.** Any other child, including `<span>`, `<a>`, `<strong>` and components that render them, throws `InlineTextChildError`.
- **Unknown tags render nothing.** `<select>`, `<option>`, `<table>`, `<br>`, `<hr>`, `<dialog>`, `<details>`, `<iframe>`, `<video>`, SVG `<path>`, custom elements: TypeScript rejects them, and a forced one logs a Rust warning and paints an empty box, dropping its children. See the substitutes in the element table.
- **JSX SVG does not work.** `<svg>` paints only its `source` (markup string) or `src` (path or data URL) as a monochrome icon tinted by `color`; children and `viewBox`/`fill`/`stroke` are ignored. Icon libraries that emit `<svg><path/></svg>` JSX paint nothing. Use `<svg source={markup}>` for tintable icons and `<img>` for full colour.
- **`input type="password"` is not masked.** Every type except `checkbox`, `radio`, `range` and `hidden` is a plain text editor, so `email`, `number`, `file`, `date`, `submit` and `button` are editable text fields. Use `<button>` for buttons and `@gpuix/react/dialogs` for files.
- **Content props, not children, for `code`, `diff` and `markdown`.** `<code>{src}</code>` renders empty; write `<code code={src} language="ts" />`, `<diff patch={p} />`, `<markdown source={md} />`. `<code>` is a highlighted block with its own horizontal scroller, not inline code.
- **`<a href>` does not navigate.** `href`, `target`, `rel`, `download` and `title` are stored as attributes only.
- **A string `className` throws in development.** Only CSS module objects compiled by `@gpuix/plugins`, or `cn()` over them, apply (`css-modules.md`).
- **`createPortal` is not supported.** Use `<anchored deferred>` or the built-in popup parts.
- **Suspense hides a subtree with `visibility: hidden`, keeping its layout box**, and a raw string that is a direct child of the boundary stays painted. React DOM uses `display: none`.

## Element table

| Element | Children | Notes |
|---|---|---|
| `div` | yes | Block by default; `display: "flex"` or `"grid"` for flex or grid. |
| `text` | strings and `<text>` | The only element that shapes text. Raw strings directly inside a `div` also become text nodes and inherit text styles. |
| `main header footer nav section article aside h1`–`h6` `p span strong em ul ol li a kbd abbr address b blockquote cite del dfn figure figcaption i ins mark menu pre s samp small sub sup time u var` | yes | Drawn as `div` with the tag's implicit role; no user-agent styles. |
| `button` | yes | Implicit `tabIndex` 0 and role `button`; Enter and Space click; `type` defaults to `submit` inside a form. |
| `label` | yes | `htmlFor`, or wraps its control. |
| `form` | yes | Submission and reset. |
| `input`, `textarea` | no | Native editors and controls. |
| `img`, `svg`, `canvas` | no | See below. |
| `code`, `diff`, `markdown` | no | Native text components. |
| `anchored` | yes | Positioned overlay. |
| `virtual-list` | yes (each child is a row) | Windowed list. |

| Missing element | Use |
|---|---|
| `select`, `option` | `@gpuix/react/select` or `/combobox` |
| `dialog`, popover | `<anchored deferred role="dialog">` |
| `table`, `dl` | `display: "grid"` with `role` (`table`, `row`, `cell`) |
| `hr` | `<div role="separator">` |
| `progress`, `meter` | `role="progressbar"` / `"meter"` with `ariaValue*` |
| `br` | `whiteSpace: "pre"` on the outer `<text>` and a newline |
| `video`, `audio`, `iframe` | none |

On `div`, `text` and the aliases, only known props reach the renderer: the universal props, `id`, `data-*`, the HTML attributes `alt download hidden href htmlFor name rel src target title type`, and the supported ARIA props. Other unknown props are dropped silently.

## `<text>` and inline runs

```tsx
<text style={{ color: "#e6edf7", width: 240 }}>
  Output is <text style={{ color: "#7dd3fc", fontWeight: 700 }} onClick={showRate}>240 parts</text> per minute.
</text>
```

- Nested runs flatten into one shaped string; wrapping, ellipsis, selection and copy cross run boundaries.
- A run may vary `color`, `fontFamily`, `fontWeight`, `letterSpacing`, `backgroundColor`, `textDecoration` and `textTransform`, and keeps its own `onClick`, ref and `data-testid`. Layout styles on a run are diagnosed; put them on the outer `<text>`.
- Whitespace policy (`whiteSpace`) is set on the outer `<text>`.
- A `<text>` takes interaction props, state styles and `tabIndex` like a `div`.

## `input` and `textarea`

- **Text editors**: `value`/`defaultValue` (numbers are stringified), `placeholder`, `readOnly`, `theme` (caret colour). `onChange` fires per edit with `event.value` and `event.inputType`. Controlled editors restore declined edits, as in React DOM. `textarea` has `minRows`/`maxRows` (auto-growing), no `rows`.
- **Ref**: `value` (setting it writes the editor without `onChange`), `selectionStart`, `selectionEnd`, `selectionDirection`, `setSelectionRange(start, end, dir?)`, `select()`. Offsets are UTF-16 code units. Restore the caret in an effect, not in `onChange`. `ref.type` is `"input"`; the input type is `ref.props.type`.
- **Checkbox and radio**: `checked`/`defaultChecked`/`indeterminate`; `onChange` carries `event.checked`; radios group by `name` and form, with arrow-key roving. Ref setters fire no `onChange`. The default box is 13px; authored `width`, `height` and `border` replace it.
- **Range**: `min`/`max`/`step`/`value`, sanitised as in HTML; `ref.valueAsNumber`. Dragging on the track is not implemented; keyboard and value changes are.
- **Hidden**: renders nothing and submits its `value`.
- **Validation**: only `required` and `setCustomValidity()` are computed; no `pattern`, `min`/`max` on text, or `maxLength`. No message is shown to the user; `ref.validationMessage` carries it. A blocked submit fires no event.

## Labels, buttons, forms

- `<label htmlFor="id">` targets a control by author `id`; without `htmlFor`, its first descendant `input`, `textarea` or `button`. Clicking it focuses and clicks the control.
- `<button disabled>` cannot be focused or activated.
- `<form onSubmit>` receives `event.formData` and `event.submitter`; nothing navigates, so `preventDefault()` has no page to stop. `onReset` is cancelable. The ref has `requestSubmit(submitter?)`, `reset()`, `checkValidity()`.
- No `select`, `fieldset` or `output` controls.

## `img` and `svg`

- `<img src>` takes a string (`http(s)://` URL, `data:` URL, or a filesystem path) or `{ kind: "path" | "url" | "data", … }` with `bytes` from an `ArrayBuffer` or typed array. PNG, JPEG, WebP, GIF and SVG, up to 10 MiB. URLs load from public addresses only unless `render(…, { allowPrivateNetworkImages: true })`.
- `objectFit` is a **prop**: `fill`, `contain` (default), `cover`, `scaleDown`, `none`. `tint="currentColor"` recolours an SVG's `currentColor`.
- `alt=""` makes an image decorative (role `presentation`) unless it has `ariaLabel` or `tabIndex`. `onLoad`/`onError` fire once per source. No `srcSet`, `sizes`, `loading` or `width`/`height` attributes; size with `style`.
- `<svg source={markup}>` or `<svg src="icon.svg">`: a monochrome icon tinted by `color`, role `graphics-document`; decorative icons need `ariaHidden` or `role="presentation"`.

## `canvas`

- `width`/`height` props are the bitmap size (default 300×150); `style.width`/`style.height` size the box. It rasterises at device resolution, so do not multiply by the pixel ratio. Changing either dimension resets the context.
- `getContext("2d")` returns a recording context. `getContext("webgpu")` returns a `GPUCanvasContext` on macOS (needs `globals` for `navigator.gpu`); the two are exclusive. Other ids return `null`.
- **2D implemented**: paths (`beginPath`, `moveTo`, `lineTo`, `arc`, `arcTo`, `bezierCurveTo`, `quadraticCurveTo`, `ellipse`, `rect`, `closePath`, `fill`, `stroke`), `fillRect`/`strokeRect`/`clearRect`, `fillStyle`, `strokeStyle`, `globalAlpha`, line styles and dashes, transforms and `save`/`restore`, `drawImage` (with `Image` or `createImageBitmap` from `@gpuix/react`).
- **2D missing**: text (`fillText`, `strokeText`, `measureText`; overlay `<text>` instead), `clip`, `roundRect`, `isPointInPath`, gradients, patterns, `getImageData`/`putImageData`/`createImageData`, shadows, `filter`, compositing, `ctx.canvas`. Each diagnoses (throws in strict mode) and returns `undefined`. `toDataURL()` returns `undefined`; there is no `toBlob`.

## `code`, `diff`, `markdown`

| Element | Content | Other props |
|---|---|---|
| `code` | `code` | `language` (beats `path`), `path`, `showLineNumbers`, `theme`. Never wraps; scrolls horizontally. Style `font*`, `lineHeight` and `color` beat the theme. |
| `diff` | `patch` (unified diff) | `wordDiff`, `collapsedPaths`, `scroll` (needs a bounded height), `maxLines`, `theme`, `onToggleFile`, `onShowMore`, `onLineClick`. |
| `markdown` | `source` (GFM) | `theme`, `onLinkClick` (`event.value` is the URL). |

Their text is selectable and searchable, but test text queries cannot see it; use `renderer.getPaintedText()`.

## `anchored` and overlays

`<anchored>` places its children beside the box of its nearest positioned ancestor, so wrap the trigger and the overlay in a `position: "relative"` parent. Props: `position`, `side`, `align`, `gap`, `anchor`, `offset`, `fit` (`"switch"` flips to the other side on overflow, `"snap"` shifts inside the window), `snapMargin`, `deferred` (paint in a later pass, on top), `priority`, `occlude` (block hits to what is behind; on by default).

- Menus, tooltips and dialogs need `<anchored deferred>` (or the built-in Content parts). A `position: "absolute"` card paints in tree order, so a later `<virtual-list>` paints over it and takes its clicks. There is no `zIndex` (#481).
- Give overlays an opaque fill. A translucent overlay background shows the `#1A1A1A` fallback surface, not the page.
- A `div` that paints a fill or is positioned blocks clicks and hovers behind it, but the wheel passes through to **any** scroller behind it, not only an ancestor. Give a modal backdrop `pointerEvents: "auto"` to swallow the wheel. `pointerEvents: "none"` removes an element's hitbox without disabling its own listeners, and does not inherit.
- Overlays cannot leave the window (#326).

## `virtual-list`

A host element, not a component; each immediate child is one row. It needs a bounded height.

- Props: `alignment` (`top`/`bottom`), `followTail`, `overdraw` (px, default 512), `estimatedItemHeight` (default 48; `null` opts out), `itemCount` (ignored without a positive estimate), `windowStart` (logical index of the first child; ignored without `itemCount`), `onVisibleRange` (`startIndex`, `endIndex` exclusive), ARIA props.
- Not accepted: mouse/keyboard handlers, `className`, `data-testid`, `hover`/`active` styles, `transition`. Wrap the list in a `div` for those.
- A single child without `itemCount={1}` throws `VirtualListRowContractError` in strict mode and warns otherwise.
- Scroll to a row with `renderer.scrollToItem?.(ref.current.id, index, offsetPx?)` (from `useGpuixRequired()`), not a ref method. `ref.current.scrollTop` works.
- Windowing (which rows to mount) is app state; unmounted rows paint as estimate-sized placeholders. A focused row stays mounted offscreen.

## Accessibility props

- Implicit roles follow HTML-AAM: `header`/`footer` are landmarks outside sectioning content, `section` and `form` only when named, `li` inside a list, `a` only with `href`, headings carry their level. An explicit `role` wins; React Native's `accessibilityRole` is rejected.
- ARIA props are accepted in camelCase (`ariaLabel`) and `aria-*` spellings. An unlisted `aria-*` prop (`aria-modal`, `aria-owns`, `aria-activedescendant`, `aria-busy`, `aria-sort`, `aria-posinset`, `aria-setsize`, `aria-autocomplete`, `aria-errormessage`) warns once and is dropped; TypeScript does not check hyphenated props. `ariaControls`, `ariaRelevant` and `ariaMultiSelectable` are kept as attributes but not exposed to assistive technology.
- `disabled` on any element makes it unavailable and removes it from Tab order; `ariaDisabled` keeps it in Tab order.
- `visuallyHidden` (the `sr-only` equivalent) takes `true`, needs an explicit role, and works on `div`, `text`, `input`, `textarea` and `img`.
- Live regions: `ariaLive` needs a role; `role="status" | "alert" | "log"` imply politeness. `announce()` from `@gpuix/react` speaks a message without an element.
- `ariaLabelledBy`/`ariaDescribedBy` resolve author `id`s.

## `hidden` and `display: none`

`hidden` applies `display: "none"` unless the element's own style sets `display`. Both remove the subtree from layout, paint, hit testing, focus and the accessibility tree, and blur a focused descendant. `visibility: "hidden"` keeps the box.

## Portals and roots

There is no `createPortal`. React DOM's needs a DOM container, and the reconciler treats a portal container as its own root type. Several top-level children are wrapped in one implicit, unstyled root `div` (#619); render one top-level element.

## Text selection and search

- All painted text is selectable, including `code`, `diff` and `markdown`. `userSelect: "none"` opts out and inherits; `selectionColor` tints the selection.
- Selection is window-level: `render(…, { onSelectionChange })`, `renderer.getSelectedText()`, `renderer.clearSelection()`. There is no `window.getSelection()`, `Selection` or `Range`. Input selection lives on the input ref.
- The `highlight` prop on any element marks matches in its subtree: `{ query, caseSensitive, wholeWord, ranges, color, activeColor, activeIndex, matchIndexOffset, radius }`, one or an array; `onHighlight` reports the count. `useTextSearch()` wraps it for a find bar; `findRanges()` mirrors the native matcher for rows a `virtual-list` has not mounted.
