/// Host config for React's reconciler — mutation-based protocol.
///
/// Each reconciler callback (createInstance, appendChild, commitUpdate, etc.)
/// makes a direct napi call to the Rust retained tree. No JSON serialization
/// of the full element tree. Only changed elements cross the FFI boundary.

import { createContext } from "react"
import type { ReactContext } from "react-reconciler"
import { DefaultEventPriority } from "react-reconciler/constants.js"

const NoEventPriority = 0
import type {
  Container,
  ElementType,
  HostContext,
  Instance,
  NativeRenderer,
  Props,
  PublicInstance,
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
import { reportStyleDiagnostics } from "./batch-renderer.js"

let currentUpdatePriority = NoEventPriority

type HostNode = Instance | TextInstance

interface HostNodeState {
  container: Container
  children: HostNode[]
  mounted: boolean
}

const hostNodeStates = new WeakMap<HostNode, HostNodeState>()
const virtualListsPendingValidation = new WeakMap<Container, Set<Instance>>()

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

function rendererFor(node: HostNode): NativeRenderer {
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

function shouldValidateVirtualListRows(): boolean {
  return typeof process === "undefined" || process.env?.NODE_ENV !== "production"
}

function validateVirtualListRowContract(instance: Instance, state: HostNodeState): void {
  if (
    instance.type !== "virtual-list" ||
    !shouldValidateVirtualListRows() ||
    state.children.length !== 1 ||
    (instance.props as Props & VirtualListProps).itemCount === 1
  ) {
    return
  }

  throw new VirtualListRowContractError(
    "GPUIX <virtual-list> received exactly one immediate child. Its immediate children are rows, so wrapping a collection in one container creates one virtual row and defeats virtualization. Render rows as direct children. For windowed data, pass itemCount, windowStart, and estimatedItemHeight, then render that slice directly. Pass itemCount={1} only when the list intentionally contains one row."
  )
}

function scheduleVirtualListValidation(instance: Instance, state: HostNodeState): void {
  if (instance.type !== "virtual-list" || !shouldValidateVirtualListRows()) return

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
  ["onAuxClickCapture", "auxClick", "capture"],
  ["onAuxClick", "auxClick", "bubble"],
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

function sendStyle(renderer: NativeRenderer, id: number, props: Props): void {
  const style = props.style
  if (style == null || Object.keys(style).length === 0) return
  renderer.setStyle(id, style)
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
const STYLE_TRANSITION_TYPES = new Set(["div", "text", "img"])
const warnedUnsupportedStyleTransitions = new WeakSet<Instance>()

class UnsupportedStyleTransitionError extends Error {
  override name = "UnsupportedStyleTransitionError"
}

function supportsStyleTransitions(type: ElementType): boolean {
  return STYLE_TRANSITION_TYPES.has(type) || DIV_ALIASES.has(type)
}

function diagnoseUnsupportedStyleTransition(
  instance: Instance,
  container: Container,
  props: Props
): void {
  if (props.style?.transition == null || supportsStyleTransitions(instance.type)) return

  const identity = [
    props.testId === undefined ? undefined : `testId=${JSON.stringify(props.testId)}`,
    props["data-testid"] === undefined
      ? undefined
      : `data-testid=${JSON.stringify(props["data-testid"])}`,
    props.id === undefined ? undefined : `id=${JSON.stringify(props.id)}`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ")
  const subject = identity.length === 0 ? `<${instance.type}>` : `<${instance.type} ${identity}>`
  const message =
    `[gpuix] ${subject} does not support style.transition. ` +
    "Style transitions are available on <div>, <text>, and <img>."

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
  "hoverGroup",
  "role",
  "ariaLabel",
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

/** Preserve the browser's natural tab stop when an `<a href>` becomes a native div. */
function nativeTabIndex(type: string, props: Props): number | undefined {
  if (props.tabIndex !== undefined) return props.tabIndex
  const href = type === "a" ? (props as Props & { href?: unknown }).href : undefined
  return typeof href === "string" ? 0 : undefined
}

/** Keep the original anchor semantics after host aliases become native divs. */
function nativeActivationKind(type: string, props: Props): "anchor" | undefined {
  const href = (props as Props & { href?: unknown }).href
  return type === "a" || typeof href === "string" ? "anchor" : undefined
}

function customPropEntries(type: string, props: Props): Array<[string, CustomPropInput]> {
  const entries = (Object.entries(props) as Array<[string, CustomPropInput]>).filter(
    ([key]) => key !== "activationKind" && key !== "tabIndex"
  )
  const tabIndex = nativeTabIndex(type, props)
  if (tabIndex !== undefined) entries.push(["tabIndex", tabIndex])
  const activationKind = nativeActivationKind(type, props)
  if (activationKind) entries.push(["activationKind", activationKind])

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
  renderer: NativeRenderer,
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
  renderer: NativeRenderer,
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
    sendStyle(renderer, node.id, node.props)
    syncEventListeners(state.container, node.id, node.props)
    syncCustomProps(renderer, node.id, node.type, node.props)
  } else {
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
      setPointerCapture: () => rootContainerInstance.renderer.setPointerCapture?.(id),
      releasePointerCapture: () =>
        rootContainerInstance.renderer.releasePointerCapture?.(id),
      getBounds: () => {
        const getElementBounds = rootContainerInstance.renderer.getElementBounds
        if (!getElementBounds) {
          throw new Error("This GPUIX renderer does not support element measurement")
        }
        const bounds = getElementBounds.call(rootContainerInstance.renderer, id)
        if (!bounds) return null
        return { x: bounds[0]!, y: bounds[1]!, width: bounds[2]!, height: bounds[3]! }
      },
      __applyCanvasCommands: (ops, operands, strings) => {
        if (instance.type !== "canvas") {
          throw new TypeError(
            `Canvas commands can only target <canvas>, received <${instance.type}>`
          )
        }
        const apply = rootContainerInstance.renderer.applyCanvasCommands
        if (!apply) {
          throw new Error("This GPUIX renderer does not support retained canvas commands")
        }
        apply.call(rootContainerInstance.renderer, id, ops, operands, strings)
        reportStyleDiagnostics(rootContainerInstance.renderer)
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
    return instance
  },

  appendChild(parent: Instance, child: Instance | TextInstance): void {
    const parentState = materialize(parent)
    materialize(child)
    appendTrackedChild(parent, parentState, child)
    scheduleVirtualListValidation(parent, parentState)
    parentState.container.renderer.appendChild(parent.id, child.id)
  },

  removeChild(parent: Instance, child: Instance | TextInstance): void {
    const parentState = stateFor(parent)
    removeTrackedChild(parentState, child)
    scheduleVirtualListValidation(parent, parentState)
    parentState.container.renderer.removeChild(parent.id, child.id)
  },

  insertBefore(
    parent: Instance,
    child: Instance | TextInstance,
    beforeChild: Instance | TextInstance
  ): void {
    const parentState = materialize(parent)
    materialize(child)
    insertTrackedChild(parent, parentState, child, beforeChild)
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

  // Batch flush point: commitMutations() sends all queued mutations to Rust
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
    containerInfo.renderer.commitMutations()
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
    // Always resend style — per-element JSON is small, and this avoids
    // bugs from same-reference mutations or style removal.
    container.renderer.setStyle(instance.id, newProps.style ?? {})
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
  HostTransitionContext: createContext(null) as unknown as ReactContext<null>,
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
