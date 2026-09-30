# Built-in components and hooks

GPU-IX ships its own headless Dialog, Select, Combobox and Tooltip (`packages/react/src/components/`), a shared floating layer (`packages/react/src/floating.ts`), file pickers (`dialogs.ts`), `motion`/`AnimatePresence` and a few hooks. The controls follow Base UI part names and behaviour where supported. Use these rather than relying on full DOM support from a third-party headless library; some Base UI components work in tested cases (`events-and-dom.md`).

Each component is importable two ways: as a namespace from its subpath (`import * as Select from "@gpuix/react/select"`, then `Select.Root`, `Select.Item`, `Select.ItemText`), or as prefixed names from `@gpuix/react` (`Select`, `SelectItem`, `SelectItemText`; likewise `Combobox*` and `Tooltip*`).

## Contents

- Traps
- Floating layer (`@gpuix/react/floating`)
- Dialog (`@gpuix/react/dialog`)
- Select (`@gpuix/react/select`)
- Combobox (`@gpuix/react/combobox`)
- Tooltip (`@gpuix/react/tooltip`)
- File pickers (`@gpuix/react/dialogs`)
- Hooks
- Open issues

## Traps

- **Style state through `style` functions, not `data-*` attributes.** No component sets `data-open`, `data-highlighted`, `data-selected` or `data-side`, and CSS modules cannot select attributes. These parts take `style={(state) => …}`:

  | Part | State passed to `className` and `style` functions |
  |---|---|
  | `SelectTrigger` | `{ disabled, touched, dirty, valid, filled, focused, open, readOnly, popupSide, value, placeholder }` |
  | `SelectIcon` | `{ open }` |
  | `SelectValue` | `{ value, placeholder }` |
  | `SelectPopup` | `{ side, align, open, transitionStatus }` |
  | `SelectList`, `SelectItemText`, `SelectGroup`, scroll arrows | `{}` |
  | `SelectItem`, `ComboboxItem` | `{ selected, highlighted, disabled }` (also accepted as a `children` function) |
  | `SelectItemIndicator` | `{ selected, transitionStatus }` |
  | `SelectLabel` | `{ disabled, touched, dirty, valid, filled, focused }` |
  | `SelectSeparator` | `{ orientation }` |

  `ComboboxTrigger`, `ComboboxInput` and the Tooltip parts take plain styles; track their state yourself with `open`/`onOpenChange`. `Select.Root` renders no wrapper element and does not accept `className` or `style`.

  ```tsx
  <SelectItem value="a" style={({ highlighted, selected }) => ({ backgroundColor: highlighted ? "#2c2c2c" : "#1a1a1a", color: selected ? "#fff" : "#bbb" })}>
    <SelectItemText>Alpha</SelectItemText>
  </SelectItem>
  ```

