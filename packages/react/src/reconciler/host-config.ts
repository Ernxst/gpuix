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
  ElementBounds,
  ElementRect,
  ElementType,
  FormProps,
  FormPublicInstance,
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
} from "./event-handlers.js"
import type { GpuixSyntheticEvent } from "./synthetic-event.js"
import { editorPropText, isTextEditingInstance, TEXT_EDITING_TYPES } from "./text-editing.js"
import { clickElement, dispatchElementEvent } from "./event-registry.js"
import {
  attributeInputValue,
  checkFormValidity,
  commitWriter,
  formOwner,
  inputKind,
  isRangeInput,
  mountChoice,
  mountRange,
  readChecked,
  readDefaultChecked,
  readIndeterminate,
  readRangeValue,
  requestSubmit,
  resetForm,
  setCustomValidity,
  updateChoice,
  updateRange,
  validationMessage,
  validityOf,
  willValidate,
  writeChecked,
  writeDefaultChecked,
  writeIndeterminate,
  writeRangeValue,
} from "./form-controls.js"
import {
  ARIA_PROP_ALIASES,
  ATTRIBUTE_PROP_ALIASES,
  AUTHORED_HOST_TYPE_PROP,
  AUTHORED_ROLE_PROP,
  isAuthorVisibleProp,
} from "./aria-props.js"
import {
  DEFAULT_VIRTUAL_LIST_ESTIMATED_ITEM_HEIGHT,
  VirtualListRowContractError,
} from "../components/virtual-list-contract.js"
import {
  diagnoseUnsupportedCanvasElementMember,
  disposeRecordingContext2D,
  getOrCreateRecordingContext2D,
  recordingContext2D,
  resetRecordingContext2D,
} from "../canvas/context-2d.js"
import {
  disposeWebGpuContext,
  getOrCreateWebGpuContext,
  webGpuContext,
} from "../canvas/webgpu.js"
import { reportStyleDiagnostics } from "./renderer-diagnostics.js"
import type { GpuixDispatchableEvent } from "../pointer-event.js"
import {
  DOCUMENT_POSITION_CONTAINED_BY,
  DOCUMENT_POSITION_CONTAINS,
  DOCUMENT_POSITION_DISCONNECTED,
  DOCUMENT_POSITION_FOLLOWING,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC,
  DOCUMENT_POSITION_PRECEDING,
} from "../dom-position.js"
import { ownerDocument } from "../document.js"
import { moveAnnouncerRegionsToRoot } from "../announce.js"

let currentUpdatePriority = NoEventPriority

type HostNode = Instance | TextInstance

const HOST_NODE_REGISTRY_KEY = "__gpuixHostNodeRegistry"

interface HostNodeState {
  container: Container
  children: HostNode[]
  mounted: boolean
  // HTML-AAM gives `<header>`, `<footer>` and `<li>` a role that depends on
  // which element contains them, so the implicit role needs the parent node,
  // not just the parent id.
  parent: Instance | null
}

type HostNodeRegistry = {
  hostNodeStates: WeakMap<HostNode, HostNodeState>
  publicInstanceContainers: WeakMap<PublicInstance, Container>
  disconnectedRootOrder: WeakMap<HostNode, number>
  nextDisconnectedRootOrder: number
}

function hostNodeRegistry(): HostNodeRegistry {
  // `render()` keeps its native host and React root on globalThis so bun --hot
  // can remount in place. Public instances outlive a module evaluation too:
  // globals installed by an earlier evaluation can receive refs created by a
  // later one, so their ownership and tree-position state share that lifetime.
  const existing = Reflect.get(globalThis, HOST_NODE_REGISTRY_KEY) as HostNodeRegistry | undefined
  if (existing) return existing

  const created: HostNodeRegistry = {
    hostNodeStates: new WeakMap(),
    publicInstanceContainers: new WeakMap(),
    disconnectedRootOrder: new WeakMap(),
    nextDisconnectedRootOrder: 0,
  }
  Reflect.set(globalThis, HOST_NODE_REGISTRY_KEY, created)
  return created
}

const sharedHostNodes = hostNodeRegistry()
const { hostNodeStates, publicInstanceContainers } = sharedHostNodes
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

export function containerForPublicInstance(instance: PublicInstance): Container | undefined {
  return publicInstanceContainers.get(instance)
}

/**
 * The authored host type of a GPUIX host element, or `null` for anything the
 * reconciler did not create. The `@gpuix/react/globals` element constructors
 * brand `instanceof` with this. It reads the shared registry, so constructors
 * installed by an earlier module evaluation still recognise later refs.
 */
