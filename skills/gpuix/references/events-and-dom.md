# Events, focus, refs and the DOM facade

GPU-IX dispatches its own synthetic events over the retained host tree (`packages/react/src/reconciler/event-registry.ts`, `synthetic-event.ts`). There is no DOM: refs are `HostElement` objects (`host-config.ts`), and `document`/`window` exist only as the partial facades that `@gpuix/react/globals` installs. Code written against the DOM runs only as far as the tables below allow.

## Contents

- Traps
- Event props
- Event objects
- Propagation, `stopPropagation`, `preventDefault`
- Focus and keyboard
- Refs (`PublicInstance`)
- `@gpuix/react/globals`
- The `document` facade
- DOM APIs that UI libraries use
- Third-party headless libraries
- Open issues

## Traps

- **`onFocus` and `onBlur` do not bubble.** In React DOM they do. An ancestor's `onFocus` never runs when a descendant takes focus; `onFocusCapture` runs only when the focused descendant has its own `onFocus` or `onFocusCapture`. To react to focus inside a subtree, use the `focusWithin` style or put handlers on each focusable child.
- **`FocusEvent.relatedTarget` is always `null`.** "Close on blur unless focus moved inside me" treats every blur as focus leaving.
- **`ref.current.id` is a number**, the native element id. The authored `id` is `ref.current.getAttribute("id")` or `ref.current.props.id`.
- **Refs have no `isConnected` (#660), `closest`, `querySelector`, `dataset`, `style`, `classList`, `children`, `parentNode`, `textContent`, `addEventListener`, `setAttribute` or `offsetWidth`.** `el.contains(el)` reports whether a ref is still mounted.
- **`window` is `globalThis`.** Under Bun `window.addEventListener("resize" | "keydown" | "blur", …)` registers without error and never fires. Use `useWindowSize()` for resize and a root `onKeyDown` for shortcuts.
- **`document` answers `getElementById`, `activeElement`, `body`, `defaultView`, and `pointerup`/`pointercancel` listeners only.** Other listener types are ignored with one warning; `documentElement` is `undefined`, and `createElement`, `querySelector` and `dispatchEvent` are undefined and throw when called.
- **Not installed anywhere**: `getComputedStyle`, `matchMedia`, `MutationObserver`, `IntersectionObserver`, `innerWidth`/`innerHeight`, `devicePixelRatio`, `DOMRect`, `CSS`, `KeyboardEvent`, `MouseEvent`, `FocusEvent`, `requestIdleCallback`.
- **Keys pressed with nothing focused reach only the root element's own `onKeyDown`/`onKeyUp`.** Render one top-level element and put app shortcuts on it. With several top-level children (`<><App /><Toaster /></>`) GPU-IX inserts an implicit root with no handlers, and no-focus shortcuts are lost (#619).
- **Only elements with a focus handle can take focus.** A handle comes from `tabIndex`, a key/focus/blur listener (capture forms included), `onAccessibilityAction`, or a `focusWithin` style; inputs, textareas and choice/range inputs have one already. `ref.focus()` on a bare `div` does nothing, and so does `autoFocus`: it focuses only an element that is already focusable. Adding `onKeyDown` makes an element focusable but not a Tab stop.
- **Enter and Space fire `onClick` on a focused element that has one or sits inside one**: focus on a `tabIndex` child inside a clickable row, and Enter fires the row's `onClick`. An `<a href>` takes Enter only; checkboxes and radios take Space only. In the DOM only buttons and links activate this way. Code that also calls its own click on Enter fires twice unless it calls `preventDefault()` on that keydown.
- **`disabled` and `ariaDisabled` block clicks for the whole subtree.** In the DOM, `aria-disabled` blocks nothing.
- **Keyboard events have no `code`, `keyCode`, `which`, `charCode`, `location` or `isComposing`.** Match on `key` and the modifier flags; hotkey libraries that match `event.code` never fire.
- **There is no HTML drag and drop between elements.** No `draggable`, `onDragStart`, `onDrag` or `onDragEnd`; `onDragEnter`/`Over`/`Leave`/`onDrop` are for OS file drags, and `dataTransfer.getData()` returns `""`. Build in-app drags with `onPointerDown` + `onPointerMove` (the pointer is captured automatically).
- **These React DOM props do not exist**: `onInput`, `onBeforeInput`, `onKeyPress`, `onCopy`/`onCut`/`onPaste`, `onFocusIn`/`onFocusOut`, `onPointerOver`/`onPointerOut`, `onMouseOver`/`onMouseOut`, `onTouch*`, `onGotPointerCapture`/`onLostPointerCapture`, `onSelect`, `onComposition*`, `onAnimation*`, `onTransition*`. TypeScript rejects them; forced through, they are dropped silently. `onChange` fires per edit, which covers `onInput`.
- **`<a href>` does not navigate.** `href` is kept as an attribute only. Open the URL yourself in `onClick`; for `<markdown>` links use `onLinkClick`.

## Event props

| Props | Capture form | Bubbles | Notes |
|---|---|---|---|
| `onClick` | yes | yes | Primary button; also keyboard activation (`inputSource: "keyboard"`). Runs label/checkbox/radio/submit/reset defaults unless prevented. |
| `onDoubleClick`, `onAuxClick` | yes | yes | Double click after a `clickCount` 2 click; aux for non-primary buttons. |
| `onContextMenu` | yes | yes | On right-button **press**, after `mouseDown`. |
| `onMouseDown`, `onMouseUp`, `onMouseMove` | yes | yes | All buttons, via `button`. |
| `onMouseEnter`, `onMouseLeave`, `onPointerEnter`, `onPointerLeave` | no | no | Computed over ancestry with `relatedTarget`; pointer before mouse. |
| `onMouseDownOutside` | no | no | GPU-IX "click outside". |
| `onPointerDown`, `Up`, `Move`, `Cancel` | yes | yes | Before the matching mouse event; `pointerCancel` when the window deactivates. |
| `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop` | yes | yes | OS file drags; `onDrop` runs only if an `onDragOver` on the path called `preventDefault()`. |
| `onKeyDown`, `onKeyUp` | yes | yes | To the focused element, or the root when nothing is focused. |
| `onFocus`, `onBlur` | yes | **no** | See Traps. |
| `onScroll` | yes | no | Scroll container position changed. |
| `onWheel` | yes | yes | DOM sign convention; `deltaMode` 0 or 1. |
| `onChange` | yes | yes | Per edit on inputs and textareas (`value`, `inputType`) and on choice inputs (`checked`); bubbles to ancestors. |
| `onSubmit`, `onReset` | yes | yes | On `<form>`. |
| `onLoad`, `onError` | yes | yes | Images. Ancestor handlers run, as in React, although `event.bubbles` is false. |
| `onVisibleRange`, `onToggleFile`, `onShowMore`, `onLineClick`, `onLinkClick` | no | no | `virtual-list`, `diff`, `markdown`. |
| `onHighlight`, `onAccessibilityAction`, `onMotionComplete` | no | yes | |

Window text selection is a `render()` option (`onSelectionChange`), not a prop.

## Event objects

A plain object, not a DOM `Event`. `nativeEvent` is the raw GPU-IX payload.

- **All events**: `type`, `target`, `currentTarget` (refs), `eventPhase`, `bubbles`, `cancelable`, `defaultPrevented`, `preventDefault()`, `stopPropagation()`, `stopImmediatePropagation()`, `isDefaultPrevented()`, `isPropagationStopped()`, `persist()` (no-op). No `timeStamp`, `isTrusted`, `composedPath()` or `view`.
- **Mouse, pointer, wheel**: modifier flags, `button` (−1 on pointer move), `detail` (click count), `clientX`/`clientY` = `pageX`/`pageY` (window coordinates), `relatedTarget` (enter/leave only), `setPointerCapture()`/`releasePointerCapture()`. No `screenX/Y`, `offsetX/Y`, `movementX/Y`, `pressure`, `tilt`.
- **Pointer**: `pointerId` 1, `pointerType` `"mouse"`, `isPrimary`, `buttons`.
- **Keyboard**: `key` per UI Events (`" "` for Space, `F1`–`F35`, the produced character), `repeat`, modifier flags, `getModifierState()` for Alt/Control/Meta/Shift. See Traps for what is missing.
- **Change**: `value`, `inputType` (`insertText`, `insertFromPaste`, …), `checked`. `event.target.value` works at runtime, but `event.target` is typed `PublicInstance`, so read `event.value`.
- **Drag**: `dataTransfer.files` (on drop), `types`, `dropEffect`, `effectAllowed`.
- `preventDefault()` on a non-cancelable event (`focus`, `blur`, `scroll`, `load`, `error`) is ignored.

## Propagation, `stopPropagation`, `preventDefault`

- The target is the deepest painted element under the pointer, even without a listener; the event then reaches listening ancestors. A click on a painted child (icon, switch thumb) reaches the parent's `onClick` with the child as `target`; only a descendant with its own `onClick` keeps it.
- Capture runs root → parent; at the target its capture then bubble listeners run; bubble runs parent → root. `stopPropagation()` still lets the target's other listener run; `stopImmediatePropagation()` does not.
- Events never reach `document` or `window`, except the window `pointerup`/`pointercancel` delivered to facade listeners, which run **before** the released element's own `onPointerUp`/`onClick`.
- `preventDefault()` cancels: click activation (and reverts a checkbox or radio flip); the keyboard click on Enter/Space keydown; Tab traversal (in any phase); keyboard scrolling on scroll keys; radio/range arrow defaults. On `dragOver` it accepts the drop.
- **Pointer capture** is automatic while pressed when the element or an ancestor has `onMouseDown` + `onMouseMove` or `onPointerDown` + `onPointerMove`. `setPointerCapture()` captures explicitly; its `pointerId` is ignored; no `lostpointercapture` event.

## Focus and keyboard

- **Tab stops**: `<button>` and `<a href>` get an implicit `tabIndex` 0 (none when `disabled`); inputs and textareas are focusable; `tabIndex={-1}` is focusable but skipped; positive values order Tab; a radio group is one stop; `display: none` subtrees are skipped.
- **Tab** is delivered as a `keyDown` with `key: "Tab"` to the focused element (or root); traversal runs unless prevented.
- **Keys with focus** go to the focused element as `target` and bubble through listening ancestors, even when the focused element has no listener. A root `onKeyDown` also hears keys typed into inputs; compare `event.target` with the root to tell them apart.
- **Keyboard activation**: Enter and Space on a focused element that has `onClick` or sits inside one; Enter only on `<a href>`; Space only on checkboxes and radios; text editors keep Space as text. Enter in a text input does not submit its `<form>`.
- **Focus visible**: the `focusVisible` style and `ref.matches(":focus-visible")` are true only after keyboard input.
- **Imperative focus**: `ref.focus({ preventScroll })` (ignored on disabled controls), `ref.blur()`, `document.activeElement` (the focused ref, or `body`). Renderer equivalents: `focusElement(id, preventScroll)`, `focusNext()`, `focusPrevious()`, `getActiveElement()`.
- **Missing**: focus trapping (#578), `inert`, `aria-modal` (#536), a `tabIndex` property on refs (read `props.tabIndex`).

## Refs (`PublicInstance`)

A ref is the host instance itself. Type refs as `PublicInstance`, `InputPublicInstance`, `FormPublicInstance` or `CanvasPublicInstance` from `@gpuix/react`.

| Member | Behaviour |
|---|---|
| `id`, `type`, `props` | Numeric native id; authored type; latest props. |
| `tagName`, `nodeName`, `localName` | Authored name (`"ARTICLE"` / `"article"`), even for tags drawn as `div`. |
| `parentElement` | Live retained parent; `null` at the root or once unmounted. (`parentId` can be stale on descendants of a removed subtree.) |
| `ownerDocument` | The host document if one exists, else the GPU-IX facade (also without `globals`). |
| `focus()`, `blur()`, `click()` | See Focus. `click()` runs full dispatch and activation. |
| `dispatchEvent(event)` | Reaches handlers only for `click` and `pointerdown`/`up`/`move`/`cancel`/`enter`/`leave`. |
| `setPointerCapture()`, `releasePointerCapture()` | Native capture; no `hasPointerCapture`. |
| `scrollTop`, `scrollLeft` (read/write), `scrollWidth`, `scrollHeight`, `clientWidth`, `clientHeight`, `scrollTo()` | Only `overflow: scroll`/`auto` and `virtual-list` scroll; `overflow: hidden` reports 0 and ignores writes. `scrollTo` is instant. |
| `scrollIntoView(opts)` | `block: "start"` or `"nearest"`; `center`, `end`, `false` and any `inline` other than `nearest` fall back to nearest with a warning, and throw in strict mode. |
| `getBoundingClientRect()` | Plain object in window coordinates; all zeros when unpainted. `getBounds()` returns `null` instead. |
| `matches(selector)` | `:focus`, `:focus-visible`, `:hover`, `:active` only; anything else throws `SyntaxError`. |
| `contains(other)`, `compareDocumentPosition(other)` | Retained-tree answers; `DOCUMENT_POSITION_*` constants are exported from `@gpuix/react` (not on `Node`). |
| `getAttribute(name)`, `hasAttribute(name)` | Read props case-insensitively (`aria-*`, `data-*`, `id`, `for`, `hidden`); `class` and `style` return `null`. |
| Inputs | `value`, `selectionStart`, `selectionEnd`, `selectionDirection`, `setSelectionRange()`, `select()`, `checked`, `defaultChecked`, `indeterminate`, `valueAsNumber` (range only), `form`, `validity`, `validationMessage`, `setCustomValidity()`; see `elements.md`. |
| Forms | `requestSubmit()`, `reset()`, `checkValidity()`. |

Absent: see Traps. `instanceof HTMLElement` works only after `import "@gpuix/react/globals"`, and those constructors carry no members.

## `@gpuix/react/globals`

`import "@gpuix/react/globals"` installs each of these on `globalThis` only if the name is absent. The root `@gpuix/react` entry installs nothing. A real browser, jsdom or happy-dom wins, and then GPU-IX elements are invisible to that document.

| Global | What it is |
|---|---|
| `requestAnimationFrame`, `cancelAnimationFrame` | The native frame clock. |
| `window`, `self` | `globalThis`. |
| `scrollTo` | No-op. |
| `ResizeObserver` | Native-backed; observes refs; entries are plain objects delivered a frame after paint; types still claim DOM shapes (#650). |
| `Image` | Canvas image loader (`src`, `decode()`, `naturalWidth`, `naturalHeight`). |
| `Node`, `Element`, `HTMLElement`, `HTMLDivElement`, `HTMLButtonElement`, `HTMLInputElement`, `HTMLTextAreaElement` | `instanceof` only; empty prototypes; `new` throws; no `Node.*` constants. |
| `PointerEvent` | Constructor for `ref.dispatchEvent`. |
| `document` | The facade below. |
| `navigator.clipboard` | `readText()` / `writeText()` only; rejects with no mounted root. |
| `navigator.gpu` | The native WebGPU subset (macOS). |

The globals are typed as full DOM types although the objects are partial (#649). Under Bun, `navigator.userAgent` is `Bun/…`, so browser sniffing sees neither a browser nor Safari.

## The `document` facade

- `getElementById(id)`: first mounted element whose `id` prop matches.
- `body`: the root host element (the implicit wrapper when there are several top-level children).
- `activeElement`, `defaultView` (`window`).
- `addEventListener`/`removeEventListener` for `"pointerup"` and `"pointercancel"` with function listeners; `capture` is honoured. Passing `once` or `signal`, a listener object, or another event type registers nothing and warns once. A listener belongs to the current root and is dropped when it unmounts.
- Only the most recently mounted root is visible; there is one document for all windows.

## DOM APIs that UI libraries use

| API | Status |
|---|---|
| `document.addEventListener` for `pointerdown`, `mousedown`, `keydown`, `focusin`, `focusout`, `click`, `scroll`, `visibilitychange` | ignored with a warning |
| `document.createElement`, `createTextNode`, `createTreeWalker`, `querySelector(All)`, `getElementsBy*`, `documentElement`, `hasFocus`, `getSelection`, `dispatchEvent` | absent |
| `window.addEventListener` (resize, keydown, blur, focus) | registers, never fires |
| `window.innerWidth`/`innerHeight`/`devicePixelRatio`/`visualViewport` | absent; use `useWindowSize()` |
| `getComputedStyle`, `matchMedia`, `MutationObserver`, `IntersectionObserver`, `requestIdleCallback`, `DOMRect`, `CSS.supports`/`CSS.escape` | absent |
| `KeyboardEvent`, `MouseEvent`, `FocusEvent` constructors | absent |
| `ResizeObserver`, `requestAnimationFrame`, `PointerEvent`, `navigator.clipboard.readText`/`writeText` | present (via `globals`) |
| `HTMLAnchorElement`, `HTMLSelectElement`, `HTMLLabelElement`, `HTMLFormElement`, `SVGElement`, `ShadowRoot` | absent |
| ref `addEventListener`, `isConnected`, `closest`, `parentNode`, `children`, `setAttribute`, `dataset`, `classList`, `style`, `offset*`, `hasPointerCapture`, `getRootNode` | absent |
| ref `dispatchEvent`, `matches`, `scrollIntoView` | partial (see Refs) |
| ref `focus`, `blur`, `click`, `contains`, `compareDocumentPosition`, `parentElement`, `ownerDocument`, `getAttribute`, `getBoundingClientRect`, `scroll*`, `client*` | present |

## Third-party headless libraries

No headless UI library runs in the repository's test suite. The Base UI rows come from fixtures that copy Base UI 1.8.0's DOM calls, except where an issue records a real run.

| Library | Status |
|---|---|
| TanStack Router `Link`, `createLink` | Works (real package; needs `globals` for `window` and `scrollTo`). |
| Base UI Tabs, Checkbox, Switch, Radio clicks, ToggleGroup and Toolbar roving focus, Slider, NumberField, Collapsible/Accordion styles | Work in shaped fixtures. |
| Base UI RadioGroup and other `CompositeList` keyboard navigation | Fails: no `isConnected`, so the list is empty (#660). |
| Base UI Autocomplete | Typing does not update the value (#579). |
| Base UI Popover, Menu, Select, Tooltip, Dialog, Combobox; Floating UI; Radix; React Aria | Expected to fail (not run): they need `getComputedStyle`, `documentElement`, element listeners, document `pointerdown`/`keydown`/`focusin`, `MutationObserver`, portals into `document.body`, or blur `relatedTarget`. |

Use the built-ins instead (`components.md`): `@gpuix/react/select`, `/combobox`, `/tooltip`, `/floating`, and `<anchored>` for other overlays.

## Open issues

| Issue | Gap |
|---|---|
| #660 | Refs lack `isConnected`. |
| #649 | `globals` installs partial facades under full DOM types. |
| #650 | `ResizeObserver` types claim DOM targets and entries. |
| #652 | No shared object-ref type across React DOM and GPU-IX; callback refs are the adapter. |
| #619 | Implicit wrapper root for several top-level children. |
| #578 | No focus trap. |
| #536 | No `ariaModal`. |
