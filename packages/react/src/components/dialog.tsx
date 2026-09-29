/** Base UI-shaped Dialog and AlertDialog primitives. */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react"
import type { ReactElement, ReactNode, RefObject } from "react"
import type { GpuixKeyboardEvent, GpuixMouseEvent, GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { buttonProps } from "./button.js"
import { DismissLayerScope, renderSlot, setRefs, useControllableState, useDismissLayer } from "./floating.js"

export type FocusTarget = number | PublicInstance | RefObject<PublicInstance | null> | false | null

interface DialogContextValue {
  open: boolean
  modal: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<PublicInstance | null>
  titleId: string
  descriptionId: string
  isTopLayer: (event?: GpuixSyntheticEvent) => boolean
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(part: string): DialogContextValue {
  const context = useContext(DialogContext)
  if (!context) throw new Error(`${part} must be used inside Dialog.Root`)
  return context
}

export interface DialogProps {
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
}

export function Dialog({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  modal = true,
}: DialogProps): ReactElement {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange })
  const isTopLayer = useDismissLayer(open)
  const triggerRef = useRef<PublicInstance | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const context = { open, modal, setOpen, triggerRef, titleId, descriptionId, isTopLayer }
  return <DialogContext.Provider value={context}><DismissLayerScope>{children}</DismissLayerScope></DialogContext.Provider>
}

export interface DialogTriggerProps extends Props { asChild?: boolean }

export const DialogTrigger = forwardRef<PublicInstance, DialogTriggerProps>(function DialogTrigger(
  { asChild, children, onClick, onKeyDown, onKeyUp, ...props }, forwardedRef
) {
  const context = useDialogContext("Dialog.Trigger")
  const ref = useCallback((value: PublicInstance | null) => {
    context.triggerRef.current = value
    setRefs(value, forwardedRef)
  }, [context.triggerRef, forwardedRef])
  const activate = (event: GpuixMouseEvent) => {
    onClick?.(event)
    if (!event.defaultPrevented) context.setOpen(true)
  }
  return renderSlot({
    asChild,
    children,
    ref,
    props: {
      ...props,
      "aria-haspopup": "dialog",
      "aria-expanded": context.open,
      ...buttonProps({ disabled: props.disabled === true, onClick: activate, onKeyDown, onKeyUp, tabIndex: !asChild && props.tabIndex === undefined ? 0 : props.tabIndex }),
    },
  })
})

export interface DialogPortalProps extends Props { children?: ReactNode }

export const DialogPortal = forwardRef<PublicInstance, DialogPortalProps>(function DialogPortal(
  { children, style, ...props }, ref
) {
  const context = useDialogContext("Dialog.Portal")
  if (!context.open) return null
  return (
    <anchored
      {...props}
      ref={ref}
      fill="window"
      deferred
      priority={0}
      occlude={context.modal}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
        ...style,
        pointerEvents: context.modal ? style?.pointerEvents : "none",
      }}
    >
      {children}
    </anchored>
  )
})

export interface DialogBackdropProps extends Props {}

export const DialogBackdrop = forwardRef<PublicInstance, DialogBackdropProps>(function DialogBackdrop(
  { style, onMouseDown, ...props }, ref
) {
  const context = useDialogContext("Dialog.Backdrop")
  return (
    <div
      {...props}
      ref={ref}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, ...style }}
      onMouseDown={(event: GpuixMouseEvent) => {
        onMouseDown?.(event)
        if (!event.defaultPrevented && context.isTopLayer()) context.setOpen(false)
      }}
    />
  )
})

export interface DialogPopupProps extends Props {
  initialFocus?: FocusTarget
  finalFocus?: FocusTarget
  role?: "dialog" | "alertdialog"
}

function resolveFocusTarget(target: FocusTarget | undefined, fallback: number | null): number | null {
  if (target === undefined) return fallback
  if (target === false || target === null) return null
  if (typeof target === "number") return target
  if ("id" in target) return target.id
  return target.current?.id ?? null
}

