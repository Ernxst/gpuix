/** Base UI-shaped Dialog and AlertDialog primitives for the native renderer. */

import React, {
  cloneElement,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode, RefObject } from "react"
import type { GpuixKeyboardEvent, GpuixMouseEvent, GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import { cancelAnimationFrame, requestAnimationFrame } from "../frame-clock.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { buttonProps } from "./button.js"
import { DismissLayerScope, renderSlot, setRefs, useDismissLayer } from "./floating.js"

export type DialogModal = boolean | "trap-focus"
export type DialogInteractionType = "mouse" | "touch" | "pen" | "keyboard"
export type DialogFocusTarget = boolean
  | number
  | PublicInstance
  | RefObject<HTMLElement | PublicInstance | null>
  | ((interactionType: DialogInteractionType) => boolean | HTMLElement | PublicInstance | null | void)
/** @deprecated Use DialogFocusTarget. */
export type FocusTarget = DialogFocusTarget

export interface DialogChangeEventDetails {
  reason: "trigger-press" | "outside-press" | "escape-key" | "close-press" | "focus-out" | "imperative-action" | "none"
  event: Event | GpuixSyntheticEvent
  cancel(): void
  allowPropagation(): void
  isCanceled: boolean
  isPropagationAllowed: boolean
  nested: boolean
  trigger: PublicInstance | undefined
  preventUnmountOnClose(): void
}

export class DialogHandle<Payload = unknown> {
  private controller: HandleController<Payload> | null = null

  constructor() {}
  open(triggerId: string | null): void { this.controller?.open(triggerId) }
  openWithPayload(payload: Payload): void { this.controller?.open(null, payload, true) }
  close(): void { this.controller?.close() }
  get isOpen(): boolean { return this.controller?.getOpen() ?? false }
  /** @internal */
  _attach(controller: HandleController<Payload> | null): void { this.controller = controller }
}

interface HandleController<Payload> {
  open(triggerId: string | null, payload?: Payload, hasPayload?: boolean): void
  close(): void
  getOpen(): boolean
}

export function createDialogHandle<Payload = unknown>(): DialogHandle<Payload> {
  return new DialogHandle<Payload>()
}

export interface DialogRootActions {
  unmount(): void
  close(): void
}

export interface DialogContextValue {
  open: boolean
  transitionStatus: DialogPartState["transitionStatus"]
  modal: DialogModal
  alert: boolean
  nested: boolean
  nestedDialogOpen: boolean
  disablePointerDismissal: boolean
  setOpen(open: boolean, reason?: DialogChangeEventDetails["reason"], nativeEvent?: GpuixSyntheticEvent): void
  triggerRef: React.MutableRefObject<PublicInstance | null>
  preventUnmountOnClose: boolean
  titleId: string
  descriptionId: string
  isTopLayer(event?: GpuixSyntheticEvent): boolean
  triggerId: string | null
  setTriggerId(id: string | null): void
  onNestedDialogCountChange(id: string, count: number): void
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(part: string): DialogContextValue {
  const context = useContext(DialogContext)
  if (!context) throw new Error(`${part} must be used inside Dialog.Root`)
  return context
}

export interface DialogRootProps<Payload = unknown> {
  children?: ReactNode | ((argument: { payload: Payload | undefined }) => ReactNode) | undefined
  open?: boolean | undefined
  defaultOpen?: boolean | undefined
  onOpenChange?: ((open: boolean, eventDetails: DialogChangeEventDetails) => void) | undefined
  onOpenChangeComplete?: ((open: boolean) => void) | undefined
  modal?: DialogModal | undefined
  disablePointerDismissal?: boolean | undefined
  actionsRef?: RefObject<DialogRootActions | null> | undefined
  handle?: DialogHandle<Payload> | undefined
  triggerId?: string | null | undefined
  defaultTriggerId?: string | null | undefined
}

export interface DialogProps extends DialogRootProps {}
export interface DialogRootState {}
export type DialogRootChangeEventReason = DialogChangeEventDetails["reason"]
export type DialogRootChangeEventDetails = DialogChangeEventDetails

interface RootOptions<Payload> extends DialogRootProps<Payload> {
  alert?: boolean
}

function DialogRootImpl<Payload = unknown>({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onOpenChangeComplete,
  modal = true,
  disablePointerDismissal = false,
  actionsRef,
  handle,
  triggerId: triggerIdProp,
  defaultTriggerId,
  alert = false,
}: RootOptions<Payload>): ReactElement {
  const parentContext = useContext(DialogContext)
  const nested = parentContext !== null
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const [preventUnmountOnClose, setPreventUnmountOnClose] = useState(false)
  const [nestedDialogCounts, setNestedDialogCounts] = useState<Record<string, number>>({})
  const open = openProp ?? localOpen
  const [transition, setTransition] = useState({ open, status: "none" as DialogPartState["transitionStatus"] })
  if (transition.open !== open) setTransition({ open, status: open ? "starting" : "ending" })
  const transitionStatus = transition.open === open ? transition.status : open ? "starting" : "ending"
  const previousOpen = useRef(open)
  const transitionFrame = useRef<number | null>(null)
  const onCompleteRef = useRef(onOpenChangeComplete)
  onCompleteRef.current = onOpenChangeComplete
  const [triggerId, setTriggerIdState] = useState<string | null>(triggerIdProp ?? defaultTriggerId ?? null)
  const [payload, setPayload] = useState<Payload | undefined>(undefined)
  const openRef = useRef(open)
  openRef.current = open
  const onChangeRef = useRef(onOpenChange)
  onChangeRef.current = onOpenChange
  const dismissLayer = useDismissLayer(open)
  const isTopLayer = useCallback((event?: GpuixSyntheticEvent) => dismissLayer(event), [dismissLayer])
  const triggerRef = useRef<PublicInstance | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const nestedDialogId = useId()
  const nestedDialogCount = Object.values(nestedDialogCounts).reduce((total, count) => total + count, 0)
  const onNestedDialogCountChange = useCallback((id: string, count: number) => {
    setNestedDialogCounts((current) => {
      if (count === 0) {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      }
      if (current[id] === count) return current
      return { ...current, [id]: count }
    })
  }, [])
  const setTriggerId = useCallback((id: string | null) => {
    setTriggerIdState(id)
  }, [])
  const setOpen = useCallback((nextOpen: boolean, reason: DialogChangeEventDetails["reason"] = "none", nativeEvent?: GpuixSyntheticEvent) => {
    if (openRef.current === nextOpen) return
    let canceled = false
    let propagationAllowed = false
    let shouldPreventUnmountOnClose = false
    const details: DialogChangeEventDetails = {
      reason,
      event: nativeEvent ?? new Event("base-ui"),
      cancel() { canceled = true },
      allowPropagation() { propagationAllowed = true },
      get isCanceled() { return canceled },
      get isPropagationAllowed() { return propagationAllowed },
      nested,
      trigger: triggerRef.current ?? undefined,
      preventUnmountOnClose() { if (!nextOpen) shouldPreventUnmountOnClose = true },
    }
    onChangeRef.current?.(nextOpen, details)
    if (!details.isPropagationAllowed) nativeEvent?.stopPropagation()
    if (details.isCanceled) return
    openRef.current = nextOpen
    if (openProp === undefined) setLocalOpen(nextOpen)
    setPreventUnmountOnClose(nextOpen ? false : shouldPreventUnmountOnClose)
  }, [nested, openProp])
  const controller = useRef<HandleController<Payload> | null>(null)
  controller.current = {
    open: (id, nextPayload, hasPayload) => {
      setTriggerId(id)
      if (hasPayload) setPayload(nextPayload)
      setOpen(true, "imperative-action")
    },
    close: () => setOpen(false, "imperative-action"),
    getOpen: () => openRef.current,
  }

  useEffect(() => {
    handle?._attach(controller.current)
    return () => handle?._attach(null)
  }, [handle])
  useEffect(() => {
    if (!actionsRef) return
    const actions = {
      unmount() {
        setPreventUnmountOnClose(false)
        setOpen(false, "imperative-action")
      },
      close() { setOpen(false, "imperative-action") },
    }
    ;(actionsRef as { current: DialogRootActions | null }).current = actions
    return () => { (actionsRef as { current: DialogRootActions | null }).current = null }
  }, [actionsRef, setOpen])
  useEffect(() => {
    if (previousOpen.current === open) return
    previousOpen.current = open
    if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current)
    transitionFrame.current = requestAnimationFrame(() => {
      transitionFrame.current = null
      setTransition((current) => current.open === open ? { open, status: "none" } : current)
      onCompleteRef.current?.(open)
    })
    return () => {
      if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current)
      transitionFrame.current = null
    }
  }, [open])
  useEffect(() => {
    if (triggerIdProp !== undefined) setTriggerIdState(triggerIdProp)
  }, [triggerIdProp])
  useLayoutEffect(() => {
    parentContext?.onNestedDialogCountChange(nestedDialogId, open ? nestedDialogCount + 1 : 0)
  }, [nestedDialogCount, nestedDialogId, open, parentContext?.onNestedDialogCountChange])
  useLayoutEffect(() => () => {
    parentContext?.onNestedDialogCountChange(nestedDialogId, 0)
  }, [nestedDialogId, parentContext?.onNestedDialogCountChange])

  const context: DialogContextValue = {
    open,
    transitionStatus,
    modal,
    alert,
    nested,
    nestedDialogOpen: nestedDialogCount > 0,
    preventUnmountOnClose,
    disablePointerDismissal,
    setOpen,
    triggerRef,
    titleId,
    descriptionId,
    isTopLayer,
    triggerId,
    setTriggerId,
    onNestedDialogCountChange,
  }
  const content = typeof children === "function" ? children({ payload }) : children
  return <DialogContext.Provider value={context}><DismissLayerScope>{content}</DismissLayerScope></DialogContext.Provider>
}

