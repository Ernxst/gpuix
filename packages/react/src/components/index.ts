// GPUIX component definitions and native motion wrappers.

import { createElement, forwardRef, useContext, useLayoutEffect } from "react"
import type { ReactElement, ReactNode } from "react"
import type { MotionProps, Props, PublicInstance, StyleDesc } from "../types/host.js"
import { PresenceContext, usePresence } from "./animate-presence.js"

export {
  AnimatePresence,
  PresenceContext,
  useIsPresent,
  usePresence,
} from "./animate-presence.js"
export type { AnimatePresenceProps } from "./animate-presence.js"

export const gpuixComponents = {
  div: "div",
  text: "text",
  img: "img",
  svg: "svg",
  canvas: "canvas",
  input: "input",
  textarea: "textarea",
  anchored: "anchored",
  "virtual-list": "virtual-list",
} as const

export type GpuixComponentType = keyof typeof gpuixComponents

export interface MotionDivProps extends MotionProps {
  children?: ReactNode
  style?: StyleDesc
  onClick?: Props["onClick"]
  onDoubleClick?: Props["onDoubleClick"]
  onContextMenu?: Props["onContextMenu"]
  onMouseDown?: Props["onMouseDown"]
  onMouseUp?: Props["onMouseUp"]
  onMouseEnter?: Props["onMouseEnter"]
  onMouseLeave?: Props["onMouseLeave"]
  onMouseMove?: Props["onMouseMove"]
  onMouseDownOutside?: Props["onMouseDownOutside"]
  onKeyDown?: Props["onKeyDown"]
  onKeyUp?: Props["onKeyUp"]
  onFocus?: Props["onFocus"]
  onBlur?: Props["onBlur"]
  onScroll?: Props["onScroll"]
  onWheel?: Props["onWheel"]
  onFileDrop?: Props["onFileDrop"]
  onMotionComplete?: Props["onMotionComplete"]
  autoFocus?: boolean
}

const MotionDiv = forwardRef<PublicInstance, MotionDivProps>(function MotionDiv(
  { initial, animate, exit, transition, onMotionComplete, ...props },
  ref
): ReactElement {
  const presence = useContext(PresenceContext)
  const [isPresent, safeToRemove] = usePresence()
  const resolvedInitial = presence?.initial === false ? false : initial
  const resolvedAnimate = !isPresent && exit ? exit : animate

  useLayoutEffect(() => {
    if (!isPresent && !exit) safeToRemove?.()
  }, [exit, isPresent, safeToRemove])

  const hostProps: Props = {
    ...props,
    ref,
    motion: {
      initial: resolvedInitial,
      animate: resolvedAnimate,
      transition,
    },
  }
  if (!isPresent || onMotionComplete) {
    hostProps.onMotionComplete = (event) => {
      onMotionComplete?.(event)
      if (!isPresent) safeToRemove?.()
    }
  }
  return createElement("div", hostProps)
})

/** Native animations with a Motion-like declarative React API. */
export const motion = {
  div: MotionDiv,
} as const

// There is no `VirtualList` React wrapper. Windowing on the React side is the
// app's job: pass `itemCount`, `estimatedItemHeight` and `windowStart` to the
// host `<virtual-list>` and render only that slice. A generic wrapper cannot
// know when to widen its own window, so it silently dropped rows whenever
// `itemCount` grew without a scroll.
