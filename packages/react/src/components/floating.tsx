/** Shared state, slot, and positioning helpers for headless floating controls. */

import React, {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode, Ref } from "react"
import type { NativeRenderer } from "../types/host.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { NativeStateStyle, Props, PublicInstance, StyleDesc } from "../types/host.js"
import { isCompiledStyle } from "../class-names.js"
import { cn } from "../cn.js"

export type FloatingSide = "top" | "right" | "bottom" | "left"
export type FloatingAlign = "start" | "center" | "end"
export type StateStyle<State> = StyleDesc | ((state: State) => StyleDesc)

/** Logical placement sides accepted by Base UI's shared anchor-positioning API. */
export type PositionerSide = FloatingSide | "inline-start" | "inline-end"
export type PositionerAlign = FloatingAlign
export type PositionerRect = { x: number; y: number; width: number; height: number }
export type PositionerBoundary = "clipping-ancestors" | Element | Array<Element | "clipping-ancestors"> | PositionerRect
export type PositionerOffsetFunction = (data: {
  side: PositionerSide
  align: PositionerAlign
  anchor: { width: number; height: number }
  positioner: { width: number; height: number }
}) => number
export type PositionerCollisionAvoidance = {
  side?: "flip" | "none"
  align?: "flip" | "shift" | "none"
  fallbackAxisSide?: "start" | "end" | "none"
} | {
  side?: "shift" | "none"
  align?: "shift" | "none"
  fallbackAxisSide?: "start" | "end" | "none"
}

export interface PositionerState {
  open: boolean
  side: PositionerSide | "none"
  align: PositionerAlign
  anchorHidden: boolean
}

/** Shared positioning options for floating controls. */
export interface PositionerProps extends Omit<Props, "className" | "style"> {
  children?: ReactNode
  position?: { x: number; y: number }
  anchor?: Element | null | { getBoundingClientRect(): DOMRect } | React.RefObject<Element | null> | (() => Element | { getBoundingClientRect(): DOMRect } | null)
  positionMethod?: "absolute" | "fixed"
  side?: PositionerSide
  sideOffset?: number | PositionerOffsetFunction
  align?: PositionerAlign
  alignOffset?: number | PositionerOffsetFunction
  collisionBoundary?: PositionerBoundary
  collisionPadding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  sticky?: boolean
  arrowPadding?: number
  disableAnchorTracking?: boolean
  collisionAvoidance?: PositionerCollisionAvoidance
  open?: boolean
  render?: ReactElement | ((props: Props, state: PositionerState) => ReactNode)
  className?: string | ((state: PositionerState) => string | undefined)
  style?: StateStyle<PositionerState> | ((state: PositionerState) => StyleDesc | undefined)
}

const dismissLayers = new WeakMap<NativeRenderer, Array<{ token: object; depth: number; order: number }>>()
const PositionerStateContext = createContext<PositionerState | null>(null)

