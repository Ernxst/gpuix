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
  SelectionDirection,
  StyleDesc,
  TextInstance,
  VirtualListProps,
} from "../types/host.js"
import {
  registerEventHandler,
  unregisterEventHandler,
  unregisterEventHandlers,
} from "./event-registry.js"
import { TEXT_EDITING_TYPES } from "./text-editing.js"
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
  // HTML-AAM gives `<header>`, `<footer>` and `<li>` a role that depends on
  // which element contains them, so the implicit role needs the parent node,
  // not just the parent id.
  parent: Instance | null
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
  stateFor(child).parent = null
}

function appendTrackedChild(parent: Instance, state: HostNodeState, child: HostNode): void {
  removeTrackedChild(state, child)
  state.children.push(child)
  child.parentId = parent.id
  stateFor(child).parent = parent
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
  stateFor(child).parent = parent
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
const warnedUnsupportedScrollIntoViewOptions = new WeakSet<Instance>()
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
    props["data-testid"] === undefined
      ? undefined
      : `data-testid=${JSON.stringify(props["data-testid"])}`,
    props.id === undefined ? undefined : `id=${JSON.stringify(props.id)}`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ")
  return identity.length === 0 ? `<${instance.type}>` : `<${instance.type} ${identity}>`
}

class UnsupportedScrollIntoViewOptionError extends Error {
  override name = "UnsupportedScrollIntoViewOptionError"
}

/**
 * Resolve `Element.scrollIntoView()`'s alignment to the one bit gpui can act
 * on: align the scroll container to the element's top edge, or scroll by the
 * smallest amount that reveals it.
 *
 * The DOM defaults to `block: "start"`, and `scrollIntoView(true)` spells the
 * same thing. `"center"` and `"end"` have no gpui equivalent: under
 * `strictStyles` they throw, and otherwise they warn once per element and
 * reveal by the nearest edge, the way every other unsupported input on this
 * host config degrades. A component shared with the web must not crash on
 * native for an alignment the reveal can only approximate.
 */
