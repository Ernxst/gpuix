/** Headless Combobox components with native GPUI text input. */

import React, {
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type {
  GpuixChangeEvent,
  GpuixFocusEvent,
  GpuixKeyboardEvent,
  GpuixMouseEvent,
  GpuixSyntheticEvent,
} from "../reconciler/synthetic-event.js"
import type { InputProps, Props, PublicInstance, StyleDesc } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import {
  DismissLayerScope,
  FloatingLayer,
  FloatingPositioner,
  renderSlot,
  setRefs,
  useControllableState,
  useDismissLayer,
  usePositionerState,
} from "./floating.js"
import type { PositionerProps, PositionerState, StateStyle } from "./floating.js"

export type ComboboxValue<Value = unknown, Multiple extends boolean | undefined = boolean | undefined> =
  Multiple extends true ? Value[] : Multiple extends false ? Value | null : Value | Value[] | null

export type ComboboxChangeReason =
  | "trigger-press" | "input-press" | "outside-press" | "item-press" | "close-press"
  | "escape-key" | "list-navigation" | "focus-out" | "input-change" | "input-clear"
  | "clear-press" | "chip-remove-press" | "cancel-open" | "none"

export interface ComboboxChangeEventDetails {
  reason: ComboboxChangeReason
  event: GpuixSyntheticEvent | undefined
  cancel: () => void
  allowPropagation: () => void
  isCanceled: boolean
  isPropagationAllowed: boolean
  isItemPress?: boolean
}

export type ComboboxHighlightEventReason = "keyboard" | "pointer" | "none"
export interface ComboboxHighlightEventDetails {
  reason: ComboboxHighlightEventReason
  event: GpuixSyntheticEvent | undefined
  index: number
  cancel: () => void
  allowPropagation: () => void
  isCanceled: boolean
  isPropagationAllowed: boolean
}

export type ComboboxPrimitiveValue = string | number | bigint | boolean
declare const comboboxItemCollectionBrand: unique symbol
export interface ComboboxItemCollection<Item = unknown, Value = Item> {
  readonly [comboboxItemCollectionBrand]: { item: Item; value: Value }
}
interface ComboboxItemCollectionData<Item = unknown, Value = Item> {
  data: readonly Item[] | readonly { items: readonly Item[]; [key: string]: unknown }[] | undefined
  readonly value: (item: Item) => Value
  readonly itemLabel: (item: Item) => string
  readonly label: (value: Value, equal: (a: Value, b: Value) => boolean, fallback?: (value: Value) => string) => string
}

export function createComboboxItems<Item, Value extends ComboboxPrimitiveValue>(
  data: readonly Item[] | readonly { items: readonly Item[]; [key: string]: unknown }[] | undefined,
  options: { getValue: (item: Item) => Value; getLabel: (item: Item) => string }
): ComboboxItemCollection<Item, Value> {
  const resolve = (value: Value, equal: (a: Value, b: Value) => boolean, fallback: (value: Value) => string = String): string => {
    const groups = data ?? []
    for (const group of groups) {
      const entries = group && typeof group === "object" && "items" in group ? group.items : [group as Item]
      for (const item of entries as readonly Item[]) if (equal(options.getValue(item), value)) return options.getLabel(item)
    }
    return fallback(value)
  }
  return {
    data,
    value: options.getValue,
    itemLabel: options.getLabel,
    label: resolve,
  } as unknown as ComboboxItemCollection<Item, Value>
}

export interface ComboboxFilterOptions extends Intl.CollatorOptions { locale?: Intl.LocalesArgument | undefined; multiple?: boolean | undefined; value?: unknown }
export interface ComboboxFilter {
  contains: <Item>(item: Item, query: string, itemToString?: (item: Item) => string) => boolean
  startsWith: <Item>(item: Item, query: string, itemToString?: (item: Item) => string) => boolean
  endsWith: <Item>(item: Item, query: string, itemToString?: (item: Item) => string) => boolean
}

export function useComboboxFilter(options: ComboboxFilterOptions = {}): ComboboxFilter {
  return useMemo(() => {
    const { locale, multiple = false, value, ...collatorOptions } = options
    const collator = new Intl.Collator(locale, { usage: "search", sensitivity: "base", ignorePunctuation: true, ...collatorOptions })
    const stringify = (item: unknown, itemToString?: (item: unknown) => string) => {
      if (itemToString) return itemToString(item)
      if (item && typeof item === "object" && "value" in item) return String((item as { value: unknown }).value ?? "")
      return String(item ?? "")
    }
    const matches = <Item,>(item: Item, query: string, itemToString: (item: Item) => string, mode: "contains" | "startsWith" | "endsWith") => {
      if (query.length === 0) return true
      const candidate = itemToString(item)
      const test = (part: string) => collator.compare(part, query) === 0
      if (mode === "startsWith") return test(candidate.slice(0, query.length))
      if (mode === "endsWith") return test(candidate.slice(-query.length))
      for (let index = 0; index <= candidate.length - query.length; index++) {
        if (test(candidate.slice(index, index + query.length))) return true
      }
      return false
    }
    return {
      contains: <Item,>(item: Item, query: string, toString?: (item: Item) => string) => {
        const label = (candidate: Item) => stringify(candidate, toString as ((item: unknown) => string) | undefined)
        if (!multiple && value != null) {
          const selected = label(value as Item)
          if (selected.length === query.length && collator.compare(selected, query) === 0) return true
        }
        return matches(item, query, label, "contains")
      },
      startsWith: <Item,>(item: Item, query: string, toString?: (item: Item) => string) => matches(item, query, (candidate) => stringify(candidate, toString as ((item: unknown) => string) | undefined), "startsWith"),
      endsWith: <Item,>(item: Item, query: string, toString?: (item: Item) => string) => matches(item, query, (candidate) => stringify(candidate, toString as ((item: unknown) => string) | undefined), "endsWith"),
    }
  }, [options])
}

export function useFilteredComboboxItems<Item = unknown>(): Item[] {
  return useComboboxContext("Combobox.useFilteredItems").filteredItems as Item[]
}

export interface ComboboxRootState {
  open: boolean
  disabled: boolean
  readOnly: boolean
  required: boolean
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
  popupSide: PositionerState["side"] | null
  listEmpty: boolean
  placeholder: boolean
  value: unknown
}

interface ComboboxItemRecord<Value> {
  value: Value
  label: string
  textValue: string
  disabled: boolean
  instance: PublicInstance | null
}

interface ComboboxContextValue<Value = unknown> {
  open: boolean
  disabled: boolean
  readOnly: boolean
  required: boolean
  touched: boolean
  dirty: boolean
  valid: boolean | null
  filled: boolean
  focused: boolean
  setFocused: React.Dispatch<React.SetStateAction<boolean>>
  setTouched: React.Dispatch<React.SetStateAction<boolean>>
  name?: string
  form?: string
  formAutoComplete?: string
  autoComplete: "list"
  locale?: Intl.LocalesArgument
  openOnInputClick: boolean
  multiple: boolean
  value: Value | Value[] | null
  inputValue: string
  items: readonly unknown[]
  filteredItems: readonly unknown[]
  selectedValues: readonly Value[]
  activeValue: Value | undefined
  activeIndex: number
  listId: string
  labelId: string
  hasLabel: boolean
  setHasLabel: React.Dispatch<React.SetStateAction<boolean>>
  inputId: string
  inputRef: React.MutableRefObject<PublicInstance | null>
  inputRefProp?: React.Ref<HTMLInputElement>
  itemRecords: Map<unknown, ComboboxItemRecord<Value>>
  itemToValue: (item: unknown) => Value
  itemToLabel: (value: Value) => string
  isEqual: (left: Value, right: Value) => boolean
  setOpen: (open: boolean, reason?: ComboboxChangeReason, event?: GpuixSyntheticEvent) => void
  setInputValue: (value: string, reason?: ComboboxChangeReason, event?: GpuixSyntheticEvent) => void
  setValue: (value: Value | Value[] | null, reason?: ComboboxChangeReason, event?: GpuixSyntheticEvent) => void
  setActive: (value: Value | undefined, reason?: ComboboxHighlightEventReason, event?: GpuixSyntheticEvent) => void
  moveActive: (delta: number, event?: GpuixKeyboardEvent) => void
  select: (value: Value, event?: GpuixSyntheticEvent) => void
  registerItem: (record: ComboboxItemRecord<Value>, instance: PublicInstance | null) => void
  isTopDismissLayer: (event?: GpuixKeyboardEvent) => boolean
  filter: null | ((item: unknown, query: string, itemToString?: (item: unknown) => string) => boolean)
  itemToStringLabel: (value: Value) => string
  matchesItem: (item: unknown, query: string) => boolean
  autoHighlight: boolean | "always"
  highlightItemOnHover: boolean
}

const ComboboxContext = createContext<ComboboxContextValue<any> | null>(null)
const ComboboxPositionedContext = createContext(false)
const ComboboxGroupItemsContext = createContext<readonly unknown[] | null>(null)
const ComboboxItemContext = createContext<{ selected: boolean } | null>(null)
const ComboboxGroupContext = createContext<string | null>(null)
const ComboboxChipIndexContext = createContext<number | null>(null)
const ComboboxChipRegistryContext = createContext<((id: string, update: (index: number) => void) => () => void) | null>(null)

function useComboboxContext(name: string): ComboboxContextValue {
  const context = useContext(ComboboxContext)
  if (!context) throw new Error(`${name} must be used inside Combobox.Root`)
  return context
}

function getFieldState(context: ComboboxContextValue) {
  return { touched: context.touched, dirty: context.dirty, valid: context.valid, filled: context.filled, focused: context.focused }
}

function getRootState(context: ComboboxContextValue, popupSide: PositionerState["side"] | null = null): ComboboxRootState {
  return { ...getFieldState(context), open: context.open, disabled: context.disabled, readOnly: context.readOnly, required: context.required, popupSide, listEmpty: context.filteredItems.length === 0, placeholder: context.selectedValues.length === 0, value: context.value }
}

function changeDetails(reason: ComboboxChangeReason, event?: GpuixSyntheticEvent, isItemPress?: boolean): ComboboxChangeEventDetails {
  let canceled = false
  let propagationAllowed = false
  return {
    reason,
    event,
    isItemPress,
    cancel() { canceled = true },
    allowPropagation() { propagationAllowed = true },
    get isCanceled() { return canceled },
    get isPropagationAllowed() { return propagationAllowed },
  }
}

function highlightDetails(reason: ComboboxHighlightEventReason, index: number, event?: GpuixSyntheticEvent): ComboboxHighlightEventDetails {
  let canceled = false
  let propagationAllowed = false
  return {
    reason, event, index,
    cancel() { canceled = true },
    allowPropagation() { propagationAllowed = true },
    get isCanceled() { return canceled },
    get isPropagationAllowed() { return propagationAllowed },
  }
}

export interface ComboboxRootProps<Value, Multiple extends boolean | undefined = false, Item = Value> extends Omit<Props, "children" | "onChange" | "className" | "style"> {
  children?: ReactNode
  multiple?: Multiple | undefined
  value?: ComboboxValue<Value, Multiple> | undefined
  defaultValue?: ComboboxValue<Value, Multiple> | undefined
  onValueChange?: (value: ComboboxValue<Value, Multiple>, details: ComboboxChangeEventDetails) => void
  open?: boolean | undefined
  defaultOpen?: boolean | undefined
  onOpenChange?: (open: boolean, details: ComboboxChangeEventDetails) => void
  onOpenChangeComplete?: (open: boolean) => void
  inputValue?: string | undefined
  defaultInputValue?: string | undefined
  onInputValueChange?: (value: string, details: ComboboxChangeEventDetails) => void
  onItemHighlighted?: (value: Value | undefined, details: ComboboxHighlightEventDetails) => void
  items?: readonly Item[] | readonly { items: readonly Item[]; [key: string]: unknown }[] | ComboboxItemCollection<Item, Value> | undefined
  filteredItems?: readonly Item[] | readonly { items: readonly Item[]; [key: string]: unknown }[] | undefined
  filter?: null | ((item: Item, query: string, itemToString?: (item: Item) => string) => boolean) | undefined
  limit?: number | undefined
  autoHighlight?: boolean | "always" | undefined
  highlightItemOnHover?: boolean | undefined
  keepHighlight?: boolean | undefined
  openOnInputClick?: boolean | undefined
  loopFocus?: boolean | undefined
  grid?: boolean | undefined
  virtualized?: boolean | undefined
  inline?: boolean | undefined
  readOnly?: boolean | undefined
  disabled?: boolean | undefined
  required?: boolean | undefined
  name?: string | undefined
  form?: string | undefined
  id?: string | undefined
  autoComplete?: string | undefined
  locale?: Intl.LocalesArgument | undefined
  itemToStringLabel?: ((value: Value) => string) | undefined
  itemToStringValue?: ((value: Value) => string) | undefined
  isItemEqualToValue?: ((itemValue: Value, value: Value) => boolean) | undefined
  actionsRef?: React.RefObject<{ unmount: () => void } | null> | undefined
  inputRef?: React.Ref<HTMLInputElement> | undefined
  modal?: boolean | undefined
}

export type ComboboxProps<Value = unknown, Multiple extends boolean | undefined = false, Item = Value> = ComboboxRootProps<Value, Multiple, Item>

export function ComboboxRoot<Value = unknown, Multiple extends boolean | undefined = false, Item = Value>({
  children, items: itemsProp, filteredItems: filteredItemsProp, value: valueProp, defaultValue,
  onValueChange, open: openProp, defaultOpen = false, onOpenChange, onOpenChangeComplete,
  inputValue: inputValueProp, defaultInputValue, onInputValueChange, onItemHighlighted,
  multiple = false as Multiple, filter, limit = -1, autoHighlight = false, highlightItemOnHover = true,
  openOnInputClick = true, loopFocus = true, readOnly = false, disabled = false, required = false,
  autoComplete, locale,
  itemToStringLabel = (value) => value && typeof value === "object" && "label" in value ? String((value as { label: unknown }).label ?? "") : String(value ?? ""),
  itemToStringValue = (value) => value && typeof value === "object" && "value" in value ? String((value as { value: unknown }).value ?? "") : String(value ?? ""),
  isItemEqualToValue = Object.is, inputRef: inputRefProp, id, ...props
}: ComboboxRootProps<Value, Multiple, Item>): ReactElement {
  const { renderer } = useGpuix()
  const inputRef = useRef<PublicInstance | null>(null)
  const generatedListId = useId()
  const listId = id ? `${id}-popup` : generatedListId
  const generatedLabelId = useId()
  const [hasLabel, setHasLabel] = useState(false)
  const generatedInputId = id ?? `combobox-input-${listId}`
  const collection = itemsProp && !Array.isArray(itemsProp) ? itemsProp as unknown as ComboboxItemCollectionData<Item, Value> : null
  const initialInputValue = defaultValue == null || multiple
    ? ""
    : collection
      ? collection.label(defaultValue as Value, isItemEqualToValue, itemToStringLabel)
      : itemToStringLabel(defaultValue as Value)
  const [value, setValueState] = useControllableState<ComboboxValue<Value, Multiple>>({ value: valueProp, defaultValue: (defaultValue ?? null) as ComboboxValue<Value, Multiple> })
  const [inputValue, setInputValueState] = useControllableState({ value: inputValueProp, defaultValue: defaultInputValue ?? initialInputValue })
  const [open, setOpenState] = useControllableState({ value: openProp, defaultValue: defaultOpen })
  const [activeValue, setActiveValue] = useState<Value | undefined>()
  const [focused, setFocused] = useState(false)
  const [touched, setTouched] = useState(false)
  const records = useRef(new Map<unknown, ComboboxItemRecord<Value>>())
  const [, setItemRevision] = useState(0)
  const dismiss = useDismissLayer(open)
  const sourceItems = collection ? collection.data ?? [] : (itemsProp as readonly Item[] | readonly { items: readonly Item[] }[] | undefined) ?? Array.from(records.current.values(), (record) => record.value as unknown as Item)
  const itemToValue = (item: unknown): Value => collection && flatItems.includes(item) ? collection.value(item as Item) : item as Value
  const labelFor = (value: Value): string => collection
    ? collection.label(value, isItemEqualToValue, itemToStringLabel)
    : itemToStringLabel(value)
  const candidates = filteredItemsProp ?? sourceItems
  const flatten = (items: readonly unknown[]): unknown[] => items.flatMap((item) => {
    if (item && typeof item === "object" && "items" in item) return flatten((item as { items: readonly unknown[] }).items)
    return [item]
  })
  const flatItems = flatten(candidates)
  const defaultFilter = useComboboxFilter({ locale })
  const matchesItem = (item: unknown, query: string) => {
    if (!query || filter === null) return true
    if (!multiple && value != null && defaultFilter.contains(value as Value, query, labelFor)) return true
    const label = collection ? collection.itemLabel(item as Item) : itemToStringLabel(itemToValue(item))
    const itemToString = (entry: unknown) => collection ? collection.itemLabel(entry as Item) : itemToStringLabel(itemToValue(entry))
    return filter ? filter(item as Item, query, itemToString) : defaultFilter.contains(item, query, itemToString)
  }
  const filteredItems = useMemo(() => {
    const query = String(inputValue ?? "").trim()
    const matches = flatItems.filter((item) => filteredItemsProp || matchesItem(item, query))
    if (query && !filter && !filteredItemsProp) {
      matches.sort((left, right) => {
        const leftLabel = (collection ? collection.itemLabel(left as Item) : itemToStringLabel(itemToValue(left))).toLocaleLowerCase()
        const rightLabel = (collection ? collection.itemLabel(right as Item) : itemToStringLabel(itemToValue(right))).toLocaleLowerCase()
        const normalizedQuery = query.toLocaleLowerCase()
        return Number(!leftLabel.startsWith(normalizedQuery)) - Number(!rightLabel.startsWith(normalizedQuery))
      })
    }
    return limit >= 0 ? matches.slice(0, limit) : matches
  }, [flatItems, inputValue, filter, filteredItemsProp, limit, collection, itemToStringLabel, locale, value, multiple])
  const selectedValues: Value[] = Array.isArray(value) ? value as Value[] : value === null || value === undefined ? [] : [value as Value]
  const initialValues = Array.isArray(defaultValue) ? defaultValue as Value[] : defaultValue == null ? [] : [defaultValue as Value]
  const dirty = selectedValues.length !== initialValues.length || selectedValues.some((selected, index) => !isItemEqualToValue(selected, initialValues[index]!))
  const fieldState = { touched, dirty, valid: null, filled: selectedValues.length > 0, focused }
  const activeIndex = activeValue === undefined ? -1 : filteredItems.findIndex((item) => isItemEqualToValue(itemToValue(item), activeValue))
  const disabledFor = (candidate: unknown) => records.current.get(itemToValue(candidate))?.disabled ?? false

  const setOpen = (next: boolean, reason: ComboboxChangeReason = "trigger-press", event?: GpuixSyntheticEvent) => {
    if (open === next) return
    const details = changeDetails(reason, event)
    onOpenChange?.(next, details)
    if (details.isCanceled) return
    setOpenState(next)
    onOpenChangeComplete?.(next)
    if (next && autoHighlight === "always") {
      const first = filteredItems.find((item) => !disabledFor(item))
      setActiveValue(first === undefined ? undefined : itemToValue(first))
    }
    if (!next && inputRef.current) renderer?.focusElement?.(inputRef.current.id)
  }
  const setInputValue = (next: string, reason: ComboboxChangeReason = "input-change", event?: GpuixSyntheticEvent, isItemPress?: boolean) => {
    const details = changeDetails(reason, event, isItemPress)
    onInputValueChange?.(next, details)
    if (details.isCanceled) return false
    setInputValueState(next)
    if (autoHighlight && next) {
      const first = flatItems.filter((item) => filteredItemsProp || matchesItem(item, next.trim())).slice(0, limit >= 0 ? limit : undefined).find((item) => !disabledFor(item))
      setActiveValue(first === undefined ? undefined : itemToValue(first))
    }
    if (!disabled && !readOnly) setOpen(true, "input-press", event)
    return true
  }
  const setValue = (next: Value | Value[] | null, reason: ComboboxChangeReason = "none", event?: GpuixSyntheticEvent) => {
    const details = changeDetails(reason, event)
    onValueChange?.(next as ComboboxValue<Value, Multiple>, details)
    if (!details.isCanceled) setValueState(next as ComboboxValue<Value, Multiple>)
    return !details.isCanceled
  }
  const setActive = (next: Value | undefined, reason: ComboboxHighlightEventReason = "none", event?: GpuixSyntheticEvent) => {
    const index = next === undefined ? -1 : filteredItems.findIndex((item) => isItemEqualToValue(itemToValue(item), next))
    const details = highlightDetails(reason, index, event)
    onItemHighlighted?.(next, details)
    if (!details.isCanceled) setActiveValue(next)
  }
  const moveActive = (delta: number, event?: GpuixKeyboardEvent) => {
    const enabled = filteredItems.filter((item) => !disabledFor(item))
    if (!enabled.length) return
    const index = activeValue === undefined ? (delta > 0 ? -1 : 0) : enabled.findIndex((item) => isItemEqualToValue(itemToValue(item), activeValue))
    const nextIndex = index + delta
    if (!loopFocus && (nextIndex < 0 || nextIndex >= enabled.length)) return
    setActive(itemToValue(enabled[(nextIndex + enabled.length) % enabled.length]!), "keyboard", event)
  }
  const select = (selected: Value, event?: GpuixSyntheticEvent) => {
    if (disabled || readOnly) return
    const next = multiple
      ? (selectedValues.some((item) => isItemEqualToValue(item, selected))
        ? selectedValues.filter((item) => !isItemEqualToValue(item, selected))
        : [...selectedValues, selected])
      : selected
    if (!setValue(next as Value | Value[] | null, "item-press", event)) return
    if (multiple) {
      if (inputValue) setInputValue("", "input-clear", event, true)
    } else {
      setInputValue(itemToLabel(selected), "item-press", event)
      setOpen(false, "item-press", event)
    }
  }
  const registerItem = useCallback((record: ComboboxItemRecord<Value>, instance: PublicInstance | null) => {
    const previous = records.current.get(record.value)
    if (instance) {
      if (previous?.instance === instance && previous.disabled === record.disabled && previous.label === record.label) return
      records.current.set(record.value, { ...record, instance })
      setItemRevision((revision) => revision + 1)
    } else if (previous) {
      records.current.delete(record.value)
      setItemRevision((revision) => revision + 1)
    }
  }, [])
  const itemToLabel = labelFor
  const context: ComboboxContextValue<Value> = {
    open, disabled, readOnly, required, ...fieldState, setFocused, setTouched, name: props.name, form: props.form, autoComplete: "list", locale,
    formAutoComplete: autoComplete, openOnInputClick, multiple: multiple === true, value: value as Value | Value[] | null,
    inputValue: String(inputValue ?? ""), items: flatItems, filteredItems, selectedValues,
    activeValue, activeIndex, listId, labelId: generatedLabelId, hasLabel, setHasLabel, inputId: generatedInputId, inputRef, inputRefProp,
    itemRecords: records.current, itemToValue, itemToLabel, isEqual: isItemEqualToValue, matchesItem,
    setOpen, setInputValue, setValue, setActive, moveActive, select, registerItem,
    isTopDismissLayer: dismiss, filter: (filter ?? null) as ComboboxContextValue<Value>["filter"], itemToStringLabel, autoHighlight, highlightItemOnHover,
  }
  return (
    <ComboboxContext.Provider value={context}>
      <DismissLayerScope>
        {children}
        {props.name && (multiple
          ? selectedValues.map((selected, index) => (
            <input key={`${String(selected)}-${index}`} type="hidden" name={props.name} form={props.form} autoComplete={autoComplete} disabled={disabled} value={itemToStringValue(selected)} />
          ))
          : <input type="hidden" name={props.name} form={props.form} autoComplete={autoComplete} disabled={disabled} value={value == null ? "" : itemToStringValue(value as Value)} />)}
      </DismissLayerScope>
    </ComboboxContext.Provider>
  )
}

type PartProps<State, Excluded extends keyof Props = never> = Omit<Props, "className" | "style" | Excluded> & {
  render?: ReactElement | ((props: Props, state: State) => ReactNode) | undefined
  className?: string | ((state: State) => string | undefined) | undefined
  style?: StateStyle<State> | ((state: State) => StyleDesc | undefined) | undefined
}

function renderPart<State>(tag: string, render: PartProps<State>["render"], props: Props, children: ReactNode, state: State, ref?: React.Ref<PublicInstance>): ReactNode {
  const resolved = { ...props, ref: props.ref ?? ref }
  if (typeof render === "function") return render(resolved, state)
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return React.createElement(tag, resolved, children)
}

function stateProps<State>(props: PartProps<State>, state: State): Props {
  const { render: _render, className, style, ...rest } = props
  return { ...rest, className: typeof className === "function" ? className(state) : className, style: typeof style === "function" ? style(state) : style }
}

export interface ComboboxInputState extends ComboboxRootState {}
export interface ComboboxInputProps extends Omit<InputProps, "style" | "className" | "ref">, PartProps<ComboboxInputState> { disabled?: boolean | undefined }
export const ComboboxInput = forwardRef<PublicInstance, ComboboxInputProps>(function ComboboxInput({ render, className, style, disabled: disabledProp, onChange, onClick, onFocus, onBlur, onKeyDown, ...props }, ref) {
  const context = useComboboxContext("Combobox.Input")
  const positioner = usePositionerState()
  const disabled = disabledProp ?? context.disabled
  const state = { ...getRootState(context, positioner?.side ?? null), disabled, placeholder: context.value === null || context.value === undefined }
  const resolved = { ...props, ...stateProps({ render, className, style }, state), ref: (instance: PublicInstance | null) => { context.inputRef.current = instance; const passedRef = context.inputRefProp; if (typeof context.inputRefProp === "function") context.inputRefProp(instance as unknown as HTMLInputElement | null); else if (context.inputRefProp) context.inputRefProp.current = instance as unknown as HTMLInputElement | null; setRefs(instance, ref) }, value: context.inputValue, name: props.name, form: props.form ?? context.form, required: props.required ?? context.required, autoComplete: "off", disabled, readOnly: context.readOnly, role: "combobox", ariaLabelledBy: props.ariaLabelledBy ?? props["aria-labelledby"] ?? (context.hasLabel && !props["aria-label"] && !props.ariaLabel ? context.labelId : undefined), ariaExpanded: context.open, ariaControls: context.open ? context.listId : undefined, ariaAutoComplete: context.readOnly ? "none" : context.autoComplete, ariaHasPopup: "listbox", ariaActiveDescendant: context.activeIndex >= 0 ? `${context.listId}-item-${context.activeIndex}` : undefined, id: props.id ?? context.inputId, "data-popup-open": context.open ? "" : undefined, "data-disabled": disabled ? "" : undefined, "data-readonly": context.readOnly ? "" : undefined, "data-required": context.required ? "" : undefined, "data-popup-side": positioner?.side ?? undefined, "data-list-empty": context.filteredItems.length === 0 ? "" : undefined, "data-placeholder": state.placeholder ? "" : undefined }
  const inputProps = {
    ...resolved,
    onChange: (event: GpuixChangeEvent) => { onChange?.(event); context.setInputValue(event.value ?? "", "input-change", event) },
    onClick: (event: GpuixMouseEvent) => { onClick?.(event); if (!event.defaultPrevented && !disabled && context.openOnInputClick) context.setOpen(true, "input-press", event) },
    onFocus: (event: GpuixFocusEvent) => { onFocus?.(event); context.setFocused(true); if (!disabled && !context.readOnly) context.setOpen(true, "input-press", event) },
    onBlur: (event: GpuixFocusEvent) => { onBlur?.(event); context.setFocused(false); context.setTouched(true); if (!event.defaultPrevented) context.setOpen(false, "focus-out", event) },
    onKeyDown: (event: GpuixKeyboardEvent) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || disabled) return
      if (event.key.toLowerCase() === "escape") { if (context.open && context.isTopDismissLayer(event)) context.setOpen(false, "escape-key", event) }
      else if (event.key === "ArrowDown" || (event.key === "n" && event.modifiers?.ctrl)) { event.preventDefault(); context.setOpen(true, "list-navigation", event); context.moveActive(1, event) }
      else if (event.key === "ArrowUp" || (event.key === "p" && event.modifiers?.ctrl)) { event.preventDefault(); context.setOpen(true, "list-navigation", event); context.moveActive(-1, event) }
      else if (event.key === "Enter" && context.activeValue !== undefined) { event.preventDefault(); context.select(context.activeValue, event) }
      else if (event.key === "Backspace" && context.multiple && !context.inputValue && context.selectedValues.length) context.setValue(context.selectedValues.slice(0, -1), "chip-remove-press", event)
    },
  }
  return renderPart("input", render, inputProps as Props, null, state, ref) as ReactElement
})