/** Read the resolved state provided by a surrounding FloatingPositioner. */
export function usePositionerState(): PositionerState | null {
  return useContext(PositionerStateContext)
}
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
  const uniqueRefs = [...new Set(refs)]
  return (value) => {
    for (const ref of uniqueRefs) {
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
  if (!first && !second) return undefined
  if (!first) return (event) => {
    if (isSyntheticEvent(event)) makeBaseUIHandlerPreventable(event)
    second?.(event)
  }
  if (!second) return (event) => {
    if (isSyntheticEvent(event)) makeBaseUIHandlerPreventable(event)
    first(event)
  }
  return (event) => {
    if (isSyntheticEvent(event)) makeBaseUIHandlerPreventable(event)
    first(event)
    if (!isSyntheticEvent(event) || !(event as GpuixSyntheticEvent & { baseUIHandlerPrevented?: boolean }).baseUIHandlerPrevented) {
      second(event)
    }
  }
}

function isSyntheticEvent(event: GpuixSyntheticEvent): boolean {
  return event !== null && typeof event === "object" && "nativeEvent" in event
}

function makeBaseUIHandlerPreventable(event: GpuixSyntheticEvent): void {
  const preventable = event as GpuixSyntheticEvent & {
    baseUIHandlerPrevented?: boolean
    preventBaseUIHandler?: () => void
  }
  preventable.baseUIHandlerPrevented = false
  preventable.preventBaseUIHandler = () => {
    preventable.baseUIHandlerPrevented = true
  }
}

function mergeClassNames(partClassName: Props["className"], renderClassName: Props["className"]): Props["className"] {
  if (renderClassName === undefined || renderClassName === "") return partClassName
  if (partClassName === undefined || partClassName === "") return renderClassName
  if (typeof partClassName === "string" && typeof renderClassName === "string") {
    return `${renderClassName} ${partClassName}`
  }
  return cn(renderClassName, partClassName)
}

/** Merge part props with the props on its `render` element, following Base UI's mergeProps order. */
export function mergeRenderProps(partProps: Props, renderProps: Props): Props {
  const merged: Props = {
    ...partProps,
    ...renderProps,
    className: mergeClassNames(partProps.className, renderProps.className),
    style: mergeStyles(partProps.style, renderProps.style),
  }
  const mergedRecord = merged as Record<string, unknown>

  for (const key of Object.keys(renderProps)) {
    const isEventHandler = key.startsWith("on") && key.charCodeAt(2) >= 65 && key.charCodeAt(2) <= 90
    if (!isEventHandler) continue

    const partHandler = (partProps as Record<string, unknown>)[key]
    const renderHandler = (renderProps as Record<string, unknown>)[key]
    if (renderHandler === undefined) {
      mergedRecord[key] = partHandler
    } else if (typeof renderHandler === "function") {
      mergedRecord[key] = composeHandlers(
        renderHandler as ((event: GpuixSyntheticEvent) => void) | undefined,
        partHandler as ((event: GpuixSyntheticEvent) => void) | undefined,
      )
    }
  }

  return merged
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
  const merged = mergeRenderProps(props, childProps)
  if (props.tabIndex === undefined) merged.tabIndex = childProps.tabIndex
  const childRef = getElementRef(child)
  const partRef = props.ref as Ref<PublicInstance> | undefined
  if (childRef || partRef || ref) merged.ref = mergeRefs(childRef, partRef, ref)
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

function physicalSide(side: PositionerSide): FloatingSide {
  if (side === "inline-start") return "left"
  if (side === "inline-end") return "right"
  return side
}

function collisionPaddingEdges(padding: PositionerProps["collisionPadding"]) {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding }
  }
  if (padding) {
    return {
      top: padding.top ?? 0,
      right: padding.right ?? 0,
      bottom: padding.bottom ?? 0,
      left: padding.left ?? 0,
    }
  }
  return { top: 5, right: 5, bottom: 5, left: 5 }
}

