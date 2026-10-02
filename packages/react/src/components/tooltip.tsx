/** Base UI-shaped Tooltip parts over the shared GPUIX floating positioner. */

import React, {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type { GpuixMouseEvent, GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import {
  FloatingPositioner,
  floatingPopupStyle,
  renderSlot,
  useControllableState,
  useDismissLayer,
  usePositionerState,
  mergeStyles,
} from "./floating.js"
import type { PositionerProps, PositionerState, StateStyle } from "./floating.js"

const tooltipTriggerInstances = new Set<PublicInstance>()

function isDescendantTooltipTrigger(parent: PublicInstance, child: PublicInstance): boolean {
  return child !== parent && parent.contains(child)
}

function isNestedTooltipTrigger(currentTarget: PublicInstance, target: PublicInstance | null, x?: number, y?: number): boolean {
  let candidate = target
  while (candidate && candidate !== currentTarget) {
    if (tooltipTriggerInstances.has(candidate) && isDescendantTooltipTrigger(currentTarget, candidate)) return true
    candidate = candidate.parentElement
  }
  if (x !== undefined && y !== undefined) {
    for (const trigger of tooltipTriggerInstances) {
      if (trigger !== currentTarget && isDescendantTooltipTrigger(currentTarget, trigger)) {
        const bounds = trigger.getBoundingClientRect()
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) return true
      }
    }
  }
  return false
}

function isEnabledNestedTrigger(currentTarget: PublicInstance, target: PublicInstance | null, x?: number, y?: number): boolean {
  let candidate = target
  while (candidate && candidate !== currentTarget) {
    if (tooltipTriggerInstances.has(candidate) && isDescendantTooltipTrigger(currentTarget, candidate) && candidate.getAttribute("data-trigger-disabled") === null) return true
    candidate = candidate.parentElement
  }
  if (x !== undefined && y !== undefined) {
    for (const trigger of tooltipTriggerInstances) {
      if (trigger !== currentTarget && isDescendantTooltipTrigger(currentTarget, trigger) && trigger.getAttribute("data-trigger-disabled") === null) {
        const bounds = trigger.getBoundingClientRect()
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) return true
      }
    }
  }
  return false
}

function hasEnabledNestedTriggerFocused(currentTarget: PublicInstance): boolean {
  return isEnabledNestedTrigger(currentTarget, currentTarget.ownerDocument.activeElement as PublicInstance | null)
}

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
  cancel: () => void
  allowPropagation: () => void
  readonly isCanceled: boolean
  readonly isPropagationAllowed: boolean
}

function focusRemainsWithinTriggers(trigger: PublicInstance, triggers: Iterable<PublicInstance>): boolean {
  const activeElement = trigger.ownerDocument.activeElement
  return activeElement !== null && Array.from(triggers).some((candidate) =>
    candidate.getAttribute("data-trigger-disabled") === null && candidate.contains(activeElement as PublicInstance)
  )
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
  focusedTooltip: React.MutableRefObject<{ owner: object; close: () => void } | null>
  disableHoverableContent: boolean
}

const defaultProvider: ProviderValue = {
  delay: 600,
  closeDelay: 0,
  timeout: 400,
  lastClosedAt: { current: Number.NEGATIVE_INFINITY },
  focusedTooltip: { current: null },
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
  const focusedTooltip = useRef<ProviderValue["focusedTooltip"]["current"]>(null)
  const value = useMemo(() => ({ delay, closeDelay, timeout, lastClosedAt, focusedTooltip, disableHoverableContent }), [delay, closeDelay, timeout, lastClosedAt, focusedTooltip, disableHoverableContent])
  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>
}

export interface TooltipHandle<Payload = unknown> {
  open: (triggerId: string) => void
  close: () => void
  readonly isOpen: boolean
}