export interface ComboboxTriggerState extends ComboboxRootState {}
export interface ComboboxTriggerProps extends PartProps<ComboboxTriggerState> { disabled?: boolean | undefined; asChild?: boolean | undefined }
export const ComboboxTrigger = forwardRef<PublicInstance, ComboboxTriggerProps>(function ComboboxTrigger({ render, className, style, children, disabled: disabledProp, onClick, ...props }, ref) {
  const context = useComboboxContext("Combobox.Trigger")
  const state = { ...getRootState(context, usePositionerState()?.side ?? null), disabled: disabledProp ?? context.disabled }
  const resolved = { ...stateProps({ render, className, style }, state), ...props, ref, type: "button", disabled: state.disabled, tabIndex: state.disabled ? -1 : (props.tabIndex ?? 0), "aria-haspopup": "listbox", "aria-expanded": context.open, "aria-controls": context.listId, "data-popup-open": context.open ? "" : undefined, "data-disabled": state.disabled ? "" : undefined, "data-readonly": context.readOnly ? "" : undefined }
  return renderPart("button", render, { ...resolved, onClick: (event: GpuixMouseEvent) => { onClick?.(event); if (!event.defaultPrevented && !state.disabled) context.setOpen(!context.open, "trigger-press", event) } } as Props, children, state, ref) as ReactElement
})

