/** Base UI-shaped Button behaviour without a default visual treatment. */

import React, { forwardRef } from "react"
import type { ReactElement, ReactNode } from "react"
import type { GpuixKeyboardEvent, GpuixMouseEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"
import { renderSlot, resolveStyle, type StateStyle } from "./floating.js"

export interface ButtonState {
  disabled: boolean
}

export interface ButtonBehavior {
  disabled?: boolean
  focusableWhenDisabled?: boolean
  onClick?: (event: GpuixMouseEvent) => void
  onKeyDown?: (event: GpuixKeyboardEvent) => void
  onKeyUp?: (event: GpuixKeyboardEvent) => void
  tabIndex?: number
}

export interface HeadlessButtonProps extends Omit<Props, "style" | "onClick" | "onKeyDown" | "onKeyUp">, ButtonBehavior {
  children?: ReactNode
  asChild?: boolean
  style?: StateStyle<ButtonState>
}

export function buttonProps({
  disabled = false,
  focusableWhenDisabled = false,
  onClick,
  onKeyDown,
  onKeyUp,
  tabIndex,
}: ButtonBehavior): Props {
  return {
    role: "button",
    disabled,
    tabIndex: disabled && !focusableWhenDisabled ? -1 : tabIndex,
    onClick: (event: GpuixMouseEvent) => {
      if (!disabled) onClick?.(event)
    },
    onKeyDown: (event: GpuixKeyboardEvent) => {
      onKeyDown?.(event)
    },
    onKeyUp: (event: GpuixKeyboardEvent) => {
      onKeyUp?.(event)
    },
  }
}

export const Button = forwardRef<PublicInstance, HeadlessButtonProps>(function Button(
  { asChild, children, style, disabled = false, focusableWhenDisabled, onClick, onKeyDown, onKeyUp, tabIndex, ...props },
  ref
): ReactElement {
  return renderSlot({
    asChild,
    children,
    props: {
      ...props,
      ...buttonProps({ disabled, focusableWhenDisabled, onClick, onKeyDown, onKeyUp, tabIndex: !asChild && tabIndex === undefined ? 0 : tabIndex }),
      style: resolveStyle(style, { disabled }) as StyleDesc | undefined,
    },
    ref,
  })
})
