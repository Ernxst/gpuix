/** Headless shadcn-shaped Select components rendered with GPUIX host elements. */

import React, {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useId,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
import {
  DOCUMENT_POSITION_FOLLOWING,
  DOCUMENT_POSITION_PRECEDING,
} from "../dom-position.js"
import type {
  GpuixKeyboardEvent,
  GpuixMouseEvent,
  GpuixScrollEvent,
} from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import {
  FloatingLayer,
  renderSlot,
  setRefs,
  useControllableState,
} from "./floating.js"
import type { FloatingPopupProps, StateStyle } from "./floating.js"

export interface SelectItemData {
  value: string
  label?: ReactNode
  textValue?: string
}

interface SelectItemRecord {
  value: string
  label: ReactNode
  textValue: string
  disabled: boolean
  /** Null only until the item's ref attaches, which happens in the same commit. */
  instance: PublicInstance | null
}

interface SelectContextValue {
  open: boolean
  value: SelectSelection | undefined
  multiple: boolean
  disabled: boolean
  readOnly: boolean
  focused: boolean
  labels: Map<string, ReactNode>
  activeValue: string | null
  listId: string
  popupPosition: { x: number; y: number } | undefined
  canScrollUp: boolean
  canScrollDown: boolean
  triggerPressedWhileOpen: React.MutableRefObject<boolean>
  dismissedByOutsidePress: React.MutableRefObject<boolean>
  triggerRef: React.MutableRefObject<PublicInstance | null>
  setOpen: (open: boolean) => void
  setActiveValue: (value: string | null) => void
  setListId: (id: string) => void
  setScrollability: (up: boolean, down: boolean) => void
  setFocused: (focused: boolean) => void
  typeahead: (character: string) => void
  moveActive: (delta: number) => void
  selectValue: (value: string) => void
  items: SelectItemRecord[]
  registerItem: (item: SelectItemRecord) => void
  unregisterItem: (value: string) => void
}

export type SelectSelection = string | string[]

export type SelectValueFor<Multiple extends boolean | undefined> = Multiple extends true
  ? string[]
  : Multiple extends false | undefined
    ? string
    : SelectSelection

const SelectContext = createContext<SelectContextValue | null>(null)
interface SelectItemContextValue {
  value: string
  setText: (text: { label: string; textValue: string } | null) => void
}

const SelectItemContext = createContext<SelectItemContextValue | null>(null)

function useSelectContext(name: string): SelectContextValue {
  const context = useContext(SelectContext)
  if (!context) throw new Error(`${name} must be used inside Select`)
  return context
}

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child)
      if (!isValidElement<{ children?: ReactNode }>(child)) return ""
      return textContent(child.props.children)
    })
    .join("")
}

/**
 * Orders two item records by document position once both have registered an
 * instance. Before that (the item's ref has not attached yet this commit),
 * falls back to `registrationIndex` for *both* records rather than treating
 * the pair as equal: a bare `return 0` there would make the comparator
 * inconsistent between calls - the same pair could sort either way depending
 * on what else `Array#sort` happens to compare it against - while indexing
 * off one shared, stable key keeps every such pair on one consistent order.
 */
