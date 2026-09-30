/** Headless shadcn-shaped Tooltip components over GPUIX anchored layers. */

import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type { GpuixKeyboardEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance } from "../types/host.js"
import {
  DismissLayerScope,
  FloatingLayer,
  floatingRootStyle,
  renderSlot,
  useControllableState,
  useDismissLayer,
} from "./floating.js"
import type { FloatingPopupProps } from "./floating.js"

interface TooltipProviderContextValue {
  delay: number
  timeout: number
  disableHoverableContent: boolean
  lastClosedAt: React.MutableRefObject<number>
}

const defaultProvider: TooltipProviderContextValue = {
  delay: 0,
  timeout: 300,
  disableHoverableContent: false,
  lastClosedAt: { current: Number.NEGATIVE_INFINITY },
}

const TooltipProviderContext = createContext(defaultProvider)

export interface TooltipProviderProps {
  children: ReactNode
  delay?: number
  timeout?: number
  disableHoverableContent?: boolean
}

export function TooltipProvider({
  children,
  delay = 0,
  timeout = 300,
  disableHoverableContent = false,
}: TooltipProviderProps): ReactElement {
  const lastClosedAt = useRef(Number.NEGATIVE_INFINITY)
  const value = useMemo(
    () => ({ delay, timeout, disableHoverableContent, lastClosedAt }),
    [delay, timeout, disableHoverableContent]
  )
  return <TooltipProviderContext.Provider value={value}>{children}</TooltipProviderContext.Provider>
}

interface TooltipContextValue {
  open: boolean
  disableHoverableContent: boolean
  openImmediately: () => void
  scheduleOpen: () => void
  scheduleClose: () => void
  cancelClose: () => void
  close: () => void
  isTopDismissLayer: (event?: GpuixKeyboardEvent) => boolean
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

function useTooltipContext(name: string): TooltipContextValue {
  const context = useContext(TooltipContext)
  if (!context) throw new Error(`${name} must be used inside Tooltip`)
  return context
}

export interface TooltipProps extends Omit<Props, "children"> {
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  disableHoverablePopup?: boolean
}

export function Tooltip({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  delayDuration,
  disableHoverablePopup,
  style,
  ...props
}: TooltipProps): ReactElement {
  const provider = useContext(TooltipProviderContext)
  const [open, setOpenState] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const isTopDismissLayer = useDismissLayer(open)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverableDisabled = disableHoverablePopup ?? provider.disableHoverableContent

  const cancelOpen = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current)
    openTimer.current = null
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const setOpen = (nextOpen: boolean) => {
    cancelOpen()
    cancelClose()
    setOpenState(nextOpen)
    if (!nextOpen) provider.lastClosedAt.current = Date.now()
  }
  const openImmediately = () => setOpen(true)
  const scheduleOpen = () => {
    cancelClose()
    const recentlyClosed = Date.now() - provider.lastClosedAt.current <= provider.timeout
    const openDelay = recentlyClosed ? 0 : (delayDuration ?? provider.delay)
    if (openDelay <= 0) {
      setOpen(true)
      return
    }
    cancelOpen()
    openTimer.current = setTimeout(() => setOpen(true), openDelay)
  }
  const close = () => setOpen(false)
  const scheduleClose = () => {
    cancelOpen()
    if (hoverableDisabled) {
      close()
      return
    }
    cancelClose()
    closeTimer.current = setTimeout(close, 80)
  }

  useEffect(() => () => {
    cancelOpen()
    cancelClose()
  }, [])

  const context: TooltipContextValue = {
    open,
    disableHoverableContent: hoverableDisabled,
    openImmediately,
    scheduleOpen,
    scheduleClose,
    cancelClose,
    close,
    isTopDismissLayer,
  }

  return (
    <TooltipContext.Provider value={context}>
      <DismissLayerScope><div {...props} style={floatingRootStyle(style)}>{children}</div></DismissLayerScope>
    </TooltipContext.Provider>
  )
}

export interface TooltipTriggerProps extends Props {
  asChild?: boolean
}

export const TooltipTrigger = forwardRef<PublicInstance, TooltipTriggerProps>(
  function TooltipTrigger(
    {
      asChild,
      children,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      onClick,
      onFocus,
      onBlur,
      onKeyDown,
      ...props
    },
    ref
  ) {
    const context = useTooltipContext("TooltipTrigger")
    return renderSlot({
      asChild,
      children,
      props: {
        ...props,
        tabIndex: asChild ? props.tabIndex : (props.tabIndex ?? 0),
        onMouseEnter: (event) => {
          onMouseEnter?.(event)
          context.scheduleOpen()
        },
        onMouseLeave: (event) => {
          onMouseLeave?.(event)
          context.scheduleClose()
        },
        onMouseDown: (event) => {
          onMouseDown?.(event)
          context.close()
        },
        onClick: (event) => {
          onClick?.(event)
          context.close()
        },
        onFocus: (event) => {
          onFocus?.(event)
          context.openImmediately()
        },
        onBlur: (event) => {
          onBlur?.(event)
          context.close()
        },
        onKeyDown: (event) => {
          onKeyDown?.(event)
          if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.isTopDismissLayer(event)) context.close()
        },
      },
      ref
    })
  }
)

export interface TooltipPopupProps extends FloatingPopupProps {}

export const TooltipPopup = forwardRef<PublicInstance, TooltipPopupProps>(
  function TooltipPopup(
    { children, side = "top", align = "center", sideOffset = 0, onMouseEnter, onMouseLeave, onKeyDown, ...props },
    ref
  ) {
    const context = useTooltipContext("TooltipPopup")
    if (!context.open) return null
    return (
      <FloatingLayer
        {...props}
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onMouseEnter={(event) => {
          onMouseEnter?.(event)
          if (!context.disableHoverableContent) context.cancelClose()
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event)
          context.scheduleClose()
        }}
        onKeyDown={(event: GpuixKeyboardEvent) => {
          onKeyDown?.(event)
          if (!event.defaultPrevented && event.key.toLowerCase() === "escape" && context.isTopDismissLayer(event)) context.close()
        }}
      >
        {children}
      </FloatingLayer>
    )
  }
)

export {
  Tooltip as Root,
  TooltipPopup as Popup,
  TooltipProvider as Provider,
  TooltipTrigger as Trigger,
}
