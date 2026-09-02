/// Host config for React's reconciler — mutation-based protocol.
///
/// Each reconciler callback (createInstance, appendChild, commitUpdate, etc.)
/// makes a direct napi call to the Rust retained tree. No JSON serialization
/// of the full element tree. Only changed elements cross the FFI boundary.

import { createContext } from "react"
import { DefaultEventPriority } from "react-reconciler/constants.js"

const NoEventPriority = 0
import type {
  Container,
  ElementType,
  HostContext,
  Instance,
  MutationRenderer,
  Props,
  PublicInstance,
  StyleDesc,
  TextInstance,
  VirtualListProps,
} from "../types/host.js"
import {
  registerEventHandler,
  unregisterEventHandler,
  unregisterEventHandlers,
} from "./event-registry.js"
import {
  DEFAULT_VIRTUAL_LIST_ESTIMATED_ITEM_HEIGHT,
  VirtualListRowContractError,
} from "../components/virtual-list-contract.js"
import {
  diagnoseUnsupportedCanvasElementMember,
  disposeRecordingContext2D,
  getOrCreateRecordingContext2D,
} from "../canvas/context-2d.js"
import { reportStyleDiagnostics } from "./renderer-diagnostics.js"

let currentUpdatePriority = NoEventPriority

type HostNode = Instance | TextInstance

interface HostNodeState {
  container: Container
  children: HostNode[]
  mounted: boolean
}

const hostNodeStates = new WeakMap<HostNode, HostNodeState>()
const virtualListsPendingValidation = new WeakMap<Container, Set<Instance>>()
const warnedVirtualListRowContracts = new WeakSet<Instance>()

class InlineTextChildError extends Error {
  override name = "InlineTextChildError"
}

function stateFor(node: HostNode): HostNodeState {
  const state = hostNodeStates.get(node)
  if (!state) {
    throw new Error(`GPUIX host node ${node.id} does not belong to a root`)
  }
  return state
}

function containerFor(node: HostNode): Container {
  return stateFor(node).container
}

function rendererFor(node: HostNode): MutationRenderer {
  return containerFor(node).renderer
}