export const DialogPopup = forwardRef<PublicInstance, DialogPopupProps>(function DialogPopup(
  { children, style, onKeyDown, initialFocus, finalFocus, tabIndex = -1, role = "dialog", ...props }, forwardedRef
) {
  const context = useDialogContext("Dialog.Popup")
  const { renderer } = useGpuix()
  const popupRef = useRef<PublicInstance | null>(null)
  const previousFocus = useRef<number | null>(null)
  const initialFocusRef = useRef(initialFocus)
  const finalFocusRef = useRef(finalFocus)
  initialFocusRef.current = initialFocus
  finalFocusRef.current = finalFocus

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

  if (!context.open) return null
  return (
    <div
      {...props}
      ref={(value: PublicInstance | null) => {
        popupRef.current = value
        setRefs(value, forwardedRef)
      }}
      role={role}
      aria-modal={context.modal}
      aria-labelledby={context.titleId}
      aria-describedby={context.descriptionId}
      tabIndex={tabIndex}
      style={{ pointerEvents: "auto", ...style }}
      onKeyDown={(event: GpuixKeyboardEvent) => {
        onKeyDown?.(event)
        if (event.key.toLowerCase() === "escape" && context.isTopLayer(event)) {
          if (!event.defaultPrevented) context.setOpen(false)
        }
        if (!context.modal || event.key.toLowerCase() !== "tab" || event.defaultPrevented || !context.isTopLayer(event)) return
        const popup = popupRef.current
        if (!popup) return
        event.preventDefault()
        if (event.modifiers?.shift) renderer?.focusPreviousWithin?.(popup.id)
        else renderer?.focusNextWithin?.(popup.id)
      }}
    >
      {children}
    </div>
  )
})

export const DialogTitle = forwardRef<PublicInstance, Props>(function DialogTitle(props, ref) {
  const context = useDialogContext("Dialog.Title")
  return <div {...props} id={props.id ?? context.titleId} role="heading" aria-level={2} ref={ref} />
})

export const DialogDescription = forwardRef<PublicInstance, Props>(function DialogDescription(props, ref) {
  const context = useDialogContext("Dialog.Description")
  return <div {...props} id={props.id ?? context.descriptionId} ref={ref} />
})

export interface DialogCloseProps extends Props { asChild?: boolean }

export const DialogClose = forwardRef<PublicInstance, DialogCloseProps>(function DialogClose(
  { asChild, children, onClick, onKeyDown, onKeyUp, ...props }, ref
) {
  const context = useDialogContext("Dialog.Close")
  const activate = (event: GpuixMouseEvent) => {
    onClick?.(event)
    if (!event.defaultPrevented) context.setOpen(false)
  }
  return renderSlot({
    asChild,
    children,
    ref,
    props: {
      ...props,
      ...buttonProps({ disabled: props.disabled === true, onClick: activate, onKeyDown, onKeyUp, tabIndex: !asChild && props.tabIndex === undefined ? 0 : props.tabIndex }),
    },
  })
})

export const AlertDialogPopup = forwardRef<PublicInstance, DialogPopupProps>(function AlertDialogPopup(props, ref) {
  return <DialogPopup {...props} ref={ref} role="alertdialog" />
})

export {
  Dialog as Root,
  DialogTrigger as Trigger,
  DialogPortal as Portal,
  DialogBackdrop as Backdrop,
  DialogPopup as Popup,
  DialogTitle as Title,
  DialogDescription as Description,
  DialogClose as Close,
}

export namespace Dialog {
  export const Root = Dialog
  export const Trigger = DialogTrigger
  export const Portal = DialogPortal
  export const Backdrop = DialogBackdrop
  export const Popup = DialogPopup
  export const Title = DialogTitle
  export const Description = DialogDescription
  export const Close = DialogClose
}

export const DialogRoot = Dialog
export const AlertDialogRoot = Dialog
export const AlertDialogTrigger = DialogTrigger
export const AlertDialogPortal = DialogPortal
export const AlertDialogBackdrop = DialogBackdrop
export const AlertDialogTitle = DialogTitle
export const AlertDialogDescription = DialogDescription
export const AlertDialogClose = DialogClose
export const AlertDialog = Object.assign(Dialog, {
  Root: Dialog,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: AlertDialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
})
