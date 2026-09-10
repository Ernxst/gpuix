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
} from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import {
  FloatingLayer,
  floatingRootStyle,
  renderSlot,
  resolveStyle,
  setRefs,
  useControllableState,
} from "./floating.js"
import type { FloatingContentProps, StateStyle } from "./floating.js"

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
  value: string | undefined
  disabled: boolean
  labels: Map<string, ReactNode>
  activeValue: string | null
  triggerPressedWhileOpen: React.MutableRefObject<boolean>
  dismissedByOutsidePress: React.MutableRefObject<boolean>
  triggerRef: React.MutableRefObject<PublicInstance | null>
  setOpen: (open: boolean) => void
  setActiveValue: (value: string | null) => void
  moveActive: (delta: number) => void
  selectValue: (value: string) => void
  items: SelectItemRecord[]
  registerItem: (item: SelectItemRecord) => void
  unregisterItem: (value: string) => void
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelectContext(name: string): SelectContextValue {
  const context = useContext(SelectContext)
  if (!context) throw new Error(`${name} must be used inside Select`)
  return context
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (!isValidElement<{ children?: ReactNode }>(node)) return ""
  return Children.toArray(node.props.children).map(textContent).join("")
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

export interface SelectProps extends Omit<Props, "children" | "onChange"> {
  children?: ReactNode
  items?: readonly SelectItemData[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}

export function Select({
  children,
  items: itemsProp,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  style,
  ...props
}: SelectProps): ReactElement {
  const { renderer } = useGpuix()
  const [value, setValue] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue,
    onChange: (nextValue) => {
      if (nextValue !== undefined) onValueChange?.(nextValue)
    },
  })
  const [open, setOpenState] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const [activeValue, setActiveValue] = useState<string | null>(null)
  const triggerPressedWhileOpen = useRef(false)
  const dismissedByOutsidePress = useRef(false)
  const triggerRef = useRef<PublicInstance | null>(null)
  // SelectItem registers itself here (instead of Select walking the element
  // tree), so an item wrapped in a user component is still discovered.
  // SelectContent keeps its children mounted even while closed - like Radix's
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
    const selected = items.find((item) => item.value === value && !item.disabled)
    if (selected) setActiveValue(selected.value)
  }, [open, value, items, activeValue])
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
      const selected = items.find((item) => item.value === value && !item.disabled)
      setActiveValue(selected?.value ?? null)
    } else if (triggerRef.current) {
      renderer?.focusElement?.(triggerRef.current.id)
    }
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
    setValue(nextValue)
    setOpen(false)
  }

  const context = useMemo<SelectContextValue>(
    () => ({
      open,
      value,
      disabled,
      items,
      labels,
      activeValue,
      triggerPressedWhileOpen,
      dismissedByOutsidePress,
      triggerRef,
      setOpen,
      setActiveValue,
      moveActive,
      selectValue,
      registerItem,
      unregisterItem,
    }),
    [open, value, disabled, items, labels, activeValue]
  )

  return (
    <SelectContext.Provider value={context}>
      <div {...props} style={floatingRootStyle(style)}>{children}</div>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerState {
  open: boolean
  disabled: boolean
  placeholder: boolean
}

export interface SelectTriggerProps extends Omit<Props, "style"> {
  asChild?: boolean
  disabled?: boolean
  style?: StateStyle<SelectTriggerState>
}

export const SelectTrigger = forwardRef<PublicInstance, SelectTriggerProps>(
  function SelectTrigger(
    { asChild, disabled: disabledProp, style, children, onMouseDown, onClick, onKeyDown, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectTrigger")
    const disabled = disabledProp ?? context.disabled
    const state = {
      open: context.open,
      disabled,
      placeholder: context.value === undefined,
    }
    const ref = (value: PublicInstance | null) => {
      context.triggerRef.current = value
      setRefs(value, forwardedRef)
    }
    const triggerProps: Props = {
      ...props,
      tabIndex: disabled ? -1 : (asChild ? props.tabIndex : (props.tabIndex ?? 0)),
      style: resolveStyle(style, state),
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
        }
      },
    }
    return renderSlot({ asChild, children, props: triggerProps, ref })
  }
)

export interface SelectValueProps extends Props {
  placeholder?: ReactNode
}

