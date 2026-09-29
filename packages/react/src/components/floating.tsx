/** Shared state, slot, and positioning helpers for headless floating controls. */

import React, {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useInsertionEffect,
  useMemo,
  useState,
} from "react"
import type { ReactElement, ReactNode, Ref } from "react"
import type { NativeRenderer } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { NativeStateStyle, Props, PublicInstance, StyleDesc } from "../types/host.js"
import { isCompiledStyle } from "../class-names.js"

export type FloatingSide = "top" | "right" | "bottom" | "left"
export type FloatingAlign = "start" | "center" | "end"
export type StateStyle<State> = StyleDesc | ((state: State) => StyleDesc)

const dismissLayers = new WeakMap<NativeRenderer, Array<{ token: object; depth: number; order: number }>>()
const DismissLayerDepth = createContext(0)
let nextDismissLayerOrder = 0

export function DismissLayerScope({ children }: { children: ReactNode }): ReactElement {
  const depth = useContext(DismissLayerDepth)
  return <DismissLayerDepth.Provider value={depth + 1}>{children}</DismissLayerDepth.Provider>
}

/** Register an open floating surface in this renderer's Escape dismissal order. */
export function useDismissLayer(open: boolean): (event?: GpuixSyntheticEvent) => boolean {
  const { renderer } = useGpuix()
  const depth = useContext(DismissLayerDepth)
  const token = useMemo(() => ({ id: {}, order: ++nextDismissLayerOrder }), [])
  useInsertionEffect(() => {
    if (!open || !renderer) return
    let layers = dismissLayers.get(renderer)
    if (!layers) {
      layers = []
      dismissLayers.set(renderer, layers)
    }
    layers.push({ token: token.id, depth, order: token.order })
    return () => {
      const current = dismissLayers.get(renderer)
      if (!current) return
      const index = current.findIndex((layer) => layer.token === token.id)
      if (index !== -1) current.splice(index, 1)
      if (current.length === 0) dismissLayers.delete(renderer)
    }
  }, [depth, open, renderer, token])

  return useCallback((event?: GpuixSyntheticEvent) => {
    const layers = renderer && dismissLayers.get(renderer)
    const topLayer = layers?.reduce<(typeof layers)[number] | undefined>((top, layer) => {
      if (!top || layer.depth > top.depth || (layer.depth === top.depth && layer.order > top.order)) return layer
      return top
    }, undefined)
    if (!open || topLayer?.token !== token.id) return false
    event?.stopPropagation()
    return true
  }, [open, renderer, token])
}

export interface FloatingPopupProps extends Omit<Props, "children"> {
  children?: ReactNode
  position?: { x: number; y: number }
  side?: FloatingSide
  sideOffset?: number
  align?: FloatingAlign
  alignOffset?: number
  collisionPadding?: number
}

const BACKGROUND_STATES = [
  "hover",
  "hoverWithin",
  "active",
  "activeWithin",
  "focus",
  "focusVisible",
  "focusWithin",
  "groupFocus",
  "groupFocusVisible",
  "groupFocusWithin",
  "dragOver",
] as const satisfies readonly (keyof StyleDesc)[]

function hasBackground(style?: StyleDesc | NativeStateStyle): boolean {
  return style?.background !== undefined || style?.backgroundColor !== undefined
}

function hasAnyBackground(style?: StyleDesc): boolean {
  return (
    hasBackground(style) ||
    BACKGROUND_STATES.some((state) => hasBackground(style?.[state]))
  )
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

type InteractiveStyle = Omit<StyleDesc, "hover" | "active">

function floatingSurfaceStateStyle(style?: InteractiveStyle): InteractiveStyle | undefined {
  if (!style) return undefined
  const surface: InteractiveStyle = {}
  if (style.visibility !== undefined) surface.visibility = style.visibility
  if (style.opacity !== undefined) surface.opacity = style.opacity
  if (style.borderRadius !== undefined) surface.borderRadius = style.borderRadius
  if (style.borderTopLeftRadius !== undefined) {
    surface.borderTopLeftRadius = style.borderTopLeftRadius
  }
  if (style.borderTopRightRadius !== undefined) {
    surface.borderTopRightRadius = style.borderTopRightRadius
  }
  if (style.borderBottomRightRadius !== undefined) {
    surface.borderBottomRightRadius = style.borderBottomRightRadius
  }
  if (style.borderBottomLeftRadius !== undefined) {
    surface.borderBottomLeftRadius = style.borderBottomLeftRadius
  }
  return Object.keys(surface).length > 0 ? surface : undefined
}

function floatingSurfaceStyle(style?: StyleDesc): StyleDesc {
  const surface: StyleDesc = floatingSurfaceStateStyle(style) ?? {}
  // The content ignores the mouse under `pointerEvents: "none"`, so its hover
  // and active states never match. The surface must not match them either.
  if (style?.pointerEvents === "none") return surface
  const hover = floatingSurfaceStateStyle(style?.hover)
  const active = floatingSurfaceStateStyle(style?.active)
  if (hover) surface.hover = hover
  if (active) surface.active = active
  return surface
}

function withoutOpacity(style?: InteractiveStyle): InteractiveStyle | undefined {
  if (!style) return undefined
  const { opacity: _opacity, ...rest } = style
  return rest
}

function floatingContentStyle(style?: StyleDesc): StyleDesc | undefined {
  if (!style) return undefined
  const { opacity: _opacity, hover, active, ...rest } = style
  return {
    ...rest,
    hover: withoutOpacity(hover),
    active: withoutOpacity(active),
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

function composeHandlers<Event extends GpuixSyntheticEvent>(
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
    onDoubleClick: composeHandlers(childProps.onDoubleClick, props.onDoubleClick),
    onContextMenu: composeHandlers(childProps.onContextMenu, props.onContextMenu),
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
    onWheel: composeHandlers(childProps.onWheel, props.onWheel),
    onChange: composeHandlers(childProps.onChange, props.onChange),
  }
  if (props.tabIndex === undefined) merged.tabIndex = childProps.tabIndex
  const childRef = getElementRef(child)
  if (childRef || ref) merged.ref = mergeRefs(childRef, ref)
  return cloneElement(child, merged)
}

export const FloatingLayer = forwardRef<PublicInstance, FloatingPopupProps>(
  function FloatingLayer(
    {
      side = "bottom",
      sideOffset = 0,
      align = "start",
      alignOffset = 0,
      collisionPadding = 8,
      position,
      children,
      ...props
    },
    ref
  ) {
    const offset =
      side === "top" || side === "bottom"
        ? { x: alignOffset, y: 0 }
        : { x: 0, y: alignOffset }
    const classStyle = isCompiledStyle(props.className) ? props.className : undefined
    const backgroundFallback =
      !hasAnyBackground(props.style) && !hasAnyBackground(classStyle)
        ? { backgroundColor: "#1A1A1A" }
        : undefined

    return (
      <anchored
        position={position}
        style={floatingSurfaceStyle(props.style)}
        side={side}
        align={align}
        gap={sideOffset}
        offset={offset}
        fit="snap"
        snapMargin={collisionPadding}
        deferred
        priority={1}
        occlude={props.style?.pointerEvents !== "none"}
      >
        <div
          {...props}
          ref={ref}
          style={mergeStyles(backgroundFallback, floatingContentStyle(props.style))}
        >
          {children}
        </div>
      </anchored>
    )
  }
)