export function DialogRoot<Payload = unknown>(props: DialogRootProps<Payload>): ReactElement {
  return <DialogRootImpl {...props} />
}

export interface DialogPartState {
  open: boolean
  transitionStatus: "starting" | "ending" | "none"
  nested: boolean
  nestedDialogOpen: boolean
}
export interface DialogTriggerState { disabled: boolean; open: boolean }
export interface DialogCloseState { disabled: boolean }
export interface DialogSimpleState {}
export interface DialogPortalState {}
export type DialogPopupState = DialogPartState
export type DialogViewportState = DialogPartState
export type DialogBackdropState = { open: boolean; transitionStatus: DialogPartState["transitionStatus"] }
export type DialogTitleState = DialogSimpleState
export type DialogDescriptionState = DialogSimpleState

export type DialogStateStyle<State> = StyleDesc | ((state: State) => StyleDesc | undefined)
export type DialogComponentRenderFn<State> = (props: Props, state: State) => ReactElement

export interface DialogComponentProps<State> extends Omit<Props, "className" | "style" | "children"> {
  children?: ReactNode | undefined
  className?: string | ((state: State) => string | undefined) | undefined
  style?: DialogStateStyle<State> | undefined
  render?: ReactElement | DialogComponentRenderFn<State> | undefined
}