function compareItemRecords(
  a: SelectItemRecord,
  b: SelectItemRecord,
  registrationIndex: (value: string) => number
): number {
  if (a.instance && b.instance) {
    const position = a.instance.compareDocumentPosition(b.instance)
    if (position & DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  }
  return registrationIndex(a.value) - registrationIndex(b.value)
}

export interface SelectProps<Multiple extends boolean | undefined = false>
  extends Omit<Props, "children" | "onChange" | "className" | "style"> {
  children?: ReactNode
  items?: readonly SelectItemData[]
  value?: SelectValueFor<Multiple>
  defaultValue?: SelectValueFor<Multiple>
  onValueChange?: (value: SelectValueFor<Multiple>) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  multiple?: Multiple
  disabled?: boolean
  readOnly?: boolean
}

function isValueSelected(value: SelectSelection | undefined, multiple: boolean, item: string): boolean {
  return multiple ? Array.isArray(value) && value.includes(item) : value === item
}

export function Select<Multiple extends boolean | undefined = false>({
  children,
  items: itemsProp,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  multiple = false as Multiple,
  disabled = false,
  readOnly = false,
}: SelectProps<Multiple>): ReactElement {
  const { renderer } = useGpuix()
  const [value, setValue] = useControllableState<SelectSelection | undefined>({
    value: valueProp,
    defaultValue,
    onChange: (nextValue) => {
      if (nextValue !== undefined) {
        onValueChange?.(nextValue as SelectValueFor<Multiple>)
      }
    },
  })
  const [open, setOpenState] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const [activeValue, setActiveValue] = useState<string | null>(null)
  const generatedListId = useId()
  const [listId, setListId] = useState(generatedListId)
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number }>()
  const [scrollability, setScrollability] = useState({ up: false, down: false })
  const [focused, setFocused] = useState(false)
  const typeaheadBuffer = useRef("")
  const typeaheadTime = useRef(0)
  const triggerPressedWhileOpen = useRef(false)
  const dismissedByOutsidePress = useRef(false)
  const triggerRef = useRef<PublicInstance | null>(null)
  // SelectItem registers itself here (instead of Select walking the element
  // tree), so an item wrapped in a user component is still discovered.
  // SelectPopup keeps its children mounted even while closed - like Radix's
  // detached collection - painting nothing until open, so an item registers
  // at mount time regardless of open state and Value can resolve a label
  // before the Select has ever opened. SelectItem always carries a host node
  // (an inert marker while closed), so every record's instance has a document
  // position once its own layout effect below has run.
  const itemRegistry = useRef<Map<string, SelectItemRecord>>(new Map())
  const itemOrder = useRef<string[]>([])
  const [items, setItems] = useState<SelectItemRecord[]>([])

  const registerItem = (item: SelectItemRecord) => {
    if (!itemRegistry.current.has(item.value)) itemOrder.current.push(item.value)
    itemRegistry.current.set(item.value, item)
  }

  const unregisterItem = (value: string) => {
    itemRegistry.current.delete(value)
    itemOrder.current = itemOrder.current.filter((candidate) => candidate !== value)
  }

  // Re-derive item order once per commit, rather than once per registration:
  // React runs child layout effects before the parent's, so by the time this
  // one runs every SelectItem below has already registered or unregistered
  // for the commit just made, and this reads that settled registry instead
  // of resorting after each individual item. The functional `setItems`
  // update bails when nothing actually changed - same length, same records
  // at the same indices - so a commit that touched something else in Select
  // (`open`, `activeValue`, ...) re-renders once here, not once per item.
  useLayoutEffect(() => {
    const registrationIndex = (value: string): number => itemOrder.current.indexOf(value)
    const sorted = itemOrder.current
      .map((itemValue) => itemRegistry.current.get(itemValue))
      .filter((item): item is SelectItemRecord => item !== undefined)
      .sort((a, b) => compareItemRecords(a, b, registrationIndex))

    setItems((current) => {
      const unchanged =
        current.length === sorted.length &&
        current.every((item, index) => item === sorted[index])
      return unchanged ? current : sorted
    })
  })
  useLayoutEffect(() => {
    if (!open || activeValue !== null) return
    const selected = items.find(
      (item) => isValueSelected(value, multiple === true, item.value) && !item.disabled
    )
    if (selected) setActiveValue(selected.value)
  }, [open, value, items, activeValue])
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopupPosition({ x: rect.x, y: rect.y + rect.height })
  }, [open])
  const labels = useMemo(() => {
    const next = new Map<string, ReactNode>()
    for (const item of itemsProp ?? []) {
      next.set(item.value, item.label ?? item.textValue ?? item.value)
    }
    return next
  }, [itemsProp])

  const setOpen = (nextOpen: boolean) => {
    setOpenState(nextOpen)
    if (nextOpen) {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPopupPosition({ x: rect.x, y: rect.y + rect.height })
      const selected = items.find(
        (item) => isValueSelected(value, multiple === true, item.value) && !item.disabled
      )
      setActiveValue(selected?.value ?? null)
    } else if (triggerRef.current) {
      renderer?.focusElement?.(triggerRef.current.id)
    }
  }

  const typeahead = (character: string) => {
    if (disabled || readOnly || !character || character.length !== 1) return
    const now = Date.now()
    const lower = character.toLocaleLowerCase()
    const prefix = now - typeaheadTime.current < 1000 ? typeaheadBuffer.current + lower : lower
    typeaheadTime.current = now
    typeaheadBuffer.current = prefix
    const enabled = items.filter((item) => !item.disabled)
    const currentIndex = enabled.findIndex((item) => item.value === activeValue)
    const ordered = currentIndex < 0
      ? enabled
      : [...enabled.slice(currentIndex + 1), ...enabled.slice(0, currentIndex + 1)]
    const match = ordered.find((item) => item.textValue.trim().toLocaleLowerCase().startsWith(prefix))
      ?? (prefix.length > 1
        ? ordered.find((item) => item.textValue.trim().toLocaleLowerCase().startsWith(lower))
        : undefined)
    if (!match) return
    if (open) setActiveValue(match.value)
    else if (!multiple) selectValue(match.value)
  }

  const moveActive = (delta: number) => {
    if (disabled) return
    const enabled = items.filter((item) => !item.disabled)
    if (enabled.length === 0) return
    const currentIndex = enabled.findIndex((item) => item.value === activeValue)
    const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex
    const nextIndex = (start + delta + enabled.length) % enabled.length
    setActiveValue(enabled[nextIndex].value)
  }

  const selectValue = (nextValue: string) => {
    if (disabled) return
    const item = items.find((candidate) => candidate.value === nextValue)
    if (!item || item.disabled) return
    if (multiple) {
      const selected = Array.isArray(value) ? value : []
      setValue(
        selected.includes(nextValue)
          ? selected.filter((candidate) => candidate !== nextValue)
          : [...selected, nextValue]
      )
      return
    }
    setValue(nextValue)
    setOpen(false)
  }

  const context = useMemo<SelectContextValue>(
    () => ({
      open,
      value,
      multiple: multiple === true,
      disabled,
      readOnly,
      focused,
      items,
      labels,
      activeValue,
      listId,
      popupPosition,
      canScrollUp: scrollability.up,
      canScrollDown: scrollability.down,
      triggerPressedWhileOpen,
      dismissedByOutsidePress,
      triggerRef,
      setOpen,
      setActiveValue,
      setListId,
      setScrollability: (up, down) => setScrollability({ up, down }),
      setFocused,
      typeahead,
      moveActive,
      selectValue,
      registerItem,
      unregisterItem,
    }),
    [open, value, multiple, disabled, readOnly, focused, items, labels, activeValue, listId, popupPosition, scrollability]
  )

  return (
    <SelectContext.Provider value={context}>
      {children}
    </SelectContext.Provider>
  )
}