export const SelectValue = forwardRef<PublicInstance, SelectValueProps>(
  function SelectValue({ placeholder, children, ...props }, ref) {
    const context = useSelectContext("SelectValue")
    const label = context.value === undefined ? undefined : context.labels.get(context.value)
    return <div {...props} ref={ref}>
      {children ?? label ?? context.items.find((item) => item.value === context.value)?.label ?? context.value ?? placeholder}
    </div>
  }
)

export interface SelectContentProps extends FloatingContentProps {
  onEscapeKeyDown?: (event: GpuixKeyboardEvent) => void
}

export const SelectContent = forwardRef<PublicInstance, SelectContentProps>(
  function SelectContent(
    { children, onMouseDownOutside, onKeyDown, onEscapeKeyDown, tabIndex = 0, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectContent")
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
          ...props,
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
            }
          },
        }
      : { style: { display: "none" as const } }

    return <FloatingLayer {...floatingProps}>{children}</FloatingLayer>
  }
)

export interface SelectItemState {
  selected: boolean
  highlighted: boolean
  disabled: boolean
}

export interface SelectItemProps extends Omit<Props, "children" | "style"> {
  value: string
  disabled?: boolean
  textValue?: string
  children?: ReactNode | ((state: SelectItemState) => ReactNode)
  style?: StateStyle<SelectItemState>
}

export const SelectItem = forwardRef<PublicInstance, SelectItemProps>(
  function SelectItem(
    { value, disabled = false, textValue, children, style, onClick, onMouseEnter, ...props },
    ref
  ) {
    const context = useSelectContext("SelectItem")
    const instanceRef = useRef<PublicInstance | null>(null)
    const state = {
      selected: context.value === value,
      highlighted: context.activeValue === value,
      disabled,
    }
    const label = typeof children === "function" ? textValue : children
    const resolvedTextValue =
      textValue ?? (typeof children === "function" ? "" : textContent(children))

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
        label,
        textValue: resolvedTextValue,
        disabled,
        instance: instanceRef.current,
      })
      return () => context.unregisterItem(value)
    }, [value, label, resolvedTextValue, disabled])

    // Closed content stays mounted (see registerItem's comment above), so
    // this marker keeps the item's document position current even while
    // Select is closed - unlike returning null, which would leave the item
    // with no tree position for compareDocumentPosition to read. Inert:
    // `display: "none"` takes no layout space, is absent from the
    // accessibility tree, and is never hit-tested (see display-none.test.tsx).
    if (!context.open) return <div style={{ display: "none" }} ref={setInstanceRef} />
    return (
      <div
        {...props}
        ref={setInstanceRef}
        style={resolveStyle(style, state)}
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
    )
  }
)

export const SelectGroup = forwardRef<PublicInstance, Props>(function SelectGroup(props, ref) {
  const context = useSelectContext("SelectGroup")
  // A group can contain items, so its children stay mounted while closed for
  // their own registration. The group renders a div in both states - like
  // SelectItem's own marker - so its host element and the items beneath it
  // keep their identity across open/close instead of remounting.
  if (!context.open) return <div style={{ display: "none" }}>{props.children}</div>
  return <div {...props} ref={ref} />
})

export const SelectLabel = forwardRef<PublicInstance, Props>(function SelectLabel(props, ref) {
  const context = useSelectContext("SelectLabel")
  if (!context.open) return null
  return <div {...props} ref={ref} />
})

export const SelectSeparator = forwardRef<PublicInstance, Props>(
  function SelectSeparator(props, ref) {
    const context = useSelectContext("SelectSeparator")
    if (!context.open) return null
    return <div {...props} ref={ref} />
  }
)

export const SelectScrollUpButton = forwardRef<PublicInstance, Props>(
  function SelectScrollUpButton(props, ref) {
    return <div {...props} ref={ref} />
  }
)

export const SelectScrollDownButton = forwardRef<PublicInstance, Props>(
  function SelectScrollDownButton(props, ref) {
    return <div {...props} ref={ref} />
  }
)

export {
  Select as Root,
  SelectContent as Content,
  SelectGroup as Group,
  SelectItem as Item,
  SelectLabel as Label,
  SelectScrollDownButton as ScrollDownButton,
  SelectScrollUpButton as ScrollUpButton,
  SelectSeparator as Separator,
  SelectTrigger as Trigger,
  SelectValue as Value,
}