export interface ComboboxValueProps { placeholder?: ReactNode; children?: ReactNode | ((value: unknown) => ReactNode) }
export const ComboboxValue = function ComboboxValue({ placeholder, children }: ComboboxValueProps): ReactElement {
  const context = useComboboxContext("Combobox.Value")
  const content = typeof children === "function" ? children(context.value) : children
  const display = context.multiple ? context.selectedValues.map(context.itemToLabel).join(", ") : context.value == null ? "" : context.itemToLabel(context.value)
  return <>{content ?? (display || placeholder)}</>
}

export interface ComboboxPopupState extends PositionerState { transitionStatus: "starting" | "ending" | "idle"; empty: boolean }
export interface ComboboxPopupProps extends PartProps<ComboboxPopupState> { initialFocus?: unknown; finalFocus?: unknown }
export const ComboboxPopup = forwardRef<PublicInstance, ComboboxPopupProps>(function ComboboxPopup({ render, className, style, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.Popup")
  const positioned = useContext(ComboboxPositionedContext)
  const position = usePositionerState()
  if (!context.open) return null
  const state: ComboboxPopupState = { open: context.open, side: position?.side ?? "bottom", align: position?.align ?? "center", anchorHidden: position?.anchorHidden ?? false, empty: context.filteredItems.length === 0, transitionStatus: "idle" }
  const popupProps = { ...stateProps({ render, className, style }, state), ...props, ref, role: "presentation", "data-open": "", "data-side": state.side, "data-align": state.align, "data-anchor-hidden": state.anchorHidden ? "" : undefined, "data-empty": state.empty ? "" : undefined }
  const content = renderPart("div", render, popupProps as Props, children, state, ref)
  if (positioned) return <>{content}</>
  return <FloatingLayer ref={ref}>{content}</FloatingLayer>
})

export interface ComboboxPositionerState extends PositionerState { empty: boolean }
export interface ComboboxPositionerProps extends Omit<PositionerProps, "className" | "style" | "render">, PartProps<ComboboxPositionerState, "children"> { alignItemWithTrigger?: boolean | undefined; children?: ReactNode }
export const ComboboxPositioner = forwardRef<PublicInstance, ComboboxPositionerProps>(function ComboboxPositioner({ children, open, render, className, style, ...props }, ref) {
  const context = useComboboxContext("Combobox.Positioner")
  const trigger = context.inputRef.current
  const resolvedOpen = open ?? context.open
  const empty = context.filteredItems.length === 0
  const withState = (state: PositionerState): ComboboxPositionerState => ({ ...state, open: resolvedOpen, empty })
  return <ComboboxPositionedContext.Provider value><FloatingPositioner {...props} anchor={props.anchor ?? trigger as unknown as Element | null} open={resolvedOpen} ref={ref}
    className={typeof className === "function" ? (state) => className(withState(state)) : className}
    style={typeof style === "function" ? (state) => style(withState(state)) : style}
    render={typeof render === "function" ? (renderProps, state) => render(renderProps, withState(state)) : render}
  >{children}</FloatingPositioner></ComboboxPositionedContext.Provider>
})

export interface ComboboxItemState { disabled: boolean; selected: boolean; highlighted: boolean }
export interface ComboboxItemProps<Value = unknown> extends PartProps<ComboboxItemState, "id"> { value?: Value | undefined; disabled?: boolean | undefined; index?: number | undefined; label?: string | undefined; children?: ReactNode }
export const ComboboxItem = forwardRef<PublicInstance, ComboboxItemProps>(function ComboboxItem({ value, disabled = false, index, label, render, className, style, children, onClick, onMouseEnter, ...props }, ref) {
  const context = useComboboxContext("Combobox.Item")
  const itemValue = value as unknown
  const derived = context.itemToValue(itemValue)
  const activeIndex = index ?? context.filteredItems.findIndex((item) => context.isEqual(context.itemToValue(item), derived))
  const selected = context.selectedValues.some((item) => context.isEqual(item, derived))
  const highlighted = context.activeIndex === activeIndex
  const state = { disabled, selected, highlighted }
  const itemLabel = label ?? context.itemToLabel(derived)
  const itemRef = useCallback((instance: PublicInstance | null) => context.registerItem({ value: derived, label: itemLabel, textValue: itemLabel, disabled, instance }, instance), [context.registerItem, derived, itemLabel, disabled])
  const combinedRef = useCallback((instance: PublicInstance | null) => { itemRef(instance); setRefs(instance, ref) }, [itemRef, ref])
  const itemProps = { ...stateProps({ render, className, style }, state), ...props, ref: combinedRef, hidden: props.hidden ?? activeIndex < 0, id: `${context.listId}-item-${activeIndex}`, role: "option", "aria-selected": selected, "aria-disabled": disabled || undefined, "data-selected": selected ? "" : undefined, "data-highlighted": highlighted ? "" : undefined, "data-disabled": disabled ? "" : undefined, onClick: (event: GpuixMouseEvent) => { onClick?.(event); if (!event.defaultPrevented && !disabled) context.select(derived, event) }, onMouseEnter: (event: GpuixMouseEvent) => { onMouseEnter?.(event); if (context.highlightItemOnHover && !disabled) context.setActive(derived, "pointer", event) } }
  return <ComboboxItemContext.Provider value={{ selected }}>{renderPart("div", render, itemProps as Props, children, state, ref) as ReactElement}</ComboboxItemContext.Provider>
})

export interface ComboboxListState { empty: boolean }
export interface ComboboxListProps extends PartProps<ComboboxListState, "children"> { children?: ReactNode | ((item: unknown, index: number) => ReactNode) }
export const ComboboxList = forwardRef<PublicInstance, ComboboxListProps>(function ComboboxList({ children, render, className, style, ...props }, ref) {
  const context = useComboboxContext("Combobox.List")
  const state = { empty: context.filteredItems.length === 0 }
  const mapped = typeof children === "function" ? context.filteredItems.map((item, index) => children(item, index)) : children
  return renderPart("div", render, { ...stateProps({ render, className, style }, state), ...props, ref, id: props.id ?? context.listId, role: "listbox", "aria-multiselectable": context.multiple || undefined, "data-empty": state.empty ? "" : undefined }, mapped, state, ref) as ReactElement
})

export interface ComboboxCollectionProps<Item = any> { children: (item: Item, index: number) => ReactNode }
export function ComboboxCollection<Item = any>({ children }: ComboboxCollectionProps<Item>): ReactElement {
  const context = useComboboxContext("Combobox.Collection")
  const groupItems = useContext(ComboboxGroupItemsContext)
  const items = groupItems === null ? context.filteredItems : context.filteredItems.filter((item) => groupItems.includes(item))
  return <>{items.map((item) => children(item as Item, context.filteredItems.indexOf(item)))}</>
}

export interface ComboboxGroupProps extends PartProps<Record<string, never>, "children"> { items?: readonly unknown[] | undefined; children?: ReactNode }
export interface ComboboxGroupLabelProps extends PartProps<Record<string, never>> {}
export interface ComboboxSeparatorProps extends PartProps<{ orientation: "horizontal" | "vertical" }> { orientation?: "horizontal" | "vertical" | undefined }
export interface ComboboxEmptyProps extends PartProps<Record<string, never>> {}
export interface ComboboxStatusProps extends PartProps<Record<string, never>> {}
export interface ComboboxLabelProps extends PartProps<ComboboxRootState, "id"> {}
export interface ComboboxInputGroupProps extends PartProps<ComboboxRootState> {}
export interface ComboboxIconProps extends PartProps<Record<string, never>> {}
export interface ComboboxArrowProps extends PartProps<{ open: boolean; side: PositionerState["side"]; align: PositionerState["align"]; uncentered: boolean }> {}
export interface ComboboxBackdropProps extends PartProps<{ open: boolean; transitionStatus: "starting" | "ending" | "idle" }> {}
export interface ComboboxPortalProps extends PartProps<Record<string, never>, "children"> { container?: HTMLElement | ShadowRoot | React.RefObject<HTMLElement | ShadowRoot | null> | null | undefined; keepMounted?: boolean | undefined; children?: ReactNode }
export interface ComboboxItemIndicatorProps extends PartProps<{ selected: boolean; transitionStatus: "starting" | "ending" | "idle" }> { keepMounted?: boolean | undefined }
export interface ComboboxScrollUpArrowProps extends PartProps<Record<string, never>> {}
export interface ComboboxScrollDownArrowProps extends PartProps<Record<string, never>> {}
export interface ComboboxChipsProps extends PartProps<Record<string, never>> {}
export interface ComboboxChipProps extends PartProps<{ disabled: boolean }> {}
export interface ComboboxChipRemoveProps extends PartProps<{ disabled: boolean }> {}
export interface ComboboxClearProps extends PartProps<{ open: boolean; disabled: boolean; visible: boolean; transitionStatus: "starting" | "ending" | "idle" }> { disabled?: boolean | undefined; keepMounted?: boolean | undefined }
export interface ComboboxRowProps extends PartProps<Record<string, never>> {}

function basicPart<State>(name: string, tag: string, state: (context: ComboboxContextValue) => State, elementProps: (context: ComboboxContextValue, current: State) => Props = () => ({})) {
  return forwardRef<PublicInstance, PartProps<State>>(function BasicPart({ render, className, style, children, ...props }, ref) {
    const context = useComboboxContext(name)
    const current = state(context)
    return renderPart(tag, render, { ...stateProps({ render, className, style }, current), ...props, ...elementProps(context, current), ref } as Props, children, current, ref) as ReactElement
  })
}

export const ComboboxLabel = forwardRef<PublicInstance, ComboboxLabelProps>(function ComboboxLabel(labelProps, ref) {
  const { id: _id, ...props } = labelProps as ComboboxLabelProps & { id?: string }
  const { render, className, style, children } = labelProps
  const context = useComboboxContext("Combobox.Label")
  useEffect(() => { context.setHasLabel(true); return () => context.setHasLabel(false) }, [context.setHasLabel])
  const state = getRootState(context)
  return renderPart("label", render, { ...stateProps({ render, className, style }, state), ...props, ref, id: context.labelId, htmlFor: context.inputId, "data-disabled": context.disabled ? "" : undefined, "data-required": context.required ? "" : undefined } as Props, children, state, ref) as ReactElement
})
export const ComboboxInputGroup = basicPart("Combobox.InputGroup", "div", getRootState, (context) => ({ "data-popup-open": context.open ? "" : undefined, "data-disabled": context.disabled ? "" : undefined, "data-readonly": context.readOnly ? "" : undefined, "data-required": context.required ? "" : undefined, "data-list-empty": context.filteredItems.length === 0 ? "" : undefined, "data-placeholder": context.selectedValues.length ? undefined : "" }))
export const ComboboxIcon = basicPart("Combobox.Icon", "span", () => ({}))
export const ComboboxGroup = forwardRef<PublicInstance, ComboboxGroupProps>(function ComboboxGroup({ items, render, className, style, children, ...props }, ref) {
  useComboboxContext("Combobox.Group")
  const groupId = useId()
  const groupItems = items ?? []
  const state = {}
  return <ComboboxGroupContext.Provider value={groupId}><ComboboxGroupItemsContext.Provider value={groupItems}>{renderPart("div", render, { ...stateProps({ render, className, style }, state), ...props, ref, role: "group", "aria-labelledby": props["aria-labelledby"] ?? groupId } as Props, children, state, ref) as ReactElement}</ComboboxGroupItemsContext.Provider></ComboboxGroupContext.Provider>
})
export const ComboboxGroupLabel = forwardRef<PublicInstance, ComboboxGroupLabelProps>(function ComboboxGroupLabel({ render, className, style, children, ...props }, ref) {
  const groupId = useContext(ComboboxGroupContext)
  const state = {}
  return renderPart("div", render, { ...stateProps({ render, className, style }, state), ...props, ref, id: props.id ?? groupId ?? undefined } as Props, children, state, ref) as ReactElement
})
export const ComboboxRow = basicPart("Combobox.Row", "div", () => ({}))
export const ComboboxStatus = basicPart("Combobox.Status", "div", () => ({}), () => ({ role: "status", "aria-live": "polite" }))
export const ComboboxEmpty = forwardRef<PublicInstance, ComboboxEmptyProps>(function ComboboxEmpty({ render, className, style, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.Empty")
  return renderPart("div", render, { ...stateProps({ render, className, style }, {}), ...props, ref, role: "status", "aria-live": "polite" } as Props, context.filteredItems.length === 0 ? children : null, {}, ref) as ReactElement
})
export const ComboboxSeparator = forwardRef<PublicInstance, ComboboxSeparatorProps>(function ComboboxSeparator({ orientation = "horizontal", render, className, style, ...props }, ref) {
  const state = { orientation }
  return renderPart("div", render, { ...stateProps({ render, className, style }, state), ...props, ref, role: "separator", "aria-orientation": orientation } as Props, null, state, ref) as ReactElement
})
export const ComboboxArrow = basicPart("Combobox.Arrow", "div", (context) => ({ open: context.open, side: "bottom" as const, align: "center" as const, uncentered: false }), (context) => ({ "data-open": context.open ? "" : undefined }))
export const ComboboxBackdrop = basicPart("Combobox.Backdrop", "div", (context) => ({ open: context.open, transitionStatus: "idle" as const }), (context) => ({ "data-open": context.open ? "" : undefined }))
export const ComboboxPortal = forwardRef<PublicInstance, ComboboxPortalProps>(function ComboboxPortal({ container: _container, keepMounted: _keepMounted, render, className, style, children, ...props }, ref) {
  return renderPart("div", render, { ...stateProps({ render, className, style }, {}), ...props, ref } as Props, children, {}, ref) as ReactElement
})
export const ComboboxItemIndicator = forwardRef<PublicInstance, ComboboxItemIndicatorProps>(function ComboboxItemIndicator({ keepMounted = false, render, className, style, children, ...props }, ref) {
  useComboboxContext("Combobox.ItemIndicator")
  const item = useContext(ComboboxItemContext)
  if (!item) throw new Error("Combobox.ItemIndicator must be used inside Combobox.Item")
  const state = { selected: item.selected, transitionStatus: "idle" as const }
  if (!state.selected && !keepMounted) return null
  return renderPart("span", render, { ...stateProps({ render, className, style }, state), ...props, ref, "data-selected": state.selected ? "" : undefined } as Props, children, state, ref) as ReactElement
})
export const ComboboxChips = forwardRef<PublicInstance, ComboboxChipsProps>(function ComboboxChips({ render, className, style, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.Chips")
  const chips = useRef(new Map<string, (index: number) => void>())
  const register = useCallback((id: string, update: (index: number) => void) => {
    chips.current.set(id, update)
    const sync = () => Array.from(chips.current.values()).forEach((notify, index) => notify(index))
    sync()
    return () => { chips.current.delete(id); sync() }
  }, [])
  return <ComboboxChipRegistryContext.Provider value={register}>{renderPart("div", render, { ...stateProps({ render, className, style }, {}), ...props, ref } as Props, children, {}, ref) as ReactElement}</ComboboxChipRegistryContext.Provider>
})
export const ComboboxChip = forwardRef<PublicInstance, ComboboxChipProps>(function ComboboxChip({ render, className, style, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.Chip")
  const register = useContext(ComboboxChipRegistryContext)
  const id = useId()
  const [index, setIndex] = useState(-1)
  useEffect(() => register?.(id, setIndex), [register, id])
  const state = { disabled: context.disabled }
  return <ComboboxChipIndexContext.Provider value={index}>{renderPart("div", render, { ...stateProps({ render, className, style }, state), ...props, ref, "data-disabled": state.disabled ? "" : undefined } as Props, children, state, ref) as ReactElement}</ComboboxChipIndexContext.Provider>
})
export const ComboboxChipRemove = basicPart("Combobox.ChipRemove", "button", (context) => ({ disabled: context.disabled }), (context) => ({ type: "button", disabled: context.disabled, "data-disabled": context.disabled ? "" : undefined }))
export const ComboboxClear = forwardRef<PublicInstance, ComboboxClearProps>(function ComboboxClear({ render, className, style, disabled: disabledProp, keepMounted: _keepMounted, onClick, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.Clear")
  const state = { open: context.open, disabled: disabledProp ?? context.disabled, visible: context.selectedValues.length > 0, transitionStatus: "idle" as const }
  if (!state.visible && !_keepMounted) return null
  return renderPart("button", render, { ...stateProps({ render, className, style }, state), ...props, ref, type: "button", disabled: state.disabled, "data-disabled": state.disabled ? "" : undefined, onClick: (event: GpuixMouseEvent) => { onClick?.(event); if (!event.defaultPrevented && !state.disabled) { context.setValue(context.multiple ? [] : null, "clear-press", event); context.setInputValue("", "input-clear", event) } } } as Props, children, state, ref) as ReactElement
})

export const ComboboxChipRemoveButton = forwardRef<PublicInstance, ComboboxChipRemoveProps>(function ComboboxChipRemove({ render, className, style, onClick, children, ...props }, ref) {
  const context = useComboboxContext("Combobox.ChipRemove")
  const index = useContext(ComboboxChipIndexContext)
  const state = { disabled: context.disabled }
  return renderPart("button", render, { ...stateProps({ render, className, style }, state), ...props, ref, type: "button", disabled: state.disabled, onClick: (event: GpuixMouseEvent) => { onClick?.(event); if (!event.defaultPrevented && !state.disabled && index !== null && index >= 0) context.setValue(context.selectedValues.filter((_, selectedIndex) => selectedIndex !== index), "chip-remove-press", event) } } as Props, children, state, ref) as ReactElement
})

export const ComboboxScrollUpArrow = basicPart("Combobox.ScrollUpArrow", "div", () => ({}))
export const ComboboxScrollDownArrow = basicPart("Combobox.ScrollDownArrow", "div", () => ({}))
export const ComboboxInputGroupField = ComboboxInputGroup

export function Combobox<Value = unknown, Multiple extends boolean | undefined = false, Item = Value>(props: ComboboxRootProps<Value, Multiple, Item>): ReactElement {
  return <ComboboxRoot {...props} />
}

Object.assign(Combobox, {
  Root: ComboboxRoot,
  InputGroup: ComboboxInputGroup,
  Label: ComboboxLabel,
  Input: ComboboxInput,
  Trigger: ComboboxTrigger,
  Value: ComboboxValue,
  Icon: ComboboxIcon,
  Portal: ComboboxPortal,
  Backdrop: ComboboxBackdrop,
  Positioner: ComboboxPositioner,
  Popup: ComboboxPopup,
  List: ComboboxList,
  Item: ComboboxItem,
  ItemIndicator: ComboboxItemIndicator,
  Arrow: ComboboxArrow,
  ScrollUpArrow: ComboboxScrollUpArrow,
  ScrollDownArrow: ComboboxScrollDownArrow,
  Group: ComboboxGroup,
  GroupLabel: ComboboxGroupLabel,
  Separator: ComboboxSeparator,
  Empty: ComboboxEmpty,
  Row: ComboboxRow,
  Chips: ComboboxChips,
  Chip: ComboboxChip,
  ChipRemove: ComboboxChipRemoveButton,
  Clear: ComboboxClear,
  Status: ComboboxStatus,
  Collection: ComboboxCollection,
  useFilter: useComboboxFilter,
  useFilteredItems: useFilteredComboboxItems,
  createItems: createComboboxItems,
})

export {
  ComboboxRoot as Root,
  ComboboxInputGroup as InputGroup,
  ComboboxLabel as Label,
  ComboboxInput as Input,
  ComboboxTrigger as Trigger,
  ComboboxValue as Value,
  ComboboxIcon as Icon,
  ComboboxPortal as Portal,
  ComboboxBackdrop as Backdrop,
  ComboboxPositioner as Positioner,
  ComboboxPopup as Popup,
  ComboboxList as List,
  ComboboxItem as Item,
  ComboboxItemIndicator as ItemIndicator,
  ComboboxArrow as Arrow,
  ComboboxScrollUpArrow as ScrollUpArrow,
  ComboboxScrollDownArrow as ScrollDownArrow,
  ComboboxGroup as Group,
  ComboboxGroupLabel as GroupLabel,
  ComboboxSeparator as Separator,
  ComboboxEmpty as Empty,
  ComboboxRow as Row,
  ComboboxChips as Chips,
  ComboboxChip as Chip,
  ComboboxChipRemoveButton as ChipRemove,
  ComboboxClear as Clear,
  ComboboxStatus as Status,
  ComboboxCollection as Collection,
  useFilteredComboboxItems as useFilteredItems,
}

export namespace ComboboxRoot {
  export type Props<Value = unknown, Multiple extends boolean | undefined = false, Item = Value> = ComboboxRootProps<Value, Multiple, Item>
  export type State = ComboboxRootState
  export type Actions = { unmount: () => void }
  export type ChangeEventReason = ComboboxChangeReason
  export type ChangeEventDetails = ComboboxChangeEventDetails
  export type HighlightEventReason = ComboboxHighlightEventReason
  export type HighlightEventDetails = ComboboxHighlightEventDetails
}
export namespace ComboboxLabel { export type Props = ComboboxLabelProps; export type State = ComboboxRootState }
export namespace ComboboxValue { export type Props = ComboboxValueProps; export type State = Record<string, never> }
export namespace ComboboxInput { export type Props = ComboboxInputProps; export type State = ComboboxInputState }
export namespace ComboboxInputGroup { export type Props = ComboboxInputGroupProps; export type State = ComboboxRootState }
export namespace ComboboxTrigger { export type Props = ComboboxTriggerProps; export type State = ComboboxTriggerState }
export namespace ComboboxList { export type Props = ComboboxListProps; export type State = ComboboxListState }
export namespace ComboboxStatus { export type Props = ComboboxStatusProps; export type State = Record<string, never> }
export namespace ComboboxPortal { export type Props = ComboboxPortalProps; export type State = Record<string, never> }
export namespace ComboboxBackdrop { export type Props = ComboboxBackdropProps; export type State = { open: boolean; transitionStatus: "starting" | "ending" | "idle" } }
export namespace ComboboxPositioner { export type Props = ComboboxPositionerProps; export type State = ComboboxPositionerState }
export namespace ComboboxPopup { export type Props = ComboboxPopupProps; export type State = ComboboxPopupState }
export namespace ComboboxArrow { export type Props = ComboboxArrowProps; export type State = { open: boolean; side: PositionerState["side"]; align: PositionerState["align"]; uncentered: boolean } }
export namespace ComboboxIcon { export type Props = ComboboxIconProps; export type State = Record<string, never> }
export namespace ComboboxGroup { export type Props = ComboboxGroupProps; export type State = Record<string, never> }
export namespace ComboboxGroupLabel { export type Props = ComboboxGroupLabelProps; export type State = Record<string, never> }
export namespace ComboboxItem { export type Props<Value = unknown> = ComboboxItemProps<Value>; export type State = ComboboxItemState }
export namespace ComboboxItemIndicator { export type Props = ComboboxItemIndicatorProps; export type State = { selected: boolean; transitionStatus: "starting" | "ending" | "idle" } }
export namespace ComboboxChips { export type Props = ComboboxChipsProps; export type State = Record<string, never> }
export namespace ComboboxChip { export type Props = ComboboxChipProps; export type State = { disabled: boolean } }
export namespace ComboboxChipRemoveButton { export type Props = ComboboxChipRemoveProps; export type State = { disabled: boolean } }
export namespace ComboboxRow { export type Props = ComboboxRowProps; export type State = Record<string, never> }
export namespace ComboboxCollection { export type Props<Item = unknown> = ComboboxCollectionProps<Item>; export type State = Record<string, never> }
export namespace ComboboxEmpty { export type Props = ComboboxEmptyProps; export type State = Record<string, never> }
export namespace ComboboxClear { export type Props = ComboboxClearProps; export type State = { open: boolean; disabled: boolean; visible: boolean; transitionStatus: "starting" | "ending" | "idle" } }
export namespace ComboboxSeparator { export type Props = ComboboxSeparatorProps; export type State = { orientation: "horizontal" | "vertical" } }
export namespace Combobox {
  export import Root = ComboboxRoot
  export import Label = ComboboxLabel
  export import Value = ComboboxValue
  export import Input = ComboboxInput
  export import InputGroup = ComboboxInputGroup
  export import Trigger = ComboboxTrigger
  export import List = ComboboxList
  export import Status = ComboboxStatus
  export import Portal = ComboboxPortal
  export import Backdrop = ComboboxBackdrop
  export import Positioner = ComboboxPositioner
  export import Popup = ComboboxPopup
  export import Arrow = ComboboxArrow
  export import Icon = ComboboxIcon
  export import Group = ComboboxGroup
  export import GroupLabel = ComboboxGroupLabel
  export import Item = ComboboxItem
  export import ItemIndicator = ComboboxItemIndicator
  export import Chips = ComboboxChips
  export import Chip = ComboboxChip
  export import ChipRemove = ComboboxChipRemoveButton
  export import Row = ComboboxRow
  export import Collection = ComboboxCollection
  export import Empty = ComboboxEmpty
  export import Clear = ComboboxClear
  export import Separator = ComboboxSeparator
  export const createItems = createComboboxItems
  export const useFilter = useComboboxFilter
  export const useFilteredItems = useFilteredComboboxItems
}