interface HandleRoot<Payload> {
  open: (triggerId: string, payload: Payload | undefined, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  close: (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  isOpen: () => boolean
  isDisabled: () => boolean
  setTrigger: (triggerId: string, instance: PublicInstance | null, payload?: Payload) => void
  cancelClose: () => void
  setCloseDelay: (delay: number) => void
}

class TooltipHandleImpl<Payload> implements TooltipHandle<Payload> {
  private root: HandleRoot<Payload> | null = null
  private roots: HandleRoot<Payload>[] = []
  private activePayload: Payload | undefined
  private activeTriggerId: string | null = null
  private triggerInstances = new Map<string, { instance: PublicInstance; payload: Payload | undefined }>()
  private pendingTriggerUnmounts = new Map<string, object>()
  private listeners = new Set<() => void>()
  private openTimer: ReturnType<typeof setTimeout> | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null

  open(triggerId: string): void {
    if (!this.root) {
      console.warn("Base UI: TooltipHandle.open() was called while no root using this handle is mounted. The call was ignored.")
      return
    }
    const trigger = this.triggerInstances.get(triggerId)
    if (!trigger) {
      throw new Error(`Base UI: TooltipHandle.open() was called with the trigger id "${triggerId}", but no matching trigger is registered with this handle.`)
    }
    this.activeTriggerId = triggerId
    this.activePayload = trigger.payload
    this.root.open(triggerId, trigger.payload, "imperative-action")
    this.notify()
  }

  close(): void {
    if (!this.root) {
      console.warn("Base UI: TooltipHandle.close() was called while no root using this handle is mounted. The call was ignored.")
      return
    }
    this.closeWithReason("imperative-action")
  }

  get isOpen(): boolean {
    return this.root?.isOpen() ?? false
  }

  get isDisabled(): boolean {
    return this.root?.isDisabled() ?? false
  }

  attach(root: HandleRoot<Payload>, attached: boolean): void {
    if (attached) {
      if (!this.roots.includes(root)) this.roots.push(root)
      if (this.roots.length > 1) console.warn("Base UI: TooltipHandle is attached to more than one mounted root.")
      this.root = root
    } else {
      this.roots = this.roots.filter((candidate) => candidate !== root)
      if (this.root === root) {
        const wasOpen = root.isOpen()
        this.root = this.roots.at(-1) ?? null
        if (wasOpen && this.root && this.activeTriggerId) {
          this.root.open(this.activeTriggerId, this.activePayload, "imperative-action")
        }
      }
    }
    if (!this.root) {
      this.cancelOpen()
      this.cancelClose()
    }
    for (const [triggerId, trigger] of this.triggerInstances) this.root?.setTrigger(triggerId, trigger.instance, trigger.payload)
    this.notify()
  }

  activate(triggerId: string, payload: Payload | undefined, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
    this.cancelOpen()
    this.cancelClose()
    this.sync(triggerId, payload)
    this.root?.open(triggerId, payload, reason, event)
    this.notify()
  }

  closeWithReason(reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
    this.cancelOpen()
    this.cancelClose()
    this.root?.close(reason, event)
  }

  scheduleOpen(delay: number, triggerId: string, payload: Payload | undefined, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
    this.cancelClose()
    this.cancelOpen()
    const open = () => this.activate(triggerId, payload, reason, event)
    if (delay <= 0) open()
    else this.openTimer = setTimeout(open, delay)
  }

  scheduleClose(delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
    this.cancelOpen()
    this.cancelClose()
    const close = () => this.closeWithReason(reason, event)
    if (delay <= 0) close()
    else this.closeTimer = setTimeout(close, delay)
  }

  cancelOpen(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer)
    this.openTimer = null
  }

  cancelOpenTimer(): void {
    this.cancelOpen()
  }

  cancelClose(): void {
    this.cancelCloseTimer()
    this.root?.cancelClose()
  }

  cancelCloseTimer(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer)
    this.closeTimer = null
  }

  sync(triggerId: string, payload: Payload | undefined): void {
    this.activeTriggerId = triggerId
    this.activePayload = payload
  }

  isTriggerOpen(triggerId: string): boolean {
    return this.isOpen && this.activeTriggerId === triggerId
  }

  setTrigger(triggerId: string, instance: PublicInstance | null): void {
    const payload = this.triggerInstances.get(triggerId)?.payload
    if (instance) this.triggerInstances.set(triggerId, { instance, payload })
    else {
      this.triggerInstances.delete(triggerId)
      if (this.activeTriggerId === triggerId) this.root?.close("trigger-focus")
    }
    this.root?.setTrigger(triggerId, instance, payload)
  }

  setTriggerPayload(triggerId: string, instance: PublicInstance | null, payload: Payload | undefined): void {
    if (instance) {
      this.pendingTriggerUnmounts.delete(triggerId)
      this.triggerInstances.set(triggerId, { instance, payload })
    } else {
      this.triggerInstances.delete(triggerId)
      const pending = {}
      this.pendingTriggerUnmounts.set(triggerId, pending)
      queueMicrotask(() => {
        if (this.pendingTriggerUnmounts.get(triggerId) !== pending) return
        this.pendingTriggerUnmounts.delete(triggerId)
        if (this.activeTriggerId === triggerId) this.root?.close("trigger-focus")
      })
    }
    this.root?.setTrigger(triggerId, instance, payload)
  }

  containsTrigger(instance: PublicInstance | null): boolean {
    return instance !== null && Array.from(this.triggerInstances.values()).some(({ instance: trigger }) =>
      trigger.getAttribute("data-trigger-disabled") === null && trigger.contains(instance)
    )
  }