- **`asChild`, not `render`.** `Dialog.Trigger`, `Dialog.Close`, `SelectTrigger`, `ComboboxTrigger` and `TooltipTrigger` accept `asChild`. `SelectItem` and `ComboboxItem` always render their own `div`. The `asChild` child must be exactly one element that forwards its ref and host props.
- **Select Root renders no wrapper element.** Its Popup is positioned against the Trigger.
- **Select, Combobox and Tooltip popups have no Portal, cannot leave the window, and shift rather than flip.** They use deferred `<anchored fit="snap">` layers. Dialog provides `Portal` and `Backdrop`; it fills the viewport with `<anchored fill="window">`.
- **Give Popup an opaque background.** It defaults to `#1A1A1A` when neither `style` nor a compiled `className` sets a background. A background supplied by either wins; a translucent colour lets the page show through.
- **Combobox filtering and keyboard navigation need `items: string[]` on Root and a function child on `ComboboxList`.** Static `ComboboxItem` children are never filtered, and one is keyboard-highlighted only when its value is in `items` and passes the filter, and `ComboboxEmpty` shows whenever the filtered list is empty (always, without `items`). This is the opposite of Select, where `items` is optional.
- **A controlled Select cannot be cleared with `value={undefined}`**: `undefined` means uncontrolled, so it shows `defaultValue`, or the last value picked while it was uncontrolled. Values are `string` or `string[]`; there is no `null`. Remount with a new `key` to reset.
- **Select keyboard support is minimal**: typeahead, Up/Down, Ctrl+N/Ctrl+P, Enter, Space and Escape. Home/End and PageUp/PageDown are not handled.
- **Combobox and Tooltip set no ARIA roles**; add `role`, `ariaExpanded` and `ariaSelected` yourself. Select sets them.
- **Tooltip opens instantly by default** (`delayDuration` 0; Base UI waits 600 ms), and opens on any focus, not only keyboard focus. Its delays use `setTimeout` on wall time, so `advanceAsyncClock` in tests does not move them.
- **Combobox `autoHighlight` defaults to `false`**, so typing and pressing Enter selects nothing until an item is arrowed to. Pass `autoHighlight` for type-and-Enter.
- **There is no Popover or Menu primitive.** `@gpuix/react/dialogs` provides native file pickers. Dialog and AlertDialog are available from `@gpuix/react/dialog` and `/alert-dialog`.

## Dialog (`@gpuix/react/dialog`)

The parts follow Base UI 1.8.0: `Root`, `Trigger`, `Portal`, `Backdrop`,
`Viewport`, `Popup`, `Title`, `Description`, `Close`, and `Handle`. The package
root also exports `Dialog`, `DialogTrigger`, and the other prefixed parts.
`Root` takes `open`/`defaultOpen`, `onOpenChange(open, eventDetails)`,
`onOpenChangeComplete`, trigger IDs, actions and handles. `modal` accepts
`true`, `false`, or `"trap-focus"`. Parts support `render`, state-function
`className`/`style`, state attributes, and `data-*` props. `Popup` takes
`initialFocus` and `finalFocus` refs or callbacks; native host refs and numeric
host IDs are also accepted.

Modal Popups expose `aria-modal`, focus the Popup when opened, trap Tab and
Shift+Tab among painted descendants, and return focus to the Trigger or prior
focused element when closed. Both `true` and `"trap-focus"` trap focus; only
`true` blocks pointer interaction behind the overlay. Escape dismisses the
highest open Dialog, Select, Combobox, or Tooltip. `Dialog.Trigger`,
`Dialog.Close`, and the root `Button` activate with Enter and Space; they add no
default focus ring.

`Portal` mounts a full-window deferred layer with `<anchored fill="window">`.
Its `container` prop is accepted for Base UI source compatibility and does not
change the native portal target. All React children remain in the retained
tree; this is a native overlay component, not a general DOM portal.

## AlertDialog (`@gpuix/react/alert-dialog`)

AlertDialog has the same part tree and handle pattern as Dialog. Its Popup has
the `alertdialog` role, and Escape or Backdrop presses do not dismiss it. Add an
`AlertDialog.Close` action for an explicit response. The `AlertDialog` export
from `/dialog` is a deprecated alias.

## Floating layer (`@gpuix/react/floating`)

Exports `FloatingLayer`, `floatingRootStyle`, `mergeStyles`, `renderSlot`, `resolveStyle`, `setRefs`, and the types `FloatingPopupProps`, `FloatingSide`, `FloatingAlign`, `StateStyle`. Select, Combobox and Tooltip Popup parts are built on `FloatingLayer`.

| `FloatingPopupProps` | Default | Meaning |
|---|---|---|
| `side` | `"bottom"` | `top`, `right`, `bottom`, `left` |
| `align` | `"start"` | `start`, `center`, `end` |
| `sideOffset` | 0 | Gap from the anchor box. |
| `alignOffset` | 0 | Cross-axis offset. |
| `collisionPadding` | 8 | Margin kept from the window edge when snapping inside it. |

