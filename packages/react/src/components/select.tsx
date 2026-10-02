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
  GpuixSyntheticEvent,
  GpuixKeyboardEvent,
  GpuixMouseEvent,
  GpuixScrollEvent,
} from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import { ResizeObserver } from "../resize-observer.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import {
  DismissLayerScope,
  FloatingPositioner,
  FloatingLayer,
  floatingPopupStyle,
  renderSlot,
  setRefs,
  useControllableState,
  useDismissLayer,
  usePositionerState,
} from "./floating.js"
import type { FloatingPopupProps, PositionerProps, PositionerState, StateStyle } from "./floating.js"

export interface SelectItemData<Value = unknown> {
  value: Value
  label?: ReactNode
  textValue?: string
}

interface SelectItemRecord {
  value: unknown
  label: ReactNode
  textValue: string
  disabled: boolean
  /** Null only until the item's ref attaches, which happens in the same commit. */
  instance: PublicInstance | null
}

interface SelectContextValue {
  open: boolean
  value: SelectSelection<unknown>
  multiple: boolean
  disabled: boolean
  readOnly: boolean
  highlightItemOnHover: boolean
  focused: boolean
  labels: Map<unknown, ReactNode>
  activeValue: unknown | null
  revealActiveValue: unknown | null
  listId: string
  fieldLabelId: string
  listMounted: boolean
  popupPosition: { x: number; y: number } | undefined
  canScrollUp: boolean
  canScrollDown: boolean
  triggerPressedWhileOpen: React.MutableRefObject<boolean>
  dismissedByOutsidePress: React.MutableRefObject<boolean>
  triggerRef: React.MutableRefObject<PublicInstance | null>
  setOpen: (open: boolean, reason?: SelectChangeEventDetails["reason"], event?: GpuixSyntheticEvent) => void
  setActiveValue: (value: unknown | null) => void
  setKeyboardActiveValue: (value: unknown | null) => void
  setListId: (id: string) => void
  setListMounted: (mounted: boolean) => void
  setScrollability: (up: boolean, down: boolean) => void
  setFocused: (focused: boolean) => void
  typeahead: (character: string, event?: GpuixSyntheticEvent) => void
  moveActive: (delta: number) => void
  moveActiveTo: (edge: "first" | "last") => void
  selectValue: (value: unknown, reason?: SelectChangeEventDetails["reason"], event?: GpuixSyntheticEvent) => void
  items: SelectItemRecord[]
  registerItem: (item: SelectItemRecord) => void
  unregisterItem: (value: unknown) => void
  isItemEqualToValue: (item: unknown, value: unknown) => boolean
}

export type SelectSelection<Value = unknown> = Value | Value[] | null

export type SelectValueFor<Value = unknown, Multiple extends boolean | undefined = boolean | undefined> = Multiple extends true
  ? Value[]
  : Multiple extends false | undefined
    ? Value | null
    : Value | Value[] | null

const SelectContext = createContext<SelectContextValue | null>(null)
const SelectPopupSideContext = createContext<string>("bottom")
const SelectPositionedContext = createContext(false)
interface SelectGroupContextValue {
  labelId: string | undefined
  setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>
}
const SelectGroupContext = createContext<SelectGroupContextValue | null>(null)
interface SelectItemContextValue {
  value: unknown
  state: React.MutableRefObject<SelectItemState>
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
  registrationIndex: (value: unknown) => number
): number {
  if (a.instance && b.instance) {
    const position = a.instance.compareDocumentPosition(b.instance)
    if (position & DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  }
  return registrationIndex(a.value) - registrationIndex(b.value)
}

export interface SelectProps<Value = unknown, Multiple extends boolean | undefined = false>
  extends Omit<Props, "children" | "onChange" | "className" | "style"> {
  children?: ReactNode
  items?: Record<string, ReactNode> | readonly SelectItemData<Value>[]
  value?: SelectValueFor<Value, Multiple> | undefined
  defaultValue?: SelectValueFor<Value, Multiple> | undefined
  onValueChange?: (value: SelectValueFor<Value, Multiple>, eventDetails: SelectChangeEventDetails) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, eventDetails: SelectChangeEventDetails) => void
  onOpenChangeComplete?: (open: boolean) => void
  multiple?: Multiple
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  name?: string
  form?: string
  autoComplete?: string
  id?: string
  inputRef?: React.Ref<HTMLInputElement>
  highlightItemOnHover?: boolean
  modal?: boolean
  actionsRef?: React.RefObject<{ unmount: () => void } | null>
  itemToStringLabel?: (value: Value) => string
  itemToStringValue?: (value: Value) => string
  isItemEqualToValue?: (itemValue: Value, value: Value) => boolean
}

export interface SelectChangeEventDetails {
  reason: "trigger-press" | "outside-press" | "item-press" | "escape-key" | "focus-out" | "list-navigation" | "cancel-open" | "window-resize" | "none"
  /** The originating GPU-IX event. Programmatic changes have no event. */
  event: GpuixSyntheticEvent | undefined
  cancel: () => void
  allowPropagation: () => void
  isCanceled: boolean
  isPropagationAllowed: boolean
  trigger: Element | undefined
}

function createSelectChangeDetails(reason: SelectChangeEventDetails["reason"], trigger?: Element, event?: GpuixSyntheticEvent): SelectChangeEventDetails {
  let isCanceled = false
  let isPropagationAllowed = false
  return {
    reason,
    event,
    cancel() { isCanceled = true },
    allowPropagation() { isPropagationAllowed = true },
    get isCanceled() { return isCanceled },
    get isPropagationAllowed() { return isPropagationAllowed },
    trigger,
  }
}

