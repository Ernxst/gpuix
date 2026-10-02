# Built-in components and hooks

GPU-IX ships its own headless Dialog, Select, Combobox and Tooltip (`packages/react/src/components/`), a shared floating layer (`packages/react/src/floating.ts`), file pickers (`dialogs.ts`), `motion`/`AnimatePresence` and a few hooks. The controls follow Base UI part names and behaviour where supported. Use these rather than relying on full DOM support from a third-party headless library; some Base UI components work in tested cases (`events-and-dom.md`).

Use the documented named namespace import for compound components: `import { Select } from "@gpuix/react/select"`, then `Select.Root`, `Select.Item`, and `Select.ItemText`. Select keeps the direct `<Select>` root and module-level part aliases for existing imports. The package root also exports prefixed names such as `Select`, `SelectItem`, and `SelectItemText` (likewise `Combobox*` and `Tooltip*`).

Each compound part exposes its `Props` and `State` types (for example,
`Select.Trigger.Props` and `Dialog.Popup.State`). Root parts also expose
`Actions`, `ChangeEventReason`, and `ChangeEventDetails` where Base UI does.
Event details use GPU-IX synthetic events instead of browser `Event` objects;
the native renderer has no DOM event object.

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

  Combobox and Tooltip parts accept state functions. `Select.Root` and
  `Combobox.Root` render no wrapper element; `Select.Root` does not accept
  `className` or `style`.

  ```tsx
  <SelectItem value="a" style={({ highlighted, selected }) => ({ backgroundColor: highlighted ? "#2c2c2c" : "#1a1a1a", color: selected ? "#fff" : "#bbb" })}>
    <SelectItemText>Alpha</SelectItemText>
  </SelectItem>
  ```

- **`render` customises parts.** It accepts an element or a function receiving host props and state. When given an element, GPU-IX combines its `className` before the part class, lets its inline styles take precedence, calls its event handlers before the part handlers, and retains both refs. Other controls that use `asChild` still require one child that forwards its ref and host props.
- **Select Root renders no wrapper element.** Its Popup is positioned against the Trigger.
- **Select, Combobox, and Tooltip provide `Portal`, `Positioner`, and `Arrow`.** Select and Combobox also provide `Backdrop`; their labels associate with their input/trigger. Use `GroupLabel` for item groups. All positioners use the shared `/floating` positioning contract.
- **Give Popup an opaque background.** It defaults to `#1A1A1A` when neither `style` nor a compiled `className` sets a background. A background supplied by either wins; a translucent colour lets the page show through.
- **Combobox filtering and keyboard navigation use the mounted items.** Pass `items` to Root and use either the `List` function child or `Collection` for grouped data. `createItems` maps generic source objects to primitive selection values and labels. `filteredItems` supports externally filtered lists; `useFilter` provides locale-aware contains/startsWith/endsWith matching, and `useFilteredItems` reads the current results inside Root. `items` is optional when composing explicit Item children.
- **A controlled Select cannot be cleared with `value={undefined}`**: `undefined` means uncontrolled. Use `value={null}` to clear single-select mode. Values can be generic objects or primitives, and multiple mode uses arrays.
- **Select keyboard support is minimal**: typeahead, Up/Down, Ctrl+N/Ctrl+P, Enter, Space and Escape. Home/End and PageUp/PageDown are not handled.
- **Combobox sets its listbox semantics.** Input has the combobox role and expanded, controls, active-descendant, and autocomplete state; List and Item expose listbox/option roles and selected/disabled state. State is also available to `className` and `style` functions.
- **Tooltip timers use wall time.** `advanceAsyncClock` in tests does not move Provider or Trigger delay timers.
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
Its `container` prop is accepted for Base UI source compatibility and is a
no-op in the native renderer. All React children remain in the retained tree;
this is a native overlay component, not a general DOM portal. Popup and
Viewport expose `transitionStatus` and the `data-starting-style`/
`data-ending-style` attributes through the native opening or closing frame.

## AlertDialog (`@gpuix/react/alert-dialog`)

AlertDialog has the same part tree and handle pattern as Dialog. Its Popup has
the `alertdialog` role, and Escape or Backdrop presses do not dismiss it. Add an
`AlertDialog.Close` action for an explicit response. The `AlertDialog` export
from `/dialog` is a deprecated alias.

## Floating layer (`@gpuix/react/floating`)