function describeCanvas(instance: Instance): string {
  const props = instance.props as Props & Record<string, unknown>
  const identity = [
    props.testId === undefined ? undefined : `testId=${JSON.stringify(props.testId)}`,
    props["data-testid"] === undefined
      ? undefined
      : `data-testid=${JSON.stringify(props["data-testid"])}`,
    props.id === undefined ? undefined : `id=${JSON.stringify(props.id)}`,
    `elementId=${instance.id}`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ")
  return `<canvas ${identity}>`
}

function nextId(container: Container): number {
  return ++container.ids.nextElementId
}

function validateVirtualListRowContract(instance: Instance, state: HostNodeState): void {
  if (
    instance.type !== "virtual-list" ||
    state.children.length !== 1 ||
    (instance.props as Props & VirtualListProps).itemCount === 1
  ) {
    return
  }

  const message =
    "GPUIX <virtual-list> received exactly one immediate child. Its immediate children are rows, so wrapping a collection in one container creates one virtual row and defeats virtualization. Render rows as direct children. For windowed data, pass itemCount, windowStart, and estimatedItemHeight, then render that slice directly. Pass itemCount={1} only when the list intentionally contains one row."
  if (state.container.strictStyles) throw new VirtualListRowContractError(message)
  if (warnedVirtualListRowContracts.has(instance)) return
  warnedVirtualListRowContracts.add(instance)
  console.warn(message)
}

function scheduleVirtualListValidation(instance: Instance, state: HostNodeState): void {
  if (instance.type !== "virtual-list") return

  let pending = virtualListsPendingValidation.get(state.container)
  if (!pending) {
    pending = new Set()
    virtualListsPendingValidation.set(state.container, pending)
  }
  pending.add(instance)
}

function validatePendingVirtualLists(container: Container): void {
  const pending = virtualListsPendingValidation.get(container)
  if (!pending) return

  virtualListsPendingValidation.delete(container)
  for (const instance of pending) {
    const state = stateFor(instance)
    if (state.mounted) validateVirtualListRowContract(instance, state)
  }
}

function removeTrackedChild(state: HostNodeState, child: HostNode): void {
  const index = state.children.indexOf(child)
  if (index !== -1) state.children.splice(index, 1)
  child.parentId = null
}

function appendTrackedChild(parent: Instance, state: HostNodeState, child: HostNode): void {
  removeTrackedChild(state, child)
  state.children.push(child)
  child.parentId = parent.id
}

function insertTrackedChild(
  parent: Instance,
  state: HostNodeState,
  child: HostNode,
  beforeChild: HostNode
): void {
  removeTrackedChild(state, child)
  const beforeIndex = state.children.indexOf(beforeChild)
  if (beforeIndex === -1) {
    state.children.push(child)
  } else {
    state.children.splice(beforeIndex, 0, child)
  }
  child.parentId = parent.id
}

// ── Event wiring helpers ─────────────────────────────────────────────

const EVENT_PROPS = [
  // Custom element events
  ["onToggleFile", "toggleFile", "bubble"],
  ["onShowMore", "showMore", "bubble"],
  ["onLineClick", "lineClick", "bubble"],
  ["onLinkClick", "linkClick", "bubble"],
  ["onVisibleRange", "visibleRange", "bubble"],
  ["onHighlight", "highlight", "bubble"],
  ["onAccessibilityAction", "accessibilityAction", "bubble"],
  ["onChangeCapture", "change", "capture"],
  ["onChange", "change", "bubble"],
  ["onSubmitCapture", "submit", "capture"],
  ["onSubmit", "submit", "bubble"],
  // Mouse events
  ["onClickCapture", "click", "capture"],
  ["onClick", "click", "bubble"],
  ["onDoubleClickCapture", "doubleClick", "capture"],
  ["onDoubleClick", "doubleClick", "bubble"],
  ["onAuxClickCapture", "auxClick", "capture"],
  ["onAuxClick", "auxClick", "bubble"],
  ["onContextMenuCapture", "contextMenu", "capture"],
  ["onContextMenu", "contextMenu", "bubble"],
  ["onMouseDownCapture", "mouseDown", "capture"],
  ["onMouseDown", "mouseDown", "bubble"],
  ["onMouseUpCapture", "mouseUp", "capture"],
  ["onMouseUp", "mouseUp", "bubble"],
  ["onMouseEnter", "mouseEnter", "bubble"],
  ["onMouseLeave", "mouseLeave", "bubble"],
  ["onMouseMoveCapture", "mouseMove", "capture"],
  ["onMouseMove", "mouseMove", "bubble"],
  ["onMouseDownOutside", "mouseDownOutside", "bubble"],
  // Keyboard events (require focus — tabIndex or autoFocus)
  ["onKeyDownCapture", "keyDown", "capture"],
  ["onKeyDown", "keyDown", "bubble"],
  ["onKeyUpCapture", "keyUp", "capture"],
  ["onKeyUp", "keyUp", "bubble"],
  // Focus events
  ["onFocusCapture", "focus", "capture"],
  ["onFocus", "focus", "bubble"],
  ["onBlurCapture", "blur", "capture"],
  ["onBlur", "blur", "bubble"],
  // Scroll events
  ["onScrollCapture", "scroll", "capture"],
  ["onScroll", "scroll", "bubble"],
  ["onWheelCapture", "wheel", "capture"],
  ["onWheel", "wheel", "bubble"],
] as const

const EVENT_PROP_NAMES = new Set<string>(EVENT_PROPS.map(([name]) => name))
const NATIVE_EVENT_TYPES = new Set(EVENT_PROPS.map(([, eventType]) => eventType))

function eventHandlerKey(eventType: string, phase: "capture" | "bubble"): string {
  return phase === "capture" ? `${eventType}Capture` : eventType
}

function hasEventListener(props: Props, eventType: string): boolean {
  return EVENT_PROPS.some(
    ([propName, candidateType]) => candidateType === eventType && props[propName] != null
  )
}

function syncEventListeners(container: Container, id: number, props: Props): void {
  for (const [propName, eventType, phase] of EVENT_PROPS) {
    const handler = props[propName]
    if (handler) {
      registerEventHandler(
        container.eventHandlers,
        id,
        eventHandlerKey(eventType, phase),
        handler
      )
    }
  }
  for (const eventType of NATIVE_EVENT_TYPES) {
    if (hasEventListener(props, eventType)) {
      container.renderer.setEventListener(id, eventType, true)
    }
  }
}

function diffEventListeners(
  container: Container,
  id: number,
  oldProps: Props,
  newProps: Props
): void {
  for (const [propName, eventType, phase] of EVENT_PROPS) {
    const oldHandler = oldProps[propName]
    const newHandler = newProps[propName]
    const handlerKey = eventHandlerKey(eventType, phase)

    if (oldHandler && !newHandler) {
      unregisterEventHandler(container.eventHandlers, id, handlerKey)
    } else if (newHandler && newHandler !== oldHandler) {
      registerEventHandler(container.eventHandlers, id, handlerKey, newHandler)
    }
  }

  for (const eventType of NATIVE_EVENT_TYPES) {
    const hadListener = hasEventListener(oldProps, eventType)
    const hasListener = hasEventListener(newProps, eventType)
    if (hadListener !== hasListener) {
      container.renderer.setEventListener(id, eventType, hasListener)
    }
  }
}

// ── Style helper ─────────────────────────────────────────────────────

function sendStyle(container: Container, instance: Instance): void {
  const style = styleForRenderer(instance, container, instance.props)
  if (style == null || Object.keys(style).length === 0) return
  container.renderer.setStyle(instance.id, style)
}

// ── Custom prop forwarding ───────────────────────────────────────────

// Props that are handled by the reconciler directly (not forwarded as custom props).
const RESERVED_PROPS = new Set(["style", "className", "children", "key", "ref"])

// HTML structural elements that GPUIX renders as native divs.
const DIV_ALIASES = new Set([
  "main",
  "header",
  "footer",
  "nav",
  "section",
  "article",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "button",
  "kbd",
])

// Built-in element types that don't use custom props.
const BUILT_IN_TYPES = new Set(["div", "text", ...DIV_ALIASES])
const CUSTOM_STYLE_TRANSITION_TYPES = new Set<ElementType>([
  "img",
  "canvas",
  "code",
  "diff",
  "input",
  "textarea",
  "markdown",
  "anchored",
])
const STYLE_TRANSITION_TYPES = new Set<ElementType>([
  "div",
  "text",
  ...CUSTOM_STYLE_TRANSITION_TYPES,
])
// These adapters paint their text/content from element-owned props or themes,
// not from the styled outer surface. A root `color` value can therefore appear
// in getResolvedStyle without changing the pixels an author meant to animate.
const ELEMENT_INTERNAL_COLOR_TRANSITION_TYPES = new Set<ElementType>([
  "img",
  "canvas",
  "code",
  "diff",
  "input",
  "textarea",
  "markdown",
  "anchored",
])
const warnedUnsupportedStyleTransitions = new WeakSet<Instance>()
const warnedInvalidStyleProps = new WeakSet<Instance>()
const warnedUnsupportedClassNameProps = new WeakSet<Instance>()
const warnedUnsupportedAccessibilityRoleProps = new WeakSet<Instance>()
const warnedUnsupportedAriaProps = new WeakSet<Instance>()
const warnedVisuallyHiddenProps = new WeakSet<Instance>()

class UnsupportedStyleTransitionError extends Error {
  override name = "UnsupportedStyleTransitionError"
}

class InvalidStylePropError extends Error {
  override name = "InvalidStylePropError"
}

class UnsupportedClassNamePropError extends Error {
  override name = "UnsupportedClassNamePropError"
}

class UnsupportedAccessibilityRolePropError extends Error {
  override name = "UnsupportedAccessibilityRolePropError"
}

class InvalidVisuallyHiddenPropError extends Error {
  override name = "InvalidVisuallyHiddenPropError"
}

class ContradictoryAccessibilityVisibilityError extends Error {
  override name = "ContradictoryAccessibilityVisibilityError"
}

function elementSubject(instance: Instance, props: Props): string {
  const identity = [
    props.testId === undefined ? undefined : `testId=${JSON.stringify(props.testId)}`,
    props["data-testid"] === undefined
      ? undefined
      : `data-testid=${JSON.stringify(props["data-testid"])}`,
    props.id === undefined ? undefined : `id=${JSON.stringify(props.id)}`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ")
  return identity.length === 0 ? `<${instance.type}>` : `<${instance.type} ${identity}>`
}

function isPlainStyleObject(style: unknown): style is StyleDesc {
  if (style === null || typeof style !== "object") return false
  const prototype = Object.getPrototypeOf(style)
  return prototype === Object.prototype || prototype === null
}

/**
 * Keep malformed whole-prop inputs out of the native JSON path. Field-level
 * validation remains native because it can report the specific style property.
 */
function styleForRenderer(instance: Instance, container: Container, props: Props): StyleDesc | undefined {
  const { style } = props
  if (style == null || isPlainStyleObject(style)) return style

  const message =
    `[gpuix] ${elementSubject(instance, props)} received an invalid style prop. ` +
    "style accepts a plain style object only."
  if (container.strictStyles) throw new InvalidStylePropError(message)
  if (!warnedInvalidStyleProps.has(instance)) {
    warnedInvalidStyleProps.add(instance)
    console.warn(message)
  }
  // Treat a rejected update like style removal instead of preserving stale or
  // serialising an arbitrary value into the native renderer.
  return {}
}

function diagnoseUnsupportedClassNameProp(
  instance: Instance,
  container: Container,
  props: Props
): void {
  const className = (props as Props & { className?: unknown }).className
  // `className=""` and `className={null}` apply no CSS classes on the web
  // either, so nothing is lost by ignoring them here.
  if (className === undefined || className === null || className === "") return

  const message =
    `[gpuix] ${elementSubject(instance, props)} does not support className. ` +
    "CSS classes are not applied by the native renderer; use the style prop with a GPUIX style object instead."
  if (container.strictStyles) throw new UnsupportedClassNamePropError(message)
  if (warnedUnsupportedClassNameProps.has(instance)) return
  warnedUnsupportedClassNameProps.add(instance)
  console.warn(message)
}

/**
 * `role` is the only public role prop. Keep a DOM-adapter spelling from being
 * silently filtered out on built-in aliases, where it would otherwise lose to
 * their synthesized role.
 */
function diagnoseUnsupportedAccessibilityRoleProp(
  instance: Instance,
  container: Container,
  props: Props
): void {
  const accessibilityRole = (props as Props & { accessibilityRole?: unknown }).accessibilityRole
  if (accessibilityRole === undefined) return

  const message =
    `[gpuix] ${elementSubject(instance, props)} does not support accessibilityRole. ` +
    "Use role instead."
  if (container.strictStyles) throw new UnsupportedAccessibilityRolePropError(message)
  if (warnedUnsupportedAccessibilityRoleProps.has(instance)) return
  warnedUnsupportedAccessibilityRoleProps.add(instance)
  console.warn(message)
}

const ARIA_PROP_ALIASES = {
  "aria-label": "ariaLabel",
  "aria-description": "ariaDescription",
  "aria-checked": "ariaChecked",
  "aria-expanded": "ariaExpanded",
  "aria-current": "ariaCurrent",
  "aria-selected": "ariaSelected",
  "aria-valuetext": "ariaValue",
  "aria-valuemin": "ariaValueMin",
  "aria-valuemax": "ariaValueMax",
  "aria-valuenow": "ariaValueNow",
  "aria-level": "ariaLevel",
  "aria-rowindex": "ariaRowIndex",
  "aria-colindex": "ariaColIndex",
  "aria-rowcount": "ariaRowCount",
  "aria-colcount": "ariaColCount",
  "aria-rowspan": "ariaRowSpan",
  "aria-colspan": "ariaColSpan",
  "aria-disabled": "ariaDisabled",
  "aria-hidden": "ariaHidden",
} as const

function diagnoseUnsupportedAriaProp(
  instance: Instance,
  container: Container,
  props: Props
): void {
  const unsupported = Object.entries(props).find(
    ([key, value]) =>
      value !== undefined && key.startsWith("aria-") && !(key in ARIA_PROP_ALIASES)
  )
  if (!unsupported) return

  const [name] = unsupported
  const message =
    `[gpuix] ${elementSubject(instance, props)} does not support ${name}. ` +
    "It has no camelCase GPUIX accessibility prop."
  if (warnedUnsupportedAriaProps.has(instance)) return
  warnedUnsupportedAriaProps.add(instance)
  console.warn(message)
}

function booleanishTrue(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true")
}

function diagnoseVisuallyHiddenProp(
  instance: Instance,
  container: Container,
  props: Props
): void {
  const value = (props as Props & { visuallyHidden?: unknown }).visuallyHidden
  let message: string | undefined
  let ErrorType: typeof InvalidVisuallyHiddenPropError | typeof ContradictoryAccessibilityVisibilityError =
    InvalidVisuallyHiddenPropError

  if (value !== undefined && value !== true) {
    message =
      `[gpuix] ${elementSubject(instance, props)} received an invalid visuallyHidden prop. ` +
      "visuallyHidden accepts true only; omit the prop when the element should paint."
  } else if (value === true) {
    const ariaHidden = Object.prototype.hasOwnProperty.call(props, "ariaHidden")
      ? props.ariaHidden
      : props["aria-hidden"]
    if (booleanishTrue(ariaHidden)) {
      ErrorType = ContradictoryAccessibilityVisibilityError
      message =
        `[gpuix] ${elementSubject(instance, props)} cannot combine visuallyHidden with ariaHidden=true. ` +
        "ariaHidden removes the accessibility node that visuallyHidden exists to preserve; remove one property."
    }
  }

  if (message === undefined) return
  if (container.strictStyles) throw new ErrorType(message)
  if (warnedVisuallyHiddenProps.has(instance)) return
  warnedVisuallyHiddenProps.add(instance)
  console.warn(message)
}

function supportsStyleTransitions(type: ElementType): boolean {
  return STYLE_TRANSITION_TYPES.has(type) || DIV_ALIASES.has(type)
}

function diagnoseUnsupportedStyleTransition(
  instance: Instance,
  container: Container,
  props: Props
): void {
  const style = props.style
  if (style == null) return

  const subject = elementSubject(instance, props)
  const support =
    "Style transitions are available on <div> and <text>. <img>, <canvas>, <code>, " +
    "<diff>, <input>, <textarea>, <markdown>, and <anchored> support outer-container " +
    "properties only."
  let message: string
  if (style.transition == null) {
    return
  } else if (!supportsStyleTransitions(instance.type)) {
    message = `[gpuix] ${subject} does not support style.transition. ${support}`
  } else if (
    ELEMENT_INTERNAL_COLOR_TRANSITION_TYPES.has(instance.type) &&
    Array.isArray(style.transition.properties) &&
    style.transition.properties.includes("color")
  ) {
    message =
      `[gpuix] ${subject} does not support style.transition property "color". ` +
      "Its text or content is painted by the element adapter, not the outer container; " +
      `element-internal colours do not interpolate. ${support}`
  } else {
    return
  }

  if (container.strictStyles) throw new UnsupportedStyleTransitionError(message)
  if (warnedUnsupportedStyleTransitions.has(instance)) return
  warnedUnsupportedStyleTransitions.add(instance)
  console.warn(message)
}

// Props that reach Rust on EVERY element type, including div and text.
// Custom props are otherwise skipped for built-ins.
const UNIVERSAL_PROPS = new Set([
  "activationKind",
  "autoFocus",
  "tabIndex",
  "motion",
  "testId",
  "role",
  "ariaLabel",
  "ariaDescription",
  "ariaChecked",
  "ariaExpanded",
  "ariaCurrent",
  "ariaSelected",
  "ariaValue",
  "ariaValueMin",
  "ariaValueMax",
  "ariaValueNow",
  "ariaLevel",
  "ariaRowIndex",
  "ariaColIndex",
  "ariaRowCount",
  "ariaColCount",
  "ariaRowSpan",
  "ariaColSpan",
  "ariaDisabled",
  "ariaHidden",
  "visuallyHidden",
  "disabled",
  // `highlight` is scoped by where it sits in the tree, so it has to reach a
  // plain `div`. Without it here, custom props are dropped for built-ins and
  // the prop silently never arrives in Rust.
  "highlight",
])

function isIdentityProp(name: string): boolean {
  return name === "id" || name.startsWith("data-")
}

function isReservedProp(name: string): boolean {
  return RESERVED_PROPS.has(name) || EVENT_PROP_NAMES.has(name)
}

function serializeCustomProp(
  type: string,
  key: string,
  value: object | string | number | boolean | null | undefined
): string | object | number | boolean | null {
  if (value === undefined || typeof value === "function") return null
  if (
    typeof value === "number" &&
    !Number.isFinite(value) &&
    [
      "ariaValueMin",
      "ariaValueMax",
      "ariaValueNow",
      "ariaLevel",
      "ariaRowIndex",
      "ariaColIndex",
      "ariaRowCount",
      "ariaColCount",
      "ariaRowSpan",
      "ariaColSpan",
    ].includes(key)
  ) {
    // JSON.stringify would silently turn these into null, which means prop
    // removal. Preserve the malformed value as text so Rust can issue the
    // same loud property diagnostic as every other invalid ARIA state.
    return String(value)
  }
  if (
    type === "img" &&
    key === "src" &&
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "data" &&
    "bytes" in value
  ) {
    const bytes = value.bytes
    if (bytes instanceof ArrayBuffer) {
      return { ...value, bytes: Array.from(new Uint8Array(bytes)) }
    }
    if (ArrayBuffer.isView(bytes)) {
      return {
        ...value,
        bytes: Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
      }
    }
  }
  return value
}

type CustomPropInput = object | string | number | boolean | null | undefined

/** Preserve native tab stops when JSX aliases become native divs. */
function nativeTabIndex(type: string, props: Props): number | undefined {
  if (props.disabled === true) return undefined
  if (props.tabIndex !== undefined) return props.tabIndex
  if (type === "button") return 0
  const href = type === "a" ? (props as Props & { href?: unknown }).href : undefined
  return typeof href === "string" ? 0 : undefined
}

/** Keep the original anchor semantics after host aliases become native divs. */
function nativeActivationKind(type: string, props: Props): "anchor" | undefined {
  const href = (props as Props & { href?: unknown }).href
  return type === "a" || typeof href === "string" ? "anchor" : undefined
}

/** Restore the two semantic aliases after both normalize to a native div. */
function nativeRole(type: string, props: Props): Props["role"] | undefined {
  if (props.role !== undefined) return props.role
  if (type === "button") return "button"
  if (type === "a") return "link"
  if (type === "img") return nativeImageRole(props)
  return undefined
}

/** An explicitly authored accessible name, from either prop spelling. */
function authoredAriaLabel(props: Props): string | undefined {
  const label = props.ariaLabel ?? props["aria-label"]
  return typeof label === "string" ? label : undefined
}

/**
 * HTML-AAM maps `<img>` to the `img` role, and to `presentation` when an empty
 * `alt` marks the image as decorative. ARIA's presentational conflict
 * resolution keeps the image role when the author named the image or put it in
 * the tab order.
 */
function nativeImageRole(props: Props): "img" | "presentation" {
  const { alt } = props as Props & { alt?: unknown }
  const decorative =
    alt === "" && authoredAriaLabel(props) === undefined && props.tabIndex === undefined
  return decorative ? "presentation" : "img"
}

/**
 * `alt` is the image's name source in HTML, and any authored ARIA name wins
 * over it exactly as it does in the DOM's name computation.
 */
function nativeImageLabel(type: string, props: Props): string | undefined {
  if (type !== "img") return undefined
  const { alt } = props as Props & { alt?: unknown }
  if (typeof alt !== "string" || alt === "") return undefined
  return authoredAriaLabel(props) === undefined ? alt : undefined
}

function customPropEntries(type: string, props: Props): Array<[string, CustomPropInput]> {
  const propEntries = Object.entries(props) as Array<[string, CustomPropInput]>
  const entries = propEntries.flatMap(([key, value]): Array<[string, CustomPropInput]> => {
    if (key === "activationKind" || key === "role" || key === "tabIndex") return []
    const alias = ARIA_PROP_ALIASES[key as keyof typeof ARIA_PROP_ALIASES]
    if (alias === undefined) return [[key, value]]
    if (Object.prototype.hasOwnProperty.call(props, alias)) return []
    return [[alias, value]]
  })
  const tabIndex = nativeTabIndex(type, props)
  if (tabIndex !== undefined) entries.push(["tabIndex", tabIndex])
  const activationKind = nativeActivationKind(type, props)
  if (activationKind) entries.push(["activationKind", activationKind])
  const role = nativeRole(type, props)
  if (role !== undefined) entries.push(["role", role])
  const imageLabel = nativeImageLabel(type, props)
  if (imageLabel !== undefined) entries.push(["ariaLabel", imageLabel])

  const virtualListProps = props as Props & VirtualListProps
  if (type !== "virtual-list" || virtualListProps.estimatedItemHeight !== undefined) {
    return entries
  }
  return [
    ...entries.filter(([key]) => key !== "estimatedItemHeight"),
    ["estimatedItemHeight", DEFAULT_VIRTUAL_LIST_ESTIMATED_ITEM_HEIGHT],
  ]
}

/** Send all custom props to Rust for non-built-in element types. */
function syncCustomProps(
  renderer: MutationRenderer,
  id: number,
  type: string,
  props: Props
): void {
  const builtIn = BUILT_IN_TYPES.has(type)
  for (const [key, value] of customPropEntries(type, props)) {
    if (isReservedProp(key)) continue
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isIdentityProp(key)) continue
    renderer.setCustomProp(id, key, serializeCustomProp(type, key, value))
  }
}

/** Diff and send changed custom props to Rust. */
function diffCustomProps(
  renderer: MutationRenderer,
  id: number,
  type: string,
  oldProps: Props,
  newProps: Props
): void {
  const builtIn = BUILT_IN_TYPES.has(type)
  const oldEntries = customPropEntries(type, oldProps)
  const newEntries = customPropEntries(type, newProps)
  const newKeys = newEntries.map(([key]) => key)
  // Updated or added props
  for (const [key, value] of newEntries) {
    if (isReservedProp(key)) continue
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isIdentityProp(key)) continue
    const oldValue = oldEntries.find(([oldKey]) => oldKey === key)?.[1]
    if (oldValue !== value) {
      renderer.setCustomProp(id, key, serializeCustomProp(type, key, value))
    }
  }
  // Removed props
  for (const [key] of oldEntries) {
    if (isReservedProp(key)) continue
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isIdentityProp(key)) continue
    if (!newKeys.includes(key)) {
      renderer.setCustomProp(id, key, null)
    }
  }
}