function partState(context: DialogContextValue): DialogPartState {
  return {
    open: context.open,
    transitionStatus: context.transitionStatus,
    nested: context.nested,
    nestedDialogOpen: context.nestedDialogOpen,
  }
}

function stateAttributes(state: DialogPartState): Props {
  return {
    "data-open": state.open ? "" : undefined,
    "data-closed": state.open ? undefined : "",
    "data-starting-style": state.transitionStatus === "starting" ? "" : undefined,
    "data-ending-style": state.transitionStatus === "ending" ? "" : undefined,
    "data-nested": state.nested ? "" : undefined,
    "data-nested-dialog-open": state.nestedDialogOpen ? "" : undefined,
  }
}

function backdropStateAttributes(state: DialogBackdropState): Props {
  return {
    "data-open": state.open ? "" : undefined,
    "data-closed": state.open ? undefined : "",
    "data-starting-style": state.transitionStatus === "starting" ? "" : undefined,
    "data-ending-style": state.transitionStatus === "ending" ? "" : undefined,
  }
}

function resolvePartProps<State>(
  props: DialogComponentProps<State>,
  state: State,
  ref: React.Ref<PublicInstance> | undefined,
): { children?: ReactNode; elementProps: Props; render?: DialogComponentProps<State>["render"] } {
  const { children, className, style, render, ...rest } = props
  const elementProps: Props = {
    ...rest,
    className: typeof className === "function" ? className(state) : className,
    style: (typeof style === "function" ? style(state) : style) as StyleDesc | undefined,
    ref,
  }
  return { children, elementProps, render }
}