  setCloseDelay(delay: number): void {
    this.root?.setCloseDelay(delay)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function attachTooltipHandle<Payload>(handle: TooltipHandle<Payload>, root: HandleRoot<Payload>, attached: boolean): void {
  ;(handle as TooltipHandleImpl<Payload>).attach(root, attached)
}

function TooltipHandleAttachment<Payload>({ handle, root }: { handle: TooltipHandle<Payload>; root: HandleRoot<Payload> }): null {
  useLayoutEffect(() => {
    attachTooltipHandle(handle, root, true)
    return () => attachTooltipHandle(handle, root, false)
  }, [handle, root])
  return null
}

function activateTooltipHandle<Payload>(handle: TooltipHandle<Payload>, triggerId: string, payload: Payload | undefined, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
  ;(handle as TooltipHandleImpl<Payload>).activate(triggerId, payload, reason, event)
}

function subscribeTooltipHandle(handle: TooltipHandle<unknown>, listener: () => void): () => void {
  return (handle as TooltipHandleImpl<unknown>).subscribe(listener)
}

function isTooltipHandleTriggerOpen(handle: TooltipHandle<unknown>, triggerId: string): boolean {
  return (handle as TooltipHandleImpl<unknown>).isTriggerOpen(triggerId)
}

function setTooltipHandleTrigger(handle: TooltipHandle<unknown>, triggerId: string, instance: PublicInstance | null, payload?: unknown): void {
  ;(handle as TooltipHandleImpl<unknown>).setTriggerPayload(triggerId, instance, payload)
}

function scheduleTooltipHandleOpen<Payload>(handle: TooltipHandle<Payload>, delay: number, triggerId: string, payload: Payload | undefined, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
  ;(handle as TooltipHandleImpl<Payload>).scheduleOpen(delay, triggerId, payload, reason, event)
}

function scheduleTooltipHandleClose(handle: TooltipHandle<unknown>, delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
  ;(handle as TooltipHandleImpl<unknown>).scheduleClose(delay, reason, event)
}

function closeTooltipHandleWithReason(handle: TooltipHandle<unknown>, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent): void {
  ;(handle as TooltipHandleImpl<unknown>).closeWithReason(reason, event)
}

function cancelTooltipHandleClose(handle: TooltipHandle<unknown>): void {
  ;(handle as TooltipHandleImpl<unknown>).cancelClose()
}

function cancelTooltipHandleOpen(handle: TooltipHandle<unknown>): void {
  ;(handle as TooltipHandleImpl<unknown>).cancelOpenTimer()
}

function cancelTooltipHandleCloseTimer(handle: TooltipHandle<unknown>): void {
  ;(handle as TooltipHandleImpl<unknown>).cancelCloseTimer()
}

function isTooltipHandleDisabled(handle: TooltipHandle<unknown>): boolean {
  return (handle as TooltipHandleImpl<unknown>).isDisabled
}

function setTooltipHandleCloseDelay(handle: TooltipHandle<unknown>, delay: number): void {
  ;(handle as TooltipHandleImpl<unknown>).setCloseDelay(delay)
}

function notifyTooltipHandle(handle: TooltipHandle<unknown> | undefined): void {
  if (handle) (handle as TooltipHandleImpl<unknown>).notify()
}

function syncTooltipHandle<Payload>(handle: TooltipHandle<Payload> | undefined, triggerId: string, payload: Payload | undefined): void {
  if (handle) (handle as TooltipHandleImpl<Payload>).sync(triggerId, payload)
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
  lastOpenReason: React.MutableRefObject<TooltipChangeEventReason | undefined>
  triggerRefs: React.MutableRefObject<Map<string, PublicInstance>>
  setTriggerRef: (triggerId: string, instance: PublicInstance | null) => void
  notifyTriggerChange: () => void
  getTrigger: (triggerId: string | null) => PublicInstance | null
  dismissLayer: (event?: GpuixSyntheticEvent) => boolean
  scheduleOpen: (delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, triggerId?: string, payload?: Payload) => void
  scheduleClose: (delay: number, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  openNow: (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, triggerId?: string, payload?: Payload) => void
  close: (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void
  cancelOpen: () => void
  cancelClose: () => void
  forceUnmount: boolean
  popupMounted: boolean
  disableHoverablePopup: boolean
  closeDelay: number
  setCloseDelay: (delay: number) => void
  handle: TooltipHandle<unknown> | undefined
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

const TooltipRootImpl = forwardRef<PublicInstance, TooltipRootProps<unknown>>(function TooltipRoot(
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
  const [openState, setOpenState] = useControllableState({ value: openProp, defaultValue: defaultOpen })
  const open = openState && !disabled
  const [popupMounted, setPopupMounted] = useState(openProp ?? defaultOpen)
  const [activeTriggerId, setActiveTriggerId] = useState<string | null>(triggerId ?? defaultTriggerId ?? null)
  const [activePayload, setActivePayload] = useState<unknown>()
  const [activeCloseDelay, setActiveCloseDelay] = useState(provider.closeDelay)
  const [, setTriggerRevision] = useState(0)
  const notifyTriggerChange = useCallback(() => setTriggerRevision((revision) => revision + 1), [])
  const [forceUnmount, setForceUnmount] = useState(false)
  const [instant, setInstant] = useState<TooltipContextValue["instant"]>()
  const lastOpenReason = useRef<TooltipChangeEventReason | undefined>(undefined)
  const triggerRefs = useRef(new Map<string, PublicInstance>())
  const pendingTriggerUnmounts = useRef(new Map<string, object>())
  const activeTriggerRef = useRef(activeTriggerId)
  activeTriggerRef.current = activeTriggerId
  const focusRegistration = useRef<object>({})
  const closeRef = useRef<(reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void>(() => {})
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissLayer = useDismissLayer(open)
  const previousOpen = useRef(open)
  const openRef = useRef(open)
  const requestedOpenRef = useRef(openProp ?? openState)
  const preventUnmountOnCloseRef = useRef(false)
  const disabledRef = useRef(disabled)
  const openNowRef = useRef<TooltipContextValue["openNow"]>(() => {})
  const closeCurrentRef = useRef<(reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => void>(() => {})
  const cancelCloseRef = useRef<() => void>(() => {})
  openRef.current = open
  requestedOpenRef.current = openProp ?? openState
  disabledRef.current = disabled

  const cancelOpen = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current)
    openTimer.current = null
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
    if (handle) cancelTooltipHandleCloseTimer(handle)
  }
  const setTriggerRef = useCallback((id: string, instance: PublicInstance | null) => {
    if (instance) {
      pendingTriggerUnmounts.current.delete(id)
      if (triggerRefs.current.get(id) !== instance) {
        triggerRefs.current.set(id, instance)
        notifyTriggerChange()
      }
      if (activeTriggerRef.current === null && openRef.current) {
        activeTriggerRef.current = id
        setActiveTriggerId(id)
      }
      return
    }
    const pending = {}
    pendingTriggerUnmounts.current.set(id, pending)
    queueMicrotask(() => {
      if (pendingTriggerUnmounts.current.get(id) !== pending) return
      pendingTriggerUnmounts.current.delete(id)
      if (triggerRefs.current.delete(id)) {
        notifyTriggerChange()
        if (activeTriggerRef.current === id) closeRef.current("trigger-focus")
      }
    })
  }, [notifyTriggerChange])
  const changeOpen = (next: boolean, reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent, nextTriggerId?: string, nextPayload?: unknown) => {
    cancelOpen()
    cancelClose()
    let preventUnmount = false
    let canceled = false
    let propagationAllowed = false
    const details: TooltipChangeEventDetails = {
      reason,
      event,
      trigger: triggerRefs.current.get(next ? nextTriggerId ?? triggerId ?? activeTriggerId ?? "" : triggerId ?? activeTriggerId ?? "") as unknown as Element | undefined,
      preventUnmountOnClose: () => { preventUnmount = true },
      cancel: () => { canceled = true },
      allowPropagation: () => { propagationAllowed = true },
      get isCanceled() { return canceled },
      get isPropagationAllowed() { return propagationAllowed },
    }
    if (next === requestedOpenRef.current) {
      if (next && nextTriggerId) {
        setActiveTriggerId(nextTriggerId)
        setActivePayload(nextPayload)
      }
      return
    }
    onOpenChange?.(next, details)
    if (canceled) return
    preventUnmountOnCloseRef.current = next ? false : preventUnmount
    if (reason === "escape-key" && !propagationAllowed) event?.stopPropagation()
    if (openProp !== undefined) {
      if (next) {
        setActiveTriggerId(nextTriggerId ?? triggerId ?? activeTriggerId)
        setActivePayload(nextPayload)
        lastOpenReason.current = reason
        setInstant(reason === "trigger-hover" ? "delay" : reason === "trigger-focus" ? "focus" : undefined)
      }
      return
    }
    requestedOpenRef.current = next
    setOpenState(next)
    if (next) {
      lastOpenReason.current = reason
      if (reason === "trigger-focus") {
        const focusedTooltip = provider.focusedTooltip.current
        if (focusedTooltip && focusedTooltip.owner !== focusRegistration.current) {
          focusedTooltip.close()
        }
        provider.focusedTooltip.current = {
          owner: focusRegistration.current,
          close: () => closeRef.current("none"),
        }
      }
      setPopupMounted(true)
      setForceUnmount(false)
      setActiveTriggerId(nextTriggerId ?? triggerId ?? activeTriggerId)
      setActivePayload(nextPayload)
      syncTooltipHandle(handle, nextTriggerId ?? triggerId ?? activeTriggerId ?? "", nextPayload)
      setInstant(reason === "trigger-hover" ? "delay" : reason === "trigger-focus" ? "focus" : undefined)
    } else {
      if (provider.focusedTooltip.current?.owner === focusRegistration.current) {
        provider.focusedTooltip.current = null
      }
      setPopupMounted(preventUnmount)
      if (!preventUnmount) setForceUnmount(false)
      setInstant("dismiss")
      if (reason !== "trigger-hover") provider.lastClosedAt.current = Date.now()
    }
    notifyTooltipHandle(handle)
  }
  const openNow: TooltipContextValue["openNow"] = (reason, event, id, nextPayload) => {
    if (disabled) return
    changeOpen(true, reason, event, id, nextPayload)
  }
  const close = (reason: TooltipChangeEventReason, event?: GpuixSyntheticEvent) => changeOpen(false, reason, event)
  closeRef.current = close
  openNowRef.current = openNow
  closeCurrentRef.current = close
  cancelCloseRef.current = cancelClose
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

  useEffect(() => {
    if (disabled && openState) close("disabled")
  }, [disabled, openState])

  useEffect(() => () => {
    cancelOpen()
    cancelClose()
    if (provider.focusedTooltip.current?.owner === focusRegistration.current) {
      provider.focusedTooltip.current = null
    }
  }, [handle])
  useEffect(() => {
    if (previousOpen.current !== open) {
      previousOpen.current = open
      onOpenChangeComplete?.(open)
    }
  }, [open, onOpenChangeComplete])
  useEffect(() => {
    notifyTooltipHandle(handle)
  }, [handle, open, activeTriggerId, activePayload])
  useEffect(() => {
    if (open) {
      preventUnmountOnCloseRef.current = false
      setPopupMounted(true)
    } else if (!preventUnmountOnCloseRef.current) {
      setPopupMounted(false)
    }
  }, [open])
  useEffect(() => {
    if (!actionsRef) return
    actionsRef.current = {
      unmount: () => setForceUnmount(true),
      close: () => close("imperative-action"),
    }
    return () => { actionsRef.current = null }
  }, [actionsRef, close])
  const handleRoot = useMemo<HandleRoot<unknown>>(() => ({
      open: (id, nextPayload, reason, event) => openNowRef.current(reason, event, id, nextPayload),
      close: (reason, event) => closeCurrentRef.current(reason, event),
      isOpen: () => openRef.current,
      isDisabled: () => disabledRef.current,
      setTrigger: (id, instance) => {
        if (instance) triggerRefs.current.set(id, instance)
        else triggerRefs.current.delete(id)
      },
      cancelClose: () => cancelCloseRef.current(),
      setCloseDelay: setActiveCloseDelay,
    }), [])

  const context: TooltipContextValue = {
    open,
    disabled,
    activeTriggerId: triggerId ?? activeTriggerId,
    payload: activePayload,
    instant,
    lastOpenReason,
    triggerRefs,
    setTriggerRef,
    cancelOpen,
    notifyTriggerChange,
    getTrigger: (id) => id ? triggerRefs.current.get(id) ?? null : null,
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
    handle,
  }
  const renderedChildren = typeof children === "function" ? children({ payload: activePayload }) : children
  return <TooltipContext.Provider value={context}>{handle && <TooltipHandleAttachment handle={handle} root={handleRoot} />}{renderedChildren}</TooltipContext.Provider>
})

export interface TooltipRootComponent {
  <Payload = unknown>(props: TooltipRootProps<Payload> & React.RefAttributes<PublicInstance>): ReactElement
}

export const TooltipRoot = TooltipRootImpl as TooltipRootComponent

export interface TooltipTriggerProps<Payload = unknown> extends TooltipPartProps<TooltipTriggerState> {
  handle?: TooltipHandle<Payload> | undefined
  payload?: Payload | undefined
  delay?: number | undefined
  closeDelay?: number | undefined
  closeOnClick?: boolean | undefined
  disabled?: boolean | undefined
  nativeButton?: boolean | undefined
}

const TooltipTriggerInRoot = forwardRef<PublicInstance, TooltipTriggerProps>(function TooltipTriggerInRoot(
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
    nativeButton = true,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
    onFocus,
    onBlur,
    onClick,
    onMouseDown,
    onPointerDown,
    onKeyDown,
    id,
    ...props
  },
  ref
) {
  const context = useTooltipContext("Tooltip.Trigger")
  const provider = useContext(ProviderContext)
  const disabled = disabledProp || context.disabled
  const nestedTriggerHovered = useRef(false)
  const pointerInside = useRef(false)
  const suppressHoverUntilLeave = useRef(false)
  const pointerPressed = useRef(false)
  const triggerInstanceRef = useRef<PublicInstance | null>(null)
  const triggerId = id ?? `tooltip-trigger-${React.useId()}`
  const isOpen = context.open && context.activeTriggerId === triggerId
  const state = { open: isOpen }
  const triggerRef = useCallback((instance: PublicInstance | null) => {
    triggerInstanceRef.current = instance
    const previous = context.triggerRefs.current.get(triggerId)
    if (previous) tooltipTriggerInstances.delete(previous)
    context.setTriggerRef(triggerId, instance)
    if (instance) {
      tooltipTriggerInstances.add(instance)
    }
    if (handle) setTooltipHandleTrigger(handle, triggerId, instance, payload)
    if (typeof ref === "function") ref(instance)
    else if (ref) ref.current = instance
  }, [context.setTriggerRef, triggerId, handle, payload, ref])
  const resolved: Props = {
    ...props,
    children,
    id: triggerId,
    ref: triggerRef,
    tabIndex: props.tabIndex ?? 0,
    "data-popup-open": isOpen ? "" : undefined,
    "data-trigger-disabled": disabled ? "" : undefined,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    onMouseEnter: (event: GpuixMouseEvent) => {
      onMouseEnter?.(event as never)
      if (pointerInside.current) return
      pointerInside.current = true
      if (nestedTriggerHovered.current) return
      if (suppressHoverUntilLeave.current) return
      if (disabled) return
      if (isEnabledNestedTrigger(event.currentTarget, event.target, event.clientX, event.clientY)) {
        nestedTriggerHovered.current = true
        context.cancelOpen()
        context.cancelClose()
        if (context.lastOpenReason.current === "trigger-hover") context.close("trigger-hover")
        return
      }
      context.setCloseDelay(closeDelay ?? provider.closeDelay)
      context.scheduleOpen(delay ?? provider.delay, "trigger-hover", event, triggerId, payload)
    },
    onMouseMove: (event: GpuixMouseEvent) => {
      onMouseMove?.(event as never)
      if (disabled) return
      if (isEnabledNestedTrigger(event.currentTarget, event.target, event.clientX, event.clientY)) {
        nestedTriggerHovered.current = true
        context.cancelOpen()
        context.cancelClose()
        if (context.lastOpenReason.current === "trigger-hover") context.close("trigger-hover")
      } else if (nestedTriggerHovered.current) {
        nestedTriggerHovered.current = false
        context.setCloseDelay(closeDelay ?? provider.closeDelay)
        context.scheduleOpen(delay ?? provider.delay, "trigger-hover", event, triggerId, payload)
      }
    },
    onMouseLeave: (event: GpuixMouseEvent) => {
      onMouseLeave?.(event as never)
      pointerInside.current = false
      suppressHoverUntilLeave.current = false
      if (isNestedTooltipTrigger(event.currentTarget, event.relatedTarget, event.clientX, event.clientY)) {
        if (isEnabledNestedTrigger(event.currentTarget, event.relatedTarget, event.clientX, event.clientY)) {
          nestedTriggerHovered.current = true
          context.cancelOpen()
          context.cancelClose()
          if (context.lastOpenReason.current === "trigger-hover") context.close("trigger-hover")
        }
        return
      }
      nestedTriggerHovered.current = false
      context.scheduleClose(closeDelay ?? provider.closeDelay, "trigger-hover", event)
    },
    onFocus: (event: GpuixSyntheticEvent) => {
      onFocus?.(event as never)
      if (!disabled && !pointerPressed.current && !isEnabledNestedTrigger(event.currentTarget, event.target) && !hasEnabledNestedTriggerFocused(event.currentTarget)) {
        context.setCloseDelay(closeDelay ?? provider.closeDelay)
        context.openNow("trigger-focus", event, triggerId, payload)
      }
    },
    onBlur: (event: GpuixSyntheticEvent) => {
      onBlur?.(event as never)
      if (context.instant === "focus") {
        if (!focusRemainsWithinTriggers(event.currentTarget, context.triggerRefs.current.values())) {
          if (focusRemainsWithinTriggers(event.currentTarget, tooltipTriggerInstances)) {
            const blurredTrigger = event.currentTarget
            queueMicrotask(() => {
              if (triggerInstanceRef.current === blurredTrigger) context.close("trigger-focus", event)
            })
          } else context.close("trigger-focus", event)
        }
      } else context.scheduleClose(closeDelay ?? provider.closeDelay, "trigger-focus", event)
    },
    onMouseDown: (event: GpuixSyntheticEvent) => {
      onMouseDown?.(event as never)
      pointerPressed.current = true
    },
    onPointerDown: (event: GpuixSyntheticEvent) => {
      onPointerDown?.(event as never)
      pointerPressed.current = true
    },
    onClick: (event: GpuixSyntheticEvent) => {
      onClick?.(event as never)
      pointerPressed.current = true
      queueMicrotask(() => { pointerPressed.current = false })
      if (closeOnClick && isOpen) {
        suppressHoverUntilLeave.current = true
        context.close("trigger-press", event)
      }
    },
    onKeyDown: (event: GpuixSyntheticEvent & { key: string; defaultPrevented: boolean }) => {
      onKeyDown?.(event as never)
      if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.dismissLayer()) context.close("escape-key", event)
    },
  }
  if (typeof render === "function") return render(resolved, state)
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return nativeButton ? <button {...resolved}>{children}</button> : <div {...resolved}>{children}</div>
})

const TooltipTriggerWithHandle = forwardRef<PublicInstance, TooltipTriggerProps>(function TooltipTriggerWithHandle(
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
    nativeButton = true,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
    onFocus,
    onBlur,
    onClick,
    onMouseDown,
    onPointerDown,
    onKeyDown,
    id,
    ...props
  },
  ref
) {
  const provider = useContext(ProviderContext)
  const generatedId = React.useId()
  const triggerId = id ?? `tooltip-trigger-${generatedId}`
  const activeHandle = handle!
  const focusOpened = useRef(false)
  const isOpen = useSyncExternalStore(
    (listener) => subscribeTooltipHandle(activeHandle, listener),
    () => isTooltipHandleTriggerOpen(activeHandle, triggerId),
    () => false
  )
  const disabled = disabledProp || isTooltipHandleDisabled(activeHandle)
  const nestedTriggerHovered = useRef(false)
  const pointerInside = useRef(false)
  const suppressHoverUntilLeave = useRef(false)
  const triggerInstanceRef = useRef<PublicInstance | null>(null)
  const pointerPressed = useRef(false)
  useEffect(() => () => {
    cancelTooltipHandleClose(activeHandle)
  }, [activeHandle])
  const state = { open: isOpen }
  const resolved: Props = {
    ...props,
    children,
    id: triggerId,
    ref: (instance: PublicInstance | null) => {
      if (triggerInstanceRef.current) tooltipTriggerInstances.delete(triggerInstanceRef.current)
      triggerInstanceRef.current = instance
      setTooltipHandleTrigger(activeHandle, triggerId, instance, payload)
      if (instance) {
        tooltipTriggerInstances.add(instance)
      }
      if (typeof ref === "function") ref(instance)
      else if (ref) ref.current = instance
    },
    tabIndex: props.tabIndex ?? 0,
    "data-popup-open": isOpen ? "" : undefined,
    "data-trigger-disabled": disabled ? "" : undefined,
    className: resolveClassName(className, state),
    style: resolveStyle(style, state),
    onMouseEnter: (event: GpuixMouseEvent) => {
      onMouseEnter?.(event as never)
      if (pointerInside.current) return
      pointerInside.current = true
      if (nestedTriggerHovered.current) return
      if (suppressHoverUntilLeave.current) return
      if (disabled) return
      if (isEnabledNestedTrigger(event.currentTarget, event.target, event.clientX, event.clientY)) {
        nestedTriggerHovered.current = true
        cancelTooltipHandleOpen(activeHandle)
        cancelTooltipHandleClose(activeHandle)
        return
      }
      focusOpened.current = false
      setTooltipHandleCloseDelay(activeHandle, closeDelay ?? provider.closeDelay)
      cancelTooltipHandleClose(activeHandle)
      const recentlyClosed = Date.now() - provider.lastClosedAt.current <= provider.timeout
      scheduleTooltipHandleOpen(activeHandle, recentlyClosed ? 0 : delay ?? provider.delay, triggerId, payload, "trigger-hover", event)
    },
    onMouseMove: (event: GpuixMouseEvent) => {
      onMouseMove?.(event as never)
      if (disabled) return
      if (isEnabledNestedTrigger(event.currentTarget, event.target, event.clientX, event.clientY)) {
        nestedTriggerHovered.current = true
        cancelTooltipHandleOpen(activeHandle)
        cancelTooltipHandleClose(activeHandle)
        return
      }
      if (nestedTriggerHovered.current) {
        nestedTriggerHovered.current = false
        const recentlyClosed = Date.now() - provider.lastClosedAt.current <= provider.timeout
        scheduleTooltipHandleOpen(activeHandle, recentlyClosed ? 0 : delay ?? provider.delay, triggerId, payload, "trigger-hover", event)
      }
    },
    onMouseLeave: (event: GpuixMouseEvent) => {
      onMouseLeave?.(event as never)
      pointerInside.current = false
      suppressHoverUntilLeave.current = false
      if (isNestedTooltipTrigger(event.currentTarget, event.relatedTarget, event.clientX, event.clientY)) {
        if (isEnabledNestedTrigger(event.currentTarget, event.relatedTarget, event.clientX, event.clientY)) {
          nestedTriggerHovered.current = true
          cancelTooltipHandleOpen(activeHandle)
          cancelTooltipHandleClose(activeHandle)
        }
        return
      }
      nestedTriggerHovered.current = false
      scheduleTooltipHandleClose(activeHandle, closeDelay ?? provider.closeDelay, "trigger-hover", event)
    },
    onFocus: (event: GpuixSyntheticEvent) => {
      onFocus?.(event as never)
      if (!disabled && !pointerPressed.current && !isEnabledNestedTrigger(event.currentTarget, event.target) && !hasEnabledNestedTriggerFocused(event.currentTarget)) {
        focusOpened.current = true
        setTooltipHandleCloseDelay(activeHandle, closeDelay ?? provider.closeDelay)
        activateTooltipHandle(activeHandle, triggerId, payload, "trigger-focus", event)
      }
    },
    onBlur: (event: GpuixSyntheticEvent) => {
      onBlur?.(event as never)
      if (focusOpened.current && isOpen) {
        const activeElement = event.currentTarget.ownerDocument.activeElement as PublicInstance | null
        if (activeElement === null || !(activeHandle as TooltipHandleImpl<unknown>).containsTrigger(activeElement)) {
          closeTooltipHandleWithReason(activeHandle, "trigger-focus", event)
        }
      } else scheduleTooltipHandleClose(activeHandle, closeDelay ?? provider.closeDelay, "trigger-focus", event)
    },
    onMouseDown: (event: GpuixSyntheticEvent) => {
      onMouseDown?.(event as never)
      pointerPressed.current = true
    },
    onPointerDown: (event: GpuixSyntheticEvent) => {
      onPointerDown?.(event as never)
      pointerPressed.current = true
    },
    onClick: (event: GpuixSyntheticEvent) => {
      onClick?.(event as never)
      pointerPressed.current = true
      queueMicrotask(() => { pointerPressed.current = false })
      if (closeOnClick && isOpen) {
        suppressHoverUntilLeave.current = true
        closeTooltipHandleWithReason(activeHandle, "trigger-press", event)
      }
    },
    onKeyDown: (event: GpuixSyntheticEvent & { key: string; defaultPrevented: boolean }) => {
      onKeyDown?.(event as never)
      if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && isOpen) closeTooltipHandleWithReason(activeHandle, "escape-key", event)
    },
  }
  if (typeof render === "function") return render(resolved, state)
  if (isValidElement<Props>(render)) return renderSlot({ asChild: true, children: render, props: resolved, ref })
  return nativeButton ? <button {...resolved}>{children}</button> : <div {...resolved}>{children}</div>
})

const TooltipTriggerImpl = forwardRef<PublicInstance, TooltipTriggerProps>(function TooltipTrigger(props, ref) {
  const context = useContext(TooltipContext)
  if (context) return <TooltipTriggerInRoot {...props} ref={ref} />
  if (!props.handle) throw new Error("Tooltip.Trigger must be used inside Tooltip.Root or with a Handle")
  return <TooltipTriggerWithHandle {...props} ref={ref} />
})

export interface TooltipTriggerComponent {
  <Payload = unknown>(props: TooltipTriggerProps<Payload> & React.RefAttributes<PublicInstance>): ReactElement
}

export const TooltipTrigger = TooltipTriggerImpl as TooltipTriggerComponent

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

export interface TooltipPositionerState extends PositionerState {
  instant: TooltipContextValue["instant"]
}

export interface TooltipPositionerProps extends Omit<PositionerProps, "className" | "style" | "render"> {
  side?: PositionerProps["side"] | undefined
  className?: string | ((state: TooltipPositionerState) => string | undefined) | undefined
  style?: StateStyle<TooltipPositionerState> | ((state: TooltipPositionerState) => StyleDesc | undefined) | undefined
  render?: ReactElement | ((props: Props, state: TooltipPositionerState) => ReactNode) | undefined
}

export const TooltipPositioner = forwardRef<PublicInstance, TooltipPositionerProps>(function TooltipPositioner(
  { children, anchor, side = "top", open: openProp, className, style, render, collisionAvoidance = { align: "flip", fallbackAxisSide: "end" }, ...props },
  ref
) {
  const context = useTooltipContext("Tooltip.Positioner")
  const open = openProp ?? context.open
  const applyState = (state: PositionerState): TooltipPositionerState => ({ ...state, instant: context.instant })
  const applyStyle = (state: PositionerState) => {
    const resolvedStyle = typeof style === "function" ? style(applyState(state)) : style
    return context.disableHoverablePopup ? mergeStyles(resolvedStyle, { pointerEvents: "none" }) : resolvedStyle
  }
  return (
    <FloatingPositioner
      {...props}
      ref={ref}
      anchor={anchor ?? context.getTrigger(context.activeTriggerId) as unknown as Element | null}
      side={side}
      collisionAvoidance={collisionAvoidance}
      open={open && !context.forceUnmount}
      className={typeof className === "function" ? (state) => className(applyState(state)) : className}
      style={style === undefined ? (context.disableHoverablePopup ? { pointerEvents: "none" } : undefined) : applyStyle}
      render={typeof render === "function" ? (renderProps, state) => render(renderProps, applyState(state)) : render}
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
  if (!positioner) throw new Error("Base UI: TooltipPositionerContext is missing. TooltipPositioner parts must be placed within <Tooltip.Positioner>.")
  const state: TooltipPopupState = {
    open: context.open,
    side: positioner?.side ?? "top",
    align: positioner?.align ?? "center",
    instant: context.instant,
    transitionStatus: "idle",
  }
  const resolvedClassName = resolveClassName(className, state)
  if ((!context.open && !context.popupMounted) || context.forceUnmount) return null
  const resolved: Props = {
    ...props,
    ref,
    className: resolvedClassName,
    style: floatingPopupStyle(resolveStyle(style, state), resolvedClassName),
    "data-open": context.open ? "" : undefined,
    "data-closed": context.open ? undefined : "",
    "data-side": state.side,
    "data-align": state.align,
    "data-instant": state.instant,
    onMouseEnter: (event) => {
      onMouseEnter?.(event)
      if (!context.disableHoverablePopup) {
        context.cancelClose()
        if (context.handle) cancelTooltipHandleClose(context.handle)
      }
    },
    onMouseLeave: (event) => {
      onMouseLeave?.(event)
      context.scheduleClose(context.closeDelay, "trigger-hover", event)
    },
    onKeyDown: (event) => {
      onKeyDown?.(event)
      if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.dismissLayer()) context.close("escape-key", event)
    },
    onMouseDownOutside: (event) => {
      onMouseDownOutside?.(event)
      if (event.x !== undefined && event.y !== undefined) {
        for (const trigger of context.triggerRefs.current.values()) {
          const bounds = trigger.getBoundingClientRect()
          if (event.x >= bounds.left && event.x <= bounds.right && event.y >= bounds.top && event.y <= bounds.bottom) return
        }
      }
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
    "aria-hidden": props["aria-hidden"] ?? "true",
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

export function Tooltip(): null { return null }

Object.assign(Tooltip, {
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
})

export namespace TooltipRoot { export type Props<Payload = unknown> = TooltipRootProps<Payload>; export type State = TooltipRootState; export type Actions = TooltipRootActions; export type ChangeEventReason = TooltipChangeEventReason; export type ChangeEventDetails = TooltipChangeEventDetails }
export namespace TooltipTrigger { export type Props<Payload = unknown> = TooltipTriggerProps<Payload>; export type State = TooltipTriggerState }
export namespace TooltipPortal { export type Props = TooltipPortalProps; export type State = TooltipPortalState }
export namespace TooltipPositioner { export type Props = TooltipPositionerProps; export type State = TooltipPositionerState }
export namespace TooltipPopup { export type Props = TooltipPopupProps; export type State = TooltipPopupState }
export namespace TooltipArrow { export type Props = TooltipArrowProps; export type State = TooltipArrowState }
export namespace TooltipProvider { export type Props = TooltipProviderProps; export type State = Record<string, never> }
export namespace TooltipViewport { export type Props = TooltipViewportProps; export type State = TooltipViewportState }
export namespace Tooltip {
  export import Root = TooltipRoot
  export import Trigger = TooltipTrigger
  export import Portal = TooltipPortal
  export import Positioner = TooltipPositioner
  export import Popup = TooltipPopup
  export import Arrow = TooltipArrow
  export import Provider = TooltipProvider
  export import Viewport = TooltipViewport
  export const Handle = TooltipHandleImpl
  export const createHandle = createTooltipHandle
}

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