export function hostElementType(value: unknown): ElementType | null {
  if (typeof value !== "object" || value === null) return null
  if (!hostNodeStates.has(value as HostNode) || !("type" in value)) return null
  return (value as Instance).type
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

/** This node and every ancestor up to (and including) its root, root first. */
function ancestorChain(node: HostNode): HostNode[] {
  const chain: HostNode[] = []
  let current: HostNode | null = node
  while (current !== null) {
    chain.unshift(current)
    current = stateFor(current).parent
  }
  return chain
}

function markUnmounted(node: HostNode): void {
  const state = stateFor(node)
  state.mounted = false
  for (const child of state.children) markUnmounted(child)
}

// A removed subtree keeps its internal parent links in the DOM. Here every node
// of an unmounted subtree reports no parent, so `parentElement` never names an
// element that `contains()` would deny holds it.
function parentElement(node: Instance): Instance | null {
  const state = stateFor(node)
  return state.mounted ? state.parent : null
}

function contains(self: HostNode, other: unknown): boolean {
  if (!hostNodeStates.has(other as HostNode)) return false

  let current: HostNode | null = other as HostNode
  while (current !== null) {
    const state = stateFor(current)
    if (!state.mounted) return false
    if (current === self) return stateFor(self).mounted
    current = state.parent
  }
  return false
}

function attributeProp(props: Props, name: string): unknown {
  const lowered = name.toLowerCase()
  const alias = Object.hasOwn(ARIA_PROP_ALIASES, lowered)
    ? ARIA_PROP_ALIASES[lowered as keyof typeof ARIA_PROP_ALIASES]
    : Object.hasOwn(ATTRIBUTE_PROP_ALIASES, lowered)
      ? ATTRIBUTE_PROP_ALIASES[lowered as keyof typeof ATTRIBUTE_PROP_ALIASES]
      : undefined
  if (alias !== undefined && Object.hasOwn(props, alias)) {
    return (props as Props & Record<string, unknown>)[alias]
  }

  const key = Object.keys(props).find((candidate) => candidate.toLowerCase() === lowered)
  return key === undefined ? undefined : (props as Props & Record<string, unknown>)[key]
}

// Disconnected roots need a stable pick between them. Element ids are not it:
// each renderer gets its own id allocator (`idAllocatorFor`), starting back
// at 1, so two different roots routinely share ids. First-seen order across
// roots is unique by construction and never collides.
function orderForDisconnectedRoot(root: HostNode): number {
  let order = sharedHostNodes.disconnectedRootOrder.get(root)
  if (order === undefined) {
    order = sharedHostNodes.nextDisconnectedRootOrder++
    sharedHostNodes.disconnectedRootOrder.set(root, order)
  }
  return order
}

function describeInvalidCompareDocumentPositionArgument(value: unknown): string {
  if (value === null) return "null"
  if (typeof value !== "object") return `a ${typeof value}`
  return "an object this renderer never created"
}

/**
 * `Node.compareDocumentPosition()` over the JS-side tree position tracked in
 * {@link hostNodeStates}, since these instances have no real DOM node to ask.
 *
 * Two nodes with different roots are disconnected; the ordering picked for
 * them is arbitrary but stable within a process, matching the DOM's guarantee
 * that disconnected nodes still compare consistently. Several top-level
 * children share the renderer-owned root after promotion, so they retain a
 * common ancestor and their document order is observable like DOM siblings.
 */
function compareDocumentPosition(self: HostNode, other: HostNode): number {
  if (!hostNodeStates.has(other)) {
    throw new TypeError(
      `compareDocumentPosition expects a GPUIX PublicInstance obtained from a ref or ` +
        `the render tree, received ${describeInvalidCompareDocumentPositionArgument(other)}.`
    )
  }
  if (self === other) return 0

  const selfChain = ancestorChain(self)
  const otherChain = ancestorChain(other)
  if (selfChain[0] !== otherChain[0]) {
    const otherPrecedes =
      orderForDisconnectedRoot(otherChain[0]!) < orderForDisconnectedRoot(selfChain[0]!)
    return (
      DOCUMENT_POSITION_DISCONNECTED |
      DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC |
      (otherPrecedes ? DOCUMENT_POSITION_PRECEDING : DOCUMENT_POSITION_FOLLOWING)
    )
  }

  let depth = 0
  while (
    depth < selfChain.length &&
    depth < otherChain.length &&
    selfChain[depth] === otherChain[depth]
  ) {
    depth++
  }
  // selfChain fully consumed as a common prefix of otherChain means self is
  // one of other's ancestors, so `other` (the argument) is self's descendant.
  if (depth === selfChain.length) {
    return DOCUMENT_POSITION_CONTAINED_BY | DOCUMENT_POSITION_FOLLOWING
  }
  // Symmetrically, `other` is self's ancestor.
  if (depth === otherChain.length) return DOCUMENT_POSITION_CONTAINS | DOCUMENT_POSITION_PRECEDING

  const commonAncestor = selfChain[depth - 1]!
  const siblings = stateFor(commonAncestor).children
  const selfBranchIndex = siblings.indexOf(selfChain[depth]!)
  const otherBranchIndex = siblings.indexOf(otherChain[depth]!)
  // self's branch coming first in the common ancestor's children means self
  // precedes other, so other follows self.
  return selfBranchIndex < otherBranchIndex
    ? DOCUMENT_POSITION_FOLLOWING
    : DOCUMENT_POSITION_PRECEDING
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
  ["onLoadCapture", "load", "capture"],
  ["onLoad", "load", "bubble"],
  ["onErrorCapture", "error", "capture"],
  ["onError", "error", "bubble"],
  ["onChangeCapture", "change", "capture"],
  ["onChange", "change", "bubble"],
  // Form events, synthesized in JS by `requestSubmit()` and `reset()`
  ["onSubmitCapture", "submit", "capture"],
  ["onSubmit", "submit", "bubble"],
  ["onResetCapture", "reset", "capture"],
  ["onReset", "reset", "bubble"],
  ["onMotionComplete", "motionComplete", "bubble"],
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
  // Pointer events. Pointer enter/leave follow React's direct transition
  // handlers and deliberately have no capture variants.
  ["onPointerDownCapture", "pointerDown", "capture"],
  ["onPointerDown", "pointerDown", "bubble"],
  ["onPointerUpCapture", "pointerUp", "capture"],
  ["onPointerUp", "pointerUp", "bubble"],
  ["onPointerMoveCapture", "pointerMove", "capture"],
  ["onPointerMove", "pointerMove", "bubble"],
  ["onPointerCancelCapture", "pointerCancel", "capture"],
  ["onPointerCancel", "pointerCancel", "bubble"],
  ["onPointerEnter", "pointerEnter", "bubble"],
  ["onPointerLeave", "pointerLeave", "bubble"],
  // OS file drag events. Native `fileDrop` fans out to the legacy raw
  // handler and the synthetic bubbling `drop` handler, so their registry keys
  // must remain distinct.
  ["onDragEnterCapture", "dragEnter", "capture"],
  ["onDragEnter", "dragEnter", "bubble"],
  ["onDragOverCapture", "dragOver", "capture"],
  ["onDragOver", "dragOver", "bubble"],
  ["onDragLeaveCapture", "dragLeave", "capture"],
  ["onDragLeave", "dragLeave", "bubble"],
  ["onDropCapture", "drop", "capture", "dropCapture"],
  ["onDrop", "drop", "bubble", "drop"],
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
  // Finder / OS file drop
  ["onFileDrop", "fileDrop", "bubble", "fileDrop"],
] as const

const EVENT_PROP_NAMES = new Set<string>(EVENT_PROPS.map(([name]) => name))
/** Events that never come from native, so no native listener is registered for them. */
const JS_ONLY_EVENT_TYPES = new Set<string>(["submit", "reset"])
const NATIVE_EVENT_TYPES = new Set<string>(
  EVENT_PROPS.map(([, eventType]) => eventType).filter(
    (eventType) => !JS_ONLY_EVENT_TYPES.has(eventType)
  )
)
type EventProps = Props &
  Pick<FormProps, "onSubmit" | "onSubmitCapture" | "onReset" | "onResetCapture">

function eventHandlerKey(eventType: string, phase: "capture" | "bubble"): string {
  return phase === "capture" ? `${eventType}Capture` : eventType
}

function registryKey(
  eventType: string,
  phase: "capture" | "bubble" | undefined,
  override: string | undefined
): string {
  return override ?? eventHandlerKey(eventType, phase ?? "bubble")
}

function hasEventListener(props: Props, eventType: string): boolean {
  const eventProps = props as EventProps
  return EVENT_PROPS.some(
    ([propName, candidateType]) => candidateType === eventType && eventProps[propName] != null
  )
}

/**
 * Whether native must report this event for this element. Labels, checkboxes,
 * radios, and submit and reset buttons need their clicks without a listener,
 * since their activation behaviour runs in JS; a radio needs its key presses
 * for arrow navigation, and a range its key presses and assistive-technology
 * actions for stepping.
 */
function hasNativeEventListener(type: ElementType, props: Props, eventType: string): boolean {
  if (hasEventListener(props, eventType)) return true
  if (type === "label") return eventType === "click"
  if (type === "button") {
    const buttonType = (props as Props & { type?: unknown }).type
    return eventType === "click" && !(typeof buttonType === "string" && buttonType.toLowerCase() === "button")
  }
  if (type !== "input") return false
  const kind = inputKind(props)
  return (
    (eventType === "click" && (kind === "checkbox" || kind === "radio")) ||
    (eventType === "keyDown" && (kind === "radio" || kind === "range")) ||
    (eventType === "accessibilityAction" && kind === "range")
  )
}

function hasAnyEventListener(props: Props): boolean {
  const eventProps = props as Record<string, unknown>
  return Object.keys(props).some(
    (propName) => EVENT_PROP_NAMES.has(propName) && eventProps[propName] != null
  )
}

function syncEventListeners(
  container: Container,
  id: number,
  type: ElementType,
  props: Props
): void {
  const eventProps = props as EventProps
  for (const [propName, eventType, phase, override] of EVENT_PROPS) {
    const handler = eventProps[propName]
    if (handler) {
      // `propName` ranges over every entry in EVENT_PROPS here, so `handler`'s
      // inferred type is a union across every kind's handler signature — wider
      // than any single one accepts. EVENT_PROPS pairs each prop with the one
      // native `eventType` that ever reaches it, so the registry only ever
      // calls this handler with an event of the kind it was declared for.
      registerEventHandler(
        container.eventHandlers,
        id,
        registryKey(eventType, phase, override),
        handler as (event: GpuixSyntheticEvent) => void
      )
    }
  }
  for (const eventType of NATIVE_EVENT_TYPES) {
    if (hasNativeEventListener(type, props, eventType)) {
      container.renderer.setEventListener(id, eventType, true)
    }
  }
}

function diffEventListeners(
  container: Container,
  id: number,
  type: ElementType,
  oldProps: Props,
  newProps: Props
): void {
  const oldEventProps = oldProps as EventProps
  const newEventProps = newProps as EventProps
  for (const [propName, eventType, phase, override] of EVENT_PROPS) {
    const oldHandler = oldEventProps[propName]
    const newHandler = newEventProps[propName]
    const handlerKey = registryKey(eventType, phase, override)

    if (oldHandler && !newHandler) {
      unregisterEventHandler(container.eventHandlers, id, handlerKey)
    } else if (newHandler && newHandler !== oldHandler) {
      registerEventHandler(
        container.eventHandlers,
        id,
        handlerKey,
        newHandler as (event: GpuixSyntheticEvent) => void
      )
    }
  }

  for (const eventType of NATIVE_EVENT_TYPES) {
    const hadListener = hasNativeEventListener(type, oldProps, eventType)
    const hasListener = hasNativeEventListener(type, newProps, eventType)
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
  "abbr",
  "address",
  "b",
  "blockquote",
  "cite",
  "del",
  "dfn",
  "figure",
  "figcaption",
  "i",
  "ins",
  "mark",
  "menu",
  "pre",
  "s",
  "samp",
  "small",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "label",
  "form",
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
 * The `hidden` attribute as React DOM writes it: a boolean attribute, present
 * for any truthy value that is not a function or symbol.
 */
function hiddenAttribute(value: unknown): true | undefined {
  if (!value || typeof value === "function" || typeof value === "symbol") return undefined
  return true
}

/**
 * Apply the user-agent rule `[hidden] { display: none }` beneath the author's
 * style. Author styles outrank the user-agent stylesheet in a browser, so an
 * element whose own style sets `display` stays displayed there and here.
 */
function withHiddenDisplay(style: StyleDesc | undefined, props: Props): StyleDesc | undefined {
  if (hiddenAttribute(props.hidden) === undefined || style?.display !== undefined) return style
  return { ...style, display: "none" }
}

/**
 * Keep malformed whole-prop inputs out of the native JSON path. Field-level
 * validation remains native because it can report the specific style property.
 */
function styleForRenderer(instance: Instance, container: Container, props: Props): StyleDesc | undefined {
  return withHiddenDisplay(authoredStyle(instance, container, props), props)
}

function authoredStyle(instance: Instance, container: Container, props: Props): StyleDesc | undefined {
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
  const transition = style.transition
  if (style.transition == null) {
    return
  } else if (!supportsStyleTransitions(instance.type)) {
    message = `[gpuix] ${subject} does not support style.transition. ${support}`
  } else if (
    ELEMENT_INTERNAL_COLOR_TRANSITION_TYPES.has(instance.type) &&
    ((typeof transition === "string" && /(?:^|,)\s*color(?:\s|$)/.test(transition)) ||
      (typeof transition === "object" &&
        Array.isArray(transition.properties) &&
        transition.properties.includes("color")))
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
  AUTHORED_HOST_TYPE_PROP,
  "autoFocus",
  "tabIndex",
  "motion",
  "role",
  "ariaLabel",
  "ariaLabelledBy",
  "ariaDescription",
  "ariaDescribedBy",
  "ariaChecked",
  "ariaPressed",
  "ariaOrientation",
  "ariaReadOnly",
  "ariaRequired",
  "ariaInvalid",
  "ariaExpanded",
  "ariaCurrent",
  "ariaLive",
  "ariaAtomic",
  "ariaSelected",
  "ariaValueText",
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
  "ariaHasPopup",
  "ariaRoleDescription",
  "visuallyHidden",
  "disabled",
  // `highlight` is scoped by where it sits in the tree, so it has to reach a
  // plain `div`. Without it here, custom props are dropped for built-ins and
  // the prop silently never arrives in Rust.
  "highlight",
])

function isReservedProp(name: string): boolean {
  return RESERVED_PROPS.has(name) || EVENT_PROP_NAMES.has(name)
}

function serializeCustomProp(
  type: string,
  key: string,
  value: object | string | number | boolean | null | undefined
): string | object | number | boolean | null {
  if (value === undefined || typeof value === "function") return null
  // React libraries can use the renderer's numeric host ids for generated
  // relationships (Base UI does this for checkbox groups). ARIA reference
  // lists are strings at the native boundary, so preserve those ids as text.
  if (
    typeof value === "number" &&
    (key === "ariaLabelledBy" || key === "ariaDescribedBy")
  ) {
    return String(value)
  }
  if (
    key === "motion" &&
    typeof value === "object" &&
    value !== null &&
    "transition" in value &&
    typeof value.transition === "object" &&
    value.transition !== null &&
    "repeat" in value.transition &&
    value.transition.repeat === Number.POSITIVE_INFINITY
  ) {
    return {
      ...value,
      transition: { ...value.transition, repeat: "Infinity" },
    }
  }
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
type NativeImplicitRole = NonNullable<Props["role"]> | "abbr"

const IMPLICIT_ROLES: Readonly<Record<string, NativeImplicitRole>> = {
  a: "link",
  abbr: "abbr",
  address: "group",
  article: "article",
  aside: "complementary",
  blockquote: "blockquote",
  button: "button",
  del: "deletion",
  dfn: "term",
  figcaption: "caption",
  figure: "figure",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  li: "listitem",
  main: "main",
  mark: "mark",
  menu: "list",
  nav: "navigation",
  ol: "list",
  s: "deletion",
  // SVG-AAM gives a bare `<svg>` the graphics-document role.
  svg: "graphics-document",
  time: "time",
  ul: "list",
  ins: "insertion",
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
const LIST_OWNER_TYPES = new Set(["ul", "ol", "menu"])

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
  return (
    (typeof labelledBy === "string" && labelledBy.trim() !== "") ||
    (typeof labelledBy === "number" && Number.isFinite(labelledBy))
  )
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
): NativeImplicitRole | undefined {
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
  if (type === "input") return nativeInputRole(props)
  // HTML-AAM maps `<form>` to the `form` landmark only when it has a name.
  if (type === "form") return hasAuthoredName(props) ? "form" : undefined
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

/**
 * A checkbox or radio input takes its role from `type`. A text input's
 * `textbox` role is implicit in Rust, and a hidden input renders nothing.
 */
function nativeInputRole(props: Props): "checkbox" | "radio" | "slider" | undefined {
  const kind = inputKind(props)
  if (kind === "range") return "slider"
  return kind === "checkbox" || kind === "radio" ? kind : undefined
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

/** Authored `<input>` props that feed choice state instead of being forwarded. */
const CHOICE_STATE_PROPS = new Set(["checked", "defaultChecked", "indeterminate"])
const RANGE_STATE_PROPS = new Set(["value", "defaultValue"])

/** Authored `<input>` and `<textarea>` props that carry the field's text. */
const TEXT_VALUE_PROPS = new Set(["value", "defaultValue"])

function customPropEntries(
  instance: Instance,
  props: Props
): Array<[string, CustomPropInput]> {
  const { type } = instance
  const propEntries = Object.entries(props) as Array<[string, CustomPropInput]>
  const entries = propEntries.flatMap(([key, value]): Array<[string, CustomPropInput]> => {
    if (key === "activationKind" || key === "role" || key === "tabIndex") return []
    if (key === "hidden") return [[key, hiddenAttribute(value)]]
    // A choice input's state reaches Rust as the internal `checked` and
    // `indeterminate` props `form-controls.ts` writes, never as authored.
    if (type === "input" && CHOICE_STATE_PROPS.has(key)) return []
    // So does a range's sanitized value, as the internal `value` prop.
    if (type === "input" && RANGE_STATE_PROPS.has(key) && inputKind(props) === "range") return []
    // The native editor holds text, so it receives the text React DOM would
    // put in the field: `value={5}` arrives as "5".
    if (TEXT_EDITING_TYPES.has(type) && TEXT_VALUE_PROPS.has(key)) {
      return [[key, editorPropText(value) ?? value]]
    }
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
  // `role` above is the *resolved* role the accessibility projection needs, so
  // an `<img>` carries one with nothing declared. The DOM has no attribute for
  // that, so the authored role is retained beside it, and it is the one a query
  // for the `role` attribute answers with.
  if (typeof props.role === "string") entries.push([AUTHORED_ROLE_PROP, props.role])
  if (type === "label" || type === "button" || type === "form") {
    entries.push([AUTHORED_HOST_TYPE_PROP, type])
  }
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
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isAuthorVisibleProp(key)) continue
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
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isAuthorVisibleProp(key)) continue
    const oldValue = oldEntries.find(([oldKey]) => oldKey === key)?.[1]
    if (oldValue !== value) {
      renderer.setCustomProp(id, key, serializeCustomProp(type, key, value))
    }
  }
  // Removed props
  for (const [key] of oldEntries) {
    if (isReservedProp(key)) continue
    if (builtIn && !UNIVERSAL_PROPS.has(key) && !isAuthorVisibleProp(key)) continue
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
 * Shared prototype for every host instance `createInstance` produces. All
 * per-element state — id, type, props, and the container that owns the
 * native element — lives in instance fields; the members that read and write
 * through them are defined once here and reached through the prototype
 * chain, the way `Element.prototype` backs every DOM element instead of each
 * node carrying its own copy.
 *
 * `#container` stays a private field rather than an own enumerable property:
 * nothing outside this hierarchy needs it, and `Object.keys()` / a spread
 * over a ref must not walk into it. Subclasses reach it only through the
 * module-scoped `containerOf`, which is what lets element kinds with extra
 * members (canvas, text-editing, form controls) extend this class instead of
 * re-closing over the same state. A getter would put a `container` member on
 * every ref, which DOM elements do not have.
 */
let containerOf: (element: HostElement) => Container

class HostElement implements Instance {
  readonly id: number
  readonly type: ElementType
  props: Props
  parentId: number | null = null
  readonly tagName: string
  readonly localName: string
  readonly nodeName: string
  readonly #container: Container

  constructor(id: number, type: ElementType, props: Props, container: Container) {
    this.id = id
    this.type = type
    this.props = props
    this.tagName = type.toUpperCase()
    this.localName = type
    this.nodeName = type.toUpperCase()
    this.#container = container
  }

  static {
    containerOf = (element) => element.#container
  }

  // [scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight].
  // An element that is not a scroll container still has a viewport in the DOM,
  // and content that cannot scroll makes its scroll extent equal to that viewport.
  #scrollMetrics(): readonly number[] {
    const native = this.#container.native
    const getScrollMetrics = native.getScrollMetrics
    const metrics = getScrollMetrics ? getScrollMetrics.call(native, this.id) : null
    if (metrics) return metrics
    const getElementBounds = native.getElementBounds
    const bounds = getElementBounds ? getElementBounds.call(native, this.id) : null
    const width = bounds?.width ?? 0
    const height = bounds?.height ?? 0
    return [0, 0, width, height, width, height]
  }

  // gpui stores how far the content moved up/left; the DOM reports how far
  // the viewport moved down/right. Subtracting rather than negating keeps a
  // reset at 0 instead of -0. Clamping stays native.
  #scrollToOffset(left: number, top: number): void {
    this.#container.native.scrollTo?.(this.id, 0 - left, 0 - top)
  }

  get parentElement(): Instance | null {
    return parentElement(this)
  }

  get ownerDocument() {
    return ownerDocument()
  }

  focus(options?: FocusOptions): void {
    // A disabled form control cannot take focus, as in the DOM.
    const formControl = this.type === "input" || this.type === "textarea" || this.type === "button"
    const { disabled } = this.props
    if (formControl && (disabled === true || typeof disabled === "string")) return
    this.#container.native.focusElement?.(this.id, options?.preventScroll === true)
  }

  blur(): void {
    // Only this element's own focus is ours to drop. A renderer that cannot
    // report the active element cannot prove that, so it does nothing
    // rather than blurring whatever happens to be focused.
    const native = this.#container.native
    if (!native.getActiveElement || native.getActiveElement() !== this.id) return
    native.blur?.()
  }

  setPointerCapture(): void {
    this.#container.native.setPointerCapture?.(this.id)
  }

  releasePointerCapture(): void {
    this.#container.native.releasePointerCapture?.(this.id)
  }

  click(): void {
    clickElement(this.#container, this)
  }

  dispatchEvent(event: GpuixDispatchableEvent): boolean {
    return dispatchElementEvent(this.#container, this, event)
  }

  get scrollLeft(): number {
    return this.#scrollMetrics()[0]!
  }

  set scrollLeft(value: number) {
    this.#scrollToOffset(value, this.#scrollMetrics()[1]!)
  }

  get scrollTop(): number {
    return this.#scrollMetrics()[1]!
  }

  set scrollTop(value: number) {
    this.#scrollToOffset(this.#scrollMetrics()[0]!, value)
  }

  get scrollWidth(): number {
    return this.#scrollMetrics()[2]!
  }

  get scrollHeight(): number {
    return this.#scrollMetrics()[3]!
  }

  get clientWidth(): number {
    return this.#scrollMetrics()[4]!
  }

  get clientHeight(): number {
    return this.#scrollMetrics()[5]!
  }

  scrollTo(optionsOrX?: ScrollToOptions | number, y?: number): void {
    const metrics = this.#scrollMetrics()
    const left = typeof optionsOrX === "number" ? optionsOrX : (optionsOrX?.left ?? metrics[0]!)
    const top =
      typeof optionsOrX === "number" ? (y ?? metrics[1]!) : (optionsOrX?.top ?? metrics[1]!)
    this.#scrollToOffset(left, top)
  }

  scrollIntoView(options?: boolean | ScrollIntoViewOptions): void {
    this.#container.native.scrollElementIntoView?.(
      this.id,
      scrollIntoViewAlignsToTop(this, this.#container, this.props, options)
    )
  }

  getBounds(): ElementBounds | null {
    const getElementBounds = this.#container.native.getElementBounds
    if (!getElementBounds) {
      throw new Error("This GPUIX renderer does not support element measurement")
    }
    const bounds = getElementBounds.call(this.#container.native, this.id)
    if (!bounds) return null
    return bounds
  }

  getBoundingClientRect(): ElementRect {
    // The DOM reports an all-zero rect for an element with no boxes rather
    // than nothing at all, so an unpainted element does the same here.
    const bounds = this.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
    return {
      ...bounds,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
      left: bounds.x,
    }
  }

  matches(selector: string): boolean {
    const normalized = selector.trim()
    if (
      normalized !== ":focus" &&
      normalized !== ":focus-visible" &&
      normalized !== ":hover" &&
      normalized !== ":active"
    ) {
      throw new SyntaxError(
        `Failed to execute 'matches' on 'Element': '${selector}' is not a supported selector. ` +
          "Supported: :focus, :focus-visible, :hover, :active."
      )
    }

    const state = this.#container.native.getElementInteractionState?.(this.id)
    if (!state) return false
    if (normalized === ":focus") return state.focused
    if (normalized === ":focus-visible") return state.focusVisible
    if (normalized === ":hover") return state.hovered
    return state.active
  }

  __applyCanvasCommands(
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void {
    if (this.type !== "canvas") {
      throw new TypeError(`Canvas commands can only target <canvas>, received <${this.type}>`)
    }
    const apply = this.#container.native.applyCanvasCommands
    if (!apply) {
      throw new Error("This GPUIX renderer does not support retained canvas commands")
    }
    apply.call(this.#container.native, this.id, ops, operands, strings)
    reportStyleDiagnostics(this.#container.native)
  }

  __applyCanvasCommandDelta(
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void {
    if (this.type !== "canvas") {
      throw new TypeError(`Canvas commands can only target <canvas>, received <${this.type}>`)
    }
    const apply = this.#container.native.applyCanvasCommandDelta
    if (!apply) {
      throw new Error("This GPUIX renderer does not support incremental canvas commands")
    }
    apply.call(this.#container.native, this.id, ops, operands, strings)
    reportStyleDiagnostics(this.#container.native)
  }

  compareDocumentPosition(other: PublicInstance): number {
    return compareDocumentPosition(this, other as unknown as HostNode)
  }

  contains(other: PublicInstance | null): boolean {
    return contains(this, other)
  }

  getAttribute(name: string): string | null {
    const lowered = name.toLowerCase()
    const authored = attributeProp(this.props, name)
    const value = lowered === "hidden" ? hiddenAttribute(authored) : authored
    if (value == null || typeof value === "function") return null
    if (lowered.startsWith("aria-") || lowered.startsWith("data-")) return String(value)
    if (value === false) return null
    if (value === true) return ""
    return typeof value === "string" || typeof value === "number" ? String(value) : null
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null
  }
}

/**
 * `<canvas>` refs. `getContext` and `toDataURL` only make sense for this one
 * element kind, so they live on a subclass rather than every host instance.
 */
class CanvasHostElement extends HostElement {
  #diagnosticTarget() {
    return {
      describeElement: () => describeCanvas(this),
      strict: containerOf(this).strictStyles,
      applyCanvasCommandDelta: (
        ops: Uint32Array,
        operands: Float64Array,
        strings: readonly string[]
      ) => this.__applyCanvasCommandDelta(ops, operands, strings),
    }
  }

  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings
  ): CanvasRenderingContext2D
  getContext(
    contextId: "webgpu",
    options?: unknown
  ): import("../canvas/webgpu.js").GPUCanvasContext | null
  getContext(contextId: string, options?: unknown): CanvasRenderingContext2D | null
  getContext(
    contextId: string
  ): CanvasRenderingContext2D | import("../canvas/webgpu.js").GPUCanvasContext | null {
    if (contextId === "2d") {
      if (webGpuContext(this)) return null
      return getOrCreateRecordingContext2D(this, this.#diagnosticTarget())
    }
    if (contextId === "webgpu") {
      if (recordingContext2D(this)) return null
      return getOrCreateWebGpuContext(this, containerOf(this).native, this.id, () => ({
        width: Number((this.props as Props & { width?: number }).width ?? 300),
        height: Number((this.props as Props & { height?: number }).height ?? 150),
      }))
    }
    return null
  }

  // Reports why there is no data URL and returns nothing. Under
  // `strictStyles` the diagnostic throws instead of returning.
  toDataURL(): undefined {
    diagnoseUnsupportedCanvasElementMember(this, this.#diagnosticTarget(), "toDataURL")
    return undefined
  }
}

/**
 * The text-editing members of `HTMLInputElement`, shared by `<input>` and
 * `<textarea>` refs. They are accessors, not plain fields, because every read
 * has to reach the native editor: the caret moves on keystrokes and pointer
 * drags that React never sees.
 */
class TextEditingHostElement extends HostElement {
  // Before the first frame builds an editor the native side has no state to
  // report, so fall back to the `value` prop with the caret at its end — where
  // the editor puts the caret when it is finally created.
  #readValue(): string {
    if (!isTextEditingInstance(this)) return attributeInputValue(this)
    const native = containerOf(this).native
    const value = native.getInputValue ? native.getInputValue(this.id) : null
    if (typeof value === "string") return value
    const editorProps = this.props as Props & { value?: unknown; defaultValue?: unknown }
    return editorPropText(editorProps.value ?? editorProps.defaultValue) ?? ""
  }

  #readSelection(): readonly number[] {
    const native = containerOf(this).native
    const range = native.getInputSelection ? native.getInputSelection(this.id) : null
    if (range) return range
    const end = this.#readValue().length
    return [end, end, 0]
  }

  #setSelection(start: number, end: number, backward: boolean): void {
    containerOf(this).native.setInputSelection?.(this.id, start, end, backward)
  }

  get value(): string {
    return this.#readValue()
  }

  set value(value: unknown) {
    if (isRangeInput(this)) {
      writeRangeValue(containerOf(this), this, value == null ? "" : String(value))
      return
    }
    // A checkbox, radio, or hidden input's value is its `value` prop.
    if (!isTextEditingInstance(this)) return
    containerOf(this).native.setInputValue?.(this.id, value == null ? "" : String(value))
  }

  get selectionStart(): number {
    return this.#readSelection()[0]!
  }

  // The DOM's setter drags `selectionEnd` along rather than letting the
  // start overtake it. One read covers both the end and the direction.
  set selectionStart(value: number) {
    const start = selectionOffset(value)
    const current = this.#readSelection()
    this.#setSelection(start, Math.max(current[1]!, start), current[2] === 1)
  }

  get selectionEnd(): number {
    return this.#readSelection()[1]!
  }

  set selectionEnd(value: number) {
    const current = this.#readSelection()
    this.#setSelection(current[0]!, selectionOffset(value), current[2] === 1)
  }

  get selectionDirection(): "forward" | "backward" {
    return this.#readSelection()[2] === 1 ? "backward" : "forward"
  }

  setSelectionRange(start: number, end: number, direction?: SelectionDirection): void {
    this.#setSelection(selectionOffset(start), selectionOffset(end), direction === "backward")
  }

  // `select()` is "set the selection range with 0 and infinity", which lands on
  // the end of the value once the native side clamps it.
  select(): void {
    this.#setSelection(0, this.#readValue().length, false)
  }
}

/**
 * The form-membership and validation members `<input>` and `<textarea>` share
 * — `HTMLInputElement.form`, `.validity`, `.validationMessage`,
 * `.willValidate`, `.checkValidity()`, and `.setCustomValidity()`. Like the
 * text-editing members they read state that changes without a React commit.
 */
class ValidatableTextEditingHostElement extends TextEditingHostElement {
  get form(): FormPublicInstance | null {
    return formOwner(containerOf(this), this) as FormPublicInstance | null
  }

  get validity(): ValidityState {
    return validityOf(containerOf(this), this)
  }

  get validationMessage(): string {
    return validationMessage(containerOf(this), this)
  }

  get willValidate(): boolean {
    return willValidate(this)
  }

  checkValidity(): boolean {
    return validityOf(containerOf(this), this).valid
  }

  setCustomValidity(message: string): void {
    setCustomValidity(this, String(message))
  }
}

/** `<input>` refs, adding the checkedness and range-value members on top of
 *  the text-editing and validation members every text-entry control shares. */
class InputHostElement extends ValidatableTextEditingHostElement {
  get checked(): boolean {
    return readChecked(this)
  }

  set checked(value: unknown) {
    writeChecked(containerOf(this), this, Boolean(value))
  }

  get defaultChecked(): boolean {
    return readDefaultChecked(this)
  }

  set defaultChecked(value: unknown) {
    writeDefaultChecked(containerOf(this), this, Boolean(value))
  }

  get indeterminate(): boolean {
    return readIndeterminate(this)
  }

  set indeterminate(value: unknown) {
    writeIndeterminate(containerOf(this), this, Boolean(value))
  }

  // Implemented for a range only, the one numeric type this renderer has.
  get valueAsNumber(): number | undefined {
    return isRangeInput(this) ? readRangeValue(this) : undefined
  }

  set valueAsNumber(value: unknown) {
    if (isRangeInput(this)) writeRangeValue(containerOf(this), this, Number(value))
  }
}

/** `<button>` refs, which carry only `HTMLButtonElement.form` beyond the
 *  members every host element has. */
class ButtonHostElement extends HostElement {
  get form(): FormPublicInstance | null {
    return formOwner(containerOf(this), this) as FormPublicInstance | null
  }
}

/** `<form>` refs, carrying the submission members of `HTMLFormElement`. */
class FormHostElement extends HostElement {
  requestSubmit(submitter?: PublicInstance | null): void {
    requestSubmit(containerOf(this), this, (submitter as Instance | null | undefined) ?? null)
  }

  reset(): void {
    resetForm(containerOf(this), this)
  }

  checkValidity(): boolean {
    return checkFormValidity(containerOf(this), this)
  }
}

/**
 * Pick the prototype for a host instance's authored type. One instance gets
 * exactly one of these — the union of members a `<textarea>` and a `<button>`
 * would both need never has to exist on either.
 */
function instantiateHostElement(
  id: number,
  type: ElementType,
  props: Props,
  container: Container
): Instance {
  switch (type) {
    case "canvas":
      return new CanvasHostElement(id, type, props, container)
    case "input":
      return new InputHostElement(id, type, props, container)
    case "textarea":
      return new ValidatableTextEditingHostElement(id, type, props, container)
    case "button":
      return new ButtonHostElement(id, type, props, container)
    case "form":
      return new FormHostElement(id, type, props, container)
    default:
      return new HostElement(id, type, props, container)
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
    syncEventListeners(state.container, node.id, node.type, node.props)
    syncCustomProps(renderer, node, node.props)
    mountChoice(state.container, node, commitWriter(state.container))
    mountRange(node, commitWriter(state.container))
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

function nativeType(instance: Instance): ElementType {
  return DIV_ALIASES.has(instance.type) ? "div" : instance.type
}

function clearAnnouncer(container: Container, destroyRegions: boolean): void {
  if (destroyRegions) {
    const regions = new Set<number>()
    for (const pair of Object.values(container.announcer)) {
      if (!pair) continue
      for (const id of pair.regionIds) regions.add(id)
    }
    for (const id of regions) container.renderer.destroyElement(id)
  }
  container.announcer.polite = null
  container.announcer.assertive = null
}

function clearContainerRoot(container: Container): void {
  const root = container.bodyElement
  if (root) {
    markUnmounted(root)
    const destroyed = container.renderer.destroyElement(root.id)
    for (const id of destroyed) {
      unregisterEventHandlers(container.eventHandlers, id)
      container.eventTargets.delete(id)
      container.preventedKeyboardActivations.delete(id)
      if (container.preventedDragOvers.has(id)) container.preventedDragOvers.clear()
    }
  }
  clearAnnouncer(container, false)
  container.bodyElement = null
  container.implicitRoot = null
  container.rootElementId = null
  container.rootElementType = null
}

function createImplicitRoot(container: Container): Instance {
  const root = instantiateHostElement(nextId(container), "div", {}, container)
  hostNodeStates.set(root, {
    container,
    children: [],
    mounted: true,
    parent: null,
  })
  publicInstanceContainers.set(root, container)
  container.renderer.createElement(root.id, "div")
  container.bodyElement = root
  container.implicitRoot = root
  container.rootElementId = root.id
  container.rootElementType = "div"
  return root
}

function setDirectContainerRoot(container: Container, child: Instance): void {
  child.parentId = null
  stateFor(child).parent = null
  materialize(child)
  container.renderer.setRoot(child.id)
  container.bodyElement = child
  container.implicitRoot = null
  container.rootElementId = child.id
  container.rootElementType = nativeType(child)
}

function placeInImplicitRoot(
  container: Container,
  root: Instance,
  child: Instance,
  beforeChild: Instance | null
): void {
  const state = stateFor(root)
  if (beforeChild) {
    insertTrackedChild(root, state, child, beforeChild)
  } else {
    appendTrackedChild(root, state, child)
  }
  materialize(child)
  if (beforeChild) {
    container.renderer.insertBefore(root.id, child.id, beforeChild.id)
  } else {
    container.renderer.appendChild(root.id, child.id)
  }
}

function promoteContainerRoot(
  container: Container,
  child: Instance,
  beforeChild: Instance | null
): void {
  const previousRoot = container.bodyElement
  if (!previousRoot) {
    setDirectContainerRoot(container, child)
    return
  }

  const root = createImplicitRoot(container)
  // A direct root owns any existing live regions. Move their current values
  // before reparenting that application root, so no stale pair remains below
  // it and the next alternating write keeps its existing cadence.
  moveAnnouncerRegionsToRoot(container, root.id)
  placeInImplicitRoot(container, root, previousRoot, null)
  placeInImplicitRoot(container, root, child, beforeChild)
  container.renderer.setRoot(root.id)
}

function placeInContainer(container: Container, child: Instance, beforeChild: Instance | null): void {
  const root = container.bodyElement
  if (!root) {
    setDirectContainerRoot(container, child)
    return
  }
  if (container.implicitRoot) {
    placeInImplicitRoot(container, container.implicitRoot, child, beforeChild)
    return
  }
  if (root === child) return
  promoteContainerRoot(container, child, beforeChild)
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
    if (hostContext?.isInsideText && type !== "text") {
      throw new InlineTextChildError(
        `GPUIX <text> can contain only strings and nested <text> elements; received <${type}>. ` +
          "Move block or custom content outside the flowing text node."
      )
    }
    const id = nextId(rootContainerInstance)
    const instance = instantiateHostElement(id, type, props, rootContainerInstance)
    hostNodeStates.set(instance, {
      container: rootContainerInstance,
      children: [],
      mounted: false,
      parent: null,
    })
    publicInstanceContainers.set(instance, rootContainerInstance)
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
    markUnmounted(child)
    scheduleVirtualListValidation(parent, parentState)
    const destroyed = parentState.container.renderer.destroyElement(child.id)
    for (const id of destroyed) {
      unregisterEventHandlers(parentState.container.eventHandlers, id)
      parentState.container.eventTargets.delete(id)
      parentState.container.preventedKeyboardActivations.delete(id)
      if (parentState.container.preventedDragOvers.has(id)) {
        parentState.container.preventedDragOvers.clear()
      }
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
    parent: Container,
    child: Instance,
    beforeChild: Instance
  ): void {
    placeInContainer(parent, child, beforeChild)
  },

  removeChildFromContainer(parent: Container, child: Instance): void {
    disposeRecordingContext2D(child)
    disposeWebGpuContext(child)
    const root = parent.bodyElement
    if (!root) return

    if (parent.implicitRoot) {
      removeTrackedChild(stateFor(parent.implicitRoot), child)
    }
    markUnmounted(child)
    const destroyed = parent.renderer.destroyElement(child.id)
    for (const id of destroyed) {
      unregisterEventHandlers(parent.eventHandlers, id)
      parent.eventTargets.delete(id)
      parent.preventedKeyboardActivations.delete(id)
      if (parent.preventedDragOvers.has(id)) {
        parent.preventedDragOvers.clear()
      }
    }
    if (parent.implicitRoot) {
      if (stateFor(parent.implicitRoot).children.length !== 0) return
      markUnmounted(parent.implicitRoot)
      parent.renderer.destroyElement(parent.implicitRoot.id)
      clearAnnouncer(parent, false)
      parent.bodyElement = null
      parent.implicitRoot = null
      parent.rootElementId = null
      parent.rootElementType = null
      return
    }
    if (root === child) {
      clearAnnouncer(parent, false)
      parent.bodyElement = null
      parent.rootElementId = null
      parent.rootElementType = null
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
    const oldCanvasProps = oldProps as Props & { width?: number; height?: number }
    const newCanvasProps = newProps as Props & { width?: number; height?: number }
    if (instance.type === "canvas" && (oldCanvasProps.width !== newCanvasProps.width || oldCanvasProps.height !== newCanvasProps.height)) {
      resetRecordingContext2D(instance)
      container.native.resetCanvas?.(instance.id)
    }
    diagnoseUnsupportedStyleTransition(instance, container, newProps)
    diagnoseUnsupportedClassNameProp(instance, container, newProps)
    diagnoseUnsupportedAccessibilityRoleProp(instance, container, newProps)
    diagnoseUnsupportedAriaProp(instance, container, newProps)
    diagnoseVisuallyHiddenProp(instance, container, newProps)
    // Always resend style — per-element JSON is small, and this avoids
    // bugs from same-reference mutations or style removal.
    container.renderer.setStyle(instance.id, styleForRenderer(instance, container, newProps) ?? {})
    if (
      hasAnyEventListener(oldProps) ||
      hasAnyEventListener(newProps) ||
      ((instance.type === "input" || instance.type === "button") &&
        (oldProps as { type?: unknown }).type !== (newProps as { type?: unknown }).type)
    ) {
      diffEventListeners(container, instance.id, instance.type, oldProps, newProps)
    }
    // Custom prop diff (for non-div/text elements)
    instance.props = newProps
    diffCustomProps(container.renderer, instance, oldProps, newProps)
    updateChoice(container, instance, oldProps, commitWriter(container))
    updateRange(instance, commitWriter(container))
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
    placeInContainer(container, child, null)
  },

  appendInitialChild(parent: Instance, child: Instance | TextInstance): void {
    stateFor(parent).children.push(child)
    child.parentId = parent.id
    stateFor(child).parent = parent
  },

  hideInstance(instance: Instance): void {
    // Keep the element's own style. `visibility: hidden` skips the paint and
    // keeps the layout box, so replacing the whole style here would collapse
    // the box and lose every other style on the element.
    //
    // Hover and active go, because a hidden element must stay hidden. A hover
    // style that sets `visibility` would otherwise paint an element React
    // asked to hide.
    const { hover: _hover, active: _active, ...base } =
      withHiddenDisplay(instance.props.style, instance.props) ?? {}
    rendererFor(instance).setStyle(instance.id, { ...base, visibility: "hidden" })
  },

  unhideInstance(instance: Instance, props: Props): void {
    rendererFor(instance).setStyle(instance.id, withHiddenDisplay(props.style, props) ?? {})
  },

  hideTextInstance(_textInstance: TextInstance): void {},
  unhideTextInstance(_textInstance: TextInstance, _text: string): void {},

  clearContainer(container: Container): void {
    clearContainerRoot(container)
  },

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
    disposeWebGpuContext(instance)
    const container = containerFor(instance)
    markUnmounted(instance)
    const destroyed = container.renderer.destroyElement(instance.id)
    for (const id of destroyed) {
      unregisterEventHandlers(container.eventHandlers, id)
      container.eventTargets.delete(id)
      container.preventedKeyboardActivations.delete(id)
      if (container.preventedDragOvers.has(id)) {
        container.preventedDragOvers.clear()
      }
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
