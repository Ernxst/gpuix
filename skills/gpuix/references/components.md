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

- **Select exposes state through callbacks and `data-*` attributes.** Use state `className`/`style` functions or selectors on the emitted attributes:

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
  | `SelectPositioner` | `{ open, side, align, anchorHidden }` |
  | `SelectSeparator` | `{ orientation }` |

  `ComboboxTrigger` and `ComboboxInput` take plain styles; `Tooltip` parts expose state through Base UI-style state callbacks and attributes. `Select.Root` renders no wrapper element and does not accept `className` or `style`.

  ```tsx
  <SelectItem value="a" style={({ highlighted, selected }) => ({ backgroundColor: highlighted ? "#2c2c2c" : "#1a1a1a", color: selected ? "#fff" : "#bbb" })}>
    <SelectItemText>Alpha</SelectItemText>
  </SelectItem>
  ```

- **`render` customises Select parts.** It accepts an element or a function receiving host props and state. Other controls that use `asChild` still require one child that forwards its ref and host props.
- **Select Root renders no wrapper element.** Its Popup is positioned against the Trigger.
- **Select and Tooltip provide `Portal`, `Positioner`, and `Arrow`.** Select also provides `Backdrop`; its `Label` labels the field, while `GroupLabel` labels an item group.
- **Give Popup an opaque background.** It defaults to `#1A1A1A` when neither `style` nor a compiled `className` sets a background. A background supplied by either wins; a translucent colour lets the page show through.
- **Combobox filtering and keyboard navigation need `items: string[]` on Root and a function child on `ComboboxList`.** Static `ComboboxItem` children are never filtered, and one is keyboard-highlighted only when its value is in `items` and passes the filter, and `ComboboxEmpty` shows whenever the filtered list is empty (always, without `items`). This is the opposite of Select, where `items` is optional.
- **A controlled Select cannot be cleared with `value={undefined}`**: `undefined` means uncontrolled. Use `value={null}` to clear single-select mode. Values can be generic objects or primitives, and multiple mode uses arrays.
- **Select keyboard support is minimal**: typeahead, Up/Down, Ctrl+N/Ctrl+P, Enter, Space and Escape. Home/End and PageUp/PageDown are not handled.
- **Combobox and Tooltip set no ARIA roles**; add `role`, `ariaExpanded` and `ariaSelected` yourself. Select sets them.
- **Tooltip timers use wall time.** `advanceAsyncClock` in tests does not move Provider or Trigger delay timers.
- **Combobox `autoHighlight` defaults to `false`**, so typing and pressing Enter selects nothing until an item is arrowed to. Pass `autoHighlight` for type-and-Enter.
- **There is no Popover, Menu or message box.** `@gpuix/react/dialogs` is file pickers only (#572 for a message box). Dialog is available from `@gpuix/react/dialog`; it handles modal Tab focus, Escape dismissal, focus restoration and `aria-modal` in AccessKit.

## Dialog (`@gpuix/react/dialog`)

The parts follow Base UI names: `Root`, `Trigger`, `Portal`, `Backdrop`,
`Popup`, `Title`, `Description`, and `Close`. The package root also exports
`Dialog`, `DialogTrigger`, and the other prefixed parts. `Root` takes
`open`/`defaultOpen`, `onOpenChange`, and `modal` (default `true`). `Popup` takes
`initialFocus` and `finalFocus`, each a host ref, numeric host element ID, or
`false` to skip that focus move.

Modal Popups expose `aria-modal`, focus the Popup when opened, trap Tab and
Shift+Tab among painted descendants, and return focus to the Trigger or prior
focused element when closed. Escape dismisses the highest open Dialog, Select,
Combobox, or Tooltip. GPU-IX does not currently export a Popover primitive.
`AlertDialog` shares the Dialog parts and renders its Popup with the
`alertdialog` role. `Dialog.Trigger`, `Dialog.Close`, and the
root `Button` export activate with Enter and Space; they add no default focus
ring.

The API follows the `@base-ui/react` Dialog shape but is not a full Base UI API
match. Compared with Base UI 1.8.0, GPU-IX does not provide
`Dialog.Viewport`, `onOpenChangeComplete`, `triggerId`, `actionsRef`, or a
`Dialog.Root` render-function child. `modal` accepts only a boolean, so
`'trap-focus'` is not available. `initialFocus` and `finalFocus` accept refs,
numeric host IDs, or `false`; they do not accept `true` or callbacks. GPU-IX's
`Portal` fills the window, so it does not need a separate `Viewport` part.

`Portal` mounts a full-window deferred layer with `<anchored fill="window">`.
All React children remain in the retained tree; this is a native overlay
component, not a general DOM portal.

## Floating layer (`@gpuix/react/floating`)

Exports `FloatingLayer`, `FloatingPositioner`, `floatingRootStyle`, `mergeStyles`, `renderSlot`, `resolveStyle`, `setRefs`, and the shared `PositionerProps` and positioning types. Select uses `FloatingPositioner`; Combobox and Tooltip can reuse the component-agnostic contract.

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

The namespace follows Base UI 1.8.0: `Root`, `Label`, `Trigger`, `Value`, `Icon`, `Portal`, `Backdrop`, `Positioner`, `Popup`, `List`, `Item`, `ItemIndicator`, `ItemText`, `Arrow`, `ScrollUpArrow`, `ScrollDownArrow`, `Group`, `GroupLabel`, and `Separator`. Prefixed `Select*` exports are also available. `Label` labels the field; `GroupLabel` labels an item group.

**Root props**: Base UI's generic `value`/`defaultValue` (nullable in single-select mode), `onValueChange(value, eventDetails)`, `open`/`defaultOpen`/`onOpenChange`, `multiple`, `disabled`, `readOnly`, `required`, `name`, `form`, `autoComplete`, `modal`, comparison/stringification callbacks, and optional item-label lookup data. Root renders no host element.

- **`items` is optional.** Keyboard navigation and clicks use the mounted `SelectItem`s, which register even while closed (Popup stays mounted as `display: none`), in document order, including items wrapped in your own components. `SelectValue` shows the matching `items` entry's label (an entry with no `label` or `textValue` shows the raw value), else the registered item's `SelectItemText`, `textValue` or plain-text children, else the raw value. Pass `items` only when the closed label must be a rich node. Multiple values join with `", "`.
- **Behaviour**: opening highlights the selected item and focuses Popup; closing refocuses the Trigger; single mode closes on select, multiple mode toggles and stays open; a press outside closes (and the same press on the Trigger does not reopen); hovering highlights; disabled items are skipped; navigation wraps; Escape calls `onEscapeKeyDown` then closes.
- **ARIA**: Trigger `role="combobox"`, `ariaExpanded`, `ariaHasPopup="listbox"` and `ariaControls` pointing to its List; List `role="listbox"`; Item `role="option"`, `ariaSelected`.
- **Typeahead and scrolling**: Typing highlights a matching item and scrolls it into view. Scroll arrows appear only when the list can scroll further in their direction.
- Positioner state exposes `open`, resolved `side`/`align`, and `anchorHidden`; its `className` and `style` callbacks receive that state. Positioning options share the component-agnostic `PositionerProps` contract from `@gpuix/react/floating`.
- Native positioning uses the trigger/anchor, `position`, side and alignment offsets, window collision correction, custom `collisionBoundary` rectangles/elements (arrays use their intersection), asymmetric `collisionPadding`, and side/alignment flip or shift. `anchorHidden` reports anchors outside that boundary. `collisionBoundary="clipping-ancestors"` means the native window viewport.
- These Base UI options are accepted but have no native effect: `positionMethod`, `sticky`, `arrowPadding`, `disableAnchorTracking`, `alignItemWithTrigger`, `collisionAvoidance.fallbackAxisSide`, `inline-start`/`inline-end` direction resolution (they map to left/right), Root `modal` and `actionsRef`, Root form props (`name`, `form`, `required`, `autoComplete`, `inputRef`), and Root `itemToStringLabel`/`itemToStringValue`. GPU-IX events in `eventDetails.event` are the originating GPU-IX event; programmatic changes have `undefined` there. `details.cancel()` prevents the corresponding state update.

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

`Tooltip` exposes the Base UI part namespace: `Provider`, `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`, `Arrow`, `Viewport`, and `Handle`/`createHandle`. The package root also exports prefixed parts such as `TooltipRoot` and `TooltipPositioner`.

```tsx
import { Tooltip } from "@gpuix/react/tooltip"

<Tooltip.Provider delay={600} closeDelay={80} timeout={400}>
  <Tooltip.Root onOpenChange={(open, details) => console.log(open, details.reason)}>
    <Tooltip.Trigger>Copy</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" sideOffset={6}>
        <Tooltip.Popup><Tooltip.Arrow />Copy message</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
```

| Part | Props | Behaviour |
|---|---|---|
| `Provider` | `delay` (600), `closeDelay` (0), `timeout` (400) | Within `timeout` of a close, the next tooltip opens without delay. |
| `Root` | `open`/`defaultOpen`, `onOpenChange(open, details)`, `onOpenChangeComplete`, `disabled`, `disableHoverablePopup`, `trackCursorAxis`, `actionsRef`, `handle`, `triggerId`, `defaultTriggerId` | Renders no host element. `details` carries the reason, originating GPU-IX event, trigger, and `preventUnmountOnClose()`. |
| `Trigger` | `delay`, `closeDelay`, `closeOnClick`, `disabled`, `handle`, `payload`, `render` | Hover schedules open; focus opens immediately; Escape closes; state styling receives `{ open }`. `disabled` suppresses tooltip interaction without disabling the rendered control. Multiple triggers retain their own anchors and payloads. |
| `Portal` | `container`, `keepMounted`, `render` | Keeps children in the retained tree; native positioning happens in Positioner. |
| `Positioner` | Shared `PositionerProps` from `/floating`; default `side="top"` | Uses `FloatingPositioner` for anchor measurement and collision handling. |
| `Popup` | `render`, state-based `className` and `style` | Unmounts while closed unless `preventUnmountOnClose()` was called; exposes open/closed, side, align, instant and transition state. |
| `Arrow` | `render`, state-based `className` and `style` | Exposes open/closed, side, align, instant and `uncentered` state. |
| `Viewport` | `render`, state-based `className` and `style` | Provides the Base UI state shape for optional content transitions. |

The Trigger, Positioner, Popup and Arrow emit Base UI open/closed and placement attributes where those parts expose them. Disabling Root closes an open tooltip and prevents future opens. Native Portal `container` and `keepMounted` are accepted but do not change the retained tree. `trackCursorAxis` is accepted but has no native cursor-tracking effect. Popup transitions and Arrow centring are not measured, so their transition status stays idle and `uncentered` stays false. `disableHoverableContent` remains as a deprecated Provider alias for older GPU-IX callers.

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