function scrollIntoViewAlignsToTop(
  instance: Instance,
  container: Container,
  props: Props,
  options?: boolean | ScrollIntoViewOptions
): boolean {
  const reject = (spelling: string): boolean => {
    const message =
      `[gpuix] ${elementSubject(instance, props)} cannot scrollIntoView with ${spelling}. ` +
      'The native renderer aligns to a child\'s top edge (block: "start") or scrolls the ' +
      'smallest amount that reveals it (block: "nearest").'
    if (container.strictStyles) throw new UnsupportedScrollIntoViewOptionError(message)
    if (!warnedUnsupportedScrollIntoViewOptions.has(instance)) {
      warnedUnsupportedScrollIntoViewOptions.add(instance)
      console.warn(message)
    }
    // The nearest edge always reveals the element, so the scroll still
    // happens; only where it comes to rest differs.
    return false
  }

  if (options === undefined || options === true) return true
  if (options === false) return reject('block: "end"')

  const { block, inline } = options
  if (block !== undefined && block !== "start" && block !== "nearest") {
    return reject(`block: ${JSON.stringify(block)}`)
  }
  if (inline !== undefined && inline !== "nearest") {
    return reject(`inline: ${JSON.stringify(inline)}`)
  }
  // `behavior` is accepted and ignored: every scroll here is instant, as with
  // PublicInstance.scrollTo().
  return block !== "nearest"
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

/**
 * The DOM spelling of every supported ARIA attribute, and the prop key the
 * retained tree stores it under. Exported so a matcher asking for the attribute
 * by its DOM name translates through the same table the reconciler wrote with.
 */
export const ARIA_PROP_ALIASES = {
  "aria-label": "ariaLabel",
  "aria-labelledby": "ariaLabelledBy",
  "aria-description": "ariaDescription",
  "aria-describedby": "ariaDescribedBy",
  "aria-checked": "ariaChecked",
  "aria-expanded": "ariaExpanded",
  "aria-current": "ariaCurrent",
  "aria-live": "ariaLive",
  "aria-atomic": "ariaAtomic",
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
  "role",
  "ariaLabel",
  "ariaLabelledBy",
  "ariaDescription",
  "ariaDescribedBy",
  "ariaChecked",
  "ariaExpanded",
  "ariaCurrent",
  "ariaLive",
  "ariaAtomic",
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

/**
 * Keep the original anchor semantics after host aliases become native divs.
 *
 * Keyed on `href`, like {@link nativeTabIndex} and {@link nativeAnchorRole}. A
 * bare `<a>` is a plain generic in the DOM — not focusable, not activatable —
 * so giving it link keyboard behaviour (Enter activates, Space declines) would
 * contradict the `generic` role it now computes.
 */
function nativeActivationKind(_type: string, props: Props): "anchor" | undefined {
  const href = (props as Props & { href?: unknown }).href
  return typeof href === "string" ? "anchor" : undefined
}

/**
 * HTML-AAM's implicit role for each JSX alias whose role depends only on the
 * tag name. The aliases missing from this table either have no corresponding
 * role (`p`, `span`, `strong`, `em`, `kbd`) or need their surroundings to
 * resolve, and are handled in `nativeRole`.
 */
const IMPLICIT_ROLES: Readonly<Record<string, NonNullable<Props["role"]>>> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  li: "listitem",
  main: "main",
  nav: "navigation",
  ol: "list",
  // SVG-AAM gives a bare `<svg>` the graphics-document role.
  svg: "graphics-document",
  ul: "list",
}

/**
 * HTML-AAM scopes `<header>`/`<footer>` to the body element: they are the
 * page's banner and contentinfo landmarks only when no sectioning element —
 * or element carrying one of those elements' roles — contains them.
 */
const LANDMARK_SCOPING_TYPES = new Set(["article", "aside", "main", "nav", "section"])
const LANDMARK_SCOPING_ROLES = new Set([
  "article",
  "complementary",
  "main",
  "navigation",
  "region",
])

/** The list containers that make an `<li>` a listitem rather than a generic. */
const LIST_OWNER_TYPES = new Set(["ul", "ol"])

function isScopedToBody(instance: Instance): boolean {
  for (let node = stateFor(instance).parent; node !== null; node = stateFor(node).parent) {
    const role = node.props.role
    if (LANDMARK_SCOPING_TYPES.has(node.type)) return false
    if (typeof role === "string" && LANDMARK_SCOPING_ROLES.has(role)) return false
  }
  return true
}

function isInsideList(instance: Instance): boolean {
  const parent = stateFor(instance).parent
  if (parent === null) return false
  return LIST_OWNER_TYPES.has(parent.type) || parent.props.role === "list"
}

/** The accessible name authored on the element itself, as `<section>` needs it. */
function hasAuthoredName(props: Props): boolean {
  const label = authoredAriaLabel(props)
  if (label !== undefined && label !== "") return true
  // A reference list names the section just as `ariaLabel` does. Whether those
  // ids resolve is decided in Rust, which holds the tree; an authored reference
  // is the most this side can see.
  const labelledBy = props.ariaLabelledBy ?? props["aria-labelledby"]
  return typeof labelledBy === "string" && labelledBy.trim() !== ""
}

/**
 * Restore each alias's HTML-AAM implicit role after it normalizes to a native
 * div. An explicit `role` always wins, exactly as `role` overrides an element's
 * implicit role in the DOM.
 */
function nativeRole(
  type: string,
  props: Props,
  instance: Instance
): Props["role"] | undefined {
  if (props.role !== undefined) return props.role
  // HTML-AAM maps `<a>` to `link` only when it has an `href`. A placeholder
  // anchor without one computes `generic`, and announcing it as a link tells a
  // screen-reader user there is somewhere to go when there is not.
  //
  // This shadows the `a` entry in IMPLICIT_ROLES, exactly as the `li` arm
  // below shadows its own: the table holds the role a type reaches when
  // nothing conditions it away, and these arms are the conditions.
  if (type === "a") return nativeAnchorRole(props)
  if (type === "img") return nativeImageRole(props)
  // `<section>` is a region landmark only when it has an accessible name;
  // an unnamed one is generic, so it contributes no node of its own.
  if (type === "section") return hasAuthoredName(props) ? "region" : undefined
  if (type === "header") return isScopedToBody(instance) ? "banner" : undefined
  if (type === "footer") return isScopedToBody(instance) ? "contentinfo" : undefined
  if (type === "li") return isInsideList(instance) ? "listitem" : undefined
  return IMPLICIT_ROLES[type]
}

/**
 * `<h1>`–`<h6>` carry their heading level with the implicit heading role. An
 * authored `ariaLevel` wins, and an explicit `role` that is not `heading` drops
 * the level with the role it belonged to.
 */
function nativeHeadingLevel(type: string, props: Props): number | undefined {
  if (props.role !== undefined && props.role !== "heading") return undefined
  if (props.ariaLevel !== undefined || props["aria-level"] !== undefined) return undefined
  const level = /^h([1-6])$/.exec(type)?.[1]
  return level === undefined ? undefined : Number(level)
}

/** The aliases whose implicit role is read from an ancestor rather than themselves. */
const CONTEXT_DEPENDENT_ROLE_TYPES = new Set(["li", "header", "footer"])

/** The ancestor roles those aliases read. `<section>` reads only its own props. */
const CONTEXT_SENSITIVE_ROLE_SOURCES = new Set([...LANDMARK_SCOPING_ROLES, "list"])

function isContextSensitiveRoleSource(role: unknown): boolean {
  return typeof role === "string" && CONTEXT_SENSITIVE_ROLE_SOURCES.has(role)
}

/**
 * Re-resolve the descendant roles that read this element's role from above.
 *
 * `<li>` reads its list owner and `<header>`/`<footer>` read every sectioning
 * ancestor, so an ancestor gaining or losing one of those roles changes what
 * they compute — the DOM recomputes them the moment the attribute changes.
 * Only a role entering or leaving that set can move a descendant, so every
 * other update skips the walk entirely.
 *
 * The walk covers the whole subtree rather than stopping at a nested sectioning
 * boundary: `nativeRole` re-walks upwards from each node, so descending past a
 * boundary is wasted work but never a wrong answer.
 *
 * This writes `role` straight to the renderer rather than going through
 * `diffCustomProps`, which is only correct because `role` is in
 * `UNIVERSAL_PROPS` — the built-in filter there would otherwise drop it for the
 * div aliases these types compile to. Any prop added here needs the same check.
 */
function resyncContextDependentRoles(container: Container, instance: Instance): void {
  const pending: HostNode[] = [...stateFor(instance).children]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    if (!("type" in node)) continue

    const state = stateFor(node)
    if (state.mounted && CONTEXT_DEPENDENT_ROLE_TYPES.has(node.type)) {
      const role = nativeRole(node.type, node.props, node)
      container.renderer.setCustomProp(
        node.id,
        "role",
        role === undefined ? null : serializeCustomProp(node.type, "role", role)
      )
    }
    pending.push(...state.children)
  }
}