function isValueSelected(value: SelectSelection<unknown>, multiple: boolean, item: unknown, equal: (item: unknown, value: unknown) => boolean): boolean {
  return multiple ? Array.isArray(value) && value.some((candidate) => equal(item, candidate)) : value !== null && equal(item, value)
}

function compareSelectItemEquality(item: unknown, value: unknown, compare: (item: unknown, value: unknown) => boolean): boolean {
  return item == null || value == null ? Object.is(item, value) : compare(item, value)
}

export function Select<Value = unknown, Multiple extends boolean | undefined = false>({
  children,
  items: itemsProp,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onOpenChangeComplete,
  multiple = false as Multiple,
  disabled = false,
  readOnly = false,
  highlightItemOnHover = true,
  isItemEqualToValue = Object.is,
}: SelectProps<Value, Multiple>): ReactElement {
  const compareValues = (item: unknown, value: unknown) => compareSelectItemEquality(item, value, isItemEqualToValue as (item: unknown, value: unknown) => boolean)
  const { renderer } = useGpuix()
  const [value, setValue] = useControllableState<SelectSelection<unknown>>({
    value: valueProp,
    defaultValue: defaultValue ?? null,
  })
  const [open, setOpenState] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
  })
  const [activeValue, setActiveValueState] = useState<unknown | null>(null)
  const [revealActiveValue, setRevealActiveValue] = useState<unknown | null>(null)
  const generatedListId = useId()
  const [listId, setListId] = useState(generatedListId)
  const fieldLabelId = `${generatedListId}-label`
  const [listMounted, setListMounted] = useState(false)
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number }>()
  const [scrollability, setScrollability] = useState({ up: false, down: false })
  const [focused, setFocused] = useState(false)
  const typeaheadBuffer = useRef("")
  const typeaheadTime = useRef(0)
  const typeaheadStartIndex = useRef(-1)
  const typeaheadMatchIndex = useRef(-1)
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
  const itemRegistry = useRef<Map<unknown, SelectItemRecord>>(new Map())
  const itemOrder = useRef<unknown[]>([])
  const [items, setItems] = useState<SelectItemRecord[]>([])

  const setActiveValue = (nextValue: unknown | null) => {
    setRevealActiveValue(null)
    setActiveValueState(nextValue)
  }
  const setKeyboardActiveValue = (nextValue: unknown | null) => {
    setRevealActiveValue(nextValue)
    setActiveValueState(nextValue)
  }

  const registerItem = (item: SelectItemRecord) => {
    if (!itemRegistry.current.has(item.value)) itemOrder.current.push(item.value)
    itemRegistry.current.set(item.value, item)
  }

  const unregisterItem = (value: unknown) => {
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
    const registrationIndex = (value: unknown): number => itemOrder.current.indexOf(value)
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
      (item) => isValueSelected(value, multiple === true, item.value, compareValues) && !item.disabled
    )
    if (selected) setActiveValue(selected.value)
  }, [open, value, items, activeValue])
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopupPosition({ x: rect.x, y: rect.y + rect.height })
  }, [open])
  const labels = useMemo(() => {
    const next = new Map<unknown, ReactNode>()
    if (Array.isArray(itemsProp)) {
      for (const item of itemsProp) next.set(item.value, item.label ?? item.textValue ?? String(item.value))
    } else if (itemsProp) {
      for (const [itemValue, label] of Object.entries(itemsProp)) next.set(itemValue, label)
    }
    return next
  }, [itemsProp])

  const setOpen = (nextOpen: boolean, reason: SelectChangeEventDetails["reason"] = "trigger-press", event?: GpuixSyntheticEvent) => {
    if (open === nextOpen) return
    const details = createSelectChangeDetails(reason, triggerRef.current as unknown as Element | undefined, event)
    onOpenChange?.(nextOpen, details)
    if (details.isCanceled) return
    setOpenState(nextOpen)
    onOpenChangeComplete?.(nextOpen)
    if (nextOpen) {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPopupPosition({ x: rect.x, y: rect.y + rect.height })
      const selected = items.find(
        (item) => isValueSelected(value, multiple === true, item.value, compareValues) && !item.disabled
      )
      setActiveValue(selected?.value ?? null)
    } else if (triggerRef.current) {
      renderer?.focusElement?.(triggerRef.current.id)
    }
  }

  const typeahead = (character: string, event?: GpuixSyntheticEvent) => {
    if (disabled || (!open && (readOnly || multiple)) || !character || character.length !== 1) return
    const now = Date.now()
    const lower = character.toLocaleLowerCase()
    const enabled = items.filter((item) => !item.disabled)
    const continuesSession = typeaheadBuffer.current.length > 0 && now - typeaheadTime.current < 750
    const currentValue = activeValue ?? (!open && !multiple ? value : null)
    const currentIndex = enabled.findIndex((item) => compareValues(item.value, currentValue))
    let startIndex = continuesSession ? typeaheadStartIndex.current : currentIndex
    let prefix = continuesSession ? typeaheadBuffer.current + lower : lower

    const canCycleRepeatedInitial = enabled.every((item) => {
      const first = item.textValue.trim().toLocaleLowerCase()
      return !first || first[0] !== first[1]
    })
    if (continuesSession && canCycleRepeatedInitial && typeaheadBuffer.current === lower) {
      prefix = lower
      startIndex = typeaheadMatchIndex.current
      typeaheadStartIndex.current = startIndex
    }

    typeaheadTime.current = now
    typeaheadBuffer.current = prefix
    if (!continuesSession) typeaheadStartIndex.current = currentIndex
    const matchIndex = enabled.findIndex((item, index) =>
      index > startIndex && item.textValue.trim().toLocaleLowerCase().startsWith(prefix)
    )
    const wrappedMatchIndex = matchIndex === -1
      ? enabled.findIndex((item, index) => index <= startIndex && item.textValue.trim().toLocaleLowerCase().startsWith(prefix))
      : matchIndex
    if (wrappedMatchIndex === -1) {
      typeaheadBuffer.current = ""
      return
    }
    const match = enabled[wrappedMatchIndex]
    if (!match) return
    typeaheadMatchIndex.current = wrappedMatchIndex
    if (open) setKeyboardActiveValue(match.value)
    else if (!readOnly && !multiple) selectValue(match.value, "list-navigation", event)
  }

  const moveActive = (delta: number) => {
    if (disabled) return
    const enabled = items.filter((item) => !item.disabled)
    if (enabled.length === 0) return
    const currentIndex = enabled.findIndex((item) => compareValues(item.value, activeValue))
    const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex
    const nextIndex = (start + delta + enabled.length) % enabled.length
    setKeyboardActiveValue(enabled[nextIndex].value)
  }

  const moveActiveTo = (edge: "first" | "last") => {
    if (disabled) return
    const enabled = items.filter((item) => !item.disabled)
    const item = edge === "first" ? enabled[0] : enabled.at(-1)
    if (item) setKeyboardActiveValue(item.value)
  }

  const selectValue = (nextValue: unknown, reason: SelectChangeEventDetails["reason"] = "item-press", event?: GpuixSyntheticEvent) => {
    if (disabled || readOnly) return
    const item = items.find((candidate) => compareValues(candidate.value, nextValue))
    if (!item || item.disabled) return
    if (multiple) {
      const selected = Array.isArray(value) ? value : []
      const nextSelection =
        selected.some((candidate) => compareValues(candidate, nextValue))
          ? selected.filter((candidate) => !compareValues(candidate, nextValue))
          : [...selected, nextValue]
      const details = createSelectChangeDetails(reason, triggerRef.current as unknown as Element | undefined, event)
      onValueChange?.(nextSelection as SelectValueFor<Value, Multiple>, details)
      if (!details.isCanceled) setValue(nextSelection)
      return
    }
    if (Object.is(value, nextValue)) {
      setOpen(false, reason, event)
      return
    }
    const details = createSelectChangeDetails(reason, triggerRef.current as unknown as Element | undefined, event)
    onValueChange?.(nextValue as SelectValueFor<Value, Multiple>, details)
    if (!details.isCanceled) {
      setValue(nextValue)
      setOpen(false, reason, event)
    }
  }

  const context = useMemo<SelectContextValue>(
    () => ({
      open,
      value,
      multiple: multiple === true,
      disabled,
      readOnly,
      highlightItemOnHover,
      focused,
      items,
      labels,
      activeValue,
      revealActiveValue,
      listId,
      fieldLabelId,
      listMounted,
      popupPosition,
      canScrollUp: scrollability.up,
      canScrollDown: scrollability.down,
      triggerPressedWhileOpen,
      dismissedByOutsidePress,
      triggerRef,
      setOpen,
      setActiveValue,
      setKeyboardActiveValue,
      setListId,
      setListMounted,
      setScrollability: (up, down) => setScrollability({ up, down }),
      setFocused,
      typeahead,
      moveActive,
      moveActiveTo,
      selectValue,
      registerItem,
      unregisterItem,
      isItemEqualToValue: compareValues,
    }),
    [open, value, multiple, disabled, readOnly, highlightItemOnHover, focused, items, labels, activeValue, revealActiveValue, listId, listMounted, popupPosition, scrollability, compareValues]
  )

  return (
    <SelectContext.Provider value={context}>
      <DismissLayerScope>{children}</DismissLayerScope>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerState {
  open: boolean
  disabled: boolean
  placeholder: boolean
  readOnly: boolean
  popupSide: string
  value: SelectSelection<unknown>
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
}

type SelectPartProps<State, Excluded extends keyof Props = never> = Omit<Props, "style" | "className" | Excluded> & {
  render?: ReactElement | ((props: Props, state: State) => ReactNode) | undefined
  className?: string | ((state: State) => string | undefined) | undefined
  style?: StateStyle<State> | ((state: State) => StyleDesc | undefined) | undefined
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

function renderPart<State>({
  tag = "div",
  render,
  props,
  children,
  state,
  ref,
}: {
  tag?: string
  render?: ReactElement | ((props: Props, state: State) => ReactNode)
  props: Props
  children?: ReactNode
  state: State
  ref?: React.Ref<PublicInstance>
}): ReactNode {
  const resolved = { ...props, ref }
  if (typeof render === "function") return render(resolved, state)
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return React.createElement(tag, resolved, children)
}

export interface SelectTriggerProps extends SelectPartProps<SelectTriggerState> {
  asChild?: boolean
  disabled?: boolean
}

export const SelectTrigger = forwardRef<PublicInstance, SelectTriggerProps>(
  function SelectTrigger(
    { asChild, render, disabled: disabledProp, style, className, children, onMouseDown, onClick, onKeyDown, onFocus, onBlur, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectTrigger")
    const disabled = disabledProp ?? context.disabled
    const state = {
      open: context.open,
      disabled,
      placeholder: context.multiple
        ? !Array.isArray(context.value) || context.value.length === 0
        : context.value === null,
      readOnly: context.readOnly,
      popupSide: "bottom",
      value: context.value,
      touched: false,
      dirty: context.value !== null,
      valid: null,
      filled: context.value !== null,
      focused: context.focused,
    }
    const ref = (value: PublicInstance | null) => {
      context.triggerRef.current = value
      setRefs(value, forwardedRef)
    }
    const triggerProps: Props = {
      ...props,
      role: props.role ?? "combobox",
      ariaLabelledBy: props.ariaLabelledBy ?? props["aria-labelledby"] ?? context.fieldLabelId,
      ariaExpanded: context.open,
      ariaHasPopup: "listbox",
      ariaControls: context.open && context.listMounted ? context.listId : undefined,
      "data-open": context.open ? "" : undefined,
      "data-popup-open": context.open ? "" : undefined,
      "data-pressed": context.open ? "" : undefined,
      "data-disabled": disabled ? "" : undefined,
      "data-readonly": context.readOnly ? "" : undefined,
      "data-placeholder": state.placeholder ? "" : undefined,
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
          context.setOpen(false, "trigger-press", event)
          return
        }
        context.setOpen(!context.open, "trigger-press", event)
      },
      onKeyDown: (event) => {
        onKeyDown?.(event)
        if (disabled) return
        if (event.key === "Escape") {
          if (!event.defaultPrevented) context.setOpen(false, "escape-key", event)
        } else if (event.key === "ArrowDown" || (event.key === "n" && event.modifiers?.ctrl)) {
          if (!context.open) context.setOpen(true, "trigger-press", event)
          context.moveActive(1)
        } else if (event.key === "ArrowUp" || (event.key === "p" && event.modifiers?.ctrl)) {
          if (!context.open) context.setOpen(true, "trigger-press", event)
          context.moveActive(-1)
        } else if (event.key === "Enter" || event.key === " ") {
          context.setOpen(!context.open, "trigger-press", event)
        } else if (event.key.length === 1 && !event.modifiers?.ctrl && !event.modifiers?.alt && !event.modifiers?.cmd) {
          context.typeahead(event.key, event)
        }
      },
    }
    if (typeof render === "function" || isValidElement<Props>(render)) {
      return renderPart({ tag: "button", render, props: triggerProps, children, state, ref }) as ReactElement
    }
    return renderSlot({ asChild, children, props: triggerProps, ref })
  }
)

export interface SelectValueState {
  value: SelectSelection<unknown>
  placeholder: boolean
}

export interface SelectValueProps extends SelectPartProps<SelectValueState, "children"> {
  placeholder?: ReactNode
  children?: ReactNode | ((value: any) => ReactNode)
}

export const SelectValue = forwardRef<PublicInstance, SelectValueProps>(
  function SelectValue({ placeholder, children, render, className, style, ...props }, ref) {
    const context = useSelectContext("SelectValue")
    const values = Array.isArray(context.value)
      ? context.value
      : context.value === null
        ? []
        : [context.value]
    const labels = values.map(
      (value) =>
        context.labels.get(value) ?? context.items.find((item) => item.value === value)?.label ?? value
    )
    const hasValue = context.multiple ? values.length > 0 : context.value !== null
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
    return renderPart({ tag: "span", render, props: { ...props, "data-placeholder": state.placeholder ? "" : undefined, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }, children: content ?? valueContent ?? placeholder, state, ref }) as ReactElement
  }
)

export interface SelectPopupProps extends Omit<FloatingPopupProps, "style" | "className"> {
  onEscapeKeyDown?: (event: GpuixKeyboardEvent) => void
  className?: string | ((state: SelectPopupState) => string | undefined)
  style?: StateStyle<SelectPopupState> | ((state: SelectPopupState) => StyleDesc | undefined)
  render?: ReactElement | ((props: Props, state: SelectPopupState) => ReactNode) | undefined
  finalFocus?: boolean | React.RefObject<HTMLElement | null> | ((closeType: string) => boolean | HTMLElement | null | void) | undefined
}

export interface SelectPopupState {
  side: string
  align: string
  open: boolean
  transitionStatus: "starting" | "ending" | "idle" | undefined
}

export const SelectPopup = forwardRef<PublicInstance, SelectPopupProps>(
  function SelectPopup(
    { children, onMouseDownOutside, onKeyDown, onEscapeKeyDown, tabIndex = 0, className, style, side = "bottom", align = "start", render, finalFocus: _finalFocus, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectPopup")
    const positioned = useContext(SelectPositionedContext)
    const positionerState = usePositionerState()
    const dismissLayer = useDismissLayer(context.open)
    const resolvedSide = positioned && positionerState ? positionerState.side : side
    const resolvedAlign = positioned && positionerState ? positionerState.align : align
    const popupState: SelectPopupState = { side: resolvedSide, align: resolvedAlign, open: context.open, transitionStatus: "idle" }
    const resolvedClassName = resolveClassName(className, popupState)
    const resolvedPopupProps = {
      ...props,
      side,
      align,
      className: resolvedClassName,
      style: floatingPopupStyle(resolvePartStyle(style, popupState), resolvedClassName),
      position: context.popupPosition,
      "data-open": context.open ? "" : undefined,
      "data-side": resolvedSide,
      "data-align": resolvedAlign,
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
            context.setOpen(false, "outside-press", event)
          },
          onKeyDown: (event: GpuixKeyboardEvent) => {
            onKeyDown?.(event)
            if (event.key.toLowerCase() === "escape") {
              if (dismissLayer(event)) {
                onEscapeKeyDown?.(event)
                if (!event.defaultPrevented) context.setOpen(false, "escape-key", event)
              }
            } else if (event.key === "ArrowDown" || (event.key === "n" && event.modifiers?.ctrl)) {
              context.moveActive(1)
            } else if (event.key === "ArrowUp" || (event.key === "p" && event.modifiers?.ctrl)) {
              context.moveActive(-1)
            } else if (event.key === "Home") {
              context.moveActiveTo("first")
            } else if (event.key === "End") {
              context.moveActiveTo("last")
            } else if ((event.key === "Enter" || event.key === " ") && context.activeValue) {
              context.selectValue(context.activeValue, "item-press", event)
            } else if (event.key.length === 1 && !event.modifiers?.ctrl && !event.modifiers?.alt && !event.modifiers?.cmd) {
              context.typeahead(event.key, event)
            }
          },
        }
      : { ...resolvedPopupProps, style: { display: "none" as const } }

    const popupContents = positioned
      ? <div
          {...Object.fromEntries(Object.entries(floatingProps).filter(([key]) => !["side", "align", "position", "render", "finalFocus"].includes(key)))}
          data-open={context.open ? "" : undefined}
          data-side={resolvedSide}
          data-align={resolvedAlign}
        >{children}</div>
      : <FloatingLayer {...floatingProps}>{children}</FloatingLayer>
    const renderedPopup = positioned
      ? renderPart({ tag: "div", render, props: { ...floatingProps, children }, state: popupState, children, ref: forwardedRef })
      : popupContents
    return <SelectPopupSideContext.Provider value={resolvedSide}>{renderedPopup}</SelectPopupSideContext.Provider>
  }
)

export interface SelectItemState {
  selected: boolean
  highlighted: boolean
  disabled: boolean
}

export interface SelectItemProps extends SelectPartProps<SelectItemState, "children"> {
  value?: unknown
  disabled?: boolean
  label?: string
  textValue?: string
  children?: ReactNode | ((state: SelectItemState) => ReactNode)
  style?: StateStyle<SelectItemState> | undefined
}

export const SelectItem = forwardRef<PublicInstance, SelectItemProps>(
  function SelectItem(
    { value, disabled = false, label, textValue, children, render, style, className, onClick, onMouseEnter, ...props },
    ref
  ) {
    const context = useSelectContext("SelectItem")
    const instanceRef = useRef<PublicInstance | null>(null)
    const [itemText, setItemText] = useState<{ label: string; textValue: string } | null>(null)
    const itemValue = value ?? null
    const state = {
      selected: isValueSelected(context.value, context.multiple, itemValue, context.isItemEqualToValue),
      highlighted: compareSelectItemEquality(context.activeValue, itemValue, context.isItemEqualToValue),
      disabled,
    }
    const stateRef = useRef(state)
    stateRef.current = state
    const fallbackTextValue = label ?? textValue ?? (typeof children === "function" ? "" : textContent(children))
    const renderedChildren = typeof children === "function" ? children(state) : children
    const itemContext = useMemo<SelectItemContextValue>(
      () => ({ value: itemValue, state: stateRef, setText: setItemText }),
      [itemValue]
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
        value: itemValue,
        label: label ?? itemText?.label ?? fallbackTextValue,
        textValue: textValue ?? label ?? itemText?.textValue ?? fallbackTextValue,
        disabled,
        instance: instanceRef.current,
      })
      return () => context.unregisterItem(itemValue)
    }, [itemValue, itemText, fallbackTextValue, disabled])
    useLayoutEffect(() => {
      if (context.open && compareSelectItemEquality(context.revealActiveValue, itemValue, context.isItemEqualToValue)) instanceRef.current?.scrollIntoView({ block: "nearest" })
    }, [context.open, context.revealActiveValue, itemValue])

    // Closed content stays mounted (see registerItem's comment above), so
    // this marker keeps the item's document position current even while
    // Select is closed - unlike returning null, which would leave the item
    // with no tree position for compareDocumentPosition to read. Its children
    // stay mounted inside the hidden marker so ItemText can register the label
    // before SelectValue renders it. Inert: `display: "none"` takes no layout
    // space, is absent from the accessibility tree, and is never hit-tested
    // (see display-none.test.tsx).
    if (!context.open) return <SelectItemContext.Provider value={itemContext}><div style={{ display: "none" }} ref={setInstanceRef}>{renderedChildren}</div></SelectItemContext.Provider>
    const itemProps: Props = {
      ...props,
      ref: setInstanceRef,
      role: "option",
      ariaSelected: state.selected,
      ariaDisabled: disabled || undefined,
      "data-selected": state.selected ? "" : undefined,
      "data-highlighted": state.highlighted ? "" : undefined,
      "data-disabled": disabled ? "" : undefined,
      style: resolvePartStyle(style, state),
      className: resolveClassName(className, state),
      onMouseEnter: (event: GpuixMouseEvent) => {
        onMouseEnter?.(event)
        if (!disabled && !context.disabled && context.highlightItemOnHover) context.setActiveValue(itemValue)
      },
      onClick: (event: GpuixMouseEvent) => {
        onClick?.(event)
        if (!disabled && !context.disabled) context.selectValue(itemValue, "item-press", event)
      },
    }
    return (
      <SelectItemContext.Provider value={itemContext}>
        {renderPart({ render, props: itemProps, state, children: renderedChildren, ref: setInstanceRef }) as ReactElement}
      </SelectItemContext.Provider>
    )
  }
)

