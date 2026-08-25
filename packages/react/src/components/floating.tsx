/** Shared state, slot, and positioning helpers for headless floating controls. */

import React, { cloneElement, forwardRef, isValidElement, useCallback, useState } from "react"
import type { ReactElement, ReactNode, Ref } from "react"
import type { EventPayload } from "@gpuix/native"
import type { Props, PublicInstance, StyleDesc } from "../types/host.js"

export type FloatingSide = "top" | "right" | "bottom" | "left"
export type FloatingAlign = "start" | "center" | "end"
export type StateStyle<State> = StyleDesc | ((state: State) => StyleDesc)

export interface FloatingContentProps extends Omit<Props, "children"> {
  children?: ReactNode
  side?: FloatingSide
  sideOffset?: number
  align?: FloatingAlign
  alignOffset?: number
  collisionPadding?: number
}

export function resolveStyle<State>(
  style: StateStyle<State> | undefined,
  state: State
): StyleDesc | undefined {
  return typeof style === "function" ? style(state) : style
}

export function mergeStyles(
  base: StyleDesc | undefined,
  override: StyleDesc | undefined
): StyleDesc | undefined {
  if (!base) return override
  if (!override) return base
  return { ...base, ...override }
}

export function floatingRootStyle(style?: StyleDesc): StyleDesc {
  return {
    display: "flex",
    position: "relative",
    alignItems: "start",
    ...style,
  }
}

export function useControllableState<Value>({
  value,
  defaultValue,
  onChange,
}: {
  value: Value | undefined
  defaultValue: Value
  onChange?: (value: Value) => void
}): [Value, (value: Value) => void] {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const controlled = value !== undefined
  const currentValue = controlled ? value : internalValue
  const setValue = useCallback(
    (nextValue: Value) => {
      if (!controlled) setInternalValue(nextValue)
      if (!Object.is(currentValue, nextValue)) onChange?.(nextValue)
    },
    [controlled, currentValue, onChange]
  )
  return [currentValue, setValue]
}

export function setRefs<T>(value: T, ...refs: Array<Ref<T> | undefined>): void {
  for (const ref of refs) {
    if (typeof ref === "function") {
      ref(value)
    } else if (ref) {
      ref.current = value
    }
  }
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (value: T) => void {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value)
      } else if (ref) {
        ref.current = value
      }
    }
  }
}

function getElementRef(element: ReactElement<Props>): Ref<PublicInstance> | undefined {
  if (element.props.ref) return element.props.ref
  const descriptor = Object.getOwnPropertyDescriptor(element, "ref")
  return descriptor?.value
}

function composeHandlers<Event extends EventPayload>(
  first?: (event: Event) => void,
  second?: (event: Event) => void
): ((event: Event) => void) | undefined {
  if (!first) return second
  if (!second) return first
  return (event) => {
    first(event)
    second(event)
  }
}

export function renderSlot({
  asChild,
  children,
  props,
  ref,
}: {
  asChild?: boolean
  children: ReactNode
  props: Props
  ref?: Ref<PublicInstance>
}): ReactElement {
  if (!asChild) {
    return <div {...props} ref={ref}>{children}</div>
  }
  if (!isValidElement<Props>(children)) {
    throw new Error("asChild requires exactly one React element")
  }

  const child = children
  const childProps = child.props
  const merged: Props = {
    ...childProps,
    ...props,
    style: mergeStyles(childProps.style, props.style),
    onClick: composeHandlers(childProps.onClick, props.onClick),
    onMouseDown: composeHandlers(childProps.onMouseDown, props.onMouseDown),
    onMouseUp: composeHandlers(childProps.onMouseUp, props.onMouseUp),
    onMouseEnter: composeHandlers(childProps.onMouseEnter, props.onMouseEnter),
    onMouseLeave: composeHandlers(childProps.onMouseLeave, props.onMouseLeave),
    onMouseMove: composeHandlers(childProps.onMouseMove, props.onMouseMove),
    onMouseDownOutside: composeHandlers(
      childProps.onMouseDownOutside,
      props.onMouseDownOutside
    ),
    onKeyDown: composeHandlers(childProps.onKeyDown, props.onKeyDown),
    onKeyUp: composeHandlers(childProps.onKeyUp, props.onKeyUp),
    onFocus: composeHandlers(childProps.onFocus, props.onFocus),
    onBlur: composeHandlers(childProps.onBlur, props.onBlur),
    onScroll: composeHandlers(childProps.onScroll, props.onScroll),
    onChange: composeHandlers(childProps.onChange, props.onChange),
    onSubmit: composeHandlers(childProps.onSubmit, props.onSubmit),
  }
  if (props.tabIndex === undefined) merged.tabIndex = childProps.tabIndex
  const childRef = getElementRef(child)
  if (childRef || ref) merged.ref = mergeRefs(childRef, ref)
  return cloneElement(child, merged)
}

export const FloatingLayer = forwardRef<PublicInstance, FloatingContentProps>(
  function FloatingLayer(
    {
      side = "bottom",
      sideOffset = 0,
      align = "start",
      alignOffset = 0,
      collisionPadding = 8,
      children,
      ...props
    },
    ref
  ) {
    const offset =
      side === "top" || side === "bottom"
        ? { x: alignOffset, y: 0 }
        : { x: 0, y: alignOffset }

    return (
      <anchored
        side={side}
        align={align}
        gap={sideOffset}
        offset={offset}
        fit="snap"
        snapMargin={collisionPadding}
        deferred
        priority={1}
        occlude
      >
        <div
          {...props}
          ref={ref}
          style={mergeStyles({ backgroundColor: "#1A1A1A" }, props.style)}
        >
          {children}
        </div>
      </anchored>
    )
  }
)