/**
 * Materialize a render-phase host node only after React places its subtree in
 * the commit phase. Abandoned concurrent renders stay as collectable JS
 * objects and never enter the native mutation queue.
 */
function materialize(node: HostNode): HostNodeState {
  const state = stateFor(node)
  if (state.mounted) return state

  const renderer = state.container.renderer
  if ("type" in node) {
    state.container.eventTargets.set(node.id, node)
    validateVirtualListRowContract(node, state)
    renderer.createElement(node.id, DIV_ALIASES.has(node.type) ? "div" : node.type)
    sendStyle(state.container, node)
    syncEventListeners(state.container, node.id, node.props)
    syncCustomProps(renderer, node.id, node.type, node.props)
  } else {
    // Native hit testing reports the deepest painted retained node. A raw React
    // text node has no public host instance of its own, so route that source to
    // its nearest host parent while preserving the native source id as the map key.
    const parentTarget =
      node.parentId == null ? undefined : state.container.eventTargets.get(node.parentId)
    if (parentTarget) state.container.eventTargets.set(node.id, parentTarget)
    renderer.createElement(node.id, "text")
    renderer.setText(node.id, node.text)
  }
  state.mounted = true

  for (const child of state.children) {
    materialize(child)
    renderer.appendChild(node.id, child.id)
  }
  return state
}

