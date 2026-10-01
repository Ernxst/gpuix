/** Base UI-shaped Tooltip parts over the shared GPUIX floating positioner. */

import React, {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import {
  FloatingPositioner,
  renderSlot,
  useControllableState,
  useDismissLayer,
  usePositionerState,
} from "./floating.js"
import type { PositionerProps, PositionerState, StateStyle } from "./floating.js"

export type TooltipChangeEventReason =
  | "trigger-hover"
  | "trigger-focus"
  | "trigger-press"
  | "outside-press"
  | "escape-key"
  | "disabled"
  | "imperative-action"
  | "none"

export interface TooltipChangeEventDetails {
  reason: TooltipChangeEventReason
  event: GpuixSyntheticEvent | undefined
  trigger: Element | undefined
  preventUnmountOnClose: () => void
}

export interface TooltipRootActions {
  unmount: () => void
  close: () => void
}

export interface TooltipRootState {}

export interface TooltipProviderProps {
  children?: ReactNode
  delay?: number | undefined
  closeDelay?: number | undefined
  timeout?: number | undefined
  /** @deprecated Use Root.disableHoverablePopup. */
  disableHoverableContent?: boolean | undefined
}

interface ProviderValue {
  delay: number
  closeDelay: number
  timeout: number
  lastClosedAt: React.MutableRefObject<number>
  disableHoverableContent: boolean
}

const defaultProvider: ProviderValue = {
  delay: 600,
  closeDelay: 0,
  timeout: 400,
  lastClosedAt: { current: Number.NEGATIVE_INFINITY },
  disableHoverableContent: false,
}
const ProviderContext = createContext(defaultProvider)

export function TooltipProvider({
  children,
  delay = 600,
  closeDelay = 0,
  timeout = 400,
  disableHoverableContent = false,
}: TooltipProviderProps): ReactElement {
  const lastClosedAt = useRef(Number.NEGATIVE_INFINITY)
  const value = useMemo(() => ({ delay, closeDelay, timeout, lastClosedAt, disableHoverableContent }), [delay, closeDelay, timeout, disableHoverableContent])
  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>
}

export interface TooltipHandle<Payload = unknown> {
  open: (triggerId: string) => void
  close: () => void
  readonly isOpen: boolean
}

interface HandleRoot<Payload> {
  open: (triggerId: string, payload: Payload | undefined) => void
  close: () => void
  isOpen: () => boolean
}

class TooltipHandleImpl<Payload> implements TooltipHandle<Payload> {
  private root: HandleRoot<Payload> | null = null
  private activePayload: Payload | undefined

  open(triggerId: string): void {
    this.root?.open(triggerId, this.activePayload)
  }

  close(): void {
    this.root?.close()
  }

  get isOpen(): boolean {
    return this.root?.isOpen() ?? false
  }

  attach(root: HandleRoot<Payload> | null): void {
    this.root = root
  }

  activate(triggerId: string, payload: Payload | undefined): void {
    this.activePayload = payload
    this.root?.open(triggerId, payload)
  }
}

function attachTooltipHandle<Payload>(handle: TooltipHandle<Payload>, root: HandleRoot<Payload> | null): void {
  ;(handle as TooltipHandleImpl<Payload>).attach(root)
}

function activateTooltipHandle<Payload>(handle: TooltipHandle<Payload>, triggerId: string, payload: Payload | undefined): void {
  ;(handle as TooltipHandleImpl<Payload>).activate(triggerId, payload)
}

export function createTooltipHandle<Payload = unknown>(): TooltipHandle<Payload> {
  return new TooltipHandleImpl<Payload>()
}

export interface TooltipRootProps<Payload = unknown> {
  children?: ReactNode | ((arg: { payload: Payload | undefined }) => ReactNode)
  open?: boolean | undefined
  defaultOpen?: boolean | undefined
  onOpenChange?: ((open: boolean, details: TooltipChangeEventDetails) => void) | undefined
  onOpenChangeComplete?: ((open: boolean) => void) | undefined
  disableHoverablePopup?: boolean | undefined
  trackCursorAxis?: "none" | "x" | "y" | "both" | undefined
  actionsRef?: React.RefObject<TooltipRootActions | null> | undefined
  disabled?: boolean | undefined
  handle?: TooltipHandle<Payload> | undefined
  triggerId?: string | null | undefined
  defaultTriggerId?: string | null | undefined
}

export interface TooltipTriggerState {
  open: boolean
}

export interface TooltipPartProps<State> extends Omit<Props, "children" | "className" | "style"> {
  children?: ReactNode
  className?: string | ((state: State) => string | undefined) | undefined
  style?: StateStyle<State> | ((state: State) => StyleDesc | undefined) | undefined
  render?: ReactElement | ((props: Props, state: State) => ReactNode) | undefined
}

interface TooltipContextValue<Payload = unknown> {
  open: boolean
  disabled: boolean
  activeTriggerId: string | null
  payload: Payload | undefined
  instant: "delay" | "focus" | "dismiss" | undefined
  triggerRef: React.MutableRefObject<PublicInstance | null>
  dismissLayer: (event?: GpuixSyntheticEvent) => boolean
  scheduleOpen: (delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, triggerId?: string, payload?: Payload) => void
  scheduleClose: (delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  openNow: (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, triggerId?: string, payload?: Payload) => void
  close: (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  cancelClose: () => void
  forceUnmount: boolean
  popupMounted: boolean
  disableHoverablePopup: boolean
  closeDelay: number
  setCloseDelay: (delay: number) => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

function useTooltipContext(name: string): TooltipContextValue {
  const value = useContext(TooltipContext)
  if (!value) throw new Error(`${name} must be used inside Tooltip.Root`)
  return value
}

function resolveClassName<State>(className: TooltipPartProps<State>["className"], state: State): string | undefined {
  return typeof className === "function" ? className(state) : className
}

function resolveStyle<State>(style: TooltipPartProps<State>["style"], state: State): StyleDesc | undefined {
  return typeof style === "function" ? style(state) : style
}

function renderPart<State>(
  tag: string,
  render: TooltipPartProps<State>["render"],
  props: Props,
  children: ReactNode,
  state: State,
  ref?: React.Ref<PublicInstance>
): ReactNode {
  const resolved = { ...props, ref }
  if (typeof render === "function") return render(resolved, state)
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return React.createElement(tag, resolved, children)
}

export const TooltipRoot = forwardRef<PublicInstance, TooltipRootProps<any>>(function TooltipRoot(
  {
    children,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    onOpenChangeComplete,
    disableHoverablePopup: disableHoverablePopupProp,
    trackCursorAxis: _trackCursorAxis = "none",
    actionsRef,
    disabled = false,
    handle,
    triggerId,
    defaultTriggerId,
  },
  _ref
) {
  const provider = useContext(ProviderContext)
  const disableHoverablePopup = disableHoverablePopupProp ?? provider.disableHoverableContent
  const [open, setOpenState] = useControllableState({ value: openProp, defaultValue: defaultOpen })
  const [popupMounted, setPopupMounted] = useState(openProp ?? defaultOpen)
  const [activeTriggerId, setActiveTriggerId] = useState<string | null>(triggerId ?? defaultTriggerId ?? null)
  const [activePayload, setActivePayload] = useState<unknown>()
  const [activeCloseDelay, setActiveCloseDelay] = useState(provider.closeDelay)
  const [forceUnmount, setForceUnmount] = useState(false)
  const [instant, setInstant] = useState<TooltipContextValue["instant"]>()
  const triggerRef = useRef<PublicInstance | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissLayer = useDismissLayer(open)
  const previousOpen = useRef(open)

  const cancelOpen = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current)
    openTimer.current = null
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const changeOpen = (next: boolean, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, nextTriggerId?: string, nextPayload?: unknown) => {
    cancelOpen()
    cancelClose()
    let preventUnmount = false
    const details: TooltipChangeEventDetails = {
      reason,
      event,
      trigger: triggerRef.current as unknown as Element | null ?? undefined,
      preventUnmountOnClose: () => { preventUnmount = true },
    }
    onOpenChange?.(next, details)
    if (openProp === undefined) setOpenState(next)
    if (next) {
      setPopupMounted(true)
      setForceUnmount(false)
      setActiveTriggerId(nextTriggerId ?? triggerId ?? activeTriggerId)
      setActivePayload(nextPayload)
      setInstant(reason === "trigger-hover" ? "delay" : reason === "trigger-focus" ? "focus" : undefined)
    } else {
      setPopupMounted(preventUnmount)
      if (!preventUnmount) setForceUnmount(false)
      setInstant("dismiss")
      provider.lastClosedAt.current = Date.now()
    }
  }
  const openNow: TooltipContextValue["openNow"] = (reason, event, id, nextPayload) => {
    if (disabled) return
    changeOpen(true, reason, event, id, nextPayload)
  }
  const close = (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => changeOpen(false, reason, event)
  const scheduleOpen: TooltipContextValue["scheduleOpen"] = (delay, reason, event, id, nextPayload) => {
    if (disabled) return
    cancelClose()
    const recentlyClosed = Date.now() - provider.lastClosedAt.current <= provider.timeout
    const resolvedDelay = recentlyClosed ? 0 : delay
    cancelOpen()
    if (resolvedDelay <= 0) openNow(reason, event, id, nextPayload)
    else openTimer.current = setTimeout(() => openNow(reason, event, id, nextPayload), resolvedDelay)
  }
  const scheduleClose: TooltipContextValue["scheduleClose"] = (delay, reason, event) => {
    cancelOpen()
    if (disableHoverablePopup) {
      close(reason, event)
      return
    }
    cancelClose()
    closeTimer.current = setTimeout(() => close(reason, event), delay)
  }

  useEffect(() => () => {
    cancelOpen()
    cancelClose()
    if (handle) attachTooltipHandle(handle, null)
  }, [handle])
  useEffect(() => {
    if (previousOpen.current !== open) {
      previousOpen.current = open
      onOpenChangeComplete?.(open)
    }
  }, [open, onOpenChangeComplete])
  useEffect(() => {
    if (open) setPopupMounted(true)
  }, [open])
  useEffect(() => {
    if (!actionsRef) return
    actionsRef.current = {
      unmount: () => setForceUnmount(true),
      close: () => close("imperative-action"),
    }
    return () => { actionsRef.current = null }
  }, [actionsRef, close])
  useEffect(() => {
    if (!handle) return
    attachTooltipHandle(handle, {
      open: (id, nextPayload) => openNow("imperative-action", undefined, id, nextPayload),
      close: () => close("imperative-action"),
      isOpen: () => open,
    })
    return () => attachTooltipHandle(handle, null)
  }, [handle, open])

  const context: TooltipContextValue = {
    open,
    disabled,
    activeTriggerId: triggerId ?? activeTriggerId,
    payload: activePayload,
    instant,
    triggerRef,
    dismissLayer,
    scheduleOpen,
    scheduleClose,
    openNow,
    close,
    cancelClose,
    forceUnmount,
    popupMounted,
    disableHoverablePopup,
    closeDelay: activeCloseDelay,
    setCloseDelay: setActiveCloseDelay,
  }
  const renderedChildren = typeof children === "function" ? children({ payload: activePayload }) : children
  return <TooltipContext.Provider value={context}>{renderedChildren}</TooltipContext.Provider>
})

export interface TooltipTriggerProps<Payload = unknown> extends TooltipPartProps<TooltipTriggerState> {
  handle?: TooltipHandle<any> | undefined
  payload?: Payload | undefined
  delay?: number | undefined
  closeDelay?: number | undefined
  closeOnClick?: boolean | undefined
  disabled?: boolean | undefined
  nativeButton?: boolean | undefined
}

export const TooltipTrigger = forwardRef<PublicInstance, TooltipTriggerProps>(function TooltipTrigger(
  {
    children,
    render,
    className,
    style,
    handle,
    payload,
    delay,
    closeDelay,
    closeOnClick = true,
    disabled: disabledProp = false,
    nativeButton: _nativeButton = true,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onClick,
    onMouseDown,
    onKeyDown,
    id,
    ...props
  },
  ref
) {
  const context = useTooltipContext("Tooltip.Trigger")
  const provider = useContext(ProviderContext)
  const disabled = disabledProp || context.disabled
  const triggerId = id ?? `tooltip-trigger-${React.useId()}`
  const isOpen = context.open && context.activeTriggerId === triggerId
  const state = { open: isOpen }
  const resolved: Props = {
    ...props,
    id: triggerId,
    ref: (instance: PublicInstance | null) => {
      context.triggerRef.current = instance
      if (typeof ref === "function") ref(instance)
      else if (ref) ref.current = instance
    },
    tabIndex: props.tabIndex ?? 0,
    "data-popup-open": isOpen ? "" : undefined,
    "data-trigger-disabled": disabled ? "" : undefined,
    disabled,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    onMouseEnter: (event: GpuixSyntheticEvent) => {
      onMouseEnter?.(event as never)
      if (disabled) return
      context.setCloseDelay(closeDelay ?? provider.closeDelay)
      if (handle) activateTooltipHandle(handle, triggerId, payload)
      else context.scheduleOpen(delay ?? provider.delay, "trigger-hover", event, triggerId, payload)
    },
    onMouseLeave: (event: GpuixSyntheticEvent) => {
      onMouseLeave?.(event as never)
      context.scheduleClose(closeDelay ?? provider.closeDelay, "trigger-hover", event)
    },
    onFocus: (event: GpuixSyntheticEvent) => {
      onFocus?.(event as never)
      if (!disabled) context.openNow("trigger-focus", event, triggerId, payload)
    },
    onBlur: (event: GpuixSyntheticEvent) => {
      onBlur?.(event as never)
      context.scheduleClose(closeDelay ?? provider.closeDelay, "trigger-focus", event)
    },
    onMouseDown: (event: GpuixSyntheticEvent) => {
      onMouseDown?.(event as never)
      if (closeOnClick && isOpen) context.close("trigger-press", event)
    },
    onClick: (event: GpuixSyntheticEvent) => {
      onClick?.(event as never)
      if (closeOnClick && isOpen) context.close("trigger-press", event)
    },
    onKeyDown: (event: GpuixSyntheticEvent & { key: string; defaultPrevented: boolean }) => {
      onKeyDown?.(event as never)
      if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.dismissLayer(event)) context.close("escape-key", event)
    },
  }
  if (typeof render === "function") return <>{render(resolved, state)}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <div {...resolved}>{children}</div>
})

export interface TooltipPortalState {}
export interface TooltipPortalProps extends TooltipPartProps<TooltipPortalState> {
  keepMounted?: boolean | undefined
  container?: HTMLElement | ShadowRoot | React.RefObject<HTMLElement | ShadowRoot | null> | null | undefined
}

export const TooltipPortal = forwardRef<PublicInstance, TooltipPortalProps>(function TooltipPortal(
  { children, render, className, style, container: _container, keepMounted: _keepMounted, ...props },
  ref
) {
  const state = {}
  const resolved = { ...props, className: resolveClassName(className, state), style: resolveStyle(style, state) }
  if (typeof render === "function") return <>{render({ ...resolved, ref }, state)}</>
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return <>{children}</>
})

export interface TooltipPositionerProps extends PositionerProps {
  side?: PositionerProps["side"] | undefined
}

export const TooltipPositioner = forwardRef<PublicInstance, TooltipPositionerProps>(function TooltipPositioner(
  { children, anchor, side = "top", open: openProp, ...props },
  ref
) {
  const context = useTooltipContext("Tooltip.Positioner")
  const open = openProp ?? context.open
  return (
    <FloatingPositioner
      {...props}
      ref={ref}
      anchor={anchor ?? context.triggerRef.current as unknown as Element | null}
      side={side}
      open={open && !context.forceUnmount}
      data-closed={!open ? "" : undefined}
      data-instant={context.instant}
    >
      {children}
    </FloatingPositioner>
  )
})

export interface TooltipPopupState {
  open: boolean
  side: PositionerState["side"]
  align: PositionerState["align"]
  instant: TooltipContextValue["instant"]
  transitionStatus: "starting" | "ending" | "idle"
}

export type TooltipPopupProps = TooltipPartProps<TooltipPopupState>

export const TooltipPopup = forwardRef<PublicInstance, TooltipPopupProps>(function TooltipPopup(
  { children, render, className, style, onMouseEnter, onMouseLeave, onKeyDown, onMouseDownOutside, ...props },
  ref
) {
  const context = useTooltipContext("Tooltip.Popup")
  const positioner = usePositionerState()
  const state: TooltipPopupState = {
    open: context.open,
    side: positioner?.side ?? "top",
    align: positioner?.align ?? "center",
    instant: context.instant,
    transitionStatus: "idle",
  }
  if ((!context.open && !context.popupMounted) || context.forceUnmount) return null
  const resolved: Props = {
    ...props,
    ref,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    "data-open": context.open ? "" : undefined,
    "data-closed": context.open ? undefined : "",
    "data-side": state.side,
    "data-align": state.align,
    "data-instant": state.instant,
    onMouseEnter: (event) => {
      onMouseEnter?.(event)
      if (!context.disableHoverablePopup) context.cancelClose()
    },
    onMouseLeave: (event) => {
      onMouseLeave?.(event)
      context.scheduleClose(context.closeDelay, "trigger-hover", event)
    },
    onKeyDown: (event) => {
      onKeyDown?.(event)
      if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.dismissLayer(event)) context.close("escape-key", event)
    },
    onMouseDownOutside: (event) => {
      onMouseDownOutside?.(event)
      context.close("outside-press", event)
    },
  }
  return <>{renderPart("div", render, resolved, children, state, ref)}</>
})

export interface TooltipArrowState {
  open: boolean
  side: PositionerState["side"]
  align: PositionerState["align"]
  uncentered: boolean
  instant: TooltipContextValue["instant"]
}

export type TooltipArrowProps = TooltipPartProps<TooltipArrowState>

export const TooltipArrow = forwardRef<PublicInstance, TooltipArrowProps>(function TooltipArrow(
  { children, render, className, style, ...props },
  ref
) {
  const context = useTooltipContext("Tooltip.Arrow")
  const positioner = usePositionerState()
  const state: TooltipArrowState = {
    open: context.open,
    side: positioner?.side ?? "top",
    align: positioner?.align ?? "center",
    uncentered: false,
    instant: context.instant,
  }
  const resolved: Props = {
    ...props,
    ref,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    "data-open": state.open ? "" : undefined,
    "data-closed": state.open ? undefined : "",
    "data-side": state.side,
    "data-align": state.align,
    "data-uncentered": state.uncentered ? "" : undefined,
    "data-instant": state.instant,
  }
  return <>{renderPart("div", render, resolved, children, state, ref)}</>
})

export interface TooltipViewportState {
  activationDirection: string | undefined
  transitioning: boolean
  instant: TooltipContextValue["instant"]
}

export type TooltipViewportProps = TooltipPartProps<TooltipViewportState>

export const TooltipViewport = forwardRef<PublicInstance, TooltipViewportProps>(function TooltipViewport(
  { children, render, className, style, ...props },
  ref
) {
  const context = useTooltipContext("Tooltip.Viewport")
  const state: TooltipViewportState = { activationDirection: undefined, transitioning: false, instant: context.instant }
  const resolved: Props = {
    ...props,
    ref,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    "data-activation-direction": undefined,
    "data-transitioning": undefined,
    "data-instant": state.instant,
  }
  return <>{renderPart("div", render, resolved, children, state, ref)}</>
})

export const Tooltip = {
  Provider: TooltipProvider,
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Portal: TooltipPortal,
  Positioner: TooltipPositioner,
  Popup: TooltipPopup,
  Arrow: TooltipArrow,
  Viewport: TooltipViewport,
  Handle: TooltipHandleImpl,
  createHandle: createTooltipHandle,
} as const

// Backwards-compatible prefixed parts for imports from `@gpuix/react`.
export {
  TooltipRoot as Root,
  TooltipTrigger as Trigger,
  TooltipPortal as Portal,
  TooltipPositioner as Positioner,
  TooltipPopup as Popup,
  TooltipArrow as Arrow,
  TooltipViewport as Viewport,
  TooltipProvider as Provider,
}