- The outer anchored surface takes only `visibility`, `opacity` and the border radii; everything else styles the inner content. Nested opacity is not multiplied.
- An open Popup blocks clicks on controls behind it; a closed one does not. `pointerEvents: "none"` turns that off.
- `renderSlot` (behind `asChild`) merges props onto its one child, composes event handlers rather than replacing them, shallow-merges `style`, and merges refs. It throws `asChild requires exactly one React element` otherwise.

## Select (`@gpuix/react/select`)

Parts (prefixed names; drop `Select` for the namespace form): `Select` (Root), `SelectTrigger`, `SelectValue`, `SelectIcon`, `SelectPopup`, `SelectList`, `SelectItem`, `SelectItemText`, `SelectItemIndicator`, `SelectGroup`, `SelectLabel` (a group label), `SelectSeparator`, `SelectScrollUpArrow`, `SelectScrollDownArrow` (both inert).

**Root props**: `value`/`defaultValue` (`string`, or `string[]` with `multiple`), `onValueChange(value)` (fires only on change), `open`/`defaultOpen`/`onOpenChange`, `multiple`, `disabled`, and `items?: { value, label?, textValue? }[]`. Root renders no host element.

- **`items` is optional.** Keyboard navigation and clicks use the mounted `SelectItem`s, which register even while closed (Popup stays mounted as `display: none`), in document order, including items wrapped in your own components. `SelectValue` shows the matching `items` entry's label (an entry with no `label` or `textValue` shows the raw value), else the registered item's `SelectItemText`, `textValue` or plain-text children, else the raw value. Pass `items` only when the closed label must be a rich node. Multiple values join with `", "`.
- **Behaviour**: opening highlights the selected item and focuses Popup; closing refocuses the Trigger; single mode closes on select, multiple mode toggles and stays open; a press outside closes (and the same press on the Trigger does not reopen); hovering highlights; disabled items are skipped; navigation wraps; Escape calls `onEscapeKeyDown` then closes.
- **ARIA**: Trigger `role="combobox"`, `ariaExpanded`, `ariaHasPopup="listbox"` and `ariaControls` pointing to its List; List `role="listbox"`; Item `role="option"`, `ariaSelected`.
- **Typeahead and scrolling**: Typing highlights a matching item and scrolls it into view. Scroll arrows appear only when the list can scroll further in their direction.
- **Missing from Base UI**: no field `Label`, `GroupLabel`, `Portal`, `Positioner`, `Arrow`, `Backdrop`; no `name`, `form`, `required`, `readOnly`, `modal`, `isItemEqualToValue`, `itemToStringLabel`, `alignItemWithTrigger`, flip or sticky positioning; string values only; `onValueChange` has no event details.

## Combobox (`@gpuix/react/combobox`)

Parts: `Root`, `Input`, `Trigger`, `Value`, `Popup`, `List`, `Item`, `Empty`, `Group`, `Label`, `Separator` (the last three are plain `div`s).

```tsx
import * as Combobox from "@gpuix/react/combobox"

<Combobox.Root items={frameworks}>
  <Combobox.Input placeholder="Framework" />
  <Combobox.Popup>
    <Combobox.Empty>No match</Combobox.Empty>
    <Combobox.List>{(item) => <Combobox.Item key={item} value={item}>{item}</Combobox.Item>}</Combobox.List>
  </Combobox.Popup>
</Combobox.Root>
```