// ── Host config ──────────────────────────────────────────────────────

export const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  // React creates host nodes while rendering and may abandon that work in
  // concurrent mode. Keep the description in JS; materialize it only from a
  // commit-phase placement callback.
  createInstance(
    type: ElementType,
    props: Props,
    rootContainerInstance: Container,
    hostContext: HostContext
  ): Instance {
    if (hostContext.isInsideText && type !== "text") {
      throw new InlineTextChildError(
        `GPUIX <text> can contain only strings and nested <text> elements; received <${type}>. ` +
          "Move block or custom content outside the flowing text node."
      )
    }
    const id = nextId(rootContainerInstance)
    const instance: Instance = {
      id,
      type,
      props,
      focus: (options?: FocusOptions) =>
        rootContainerInstance.native.focusElement?.(id, options?.preventScroll === true),
      blur: () => {
        // Only this element's own focus is ours to drop. A renderer that cannot
        // report the active element cannot prove that, so it does nothing
        // rather than blurring whatever happens to be focused.
        const native = rootContainerInstance.native
        if (!native.getActiveElement || native.getActiveElement() !== id) return
        native.blur?.()
      },
      setPointerCapture: () => rootContainerInstance.native.setPointerCapture?.(id),
      releasePointerCapture: () =>
        rootContainerInstance.native.releasePointerCapture?.(id),
      get scrollLeft() {
        const getScrollOffset = rootContainerInstance.native.getScrollOffset
        return -(getScrollOffset?.call(rootContainerInstance.native, id)?.[0] ?? 0)
      },
      get scrollTop() {
        const getScrollOffset = rootContainerInstance.native.getScrollOffset
        return -(getScrollOffset?.call(rootContainerInstance.native, id)?.[1] ?? 0)
      },
      getBounds: () => {
        const getElementBounds = rootContainerInstance.native.getElementBounds
        if (!getElementBounds) {
          throw new Error("This GPUIX renderer does not support element measurement")
        }
        const bounds = getElementBounds.call(rootContainerInstance.native, id)
        if (!bounds) return null
        return { x: bounds[0]!, y: bounds[1]!, width: bounds[2]!, height: bounds[3]! }
      },
      __applyCanvasCommands: (ops, operands, strings) => {
        if (instance.type !== "canvas") {
          throw new TypeError(
            `Canvas commands can only target <canvas>, received <${instance.type}>`
          )
        }
        const apply = rootContainerInstance.native.applyCanvasCommands
        if (!apply) {
          throw new Error("This GPUIX renderer does not support retained canvas commands")
        }
        apply.call(rootContainerInstance.native, id, ops, operands, strings)
        reportStyleDiagnostics(rootContainerInstance.native)
      },
      parentId: null,
      getAttribute(name): string | null {
        const value = (instance.props as Props & Record<string, unknown>)[name]
        if (value == null || typeof value === "function") return null
        if (name === "id" || name.startsWith("data-")) return String(value)
        if (value === false) return null
        if (value === true) return ""
        return typeof value === "string" || typeof value === "number" ? String(value) : null
      },
    }
    if (type === "canvas") {
      const diagnosticTarget = {
        describeElement: () => describeCanvas(instance),
        strict: rootContainerInstance.strictStyles,
        applyCanvasCommands: (ops: Uint32Array, operands: Float64Array, strings: readonly string[]) =>
          instance.__applyCanvasCommands(ops, operands, strings),
      }
      instance.getContext = ((contextId: string): CanvasRenderingContext2D | null => {
        if (contextId !== "2d") return null
        return getOrCreateRecordingContext2D(instance, diagnosticTarget)
      }) as NonNullable<Instance["getContext"]>
      instance.toDataURL = (() => {
        diagnoseUnsupportedCanvasElementMember(
          instance,
          diagnosticTarget,
          "toDataURL"
        )
        return undefined as never
      }) as NonNullable<Instance["toDataURL"]>
    }
    hostNodeStates.set(instance, {
      container: rootContainerInstance,
      children: [],
      mounted: false,
    })
    diagnoseUnsupportedStyleTransition(instance, rootContainerInstance, props)
    diagnoseUnsupportedClassNameProp(instance, rootContainerInstance, props)
    diagnoseUnsupportedAccessibilityRoleProp(instance, rootContainerInstance, props)
    diagnoseUnsupportedAriaProp(instance, rootContainerInstance, props)
    diagnoseVisuallyHiddenProp(instance, rootContainerInstance, props)
    return instance
  },

  appendChild(parent: Instance, child: Instance | TextInstance): void {
    const parentState = materialize(parent)
    materialize(child)
    appendTrackedChild(parent, parentState, child)
    if (!("type" in child)) parentState.container.eventTargets.set(child.id, parent)
    scheduleVirtualListValidation(parent, parentState)
    parentState.container.renderer.appendChild(parent.id, child.id)
  },

  // React only calls this from the deletion path, never to move a node, so the
  // child is gone for good and has to be freed here. Detaching alone leaked
  // every removed text node: `detachDeletedInstance` runs for host components
  // only, so nothing else would ever destroy a `HostText`.
  removeChild(parent: Instance, child: Instance | TextInstance): void {
    const parentState = stateFor(parent)
    removeTrackedChild(parentState, child)
    scheduleVirtualListValidation(parent, parentState)
    const destroyed = parentState.container.renderer.destroyElement(child.id)
    for (const id of destroyed) {
      unregisterEventHandlers(parentState.container.eventHandlers, id)
      parentState.container.eventTargets.delete(id)
      parentState.container.preventedKeyboardActivations.delete(id)
    }
  },

  insertBefore(
    parent: Instance,
    child: Instance | TextInstance,
    beforeChild: Instance | TextInstance
  ): void {
    const parentState = materialize(parent)
    materialize(child)
    insertTrackedChild(parent, parentState, child, beforeChild)
    if (!("type" in child)) parentState.container.eventTargets.set(child.id, parent)
    scheduleVirtualListValidation(parent, parentState)
    parentState.container.renderer.insertBefore(parent.id, child.id, beforeChild.id)
  },

  insertInContainerBefore(
    _parent: Container,
    _child: Instance,
    _beforeChild: Instance
  ): void {},

  removeChildFromContainer(parent: Container, child: Instance): void {
    disposeRecordingContext2D(child)
    const destroyed = parent.renderer.destroyElement(child.id)
    for (const id of destroyed) {
      unregisterEventHandlers(parent.eventHandlers, id)
      parent.eventTargets.delete(id)
      parent.preventedKeyboardActivations.delete(id)
    }
  },

  prepareForCommit(_containerInfo: Container): Record<string, unknown> | null {
    return null
  },

  // Batch flush point: flushMutations() sends all queued mutations to Rust
  // in a single applyBatch() FFI call. This is the end of React's synchronous
  // commit phase — all mutations from this render are flushed together.
  resetAfterCommit(containerInfo: Container): void {
    try {
      validatePendingVirtualLists(containerInfo)
    } catch (error) {
      containerInfo.renderer.discardMutations?.()
      console.error(error)
      return
    }
    containerInfo.renderer.flushMutations()
  },

  getRootHostContext(_rootContainerInstance: Container): HostContext {
    return { isInsideText: false }
  },

  getChildHostContext(
    parentHostContext: HostContext,
    type: ElementType,
    _rootContainerInstance: Container
  ): HostContext {
    const isInsideText = type === "text"
    return { ...parentHostContext, isInsideText }
  },

  shouldSetTextContent(_type: ElementType, _props: Props): boolean {
    return false
  },

  createTextInstance(
    text: string,
    rootContainerInstance: Container,
    _hostContext: HostContext
  ): TextInstance {
    const instance: TextInstance = {
      id: nextId(rootContainerInstance),
      text,
      parentId: null,
    }
    hostNodeStates.set(instance, {
      container: rootContainerInstance,
      children: [],
      mounted: false,
    })
    return instance
  },

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  shouldAttemptEagerTransition(): boolean {
    return false
  },

  finalizeInitialChildren(
    _instance: Instance,
    _type: ElementType,
    _props: Props,
    _rootContainerInstance: Container,
    _hostContext: HostContext
  ): boolean {
    return false
  },

  commitMount(
    _instance: Instance,
    _type: ElementType,
    _props: Props,
    _internalInstanceHandle: unknown
  ): void {},

  commitUpdate(
    instance: Instance,
    _type: ElementType,
    oldProps: Props,
    newProps: Props,
    _internalInstanceHandle: unknown
  ): void {
    const container = containerFor(instance)
    diagnoseUnsupportedStyleTransition(instance, container, newProps)
    diagnoseUnsupportedClassNameProp(instance, container, newProps)
    diagnoseUnsupportedAccessibilityRoleProp(instance, container, newProps)
    diagnoseUnsupportedAriaProp(instance, container, newProps)
    diagnoseVisuallyHiddenProp(instance, container, newProps)
    // Always resend style — per-element JSON is small, and this avoids
    // bugs from same-reference mutations or style removal.
    container.renderer.setStyle(instance.id, styleForRenderer(instance, container, newProps) ?? {})
    diffEventListeners(container, instance.id, oldProps, newProps)
    // Custom prop diff (for non-div/text elements)
    diffCustomProps(container.renderer, instance.id, instance.type, oldProps, newProps)
    instance.props = newProps
    scheduleVirtualListValidation(instance, stateFor(instance))
  },

  commitTextUpdate(
    textInstance: TextInstance,
    _oldText: string,
    newText: string
  ): void {
    rendererFor(textInstance).setText(textInstance.id, newText)
    textInstance.text = newText
  },

  appendChildToContainer(container: Container, child: Instance): void {
    child.parentId = null
    materialize(child)
    container.renderer.setRoot(child.id)
  },

  appendInitialChild(parent: Instance, child: Instance | TextInstance): void {
    stateFor(parent).children.push(child)
    child.parentId = parent.id
  },

  hideInstance(instance: Instance): void {
    rendererFor(instance).setStyle(instance.id, { visibility: "hidden" })
  },

  unhideInstance(instance: Instance, _props: Props): void {
    rendererFor(instance).setStyle(instance.id, instance.props.style ?? {})
  },

  hideTextInstance(_textInstance: TextInstance): void {},
  unhideTextInstance(_textInstance: TextInstance, _text: string): void {},

  clearContainer(_container: Container): void {},

  setCurrentUpdatePriority(newPriority: number): void {
    currentUpdatePriority = newPriority
  },

  getCurrentUpdatePriority: (): number => currentUpdatePriority,

  resolveUpdatePriority(): number {
    if (currentUpdatePriority !== NoEventPriority) {
      return currentUpdatePriority
    }
    return DefaultEventPriority
  },

  maySuspendCommit(): boolean {
    return false
  },

  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance(): void {},
  requestPostPaintCallback(): void {},
  trackSchedulerEvent(): void {},

  resolveEventType(): null {
    return null
  },

  resolveEventTimeStamp(): number {
    return -1.1
  },

  preloadInstance(): boolean {
    return true
  },

  startSuspendingCommit(): void {},
  suspendInstance(): void {},

  waitForCommitToBeReady(): null {
    return null
  },

  detachDeletedInstance(instance: Instance): void {
    disposeRecordingContext2D(instance)
    const container = containerFor(instance)
    const destroyed = container.renderer.destroyElement(instance.id)
    for (const id of destroyed) {
      unregisterEventHandlers(container.eventHandlers, id)
      container.eventTargets.delete(id)
      container.preventedKeyboardActivations.delete(id)
    }
  },

  getPublicInstance(instance: Instance): PublicInstance {
    return instance
  },

  preparePortalMount(_containerInfo: Container): void {},
  isPrimaryRenderer: true,

  getInstanceFromNode(): null {
    return null
  },

  beforeActiveInstanceBlur(): void {},
  afterActiveInstanceBlur(): void {},
  prepareScopeUpdate(): void {},

  getInstanceFromScope(): null {
    return null
  },
}