export interface SelectListProps extends SelectPartProps<Record<string, never>> {}

export const SelectList = forwardRef<PublicInstance, SelectListProps>(function SelectList(
  { children, render, className, style, id, onScroll, ...props },
  ref
) {
  const context = useSelectContext("SelectList")
  const listRef = useRef<PublicInstance | null>(null)
  useLayoutEffect(() => {
    if (!context.open) return
    context.setListMounted(true)
    return () => context.setListMounted(false)
  }, [context.open])
  useLayoutEffect(() => {
    if (!context.open) return
    const element = listRef.current
    if (!element) return
    const updateScrollability = () => {
      context.setScrollability(
        element.scrollTop > 0,
        element.scrollTop + element.clientHeight < element.scrollHeight
      )
    }
    const observer = new ResizeObserver(updateScrollability)
    observer.observe(element)
    return () => observer.disconnect()
  }, [context.open])
  useLayoutEffect(() => {
    const nextId = id ?? context.listId
    context.setListId(nextId)
    const element = listRef.current
    if (element) context.setScrollability(element.scrollTop > 0, element.scrollTop + element.clientHeight < element.scrollHeight)
  }, [context.open, context.listId, id, context.items.length, style])
  const mergedRef = (element: PublicInstance | null) => {
    listRef.current = element
    setRefs(element, ref)
  }
  const state = {}
  return renderPart({
    render,
    props: {
      ...props,
      id: id ?? context.listId,
      ref: mergedRef,
      className: resolveClassName(className, state),
      style: resolvePartStyle(style, state),
      role: "listbox",
      ariaMultiSelectable: context.multiple || undefined,
      "data-multiple": context.multiple ? "" : undefined,
      onScroll: (event: GpuixScrollEvent) => {
        onScroll?.(event)
        const element = listRef.current
        if (element) context.setScrollability(element.scrollTop > 0, element.scrollTop + element.clientHeight < element.scrollHeight)
      },
    },
    children,
    state,
    ref: mergedRef,
  }) as ReactElement
})

