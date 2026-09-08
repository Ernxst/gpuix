/** Headless shadcn-shaped Select components rendered with GPUIX host elements. */

import React, {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
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

interface SelectItemRecord {
  value: string
  label: ReactNode
  textValue: string
  disabled: boolean
}

interface SelectContextValue {
  open: boolean
  value: string | undefined
  disabled: boolean
  items: SelectItemRecord[]
  activeValue: string | null
  triggerPressedWhileOpen: React.MutableRefObject<boolean>
  dismissedByOutsidePress: React.MutableRefObject<boolean>
  triggerRef: React.MutableRefObject<PublicInstance | null>
  setOpen: (open: boolean) => void
  setActiveValue: (value: string | null) => void
  moveActive: (delta: number) => void
  selectValue: (value: string) => void
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

export interface SelectProps extends Omit<Props, "children" | "onChange"> {
  children?: ReactNode
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
  // before the Select has ever opened. Order reflects mount order: React
  // commits children in document order on the initial render, but an item
  // mounted later (e.g. after a conditional render) is appended rather than
  // inserted in place.
  const itemRegistry = useRef<Map<string, SelectItemRecord>>(new Map())
  const itemOrder = useRef<string[]>([])
  const [items, setItems] = useState<SelectItemRecord[]>([])

  const syncItems = () => {
    setItems(
      itemOrder.current
        .map((itemValue) => itemRegistry.current.get(itemValue))
        .filter((item): item is SelectItemRecord => item !== undefined)
    )
  }

  const registerItem = (item: SelectItemRecord) => {
    if (!itemRegistry.current.has(item.value)) itemOrder.current.push(item.value)
    itemRegistry.current.set(item.value, item)
    syncItems()
  }

  const unregisterItem = (value: string) => {
    itemRegistry.current.delete(value)
    itemOrder.current = itemOrder.current.filter((candidate) => candidate !== value)
    syncItems()
  }

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
    const enabled = items.filter((item) => !item.disabled)
    if (enabled.length === 0) return
    const currentIndex = enabled.findIndex((item) => item.value === activeValue)
    const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex
    const nextIndex = (start + delta + enabled.length) % enabled.length
    setActiveValue(enabled[nextIndex].value)
  }

  const selectValue = (nextValue: string) => {
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
    [open, value, disabled, items, activeValue]
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
    const item = context.items.find((candidate) => candidate.value === context.value)
    return <div {...props} ref={ref}>{children ?? item?.label ?? placeholder}</div>
  }
)

export interface SelectContentProps extends FloatingContentProps {
  onEscapeKeyDown?: (event: GpuixSyntheticEvent) => void
}

export const SelectContent = forwardRef<PublicInstance, SelectContentProps>(
  function SelectContent(
    { children, onMouseDownOutside, onKeyDown, onEscapeKeyDown, tabIndex = 0, ...props },
    forwardedRef
  ) {
    const context = useSelectContext("SelectContent")
    // Children stay mounted while closed - like Radix's detached collection -
    // so SelectItem registers at mount time regardless of open state. The
    // clipped, zero-size, out-of-flow box keeps a user wrapper's own host
    // element (one we don't control the hiding of) from taking layout space
    // or painting; the floating panel itself is gated on open separately, so
    // closed content contributes no text to the render tree either way.
    if (!context.open) {
      return (
        <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
          {children}
        </div>
      )
    }
    return (
      <FloatingLayer
        {...props}
        ref={forwardedRef}
        tabIndex={tabIndex}
        autoFocus
        onMouseDownOutside={(event) => {
          onMouseDownOutside?.(event)
          context.dismissedByOutsidePress.current = true
          queueMicrotask(() => {
            context.dismissedByOutsidePress.current = false
          })
          context.setOpen(false)
        }}
        onKeyDown={(event) => {
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
        }}
      >
        {children}
      </FloatingLayer>
    )
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
    const state = {
      selected: context.value === value,
      highlighted: context.activeValue === value,
      disabled,
    }
    const label = typeof children === "function" ? textValue : children
    const resolvedTextValue =
      textValue ?? (typeof children === "function" ? "" : textContent(children))

    useLayoutEffect(() => {
      context.registerItem({ value, label, textValue: resolvedTextValue, disabled })
      return () => context.unregisterItem(value)
    }, [value, label, resolvedTextValue, disabled])

    if (!context.open) return null

    return (
      <div
        {...props}
        ref={ref}
        style={resolveStyle(style, state)}
        onMouseEnter={(event: GpuixSyntheticEvent) => {
          onMouseEnter?.(event)
          if (!disabled) context.setActiveValue(value)
        }}
        onClick={(event: GpuixSyntheticEvent) => {
          onClick?.(event)
          if (!disabled) context.selectValue(value)
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
  // their own registration - only the group's own host element disappears.
  if (!context.open) return <>{props.children}</>
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