Exports `FloatingLayer`, `FloatingPositioner`, `floatingRootStyle`, `mergeStyles`, `renderSlot`, `resolveStyle`, `setRefs`, and the shared `PositionerProps` and positioning types. Select uses `FloatingPositioner`; Combobox and Tooltip can reuse the component-agnostic contract.

`PositionerProps` is shared by Select, Combobox, and Tooltip. It accepts `anchor`, `side` (including `inline-start`/`inline-end`), numeric or callback `sideOffset` and `alignOffset`, `align`, `collisionBoundary`, numeric or per-edge `collisionPadding`, and `collisionAvoidance`. Padding defaults to five pixels on every edge; a per-edge object uses zero for omitted edges. Collision handling uses that padded boundary to choose flips and shifts, and `anchorHidden` reports an anchor outside the effective boundary. `collisionBoundary="clipping-ancestors"` means the native window viewport. GPU-IX also accepts an explicit `position` on its Positioner, which Base UI does not expose.

The Positioner accepts `positionMethod`, `sticky`, `arrowPadding`, and `disableAnchorTracking` for Base UI type compatibility, but the native renderer does not implement those behaviours. Logical sides map to left/right without text-direction resolution, and `collisionAvoidance.fallbackAxisSide` has no native effect. Select's `alignItemWithTrigger` is a Popup prop and has no native effect.

- The outer anchored surface takes only `visibility`, `opacity` and the border radii; everything else styles the inner content. Nested opacity is not multiplied.
- An open Popup blocks clicks on controls behind it; a closed one does not. `pointerEvents: "none"` turns that off.
- `renderSlot` (behind `asChild`) merges props onto its one child, combines `className`, composes event handlers, shallow-merges `style`, and merges refs. It throws `asChild requires exactly one React element` otherwise.

## Select (`@gpuix/react/select`)

The namespace follows Base UI 1.8.0: `Root`, `Label`, `Trigger`, `Value`, `Icon`, `Portal`, `Backdrop`, `Positioner`, `Popup`, `List`, `Item`, `ItemIndicator`, `ItemText`, `Arrow`, `ScrollUpArrow`, `ScrollDownArrow`, `Group`, `GroupLabel`, and `Separator`. Prefixed `Select*` exports are also available. `Label` labels the field; `GroupLabel` labels an item group.

**Root props**: Base UI's generic `value`/`defaultValue` (nullable in single-select mode), `onValueChange(value, eventDetails)`, `open`/`defaultOpen`/`onOpenChange`, `multiple`, `disabled`, `readOnly`, `required`, `name`, `form`, `autoComplete`, `modal`, comparison/stringification callbacks, and optional item-label lookup data. Root renders no host element.

- **`items` is optional.** Keyboard navigation and clicks use the mounted `SelectItem`s, which register even while closed (Popup stays mounted as `display: none`), in document order, including items wrapped in your own components. `SelectValue` shows the matching `items` entry's label (an entry with no `label` or `textValue` shows the raw value), else the registered item's `SelectItemText`, `textValue` or plain-text children, else the raw value. Pass `items` only when the closed label must be a rich node. Multiple values join with `", "`.
- **Item function children** receive `{ selected, highlighted, disabled }` in both closed and open states. `ItemText` accepts the same function child and renders it with that item state. Its closed label and typeahead text come from the call with `selected` and `highlighted` false; the Item `label` and `textValue` props override that label.
- **Behaviour**: opening highlights the selected item and focuses Popup; closing refocuses the Trigger; single mode closes on select, multiple mode toggles and stays open; a press outside closes (and the same press on the Trigger does not reopen); hovering highlights; disabled items are skipped; navigation wraps; Escape calls `onEscapeKeyDown` then closes.
- **ARIA**: Trigger `role="combobox"`, `ariaExpanded`, `ariaHasPopup="listbox"` and `ariaControls` pointing to its List; List `role="listbox"`; Item `role="option"`, `ariaSelected`.
- **Typeahead and scrolling**: Typing highlights a matching item and scrolls it into view. Scroll arrows appear only when the list can scroll further in their direction.
- Positioner state exposes `open`, resolved `side`/`align`, and `anchorHidden`; its `className` and `style` callbacks receive that state. Positioning options share the component-agnostic `PositionerProps` contract from `@gpuix/react/floating`.
- Native positioning uses the trigger/anchor, `position`, side and alignment offsets, window collision correction, custom `collisionBoundary` rectangles/elements (arrays use their intersection), asymmetric `collisionPadding`, and side/alignment flip or shift. The five-pixel default and per-edge values set the flip boundary and shift inset. `anchorHidden` reports anchors outside that boundary. `collisionBoundary="clipping-ancestors"` means the native window viewport.
- These Base UI options are accepted but have no native effect: `positionMethod`, `sticky`, `arrowPadding`, `disableAnchorTracking`, `alignItemWithTrigger`, `collisionAvoidance.fallbackAxisSide`, `inline-start`/`inline-end` direction resolution (they map to left/right), Root `modal` and `actionsRef`, Root form props (`name`, `form`, `required`, `autoComplete`, `inputRef`), and Root `itemToStringLabel`/`itemToStringValue`. GPU-IX events in `eventDetails.event` are the originating GPU-IX event; programmatic changes have `undefined` there. `details.cancel()` prevents the corresponding state update.