- **Root props**: `items?: string[]`, `value`/`defaultValue` (`string | string[] | null`), `onValueChange`, `inputValue`/`defaultInputValue`/`onInputValueChange`, `open`/`defaultOpen`/`onOpenChange`, `multiple`, `disabled`, `autoHighlight`, `filter` (`null` disables; `(item, query, itemToString) => boolean`), `itemToStringValue` (display, filtering and the text written into the input after selection).
- **Default filter**: trimmed, case-insensitive substring; prefix matches first, then `items` order.
- **Input** is a native `<input>`; click, focus and typing each open the popup. Escape or moving focus away closes it; Up/Down and Ctrl+N/Ctrl+P move the highlight (wrapping, skipping disabled) but do not reopen after Escape; Enter selects the highlighted item, and does nothing with no highlight.
- **Selection**: single mode sets the value, writes it into the input and closes; multiple mode toggles, clears the input and stays open.
- **Popup** unmounts while closed; a press outside closes it; focus stays in the input.
- **Missing from Base UI**: `InputGroup`, `Icon`, `Clear`, `Chips`, `Chip`, `ItemIndicator`, `Status`, `Portal`, `Positioner`, `GroupLabel`, `Arrow`; `limit`, `virtualized`, `openOnInputClick`, `grid`, `inline`, `readOnly`, `required`, `name`; non-string items; ARIA.

## Tooltip (`@gpuix/react/tooltip`)

Parts: `Provider`, `Root`, `Trigger`, `Popup`.

| Part | Props | Behaviour |
|---|---|---|
| `Provider` | `delay` (0), `timeout` (300), `disableHoverableContent` | Within `timeout` of a close, the next tooltip opens without delay. |
| `Root` | `open`/`defaultOpen`/`onOpenChange`, `delayDuration`, `disableHoverablePopup` | Wrapper `div`. |
| `Trigger` | `asChild`; `tabIndex` 0 unless `asChild` | Hover schedules open; leave schedules close (80 ms when content is hoverable); press closes; focus opens immediately; blur closes; Escape closes while the trigger has focus. |
| `Popup` | `FloatingPopupProps` with `side="top"`, `align="center"` | Unmounts while closed; hovering it keeps it open unless `disableHoverablePopup`. |

Base UI names the provider's opening delay and sibling-tooltip timeout `delay` and `timeout`. It also has `closeDelay`, which GPU-IX's fixed 80 ms close timer does not expose. GPU-IX keeps `delayDuration` on Root, and `disableHoverableContent` on Provider, because those props do not have the same part boundary in Base UI.

## File pickers (`@gpuix/react/dialogs`)

| Function | Resolves | Options used |
|---|---|---|
| `showOpenFilePicker(opts)` | `string[]` of absolute paths | `multiple` |
| `showDirectoryPicker(opts)` | `string` | none |
| `showSaveFilePicker(opts)` | `string` | `suggestedName`, `startIn` (default home directory) |

They return paths, not `FileSystemHandle`s; `types` and `excludeAcceptAllOption` are ignored. Cancel rejects with an `AbortError`; with no mounted root they reject with `No GPUIX root is mounted`. The module imports `node:os`, so it is desktop-only. In tests, script results with `renderer.setNextPickerResult(paths | path | null)` before the call, or it throws.

## Hooks

All from `@gpuix/react`.

| Hook | Returns |
|---|---|
| `useGpuix()` | `{ renderer }`; `{ renderer: null }` outside a GPU-IX root. |
| `useGpuixRequired()` | The renderer; throws outside a root (its message names a `GpuixProvider`, which does not exist: `root.render` provides the context). Window controls (`activateWindow`, `minimizeWindow`, `zoomWindow`, `toggleFullscreen`), `scrollToItem`, `focusElement` and `getElementBounds` live on it. |
| `useWindowSize()` | `{ width, height, scaleFactor }` in logical px, updated on native resize. The replacement for `window.innerWidth` and media queries. |
| `useWindowInsets({ intervalMs })` | Safe-area and on-screen keyboard insets, polled (default every 100 ms). |
| `useTextSearch({ query, … })` | `{ props, total, active, next, previous, goTo }`; spread `props` on the searched container. |
| `findRanges({ text, query, … })` | UTF-16 `[start, end)` pairs matching the native matcher. |
| `usePresence()`, `useIsPresent()` | Exit state inside `AnimatePresence` (`styles.md`). |

## Open issues

| Issue | Gap |
|---|---|
| #579 | Base UI Autocomplete typing does not update the value. |
| #326 | Popups cannot leave the window. |
| #572 | No native message box. |