function rectOfBoundary(
  boundary: PositionerBoundary | undefined,
  viewport: PositionerRect | null
): PositionerRect | null {
  if (!boundary) return null
  if (boundary === "clipping-ancestors") return viewport
  if (Array.isArray(boundary)) {
    const rects = boundary.map((entry) => rectOfBoundary(entry, viewport)).filter((rect): rect is PositionerRect => rect !== null)
    if (rects.length === 0) return null
    const left = Math.max(...rects.map((rect) => rect.x))
    const top = Math.max(...rects.map((rect) => rect.y))
    const right = Math.min(...rects.map((rect) => rect.x + rect.width))
    const bottom = Math.min(...rects.map((rect) => rect.y + rect.height))
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  }
  if ("getBoundingClientRect" in boundary) {
    const rect = boundary.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  return boundary
}

function alignmentOverflow(
  side: PositionerSide,
  align: PositionerAlign,
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  positioner: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  boundary: PositionerRect,
  padding: { top: number; right: number; bottom: number; left: number }
): number {
  const verticalSide = physicalSide(side) === "top" || physicalSide(side) === "bottom"
  const start = verticalSide
    ? align === "start" ? anchor.left : align === "end" ? anchor.right - positioner.width : anchor.left + (anchor.width - positioner.width) / 2
    : align === "start" ? anchor.top : align === "end" ? anchor.bottom - positioner.height : anchor.top + (anchor.height - positioner.height) / 2
  const size = verticalSide ? positioner.width : positioner.height
  const min = verticalSide ? boundary.x + padding.left : boundary.y + padding.top
  const max = verticalSide ? boundary.x + boundary.width - padding.right : boundary.y + boundary.height - padding.bottom
  return Math.max(min - start, 0) + Math.max(start + size - max, 0)
}

function sideOverflow(
  side: PositionerSide,
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  positioner: Pick<DOMRect, "width" | "height">,
  boundary: PositionerRect,
  padding: { top: number; right: number; bottom: number; left: number },
  offset: number
): number {
  const resolvedSide = physicalSide(side)
  if (resolvedSide === "top") {
    const bottom = anchor.top - offset
    return Math.max(boundary.y + padding.top - (bottom - positioner.height), 0) +
      Math.max(bottom - (boundary.y + boundary.height - padding.bottom), 0)
  }
  if (resolvedSide === "bottom") {
    const top = anchor.bottom + offset
    return Math.max(boundary.y + padding.top - top, 0) +
      Math.max(top + positioner.height - (boundary.y + boundary.height - padding.bottom), 0)
  }
  if (resolvedSide === "left") {
    const right = anchor.left - offset
    return Math.max(boundary.x + padding.left - (right - positioner.width), 0) +
      Math.max(right - (boundary.x + boundary.width - padding.right), 0)
  }
  const left = anchor.right + offset
  return Math.max(boundary.x + padding.left - left, 0) +
    Math.max(left + positioner.width - (boundary.x + boundary.width - padding.right), 0)
}

/** A renderer-neutral positioner contract shared by floating controls. */
export const FloatingPositioner = forwardRef<PublicInstance, PositionerProps>(
  function FloatingPositioner(
    {
      children,
      position,
      anchor,
      positionMethod: _positionMethod,
      side = "bottom",
      sideOffset = 0,
      align = "center",
      alignOffset = 0,
      collisionBoundary,
      collisionPadding = 5,
      collisionAvoidance,
      sticky: _sticky,
      arrowPadding: _arrowPadding,
      disableAnchorTracking: _disableAnchorTracking,
      open = true,
      render,
      className,
      style,
      ...props
    },
    ref
  ) {
    const { renderer } = useGpuix()
    const positionerRef = useRef<PublicInstance | null>(null)
    const [measuredPlacement, setMeasuredPlacement] = useState<{
      side: PositionerSide
      align: PositionerAlign
      position?: { x: number; y: number }
      requestedSide: PositionerSide
      requestedAlign: PositionerAlign
      requestedPosition?: { x: number; y: number }
    } | null>(null)
    const [measuredDimensions, setMeasuredDimensions] = useState<{
      anchor: { width: number; height: number }
      positioner: { width: number; height: number }
    } | null>(null)
    const anchorNode = typeof anchor === "function"
      ? anchor()
      : anchor && "current" in anchor
        ? anchor.current
        : anchor
    const anchorRect = anchorNode && "getBoundingClientRect" in anchorNode
      ? anchorNode.getBoundingClientRect()
      : null
    const viewport = renderer?.getWindowSize?.()
    const viewportRect = viewport ? { x: 0, y: 0, width: viewport.width, height: viewport.height } : null
    const boundaryRect = rectOfBoundary(collisionBoundary, viewportRect) ?? viewportRect
    const padding = collisionPaddingEdges(collisionPadding)
    useLayoutEffect(() => {
      if (!open || !anchorRect || !positionerRef.current) {
        setMeasuredPlacement(null)
        return
      }
      const popupRect = positionerRef.current.getBoundingClientRect()
      const nextDimensions = {
        anchor: { width: anchorRect.width, height: anchorRect.height },
        positioner: { width: popupRect.width, height: popupRect.height },
      }
      setMeasuredDimensions((current) => current?.anchor.width === nextDimensions.anchor.width &&
        current.anchor.height === nextDimensions.anchor.height &&
        current.positioner.width === nextDimensions.positioner.width &&
        current.positioner.height === nextDimensions.positioner.height
        ? current
        : nextDimensions)
      let resolvedSide: PositionerSide = side
      const sideAvoidance = collisionAvoidance?.side ?? "flip"
      if (sideAvoidance === "flip" && boundaryRect) {
        const oppositeSide: PositionerSide = side === "top" ? "bottom"
          : side === "bottom" ? "top"
            : side === "left" ? "right"
              : side === "right" ? "left"
                : side === "inline-start" ? "inline-end" : "inline-start"
        const offsetFor = (candidateSide: PositionerSide) => typeof sideOffset === "number"
          ? sideOffset
          : sideOffset({
            side: candidateSide,
            align,
            anchor: nextDimensions.anchor,
            positioner: nextDimensions.positioner,
          })
        const requestedOverflow = sideOverflow(side, anchorRect, popupRect, boundaryRect, padding, offsetFor(side))
        const oppositeOverflow = sideOverflow(oppositeSide, anchorRect, popupRect, boundaryRect, padding, offsetFor(oppositeSide))
        if (requestedOverflow > oppositeOverflow) resolvedSide = oppositeSide
      }
      let resolvedAlign: PositionerAlign = align
      if (boundaryRect && collisionAvoidance?.align === "flip" && (align === "start" || align === "end")) {
        const oppositeAlign = align === "start" ? "end" : "start"
        const currentOverflow = alignmentOverflow(resolvedSide, align, anchorRect, popupRect, boundaryRect, padding)
        const oppositeOverflow = alignmentOverflow(resolvedSide, oppositeAlign, anchorRect, popupRect, boundaryRect, padding)
        if (currentOverflow > 0 && oppositeOverflow === 0) {
          resolvedAlign = oppositeAlign
        }
      }
      const requestedPosition = resolvedSide === side && resolvedAlign === align && position
        ? position
        : resolvedSide === "top"
          ? { x: resolvedAlign === "start" ? anchorRect.left : resolvedAlign === "end" ? anchorRect.right : anchorRect.left + anchorRect.width / 2, y: anchorRect.top }
          : resolvedSide === "bottom"
            ? { x: resolvedAlign === "start" ? anchorRect.left : resolvedAlign === "end" ? anchorRect.right : anchorRect.left + anchorRect.width / 2, y: anchorRect.bottom }
            : resolvedSide === "left"
              ? { x: anchorRect.left, y: resolvedAlign === "start" ? anchorRect.top : resolvedAlign === "end" ? anchorRect.bottom : anchorRect.top + anchorRect.height / 2 }
              : { x: anchorRect.right, y: resolvedAlign === "start" ? anchorRect.top : resolvedAlign === "end" ? anchorRect.bottom : anchorRect.top + anchorRect.height / 2 }
      const sameRequest = measuredPlacement?.side === resolvedSide && measuredPlacement.align === resolvedAlign &&
        measuredPlacement.requestedSide === side && measuredPlacement.requestedAlign === align &&
        measuredPlacement.requestedPosition?.x === requestedPosition?.x && measuredPlacement.requestedPosition?.y === requestedPosition?.y
      let nextPosition = sameRequest ? measuredPlacement.position : requestedPosition
      // The first layout measurement still describes the popup's previous
      // fallback placement. Apply collision shifts only after the requested
      // anchor position has been rendered and measured.
      if ((sameRequest || position !== undefined) && boundaryRect && resolvedAlign === align && (collisionAvoidance?.align !== "none" || collisionAvoidance?.side !== "none")) {
        const left = boundaryRect.x + padding.left
        const top = boundaryRect.y + padding.top
        const right = boundaryRect.x + boundaryRect.width - padding.right
        const bottom = boundaryRect.y + boundaryRect.height - padding.bottom
        const verticalSide = physicalSide(resolvedSide) === "top" || physicalSide(resolvedSide) === "bottom"
        let dx = popupRect.left < left ? left - popupRect.left : popupRect.right > right ? right - popupRect.right : 0
        let dy = popupRect.top < top ? top - popupRect.top : popupRect.bottom > bottom ? bottom - popupRect.bottom : 0
        // After a side flip, the main-axis measurement still describes the old
        // side. Keep only the cross-axis correction until native layout reflects
        // the newly resolved side.
        if (resolvedSide !== side) {
          if (verticalSide) dy = 0
          else dx = 0
        }
        if (requestedPosition && (dx !== 0 || dy !== 0)) {
          const base = sameRequest ? measuredPlacement.position ?? requestedPosition : requestedPosition
          nextPosition = { x: base.x + dx, y: base.y + dy }
        }
      }
      setMeasuredPlacement((current) => current?.side === resolvedSide && current.align === resolvedAlign && current.position?.x === nextPosition?.x && current.position?.y === nextPosition?.y && current.requestedSide === side && current.requestedAlign === align && current.requestedPosition?.x === requestedPosition?.x && current.requestedPosition?.y === requestedPosition?.y
        ? current
        : { side: resolvedSide, align: resolvedAlign, position: nextPosition, requestedSide: side, requestedAlign: align, requestedPosition })
    }, [
      open, side, align, position?.x, position?.y, sideOffset, alignOffset,
      anchorRect?.x, anchorRect?.y, anchorRect?.width, anchorRect?.height,
      collisionAvoidance?.side, collisionAvoidance?.align, collisionAvoidance?.fallbackAxisSide,
      typeof collisionPadding === "number" ? collisionPadding : collisionPadding?.top,
      typeof collisionPadding === "number" ? collisionPadding : collisionPadding?.right,
      typeof collisionPadding === "number" ? collisionPadding : collisionPadding?.bottom,
      typeof collisionPadding === "number" ? collisionPadding : collisionPadding?.left,
      boundaryRect?.x, boundaryRect?.y, boundaryRect?.width, boundaryRect?.height,
    ])
    const resolvedSide = measuredPlacement?.side ?? side
    const resolvedAlign = measuredPlacement?.align ?? align
    const resolvedPosition = measuredPlacement?.position ?? position
    // GPUI's anchored custom element performs measurement and collision
    // correction natively. Offset callbacks require measured dimensions, so
    // they are resolved by a later render once the relevant native layout
    // APIs expose both anchor and popup geometry. Never invoke them with
    // invented dimensions.
    const offsetData = {
      side: resolvedSide,
      align: resolvedAlign,
      anchor: measuredDimensions?.anchor ?? { width: 0, height: 0 },
      positioner: measuredDimensions?.positioner ?? { width: 0, height: 0 },
    }
    const resolvedSideOffset = typeof sideOffset === "number" ? sideOffset : measuredDimensions ? sideOffset(offsetData) : 0
    const resolvedAlignOffset = typeof alignOffset === "number" ? alignOffset : measuredDimensions ? alignOffset(offsetData) : 0
    const visibleBoundary = boundaryRect
    const anchorHidden = !!(open && anchorRect && visibleBoundary && (
      anchorRect.right <= visibleBoundary.x || anchorRect.left >= visibleBoundary.x + visibleBoundary.width ||
      anchorRect.bottom <= visibleBoundary.y || anchorRect.top >= visibleBoundary.y + visibleBoundary.height
    ))
    const state: PositionerState = { open, side: open ? resolvedSide : "none", align: resolvedAlign, anchorHidden }
    const offset = physicalSide(resolvedSide) === "top" || physicalSide(resolvedSide) === "bottom"
      ? { x: resolvedAlignOffset, y: 0 }
      : { x: 0, y: resolvedAlignOffset }
    const fit = collisionAvoidance?.side === "none"
      ? "none"
      : collisionAvoidance?.side === "shift" || collisionAvoidance?.align === "shift"
        ? "snap"
        : "switch"
    const contentProps: Props = {
      ...props,
      ref: (instance: PublicInstance | null) => {
        positionerRef.current = instance
        setRefs(instance, ref)
      },
      className: typeof className === "function" ? className(state) : className,
      style: typeof style === "function" ? style(state) : style,
      "data-open": open ? "" : undefined,
      "data-side": state.side,
      "data-align": resolvedAlign,
      "data-anchor-hidden": anchorHidden ? "" : undefined,
    }
    let content: ReactNode
    if (typeof render === "function") {
      content = render(contentProps, state)
    } else if (isValidElement<Props>(render)) {
      content = renderSlot({ asChild: true, children: render, props: contentProps })
    } else {
      content = <div {...contentProps}>{children}</div>
    }
    return (
      <anchored
        position={resolvedPosition}
        side={physicalSide(resolvedSide)}
      align={resolvedAlign}
        gap={resolvedSideOffset}
        offset={offset}
        fit={fit}
        snapMargin={collisionPadding ?? 5}
        deferred
        priority={1}
      >
        <PositionerStateContext.Provider value={state}>{content}</PositionerStateContext.Provider>
      </anchored>
    )
  }
)