## Combobox (`@gpuix/react/combobox`)

Parts: `Root`, `Label`, `Value`, `Input`, `InputGroup`, `Trigger`, `List`, `Status`, `Portal`, `Backdrop`, `Positioner`, `Popup`, `Arrow`, `Icon`, `Group`, `GroupLabel`, `Item`, `ItemIndicator`, `Chips`, `Chip`, `ChipRemove`, `Row`, `Collection`, `Empty`, `Clear`, `Separator`, plus `useFilter`, `useFilteredItems`, and `createItems`.

```tsx
import { Combobox } from "@gpuix/react/combobox"

<Combobox.Root items={frameworks}>
  <Combobox.Input placeholder="Framework" />
  <Combobox.Positioner>
    <Combobox.Popup>
      <Combobox.Empty>No match</Combobox.Empty>
      <Combobox.List>{(item) => <Combobox.Item key={item} value={item}>{item}</Combobox.Item>}</Combobox.List>
    </Combobox.Popup>
  </Combobox.Positioner>
</Combobox.Root>
```

- **Root props**: generic `items` (flat, grouped or `createItems` collection), `filteredItems`, controlled/uncontrolled `value`, `inputValue`, and `open`, `onValueChange`, `onInputValueChange`, `onOpenChange`, `onItemHighlighted`, multiple selection, disabled/read-only/required, `autoHighlight`, `autoComplete`, `locale`, `filter`, `limit`, and item value/label/equality accessors. Root renders no host element.
- **Default filter**: trimmed, locale-aware substring; prefix matches first, then `items` order. Root `autoComplete` sets the browser's form autofill hint; the input uses `aria-autocomplete="list"` by default and `"none"` while read-only.
- **Input** is a native `<input>`; it associates with Label and exposes combobox/listbox ARIA state. Click, focus and typing open the popup by default. Escape or moving focus away closes it; Up/Down and Ctrl+N/Ctrl+P move the highlight (wrapping, skipping disabled); Enter selects the highlighted item.
- **Selection**: single mode sets the value, writes it into the input and closes; multiple mode toggles, clears the input and stays open.
- **Popup** unmounts while closed; a press outside closes it; focus stays in the input.
- **State and styling**: parts accept `className` and `style` functions. Input, Trigger, Positioner, Popup, List and Item expose state via callbacks; interactive parts set their corresponding ARIA and `data-*` attributes. `Portal` is a render-through part in the native renderer; floating content is placed by the shared Positioner.

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
| `Trigger` | `delay`, `closeDelay`, `closeOnClick`, `disabled`, `handle`, `payload`, `render` | Hover schedules open; focus opens immediately; leaving a focus-opened trigger closes immediately wherever focus moves; hover closure follows `closeDelay`; Escape closes. Focusing another trigger in the same Provider replaces the tooltip opened by the previous trigger. `disabled` suppresses tooltip interaction without disabling the rendered control. Multiple triggers retain their own anchors and payloads. |
| `Portal` | `container`, `keepMounted`, `render` | Keeps children in the retained tree; native positioning happens in Positioner. |
| `Positioner` | Shared `PositionerProps` from `/floating`; default `side="top"` | Uses `FloatingPositioner` to follow the active rendered trigger and place the popup on the requested side with collision handling. |
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
| `useGpuixRequired()` | The renderer; throws outside a root (its message names a `GpuixProvider`, which does not exist: `root.render` provides the context). Window controls (`activateWindow`, `minimizeWindow`, `zoomWindow`, `toggleFullscreen`, `setWindowTitle`), `scrollToItem`, `focusElement` and `getElementBounds` live on it. |
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