export interface SelectIconState {
  open: boolean
}

export interface SelectIconProps extends SelectPartProps<SelectIconState> {}

export const SelectIcon = forwardRef<PublicInstance, SelectIconProps>(function SelectIcon(
  { children, render, style, className, ...props },
  ref
) {
  const context = useSelectContext("SelectIcon")
  const state = { open: context.open }
  return renderPart({ render, props: { ...props, "data-open": context.open ? "" : undefined, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }, children, state, ref }) as ReactElement
})

export interface SelectItemTextProps extends SelectPartProps<Record<string, never>, "children"> {
  children?: ReactNode | ((state: SelectItemState) => ReactNode)
}

export const SelectItemText = forwardRef<PublicInstance, SelectItemTextProps>(
  function SelectItemText({ children, render, className, style, ...props }, ref) {
    useSelectContext("SelectItemText")
    const context = useContext(SelectItemContext)
    if (!context) throw new Error("SelectItemText must be used inside SelectItem")
    const state = context.state.current
    const renderedChildren = typeof children === "function" ? children(state) : children
    const label = typeof children === "function"
      ? textContent(children({ selected: false, highlighted: false, disabled: state.disabled }))
      : textContent(children)
    useLayoutEffect(() => {
      context.setText({ label, textValue: label })
      return () => context.setText(null)
    }, [context, label])
    return renderPart({ tag: "span", render, props: { ...props, className: resolveClassName(className, {}), style: resolvePartStyle(style, {}) }, children: renderedChildren, state: {}, ref }) as ReactElement
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
  function SelectItemIndicator({ children, keepMounted = false, render, style, className, ...props }, ref) {
    const context = useSelectContext("SelectItemIndicator")
    const item = useContext(SelectItemContext)
    if (!item) throw new Error("SelectItemIndicator must be used inside SelectItem")
    const selected = isValueSelected(context.value, context.multiple, item.value, context.isItemEqualToValue)
    if (!selected && !keepMounted) return null
    return (
      renderPart({ tag: "span", render, props: { ...props, "data-selected": selected ? "" : undefined, className: resolveClassName(className, { selected, transitionStatus: "idle" }), style: resolvePartStyle(style, { selected, transitionStatus: "idle" }), ariaHidden: true }, children, state: { selected, transitionStatus: "idle" as const }, ref }) as ReactElement
    )
  }
)

export const SelectGroup = forwardRef<PublicInstance, SelectPartProps<Record<string, never>>>(function SelectGroup({ render, className, style, children, ...props }, ref) {
  const context = useSelectContext("SelectGroup")
  const [labelId, setLabelId] = useState<string | undefined>()
  const groupContext = useMemo(() => ({ labelId, setLabelId }), [labelId])
  // A group can contain items, so its children stay mounted while closed for
  // their own registration. The group renders a div in both states - like
  // SelectItem's own marker - so its host element and the items beneath it
  // keep their identity across open/close instead of remounting.
  const resolved: Props = { role: "group", ariaLabelledBy: labelId, ...props, ref, "data-disabled": context.disabled ? "" : undefined, className: resolveClassName(className, {}), style: context.open ? resolvePartStyle(style, {}) : { display: "none" } }
  return <SelectGroupContext.Provider value={groupContext}>{renderPart({ render, props: resolved, children, state: {}, ref }) as ReactElement}</SelectGroupContext.Provider>
})

export interface SelectLabelState {
  disabled: boolean
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
}
export type SelectLabelProps = SelectPartProps<SelectLabelState>

export interface SelectGroupLabelState {}
export const SelectGroupLabel = forwardRef<PublicInstance, SelectPartProps<SelectGroupLabelState>>(function SelectGroupLabel(componentProps, ref) {
  const { render, className, style, children, id, ariaHidden, ["aria-hidden"]: ariaHiddenAttribute, ...props } = componentProps
  useSelectContext("SelectGroupLabel")
  const groupContext = useContext(SelectGroupContext)
  if (!groupContext) throw new Error("Base UI: SelectGroupContext is missing. SelectGroup parts must be placed within <Select.Group>.")
  const generatedId = useId()
  const labelId = id ?? generatedId
  useLayoutEffect(() => {
    groupContext.setLabelId(labelId)
    return () => groupContext.setLabelId((currentId) => currentId === labelId ? undefined : currentId)
  }, [groupContext.setLabelId, labelId])
  const hasAriaHidden = Object.prototype.hasOwnProperty.call(componentProps, "ariaHidden") || Object.prototype.hasOwnProperty.call(componentProps, "aria-hidden")
  const resolvedAriaHidden = Object.prototype.hasOwnProperty.call(componentProps, "ariaHidden") ? ariaHidden : ariaHiddenAttribute
  const resolved: Props = { ...props, id: labelId, ref, ariaHidden: hasAriaHidden ? resolvedAriaHidden : true, className: resolveClassName(className, {}), style: resolvePartStyle(style, {}) }
  if (typeof render === "function") return <>{render(resolved, {})}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export const SelectLabel = forwardRef<PublicInstance, SelectPartProps<SelectLabelState>>(function SelectLabel({ render, className, style, children, id, ...props }, ref) {
  const context = useSelectContext("SelectLabel")
  const state = { disabled: context.disabled, touched: false, dirty: context.value !== null, valid: null, filled: context.value !== null, focused: context.focused }
  const resolved: Props = { ...props, id: id ?? context.fieldLabelId, ref, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }
  if (typeof render === "function") return <>{render(resolved, state)}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export interface SelectPositionerProps extends PositionerProps {
  children?: ReactNode
  alignItemWithTrigger?: boolean | undefined
}

export const SelectPositioner = forwardRef<PublicInstance, SelectPositionerProps>(function SelectPositioner({ children, open, alignItemWithTrigger: _alignItemWithTrigger, ...props }, ref) {
  const context = useSelectContext("SelectPositioner")
  const isOpen = open ?? context.open
  const side = props.side ?? "bottom"
  const align = props.align ?? "center"
  const triggerRect = context.triggerRef.current?.getBoundingClientRect()
  const triggerPosition = triggerRect
    ? side === "top"
      ? { x: align === "start" ? triggerRect.left : align === "end" ? triggerRect.right : triggerRect.left + triggerRect.width / 2, y: triggerRect.top }
      : side === "bottom"
        ? { x: align === "start" ? triggerRect.left : align === "end" ? triggerRect.right : triggerRect.left + triggerRect.width / 2, y: triggerRect.bottom }
        : side === "left"
          ? { x: triggerRect.left, y: align === "start" ? triggerRect.top : align === "end" ? triggerRect.bottom : triggerRect.top + triggerRect.height / 2 }
          : { x: triggerRect.right, y: align === "start" ? triggerRect.top : align === "end" ? triggerRect.bottom : triggerRect.top + triggerRect.height / 2 }
    : context.popupPosition
  return (
    <SelectPositionedContext.Provider value>
      <SelectPopupSideContext.Provider value={side}>
        <FloatingPositioner {...props} anchor={props.anchor ?? context.triggerRef.current as unknown as Element | null} ref={ref} open={isOpen} position={props.position ?? triggerPosition}>
          {children}
        </FloatingPositioner>
      </SelectPopupSideContext.Provider>
    </SelectPositionedContext.Provider>
  )
})

export interface SelectBackdropState { open: boolean; transitionStatus: "starting" | "ending" | "idle" }
export const SelectBackdrop = forwardRef<PublicInstance, SelectPartProps<SelectBackdropState>>(function SelectBackdrop({ render, className, style, children, ...props }, ref) {
  const context = useSelectContext("SelectBackdrop")
  const state: SelectBackdropState = { open: context.open, transitionStatus: "idle" }
  const resolved: Props = { ...props, ref, "data-open": context.open ? "" : undefined, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }
  if (typeof render === "function") return <>{render(resolved, state)}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export interface SelectPortalProps extends SelectPartProps<Record<string, never>> {
  container?: HTMLElement | ShadowRoot | React.RefObject<HTMLElement | ShadowRoot | null> | null | undefined
}
export const SelectPortal = forwardRef<PublicInstance, SelectPortalProps>(function SelectPortal({ render, className, style, children, container: _container, ...props }, ref) {
  const resolved: Props = { ...props, ref, className: resolveClassName(className, {}), style: resolvePartStyle(style, {}) }
  if (typeof render === "function") return <>{render(resolved, {})}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export interface SelectArrowState { open: boolean; side: string | "none"; align: string; uncentered: boolean }
export const SelectArrow = forwardRef<PublicInstance, SelectPartProps<SelectArrowState>>(function SelectArrow({ render, className, style, children, ...props }, ref) {
  const context = useSelectContext("SelectArrow")
  const side = useContext(SelectPopupSideContext)
  const state: SelectArrowState = { open: context.open, side: context.open ? side : "none", align: "center", uncentered: false }
  const resolved: Props = { ...props, ref, "data-open": context.open ? "" : undefined, "data-side": state.side, "data-align": state.align, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }
  if (typeof render === "function") return <>{render(resolved, state)}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export interface SelectSeparatorState { orientation: "horizontal" | "vertical" }
export interface SelectSeparatorProps extends SelectPartProps<SelectSeparatorState> { orientation?: "horizontal" | "vertical" | undefined }

export const SelectSeparator = forwardRef<PublicInstance, SelectSeparatorProps>(
  function SelectSeparator({ render, className, style, orientation = "horizontal", children, ...props }, ref) {
    const context = useSelectContext("SelectSeparator")
    if (!context.open) return null
    const state = { orientation }
    return renderPart({ render, props: { ...props, role: "separator", "aria-orientation": orientation, "data-orientation": orientation, className: resolveClassName(className, state), style: resolvePartStyle(style, state) }, children, state, ref }) as ReactElement
  }
)

export interface SelectScrollArrowState {
  direction: "up" | "down"
  visible: boolean
  side: string
  transitionStatus: "idle"
}
export interface SelectScrollArrowProps extends SelectPartProps<SelectScrollArrowState> { keepMounted?: boolean | undefined }

export const SelectScrollUpArrow = forwardRef<PublicInstance, SelectScrollArrowProps>(
  function SelectScrollUpArrow({ render, keepMounted = false, className, style, children, ...props }, ref) {
    const context = useSelectContext("SelectScrollUpArrow")
    const side = useContext(SelectPopupSideContext)
    const state: SelectScrollArrowState = {
      direction: "up",
      visible: context.canScrollUp,
      side,
      transitionStatus: "idle",
    }
    if (!context.canScrollUp && !keepMounted) return null
    return renderPart({ render, props: { ...props, "data-side": side, style: resolvePartStyle(style, state), className: resolveClassName(className, state) }, children, state, ref }) as ReactElement
  }
)

export const SelectScrollDownArrow = forwardRef<PublicInstance, SelectScrollArrowProps>(
  function SelectScrollDownArrow({ render, keepMounted = false, className, style, children, ...props }, ref) {
    const context = useSelectContext("SelectScrollDownArrow")
    const side = useContext(SelectPopupSideContext)
    const state: SelectScrollArrowState = {
      direction: "down",
      visible: context.canScrollDown,
      side,
      transitionStatus: "idle",
    }
    if (!context.canScrollDown && !keepMounted) return null
    return renderPart({ render, props: { ...props, "data-side": side, style: resolvePartStyle(style, state), className: resolveClassName(className, state) }, children, state, ref }) as ReactElement
  }
)

export function SelectRoot<Value = unknown, Multiple extends boolean | undefined = false>(props: SelectProps<Value, Multiple>): ReactElement {
  return <Select {...props} />
}

export namespace Select {
  export import Root = SelectRoot
  export import Trigger = SelectTrigger
  export import Value = SelectValue
  export import Icon = SelectIcon
  export import Portal = SelectPortal
  export import Backdrop = SelectBackdrop
  export import Positioner = SelectPositioner
  export import Popup = SelectPopup
  export import List = SelectList
  export import Item = SelectItem
  export import ItemIndicator = SelectItemIndicator
  export import ItemText = SelectItemText
  export import Arrow = SelectArrow
  export import ScrollUpArrow = SelectScrollUpArrow
  export import ScrollDownArrow = SelectScrollDownArrow
  export import Group = SelectGroup
  export import GroupLabel = SelectGroupLabel
  export import Label = SelectLabel
  export import Separator = SelectSeparator
}

export namespace SelectRoot { export type Props<Value = unknown, Multiple extends boolean | undefined = false> = SelectRootProps<Value, Multiple>; export type State = SelectRootState; export type Actions = SelectRootActions; export type ChangeEventReason = SelectRootChangeEventReason; export type ChangeEventDetails = SelectRootChangeEventDetails }
export namespace SelectTrigger { export type Props = SelectTriggerProps; export type State = SelectTriggerState }
export namespace SelectValue { export type Props = SelectValueProps; export type State = SelectValueState }
export namespace SelectIcon { export type Props = SelectIconProps; export type State = SelectIconState }
export namespace SelectPortal { export type Props = SelectPortalProps; export type State = SelectPortalState }
export namespace SelectBackdrop { export type Props = SelectBackdropProps; export type State = SelectBackdropState }
export namespace SelectPositioner { export type Props = SelectPositionerProps; export type State = SelectPositionerState }
export namespace SelectPopup { export type Props = SelectPopupProps; export type State = SelectPopupState }
export namespace SelectList { export type Props = SelectListProps; export type State = Record<string, never> }
export namespace SelectItem { export type Props = SelectItemProps; export type State = SelectItemState }
export namespace SelectItemIndicator { export type Props = SelectItemIndicatorProps; export type State = SelectItemIndicatorState }
export namespace SelectItemText { export type Props = SelectItemTextProps; export type State = Record<string, never> }
export namespace SelectArrow { export type Props = SelectArrowProps; export type State = SelectArrowState }
export namespace SelectScrollUpArrow { export type Props = SelectScrollUpArrowProps; export type State = SelectScrollUpArrowState }
export namespace SelectScrollDownArrow { export type Props = SelectScrollDownArrowProps; export type State = SelectScrollDownArrowState }
export namespace SelectGroup { export type Props = SelectGroupProps; export type State = SelectGroupState }
export namespace SelectGroupLabel { export type Props = SelectGroupLabelProps; export type State = SelectGroupLabelState }
export namespace SelectLabel { export type Props = SelectLabelProps; export type State = SelectLabelState }
export namespace SelectSeparator { export type Props = SelectSeparatorProps; export type State = SelectSeparatorState }

export {
  Select as Root,
  SelectPopup as Popup,
  SelectGroup as Group,
  SelectGroupLabel as GroupLabel,
  SelectIcon as Icon,
  SelectItem as Item,
  SelectItemIndicator as ItemIndicator,
  SelectItemText as ItemText,
  SelectList as List,
  SelectLabel as Label,
  SelectPortal as Portal,
  SelectBackdrop as Backdrop,
  SelectPositioner as Positioner,
  SelectArrow as Arrow,
  SelectScrollDownArrow as ScrollDownArrow,
  SelectScrollUpArrow as ScrollUpArrow,
  SelectSeparator as Separator,
  SelectTrigger as Trigger,
  SelectValue as Value,
}

export type SelectRootProps<Value = unknown, Multiple extends boolean | undefined = false> = SelectProps<Value, Multiple>
export type SelectRootState = Record<string, never>
export interface SelectRootActions { unmount: () => void }
export type SelectRootChangeEventReason = SelectChangeEventDetails["reason"]
export type SelectRootChangeEventDetails = SelectChangeEventDetails
export type SelectGroupProps = SelectPartProps<Record<string, never>>
export type SelectGroupState = Record<string, never>
export type SelectGroupLabelProps = SelectPartProps<SelectGroupLabelState>
export type SelectPositionerState = PositionerState
export type SelectBackdropProps = SelectPartProps<SelectBackdropState>
export type SelectPortalState = Record<string, never>
export type SelectArrowProps = SelectPartProps<SelectArrowState>
export type SelectScrollUpArrowProps = SelectScrollArrowProps
export type SelectScrollDownArrowProps = SelectScrollArrowProps
export type SelectScrollUpArrowState = SelectScrollArrowState
export type SelectScrollDownArrowState = SelectScrollArrowState