function renderPart<State>(
  type: string,
  props: DialogComponentProps<State>,
  state: State,
  ref: React.Ref<PublicInstance> | undefined,
): ReactElement {
  const { children, elementProps, render } = resolvePartProps(props, state, ref)
  const resolved: ReactElement<Record<string, unknown>> | undefined = typeof render === "function"
    ? render({ ...elementProps, children }, state) as ReactElement<Record<string, unknown>>
    : render as ReactElement<Record<string, unknown>> | undefined
  if (resolved) {
    const mergedProps: Record<string, unknown> = { ...elementProps, ...resolved.props }
    for (const [key, renderHandler] of Object.entries(resolved.props)) {
      const componentHandler = (elementProps as Record<string, unknown>)[key]
      if (key.startsWith("on") && renderHandler !== componentHandler && typeof renderHandler === "function" && typeof componentHandler === "function") {
        mergedProps[key] = (...args: unknown[]) => {
          renderHandler(...args)
          componentHandler(...args)
        }
      }
    }
    mergedProps.children = resolved.props.children ?? children
    if (elementProps.ref && resolved.props.ref && elementProps.ref !== resolved.props.ref) {
      mergedProps.ref = (value: PublicInstance | null) => setRefs(value, resolved.props.ref as React.Ref<PublicInstance> | undefined, elementProps.ref as React.Ref<PublicInstance> | undefined)
    }
    return cloneElement(resolved, mergedProps as Props)
  }
  return React.createElement(type, elementProps, children) as ReactElement
}

export interface DialogTriggerProps<Payload = unknown> extends DialogComponentProps<DialogTriggerState> {
  asChild?: boolean | undefined
  disabled?: boolean | undefined
  nativeButton?: boolean | undefined
  handle?: DialogHandle<Payload> | undefined
  payload?: Payload | undefined
}

function DialogTriggerImpl<Payload = unknown>({
  asChild,
  disabled = false,
  nativeButton: _nativeButton,
  handle,
  payload,
  id,
  children,
  className,
  style,
  render,
  onClick,
  onKeyDown,
  onKeyUp,
  ...props
}: DialogTriggerProps<Payload>, forwardedRef: React.ForwardedRef<PublicInstance>): ReactElement {
  const context = useContext(DialogContext)
  if (!context && !handle) throw new Error("Dialog.Trigger must be used inside Dialog.Root or receive a handle")
  const ref = useCallback((value: PublicInstance | null) => {
    if (value && context?.triggerId === (id ?? value.id.toString())) context.triggerRef.current = value
    if (value && context?.triggerId === null) context.triggerRef.current = value
    setRefs(value, forwardedRef)
  }, [context, forwardedRef, id])
  const state = { disabled, open: context ? context.open && (context.triggerId === null || context.triggerId === (id ?? context.triggerId)) : handle?.isOpen ?? false }
  const activate = (event: GpuixMouseEvent) => {
    onClick?.(event)
    if (event.defaultPrevented || disabled) return
    if (handle) {
      if (payload !== undefined) handle.openWithPayload(payload)
      else handle.open(id ?? null)
    } else {
      if (!context) return
      context.setTriggerId(id ?? null)
      context.setOpen(true, "trigger-press", event)
    }
  }
  const finalProps: DialogComponentProps<DialogTriggerState> = {
    ...props,
    id,
    "aria-haspopup": "dialog",
    "aria-expanded": state.open,
    "data-disabled": disabled ? "" : undefined,
    "data-popup-open": state.open ? "" : undefined,
    ...buttonProps({ disabled, onClick: activate, onKeyDown, onKeyUp, tabIndex: props.tabIndex }),
    className,
    style,
    render,
    children,
  }
  if (asChild) return renderSlot({ asChild: true, children, ref, props: { ...finalProps, className: resolveClassName(className, state), style: resolveStyle(style, state) } })
  return renderPart("button", finalProps, state, ref)
}