/** `<a href>` is a link; `<a>` alone is generic, which needs no role at all. */
function nativeAnchorRole(props: Props): "link" | undefined {
  const { href } = props as Props & { href?: unknown }
  return typeof href === "string" ? "link" : undefined
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

function customPropEntries(
  instance: Instance,
  props: Props
): Array<[string, CustomPropInput]> {
  const { type } = instance
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
  const role = nativeRole(type, props, instance)
  if (role !== undefined) entries.push(["role", role])
  const headingLevel = nativeHeadingLevel(type, props)
  if (headingLevel !== undefined) entries.push(["ariaLevel", headingLevel])
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
  instance: Instance,
  props: Props
): void {
  const { id, type } = instance
  const builtIn = BUILT_IN_TYPES.has(type)
  for (const [key, value] of customPropEntries(instance, props)) {
    if (isReservedProp(key)) continue
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isIdentityProp(key)) continue
    renderer.setCustomProp(id, key, serializeCustomProp(type, key, value))
  }
}

/** Diff and send changed custom props to Rust. */
function diffCustomProps(
  renderer: MutationRenderer,
  instance: Instance,
  oldProps: Props,
  newProps: Props
): void {
  const { id, type } = instance
  const builtIn = BUILT_IN_TYPES.has(type)
  const oldEntries = customPropEntries(instance, oldProps)
  const newEntries = customPropEntries(instance, newProps)
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
 * WebIDL folds every `unsigned long` argument through `ToUint32`, which is what
 * `x >>> 0` spells: `setSelectionRange(-1, -1)` really does mean "both ends at
 * 4294967295", clamped to the end of the value by the time it lands.
 */
function selectionOffset(value: number): number {
  return value >>> 0
}

/**
 * Install the text-editing members of `HTMLInputElement` on an `<input>` or
 * `<textarea>` ref. They are accessors, not plain fields, because every read
 * has to reach the native editor: the caret moves on keystrokes and pointer
 * drags that React never sees.
 */
function installTextEditingMembers(
  instance: Instance,
  container: Container,
  id: number
): void {
  // Before the first frame builds an editor the native side has no state to
  // report, so fall back to the `value` prop with the caret at its end — where
  // the editor puts the caret when it is finally created.
  const readValue = (): string => {
    const native = container.native
    const value = native.getInputValue ? native.getInputValue(id) : null
    if (typeof value === "string") return value
    const prop = (instance.props as Props & { value?: unknown }).value
    return typeof prop === "string" ? prop : ""
  }
  const readSelection = (): readonly number[] => {
    const native = container.native
    const range = native.getInputSelection ? native.getInputSelection(id) : null
    if (range) return range
    const end = readValue().length
    return [end, end, 0]
  }
  const setSelection = (start: number, end: number, backward: boolean): void => {
    container.native.setInputSelection?.(id, start, end, backward)
  }

  // Non-enumerable and configurable, matching the prototype accessors these
  // mirror on a real `HTMLInputElement`. Every read crosses to native and
  // forces a draw, so an enumerable own property would make an incidental
  // spread, `Object.keys()`, or deep-equal over a ref cost four of them.
  const nativeAccessor = (
    descriptor: PropertyDescriptor
  ): PropertyDescriptor & ThisType<undefined> => ({
    enumerable: false,
    configurable: true,
    ...descriptor,
  })

  Object.defineProperties(instance, {
    value: nativeAccessor({
      get: readValue,
      set: (value: unknown) => {
        container.native.setInputValue?.(id, value == null ? "" : String(value))
      },
    }),
    selectionStart: nativeAccessor({
      get: () => readSelection()[0]!,
      // The DOM's setter drags `selectionEnd` along rather than letting the
      // start overtake it. One read covers both the end and the direction.
      set: (value: number) => {
        const start = selectionOffset(value)
        const current = readSelection()
        setSelection(start, Math.max(current[1]!, start), current[2] === 1)
      },
    }),
    selectionEnd: nativeAccessor({
      get: () => readSelection()[1]!,
      set: (value: number) => {
        const current = readSelection()
        setSelection(current[0]!, selectionOffset(value), current[2] === 1)
      },
    }),
    selectionDirection: nativeAccessor({
      get: (): "forward" | "backward" =>
        readSelection()[2] === 1 ? "backward" : "forward",
    }),
  })

  instance.setSelectionRange = (
    start: number,
    end: number,
    direction?: SelectionDirection
  ): void => {
    setSelection(selectionOffset(start), selectionOffset(end), direction === "backward")
  }
  // `select()` is "set the selection range with 0 and infinity", which lands on
  // the end of the value once the native side clamps it.
  instance.select = (): void => setSelection(0, readValue().length, false)
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
    syncCustomProps(renderer, node, node.props)
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
    // [scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight].
    // An element that is not a scroll container still has a viewport in the DOM,
    // and content that cannot scroll makes its scroll extent equal to that viewport.
    const scrollMetrics = (): readonly number[] => {
      const native = rootContainerInstance.native
      const getScrollMetrics = native.getScrollMetrics
      const metrics = getScrollMetrics ? getScrollMetrics.call(native, id) : null
      if (metrics) return metrics
      const getElementBounds = native.getElementBounds
      const bounds = getElementBounds ? getElementBounds.call(native, id) : null
      const width = bounds?.[2] ?? 0
      const height = bounds?.[3] ?? 0
      return [0, 0, width, height, width, height]
    }
    const scrollToOffset = (left: number, top: number): void => {
      // gpui stores how far the content moved up/left; the DOM reports how far
      // the viewport moved down/right. Subtracting rather than negating keeps a
      // reset at 0 instead of -0. Clamping stays native.
      rootContainerInstance.native.scrollTo?.(id, 0 - left, 0 - top)
    }
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
      get scrollLeft(): number {
        return scrollMetrics()[0]!
      },
      set scrollLeft(value: number) {
        scrollToOffset(value, scrollMetrics()[1]!)
      },
      get scrollTop(): number {
        return scrollMetrics()[1]!
      },
      set scrollTop(value: number) {
        scrollToOffset(scrollMetrics()[0]!, value)
      },
      get scrollWidth(): number {
        return scrollMetrics()[2]!
      },
      get scrollHeight(): number {
        return scrollMetrics()[3]!
      },
      get clientWidth(): number {
        return scrollMetrics()[4]!
      },
      get clientHeight(): number {
        return scrollMetrics()[5]!
      },
      scrollTo: (optionsOrX?: ScrollToOptions | number, y?: number) => {
        const metrics = scrollMetrics()
        const left =
          typeof optionsOrX === "number" ? optionsOrX : (optionsOrX?.left ?? metrics[0]!)
        const top =
          typeof optionsOrX === "number" ? (y ?? metrics[1]!) : (optionsOrX?.top ?? metrics[1]!)
        scrollToOffset(left, top)
      },
      scrollIntoView: (options?: boolean | ScrollIntoViewOptions) =>
        rootContainerInstance.native.scrollElementIntoView?.(
          id,
          scrollIntoViewAlignsToTop(instance, rootContainerInstance, props, options)
        ),
      getBounds: () => {
        const getElementBounds = rootContainerInstance.native.getElementBounds
        if (!getElementBounds) {
          throw new Error("This GPUIX renderer does not support element measurement")
        }
        const bounds = getElementBounds.call(rootContainerInstance.native, id)
        if (!bounds) return null
        return { x: bounds[0]!, y: bounds[1]!, width: bounds[2]!, height: bounds[3]! }
      },
      getBoundingClientRect: () => {
        // The DOM reports an all-zero rect for an element with no boxes rather
        // than nothing at all, so an unpainted element does the same here.
        const bounds = instance.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
        return {
          ...bounds,
          top: bounds.y,
          right: bounds.x + bounds.width,
          bottom: bounds.y + bounds.height,
          left: bounds.x,
        }
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
      // Reports why there is no data URL and returns nothing. Under
      // `strictStyles` the diagnostic throws instead of returning.
      instance.toDataURL = (): undefined => {
        diagnoseUnsupportedCanvasElementMember(instance, diagnosticTarget, "toDataURL")
        return undefined
      }
    }
    if (TEXT_EDITING_TYPES.has(type)) {
      installTextEditingMembers(instance, rootContainerInstance, id)
    }
    hostNodeStates.set(instance, {
      container: rootContainerInstance,
      children: [],
      mounted: false,
      parent: null,
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
    // Attach before materializing. Materializing sends the child's props, and a
    // context-dependent implicit role reads the ancestors this call installs;
    // resolving it first computes the role against no parent at all.
    appendTrackedChild(parent, parentState, child)
    materialize(child)
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
    // Attach before materializing, for the reason `appendChild` explains.
    insertTrackedChild(parent, parentState, child, beforeChild)
    materialize(child)
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
      parent: null,
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
    diffCustomProps(container.renderer, instance, oldProps, newProps)
    instance.props = newProps
    // After the new props are installed, so the descendants' ancestor walk
    // reads the role this update just applied.
    if (
      oldProps.role !== newProps.role &&
      (isContextSensitiveRoleSource(oldProps.role) || isContextSensitiveRoleSource(newProps.role))
    ) {
      resyncContextDependentRoles(container, instance)
    }
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
    stateFor(child).parent = null
    materialize(child)
    container.renderer.setRoot(child.id)
  },

  appendInitialChild(parent: Instance, child: Instance | TextInstance): void {
    stateFor(parent).children.push(child)
    child.parentId = parent.id
    stateFor(child).parent = parent
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