export interface SelectTriggerState {
  open: boolean
  disabled: boolean
  placeholder: boolean
  readOnly: boolean
  popupSide: string
  value: SelectSelection | undefined
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
}

type SelectPartProps<State, Excluded extends keyof Props = never> = Omit<Props, "style" | "className" | Excluded> & {
  className?: string | ((state: State) => string | undefined)
  style?: StateStyle<State> | ((state: State) => StyleDesc | undefined)
}

function resolveClassName<State>(
  className: SelectPartProps<State>["className"],
  state: State
): string | undefined {
  return typeof className === "function" ? className(state) : className
}

function resolvePartStyle<State>(
  style: SelectPartProps<State>["style"],
  state: State
): StyleDesc | undefined {
  return typeof style === "function" ? style(state) : style
}

export interface SelectTriggerProps extends SelectPartProps<SelectTriggerState> {
  asChild?: boolean
  disabled?: boolean
}

export const SelectTrigger = forwardRef<PublicInstance, SelectTriggerProps>(
  function SelectTrigger(
    { asChild, disabled: disabledProp, style, className, children, onMouseDown, onClick, onKeyDown, onFocus, onBlur, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectTrigger")
    const disabled = disabledProp ?? context.disabled
    const state = {
      open: context.open,
      disabled,
      placeholder: context.multiple
        ? !Array.isArray(context.value) || context.value.length === 0
        : context.value === undefined,
      readOnly: context.readOnly,
      popupSide: "bottom",
      value: context.value,
      touched: false,
      dirty: context.value !== undefined,
      valid: null,
      filled: context.value !== undefined && context.value !== "",
      focused: context.focused,
    }
    const ref = (value: PublicInstance | null) => {
      context.triggerRef.current = value
      setRefs(value, forwardedRef)
    }
    const triggerProps: Props = {
      ...props,
      role: props.role ?? "combobox",
      ariaExpanded: context.open,
      ariaHasPopup: "listbox",
      ariaControls: context.listId,
      tabIndex: disabled ? -1 : (asChild ? props.tabIndex : (props.tabIndex ?? 0)),
      style: resolvePartStyle(style, state),
      className: resolveClassName(className, state),
      onFocus: (event) => { onFocus?.(event); context.setFocused(true) },
      onBlur: (event) => { onBlur?.(event); context.setFocused(false) },
      onMouseDown: (event) => {
        onMouseDown?.(event)
        context.triggerPressedWhileOpen.current = context.open
      },
      onClick: (event) => {
        onClick?.(event)
        if (disabled) return
        if (context.dismissedByOutsidePress.current) {
          context.dismissedByOutsidePress.current = false
          return
        }
        if (context.triggerPressedWhileOpen.current) {
          context.triggerPressedWhileOpen.current = false
          context.setOpen(false)
          return
        }
        context.setOpen(!context.open)
      },
      onKeyDown: (event) => {
        onKeyDown?.(event)
        if (disabled) return
        if (event.key === "Escape") {
          context.setOpen(false)
        } else if (event.key === "ArrowDown" || (event.key === "n" && event.modifiers?.ctrl)) {
          if (!context.open) context.setOpen(true)
          context.moveActive(1)
        } else if (event.key === "ArrowUp" || (event.key === "p" && event.modifiers?.ctrl)) {
          if (!context.open) context.setOpen(true)
          context.moveActive(-1)
        } else if (event.key === "Enter" || event.key === " ") {
          context.setOpen(!context.open)
        } else if (event.key.length === 1 && !event.modifiers?.ctrl && !event.modifiers?.alt && !event.modifiers?.cmd) {
          context.typeahead(event.key)
        }
      },
    }
    return renderSlot({ asChild, children, props: triggerProps, ref })
  }
)

export interface SelectValueState {
  value: SelectSelection | undefined
  placeholder: boolean
}

export interface SelectValueProps extends SelectPartProps<SelectValueState, "children"> {
  placeholder?: ReactNode
  children?: ReactNode | ((value: SelectSelection | undefined) => ReactNode)
}

export const SelectValue = forwardRef<PublicInstance, SelectValueProps>(
  function SelectValue({ placeholder, children, className, style, ...props }, ref) {
    const context = useSelectContext("SelectValue")
    const values = Array.isArray(context.value)
      ? context.value
      : context.value === undefined
        ? []
        : [context.value]
    const labels = values.map(
      (value) =>
        context.labels.get(value) ?? context.items.find((item) => item.value === value)?.label ?? value
    )
    const hasValue = context.multiple ? values.length > 0 : context.value !== undefined
    const valueContent = hasValue
      ? context.multiple
        ? labels.flatMap((label, index) => (index === 0 ? [label] : [", ", label]))
        : labels[0]
      : undefined
    const content =
      typeof children === "function"
        ? children(context.multiple ? values : context.value)
        : children
    const state = { value: context.value, placeholder: !hasValue }
    return <div {...props} className={resolveClassName(className, state)} style={resolvePartStyle(style, state)} ref={ref}>
      {content ?? valueContent ?? placeholder}
    </div>
  }
)

export interface SelectPopupProps extends Omit<FloatingPopupProps, "style" | "className"> {
  onEscapeKeyDown?: (event: GpuixKeyboardEvent) => void
  className?: string | ((state: SelectPopupState) => string | undefined)
  style?: StateStyle<SelectPopupState> | ((state: SelectPopupState) => StyleDesc | undefined)
}

export interface SelectPopupState {
  side: string
  align: string
  open: boolean
  transitionStatus: "starting" | "ending" | "idle" | undefined
}

export const SelectPopup = forwardRef<PublicInstance, SelectPopupProps>(
  function SelectPopup(
    { children, onMouseDownOutside, onKeyDown, onEscapeKeyDown, tabIndex = 0, className, style, side = "bottom", align = "start", ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectPopup")
    const popupState: SelectPopupState = { side, align, open: context.open, transitionStatus: "idle" }
    const resolvedPopupProps = {
      ...props,
      side,
      align,
      className: resolveClassName(className, popupState),
      style: resolvePartStyle(style, popupState),
      position: context.popupPosition,
    }
    // Children stay mounted while closed - like Radix's detached collection -
    // so SelectItem registers at mount time regardless of open state. Both
    // states render the same FloatingLayer element type on the path to
    // children, so React preserves every item's fiber and host element across
    // open/close. Item content and SelectLabel still remount on open - the
    // closed item marker has no children. Closed, the panel carries none of
    // the user's props, handlers, tabIndex, or autoFocus - display:none builds
    // no children in the native renderer, so nothing below paints, lays out,
    // is hit-tested, or reaches the accessibility tree, and no focus handle
    // exists for it to reacquire on reopen.
    const floatingProps = context.open
      ? {
          ...resolvedPopupProps,
          ref: forwardedRef,
          tabIndex,
          autoFocus: true,
          onMouseDownOutside: (event: GpuixMouseEvent) => {
            onMouseDownOutside?.(event)
            context.dismissedByOutsidePress.current = true
            queueMicrotask(() => {
              context.dismissedByOutsidePress.current = false
            })
            context.setOpen(false)
          },
          onKeyDown: (event: GpuixKeyboardEvent) => {
            onKeyDown?.(event)
            if (event.key === "Escape") {
              onEscapeKeyDown?.(event)
              context.setOpen(false)
            } else if (event.key === "ArrowDown" || (event.key === "n" && event.modifiers?.ctrl)) {
              context.moveActive(1)
            } else if (event.key === "ArrowUp" || (event.key === "p" && event.modifiers?.ctrl)) {
              context.moveActive(-1)
            } else if ((event.key === "Enter" || event.key === " ") && context.activeValue) {
              context.selectValue(context.activeValue)
            } else if (event.key.length === 1 && !event.modifiers?.ctrl && !event.modifiers?.alt && !event.modifiers?.cmd) {
              context.typeahead(event.key)
            }
          },
        }
      : { ...resolvedPopupProps, style: { display: "none" as const } }

    return <FloatingLayer {...floatingProps}>{children}</FloatingLayer>
  }
)

export interface SelectItemState {
  selected: boolean
  highlighted: boolean
  disabled: boolean
}

export interface SelectItemProps extends SelectPartProps<SelectItemState, "children"> {
  value: string
  disabled?: boolean
  textValue?: string
  children?: ReactNode | ((state: SelectItemState) => ReactNode)
  style?: StateStyle<SelectItemState>
}

export const SelectItem = forwardRef<PublicInstance, SelectItemProps>(
  function SelectItem(
    { value, disabled = false, textValue, children, style, className, onClick, onMouseEnter, ...props },
    ref
  ) {
    const context = useSelectContext("SelectItem")
    const instanceRef = useRef<PublicInstance | null>(null)
    const [itemText, setItemText] = useState<{ label: string; textValue: string } | null>(null)
    const state = {
      selected: isValueSelected(context.value, context.multiple, value),
      highlighted: context.activeValue === value,
      disabled,
    }
    const fallbackTextValue = textValue ?? (typeof children === "function" ? "" : textContent(children))
    const itemContext = useMemo<SelectItemContextValue>(
      () => ({ value, setText: setItemText }),
      [value]
    )

    // Ref callbacks attach before layout effects run in the same commit, so
    // this is set before registerItem below reads it. Stable via useCallback
    // (keyed only on `ref`, since `setRefs` is pure over its arguments): an
    // inline arrow here would give React a new function every render, which
    // detaches and reattaches the ref - and re-fires this callback - on every
    // commit instead of only when the forwarded ref itself changes.
    const setInstanceRef = useCallback(
      (instance: PublicInstance | null) => {
        instanceRef.current = instance
        setRefs(instance, ref)
      },
      [ref]
    )

    useLayoutEffect(() => {
      context.registerItem({
        value,
        label: itemText?.label ?? fallbackTextValue,
        textValue: itemText?.textValue ?? fallbackTextValue,
        disabled,
        instance: instanceRef.current,
      })
      return () => context.unregisterItem(value)
    }, [value, itemText, fallbackTextValue, disabled])
    useLayoutEffect(() => {
      if (context.open && context.activeValue === value) instanceRef.current?.scrollIntoView({ block: "nearest" })
    }, [context.open, context.activeValue, value])

    // Closed content stays mounted (see registerItem's comment above), so
    // this marker keeps the item's document position current even while
    // Select is closed - unlike returning null, which would leave the item
    // with no tree position for compareDocumentPosition to read. Its children
    // stay mounted inside the hidden marker so ItemText can register the label
    // before SelectValue renders it. Inert: `display: "none"` takes no layout
    // space, is absent from the accessibility tree, and is never hit-tested
    // (see display-none.test.tsx).
    if (!context.open) {
      return (
        <SelectItemContext.Provider value={itemContext}>
          <div style={{ display: "none" }} ref={setInstanceRef}>
            {typeof children === "function" ? children(state) : children}
          </div>
        </SelectItemContext.Provider>
      )
    }
    return (
      <SelectItemContext.Provider value={itemContext}>
        <div
          {...props}
          ref={setInstanceRef}
          role="option"
          ariaSelected={state.selected}
          ariaDisabled={disabled || undefined}
          style={resolvePartStyle(style, state)}
          className={resolveClassName(className, state)}
          onMouseEnter={(event: GpuixMouseEvent) => {
            onMouseEnter?.(event)
            if (!disabled && !context.disabled) context.setActiveValue(value)
          }}
          onClick={(event: GpuixMouseEvent) => {
            onClick?.(event)
            if (!disabled && !context.disabled) context.selectValue(value)
          }}
        >
          {typeof children === "function" ? children(state) : children}
        </div>
      </SelectItemContext.Provider>
    )
  }
)

export interface SelectListProps extends SelectPartProps<Record<string, never>> {}

export const SelectList = forwardRef<PublicInstance, SelectListProps>(function SelectList(
  { children, className, style, id, onScroll, ...props },
  ref
) {
  const context = useSelectContext("SelectList")
  const listRef = useRef<PublicInstance | null>(null)
  useLayoutEffect(() => {
    const nextId = id ?? context.listId
    context.setListId(nextId)
    const element = listRef.current
    if (element) context.setScrollability(element.scrollTop > 0, element.scrollTop + element.clientHeight < element.scrollHeight)
  }, [context.open, context.listId, id, context.items.length])
  const mergedRef = (element: PublicInstance | null) => {
    listRef.current = element
    setRefs(element, ref)
  }
  const state = {}
  return (
    <div
      {...props}
      id={id ?? context.listId}
      ref={mergedRef}
      className={resolveClassName(className, state)}
      style={resolvePartStyle(style, state)}
      role="listbox"
      ariaMultiSelectable={context.multiple || undefined}
      onScroll={(event: GpuixScrollEvent) => {
        onScroll?.(event)
        const element = listRef.current
        if (element) context.setScrollability(element.scrollTop > 0, element.scrollTop + element.clientHeight < element.scrollHeight)
      }}
    >
      {children}
    </div>
  )
})

export interface SelectIconState {
  open: boolean
}

export interface SelectIconProps extends SelectPartProps<SelectIconState> {}

export const SelectIcon = forwardRef<PublicInstance, SelectIconProps>(function SelectIcon(
  { children, style, className, ...props },
  ref
) {
  const context = useSelectContext("SelectIcon")
  return (
    <div {...props} ref={ref} className={resolveClassName(className, { open: context.open })} style={resolvePartStyle(style, { open: context.open })}>
      {children}
    </div>
  )
})

export interface SelectItemTextProps extends SelectPartProps<Record<string, never>> {}

export const SelectItemText = forwardRef<PublicInstance, SelectItemTextProps>(
  function SelectItemText({ children, className, style, ...props }, ref) {
    useSelectContext("SelectItemText")
    const context = useContext(SelectItemContext)
    if (!context) throw new Error("SelectItemText must be used inside SelectItem")
    const label = textContent(children)
    useLayoutEffect(() => {
      context.setText({ label, textValue: label })
      return () => context.setText(null)
    }, [context, label])
    return (
      <div {...props} ref={ref} className={resolveClassName(className, {})} style={resolvePartStyle(style, {})}>
        {children}
      </div>
    )
  }
)

export interface SelectItemIndicatorState {
  selected: boolean
  transitionStatus: "starting" | "ending" | "idle" | undefined
}

export interface SelectItemIndicatorProps extends SelectPartProps<SelectItemIndicatorState> {
  keepMounted?: boolean
}

export const SelectItemIndicator = forwardRef<PublicInstance, SelectItemIndicatorProps>(
  function SelectItemIndicator({ children, keepMounted = false, style, className, ...props }, ref) {
    const context = useSelectContext("SelectItemIndicator")
    const item = useContext(SelectItemContext)
    if (!item) throw new Error("SelectItemIndicator must be used inside SelectItem")
    const selected = isValueSelected(context.value, context.multiple, item.value)
    if (!selected && !keepMounted) return null
    return (
      <div
        {...props}
        ref={ref}
        className={resolveClassName(className, { selected, transitionStatus: "idle" })}
        style={resolvePartStyle(style, { selected, transitionStatus: "idle" })}
        ariaHidden
      >
        {children}
      </div>
    )
  }
)

export const SelectGroup = forwardRef<PublicInstance, SelectPartProps<Record<string, never>>>(function SelectGroup({ className, style, ...props }, ref) {
  const context = useSelectContext("SelectGroup")
  // A group can contain items, so its children stay mounted while closed for
  // their own registration. The group renders a div in both states - like
  // SelectItem's own marker - so its host element and the items beneath it
  // keep their identity across open/close instead of remounting.
  if (!context.open) return <div style={{ display: "none" }}>{props.children}</div>
  return <div {...props} ref={ref} className={resolveClassName(className, {})} style={resolvePartStyle(style, {})} />
})

export interface SelectLabelState {
  disabled: boolean
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
}

export const SelectLabel = forwardRef<PublicInstance, SelectPartProps<SelectLabelState>>(function SelectLabel({ className, style, ...props }, ref) {
  const context = useSelectContext("SelectLabel")
  if (!context.open) return null
  const state = { disabled: context.disabled, touched: false, dirty: context.value !== undefined, valid: null, filled: context.value !== undefined && context.value !== "", focused: false }
  return <div {...props} ref={ref} className={resolveClassName(className, state)} style={resolvePartStyle(style, state)} />
})

export interface SelectSeparatorState { orientation: "horizontal" | "vertical" }
export interface SelectSeparatorProps extends SelectPartProps<SelectSeparatorState> { orientation?: "horizontal" | "vertical" }

export const SelectSeparator = forwardRef<PublicInstance, SelectSeparatorProps>(
  function SelectSeparator({ className, style, orientation = "horizontal", ...props }, ref) {
    const context = useSelectContext("SelectSeparator")
    if (!context.open) return null
    return <div {...props} ref={ref} className={resolveClassName(className, { orientation })} style={resolvePartStyle(style, { orientation })} />
  }
)

export type SelectArrowProps = SelectPartProps<Record<string, never>>

export const SelectScrollUpArrow = forwardRef<PublicInstance, SelectArrowProps>(
  function SelectScrollUpArrow({ className, style, ...props }, ref) {
    const context = useSelectContext("SelectScrollUpArrow")
    if (!context.canScrollUp) return null
    return <div {...props} className={resolveClassName(className, {})} style={resolvePartStyle(style, {})} ref={ref} />
  }
)

export const SelectScrollDownArrow = forwardRef<PublicInstance, SelectArrowProps>(
  function SelectScrollDownArrow({ className, style, ...props }, ref) {
    const context = useSelectContext("SelectScrollDownArrow")
    if (!context.canScrollDown) return null
    return <div {...props} className={resolveClassName(className, {})} style={resolvePartStyle(style, {})} ref={ref} />
  }
)

export {
  Select as Root,
  SelectPopup as Popup,
  SelectGroup as Group,
  SelectIcon as Icon,
  SelectItem as Item,
  SelectItemIndicator as ItemIndicator,
  SelectItemText as ItemText,
  SelectList as List,
  SelectLabel as Label,
  SelectScrollDownArrow as ScrollDownArrow,
  SelectScrollUpArrow as ScrollUpArrow,
  SelectSeparator as Separator,
  SelectTrigger as Trigger,
  SelectValue as Value,
}