function resolveClassName<State>(value: DialogComponentProps<State>["className"], state: State): string | undefined {
  return typeof value === "function" ? value(state) : value
}
function resolveStyle<State>(value: DialogComponentProps<State>["style"], state: State): StyleDesc | undefined {
  return typeof value === "function" ? value(state) : value
}

export const DialogTrigger = forwardRef<PublicInstance, DialogTriggerProps<unknown>>(DialogTriggerImpl)

export interface DialogPortalProps extends DialogComponentProps<DialogPortalState> {
  /** Accepted for Base UI source compatibility; native portals always target the GPU-IX window. */
  container?: HTMLElement | ShadowRoot | RefObject<HTMLElement | ShadowRoot | null> | null | undefined
  keepMounted?: boolean | undefined
}

export const DialogPortal = forwardRef<PublicInstance, DialogPortalProps>(function DialogPortal(
  { container: _container, keepMounted = false, children, style, className, render, ...props }, ref,
) {
  const context = useDialogContext("Dialog.Portal")
  if (!context.open && context.transitionStatus !== "ending" && !keepMounted && !context.preventUnmountOnClose) return null
  const state: DialogPortalState = {}
  const resolvedStyle: StyleDesc = { display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", ...resolveStyle(style, state), pointerEvents: context.modal === true ? undefined : "none" }
  const portalProps = {
    ...props,
    fill: "window",
    deferred: true,
    priority: 0,
    occlude: context.open && context.modal === true,
    className,
    style: resolvedStyle,
    children,
  }
  return renderPart("anchored", { ...portalProps, render }, state, ref)
})

export interface DialogBackdropProps extends DialogComponentProps<{ open: boolean; transitionStatus: DialogPartState["transitionStatus"] }> {
  forceRender?: boolean | undefined
}

export const DialogBackdrop = forwardRef<PublicInstance, DialogBackdropProps>(function DialogBackdrop(
  { forceRender = false, children, style, onMouseDown, className, render, ...props }, ref,
) {
  const context = useDialogContext("Dialog.Backdrop")
  if (!context.open && context.transitionStatus !== "ending" && !forceRender && !context.preventUnmountOnClose) return null
  const state = { open: context.open, transitionStatus: context.transitionStatus }
  const elementProps: DialogComponentProps<typeof state> = {
    ...props,
    className,
    style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, ...resolveStyle(style, state) },
    onMouseDown: (event: GpuixMouseEvent) => {
      onMouseDown?.(event)
      if (!event.defaultPrevented && !context.alert && !context.disablePointerDismissal && context.isTopLayer()) context.setOpen(false, "outside-press", event)
    },
    children,
    render,
  }
  return renderPart("div", { ...elementProps, ...backdropStateAttributes(state) }, state, ref)
})

export interface DialogPopupProps extends DialogComponentProps<DialogPartState> {
  initialFocus?: DialogFocusTarget | undefined
  finalFocus?: DialogFocusTarget | undefined
  tabIndex?: number | undefined
}

function resolveFocusTarget(target: DialogFocusTarget | undefined, fallback: number | null, interaction: DialogInteractionType = "keyboard"): number | null {
  if (target === undefined || target === true) return fallback
  if (target === false) return null
  if (typeof target === "number") return target
  if ("id" in target && typeof target.id === "number") return target.id
  const resolved = typeof target === "function"
    ? target(interaction)
    : "current" in target
      ? target.current
      : null
  if (resolved === undefined || resolved === null || resolved === false) return null
  if (resolved === true) return fallback
  if (typeof resolved === "number") return resolved
  if ("id" in resolved && typeof resolved.id === "number") return resolved.id
  return null
}

export const DialogPopup = forwardRef<PublicInstance, DialogPopupProps>(function DialogPopup(
  { children, style, onKeyDown, initialFocus, finalFocus, tabIndex = -1, className, render, ...props }, forwardedRef,
) {
  const context = useDialogContext("Dialog.Popup")
  const { renderer } = useGpuix()
  const popupRef = useRef<PublicInstance | null>(null)
  const previousFocus = useRef<number | null>(null)
  const initialFocusRef = useRef(initialFocus)
  const finalFocusRef = useRef(finalFocus)
  initialFocusRef.current = initialFocus
  finalFocusRef.current = finalFocus
  const state = partState(context)

  useLayoutEffect(() => {
    if (!context.open || !renderer) return
    previousFocus.current = renderer.getActiveElement?.() ?? null
    if (context.isTopLayer()) {
      const target = resolveFocusTarget(initialFocusRef.current, popupRef.current?.id ?? null)
      if (target !== null) renderer.focusElement?.(target)
    }
    return () => {
      const target = resolveFocusTarget(finalFocusRef.current, context.triggerRef.current?.id ?? previousFocus.current)
      if (target !== null) renderer.focusElement?.(target)
    }
  }, [context.isTopLayer, context.open, context.triggerRef, renderer])

  if (!context.open && context.transitionStatus !== "ending" && !context.preventUnmountOnClose) return null
  const elementProps: DialogComponentProps<DialogPartState> = {
    ...props,
    role: context.alert ? "alertdialog" : "dialog",
    "aria-modal": context.modal !== false ? true : undefined,
    "aria-labelledby": props["aria-labelledby"] ?? context.titleId,
    "aria-describedby": props["aria-describedby"] ?? context.descriptionId,
    tabIndex,
    style: { pointerEvents: "auto", ...resolveStyle(style, state) },
    className,
    render,
    onKeyDown: (event: GpuixKeyboardEvent) => {
      onKeyDown?.(event)
      if (event.key.toLowerCase() === "escape" && !context.alert && context.isTopLayer() && !event.defaultPrevented) context.setOpen(false, "escape-key", event)
      if (context.modal === false || event.key.toLowerCase() !== "tab" || event.defaultPrevented || !context.isTopLayer(event)) return
      const popup = popupRef.current
      if (!popup) return
      event.preventDefault()
      if (event.modifiers?.shift) renderer?.focusPreviousWithin?.(popup.id)
      else renderer?.focusNextWithin?.(popup.id)
    },
    children,
  }
  return renderPart("div", { ...elementProps, ...stateAttributes(state) }, state, (value) => {
    popupRef.current = value
    setRefs(value, forwardedRef)
  })
})

export interface DialogViewportProps extends DialogComponentProps<DialogPartState> {}

export const DialogViewport = forwardRef<PublicInstance, DialogViewportProps>(function DialogViewport(
  { children, className, style, render, ...props }, ref,
) {
  const context = useDialogContext("Dialog.Viewport")
  if (!context.open && context.transitionStatus !== "ending" && !context.preventUnmountOnClose) return null
  const state = partState(context)
  return renderPart("div", { ...props, role: "presentation", className, style, render, children, ...stateAttributes(state) }, state, ref)
})

export interface DialogTitleProps extends DialogComponentProps<DialogSimpleState> {}
export interface DialogDescriptionProps extends DialogComponentProps<DialogSimpleState> {}

export const DialogTitle = forwardRef<PublicInstance, DialogTitleProps>(function DialogTitle(props, ref) {
  const context = useDialogContext("Dialog.Title")
  const state = {}
  return renderPart("h2", { ...props, id: props.id ?? context.titleId }, state, ref)
})

export const DialogDescription = forwardRef<PublicInstance, DialogDescriptionProps>(function DialogDescription(props, ref) {
  const context = useDialogContext("Dialog.Description")
  const state = {}
  return renderPart("p", { ...props, id: props.id ?? context.descriptionId }, state, ref)
})

export interface DialogCloseProps extends DialogComponentProps<DialogCloseState> {
  asChild?: boolean
  disabled?: boolean
  nativeButton?: boolean
}

export const DialogClose = forwardRef<PublicInstance, DialogCloseProps>(function DialogClose(
  { asChild, disabled = false, nativeButton: _nativeButton, children, className, style, render, onClick, onKeyDown, onKeyUp, ...props }, ref,
) {
  const context = useDialogContext("Dialog.Close")
  const state = { disabled }
  const activate = (event: GpuixMouseEvent) => {
    onClick?.(event)
    if (!event.defaultPrevented && !disabled) context.setOpen(false, "close-press", event)
  }
  const componentProps = {
    ...props,
    disabled,
    className,
    style,
    render,
    ...buttonProps({ disabled, onClick: activate, onKeyDown, onKeyUp, tabIndex: props.tabIndex }),
    "data-disabled": disabled ? "" : undefined,
    children,
  }
  if (asChild) return renderSlot({ asChild: true, children, ref, props: { ...componentProps, className: resolveClassName(className, state), style: resolveStyle(style, state) } })
  return renderPart("button", componentProps, state, ref)
})

export class AlertDialogHandle<Payload = unknown> extends DialogHandle<Payload> {
  private readonly __alertDialogBrand = true
}

export function createAlertDialogHandle<Payload = unknown>(): AlertDialogHandle<Payload> {
  return new AlertDialogHandle<Payload>()
}

export type AlertDialogRootProps<Payload = unknown> = Omit<DialogRootProps<Payload>, "modal" | "disablePointerDismissal" | "handle"> & {
  handle?: AlertDialogHandle<Payload>
}
export type AlertDialogTriggerProps<Payload = unknown> = Omit<DialogTriggerProps<Payload>, "handle"> & {
  handle?: AlertDialogHandle<Payload>
}

export function AlertDialogRoot<Payload = unknown>(props: AlertDialogRootProps<Payload>): ReactElement {
  return <DialogRootImpl {...props} alert modal={true} disablePointerDismissal />
}

export const AlertDialogTrigger = forwardRef<PublicInstance, AlertDialogTriggerProps<unknown>>(function AlertDialogTrigger(props, ref) {
  return <DialogTrigger {...props} ref={ref} />
})

export type AlertDialogRootState = DialogRootState
export type AlertDialogRootChangeEventReason = DialogRootChangeEventReason
export type AlertDialogRootChangeEventDetails = DialogChangeEventDetails
export type AlertDialogTriggerState = DialogTriggerState
export type AlertDialogBackdropProps = DialogBackdropProps
export type AlertDialogBackdropState = DialogBackdropState
export type AlertDialogCloseProps = DialogCloseProps
export type AlertDialogCloseState = DialogCloseState
export type AlertDialogDescriptionProps = DialogDescriptionProps
export type AlertDialogDescriptionState = DialogDescriptionState
export type AlertDialogPopupProps = DialogPopupProps
export type AlertDialogPopupState = DialogPopupState
export type AlertDialogPortalProps = DialogPortalProps
export type AlertDialogPortalState = DialogPortalState
export type AlertDialogTitleProps = DialogTitleProps
export type AlertDialogTitleState = DialogTitleState
export type AlertDialogViewportProps = DialogViewportProps
export type AlertDialogViewportState = DialogViewportState

export const Dialog = Object.assign(DialogRoot, {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: DialogPopup,
  Viewport: DialogViewport,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Handle: DialogHandle,
  createHandle: createDialogHandle,
})

/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialog = Object.assign(AlertDialogRoot, {
  Root: AlertDialogRoot,
  Trigger: AlertDialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: DialogPopup,
  Viewport: DialogViewport,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Handle: AlertDialogHandle,
  createHandle: createAlertDialogHandle,
})

export {
  DialogRoot as Root,
  DialogTrigger as Trigger,
  DialogPortal as Portal,
  DialogBackdrop as Backdrop,
  DialogPopup as Popup,
  DialogViewport as Viewport,
  DialogTitle as Title,
  DialogDescription as Description,
  DialogClose as Close,
  DialogHandle as Handle,
}

/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogRootAlias = AlertDialogRoot
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogTriggerAlias = AlertDialogTrigger
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogPopupAlias = DialogPopup
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogPortalAlias = DialogPortal
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogBackdropAlias = DialogBackdrop
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogTitleAlias = DialogTitle
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogDescriptionAlias = DialogDescription
/** @deprecated Import AlertDialog from `@gpuix/react/alert-dialog`. */
export const AlertDialogCloseAlias = DialogClose
export const AlertDialogPortal = DialogPortal
export const AlertDialogBackdrop = DialogBackdrop
export const AlertDialogPopup = DialogPopup
export const AlertDialogTitle = DialogTitle
export const AlertDialogDescription = DialogDescription
export const AlertDialogClose = DialogClose
export const AlertDialogViewport = DialogViewport
