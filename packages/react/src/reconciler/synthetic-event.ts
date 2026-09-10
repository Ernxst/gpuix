import type { EventModifiers, EventPayload } from "@gpuix/native"
import { createGpuixDataTransfer } from "./drop-files.js"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

export type GpuixEventPhase = 1 | 2 | 3

/**
 * GPUI key names that UI Events spells differently.
 *
 * The keys are the lowercase names GPUI platforms produce: macOS, Windows
 * (`menu` for the context-menu key), Linux (the XF86 editing and document
 * keys), and the browser platform, which lowercases every DOM name it does
 * not translate itself, so `ContextMenu` arrives as `contextmenu`.
 */
export const DOM_KEY_NAMES: Readonly<Record<string, string>> = {
  alt: "Alt",
  altgraph: "AltGraph",
  back: "BrowserBack",
  backspace: "Backspace",
  capslock: "CapsLock",
  clear: "Clear",
  compose: "Compose",
  contextmenu: "ContextMenu",
  control: "Control",
  copy: "Copy",
  cut: "Cut",
  dead: "Dead",
  delete: "Delete",
  down: "ArrowDown",
  end: "End",
  enter: "Enter",
  escape: "Escape",
  fn: "Fn",
  fnlock: "FnLock",
  forward: "BrowserForward",
  function: "Fn",
  help: "Help",
  home: "Home",
  insert: "Insert",
  left: "ArrowLeft",
  menu: "ContextMenu",
  new: "New",
  numlock: "NumLock",
  open: "Open",
  pagedown: "PageDown",
  pageup: "PageUp",
  paste: "Paste",
  platform: "Meta",
  print: "Print",
  printscreen: "PrintScreen",
  process: "Process",
  redo: "Redo",
  right: "ArrowRight",
  save: "Save",
  scrolllock: "ScrollLock",
  shift: "Shift",
  space: " ",
  tab: "Tab",
  undo: "Undo",
  unidentified: "Unidentified",
  up: "ArrowUp",
}

/** `keyChar` is the DOM key value when it holds one printable character. */
function printableKeyChar(keyChar: string | undefined): string | undefined {
  if (keyChar === undefined) return undefined
  if (Array.from(keyChar).length !== 1) return undefined

  const code = keyChar.codePointAt(0)!
  // C0 and C1 controls: "\n" for enter, "\t" for tab, and friends.
  const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f)
  return isControl ? undefined : keyChar
}

/**
 * The UI Events `key` value for a native keyboard payload.
 *
 * Named keys come from the table. Printable keys use `keyChar`, the character
 * the layout and modifiers actually produced, so `Shift+A` reads `"A"` and
 * `Shift+1` reads `"!"` as they do in a browser. GPUI's own key name remains
 * the fallback for modifier combinations that produce no character.
 */
export function domKeyName(
  key: string | undefined,
  keyChar?: string
): string | undefined {
  if (key === undefined) return undefined

  const gpuiKey = key.toLowerCase()
  const namedKey = DOM_KEY_NAMES[gpuiKey]
  if (namedKey !== undefined) return namedKey

  const functionKey = /^f([1-9]|[12]\d|3[0-5])$/.exec(gpuiKey)
  if (functionKey !== null) return `F${functionKey[1]}`

  return printableKeyChar(keyChar) ?? key
}

/**
 * The kind-agnostic members every GPUIX synthetic event carries, regardless
 * of which native payload produced it.
 *
 * `nativeEvent` is the escape hatch: the full, unmodified payload, for code
 * that needs a field this base type does not carry (or needs to read a
 * member without first narrowing `type`). `elementId` and `eventType` are
 * kept at the top level too, alongside `nativeEvent`: every kind's payload
 * has them, `eventType` is what `type` is derived from, and both are
 * required on `EventPayload` while everything else on it is optional — so
 * every per-kind event below remains structurally assignable to the raw
 * `EventPayload` type.
 *
 * No modifier keys, no pointer fields, no key fields: those belong to the
 * kinds that actually deliver them, below.
 */
export type GpuixEvent = {
  readonly nativeEvent: EventPayload
  readonly target: PublicInstance
  readonly currentTarget: PublicInstance
  readonly type: string
  readonly eventPhase: GpuixEventPhase
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly defaultPrevented: boolean

  preventDefault(): void
  stopPropagation(): void
  /**
   * Stop this event, including any listener still to run on the current
   * target, matching `Event.stopImmediatePropagation()`.
   *
   * `stopPropagation()` alone still lets the target's other listener run — a
   * `onClickCapture` and `onClick` pair on one element are both AT_TARGET
   * listeners, and the DOM runs both.
   */
  stopImmediatePropagation(): void
  isDefaultPrevented(): boolean
  isPropagationStopped(): boolean
  /** GPUIX events are never pooled, so persist is intentionally a no-op. */
  persist(): void

  readonly elementId: number
  readonly eventType: string
}

/** The mouse event types {@link EVENT_PROPS} declares in `host-config.ts`. */
export type GpuixMouseEventType =
  | "click"
  | "doubleClick"
  | "auxClick"
  | "contextMenu"
  | "mouseDown"
  | "mouseUp"
  | "mouseEnter"
  | "mouseLeave"
  | "mouseMove"
  | "mouseDownOutside"
  | "dragEnter"
  | "dragOver"
  | "dragLeave"
  | "drop"

/**
 * The pointer members {@link GpuixMouseEvent} and {@link GpuixWheelEvent}
 * both carry, parameterized over each kind's own `type` literal so a wheel
 * event's `type` can be `"wheel"` rather than a mouse event type.
 */
interface GpuixPointerEvent<Type extends string> extends GpuixEvent {
  readonly type: Type
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  /** Which mouse button: 0=left, 1=middle, 2=right. Defaults to 0. */
  readonly button: number
  /** Consecutive-click count (1=single, 2=double, 3=triple). */
  readonly detail: number
  /**
   * Pointer position in window coordinates, the DOM spelling of `x`.
   *
   * `clientX` and `pageX` hold the same number here. They differ in a browser
   * only by the document's own scroll offset, and this renderer has no
   * scrolling document — scroll containers are ordinary elements. `0` on
   * events that carry no pointer position.
   */
  readonly clientX: number
  /** Pointer position in window coordinates, the DOM spelling of `y`.
   *  See {@link clientX}. */
  readonly clientY: number
  /** Identical to {@link clientX}; see it for why. */
  readonly pageX: number
  /** Identical to {@link clientY}; see {@link clientX} for why. */
  readonly pageY: number
  /**
   * The other element in a two-element transition, matching
   * `MouseEvent.relatedTarget`: on `mouseEnter` the element the pointer left,
   * on `mouseLeave` the element it moved to. `null` when the pointer came from
   * or went to nothing outside the tree.
   */
  readonly relatedTarget: PublicInstance | null
  /** Route this pressed-pointer sequence to the original event target. */
  setPointerCapture(): void
  /** Stop routing this pressed-pointer sequence to the original event target. */
  releasePointerCapture(): void

  readonly x?: number
  readonly y?: number
  readonly clickCount?: number
  readonly isRightClick?: boolean
  readonly inputSource?: string
  readonly pressedButton?: number
  /** `true` = pointer entered the element, `false` = left it.
   *  Populated for `mouseEnter` and `mouseLeave`. */
  readonly hovered?: boolean
  readonly modifiers?: EventModifiers
}

/** A click, press, hover-transition, or context-menu event. */
export type GpuixMouseEvent = GpuixPointerEvent<GpuixMouseEventType>

export interface GpuixFile {
  readonly name: string
  readonly path: string
  readonly size: number
  readonly lastModified: number
  readonly type: string
}

export interface GpuixFileList extends ReadonlyArray<GpuixFile> {
  item(index: number): GpuixFile | null
}

export interface GpuixDataTransfer {
  readonly files: GpuixFileList
  readonly types: readonly string[]
  dropEffect: "none" | "copy" | "move" | "link"
  effectAllowed: string
  getData(): ""
}

export type GpuixDragEventType = "dragEnter" | "dragOver" | "dragLeave" | "drop"

/** An OS file drag event. File contents are exposed only by `drop`. */
export interface GpuixDragEvent extends GpuixMouseEvent {
  readonly type: GpuixDragEventType
  readonly dataTransfer: GpuixDataTransfer
}

/** A trackpad or wheel scroll gesture — bubbles, unlike `onScroll`. */
export interface GpuixWheelEvent extends GpuixPointerEvent<"wheel"> {
  /** DOM signs: positive scrolls the view right. */
  readonly deltaX: number
  /** DOM signs: positive scrolls the view down. */
  readonly deltaY: number
  /** GPUI currently supplies two-dimensional wheel input, so this is 0. */
  readonly deltaZ: number
  /** `0` = pixels, `1` = lines, `2` = pages. */
  readonly deltaMode: number
  /** `true` = pixel-precise (trackpad), `false` = line-based (mouse wheel). */
  readonly precise?: boolean
  /** Trackpad gesture phase: "started", "moved", "ended". */
  readonly touchPhase?: string
}

/** A key press or release delivered to the focused element. */
export interface GpuixKeyboardEvent extends GpuixEvent {
  readonly type: "keyDown" | "keyUp"
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly modifiers?: EventModifiers
  /** The UI Events `key` value. See {@link domKeyName}. */
  readonly key: string
  /** Whether this is a key-repeat event (key held down). */
  readonly repeat: boolean

  readonly keyChar?: string
  readonly isHeld?: boolean
}

/**
 * A focus or blur event. `relatedTarget` is always `null`: GPUI's focus
 * subscriptions report only the element whose own focus changed, never the
 * other side of the transition, so this renderer genuinely does not know it.
 */
export interface GpuixFocusEvent extends GpuixEvent {
  readonly type: "focus" | "blur"
  readonly relatedTarget: null
}

/** A scroll-container position change. Does not bubble, unlike `onWheel`. */
export interface GpuixScrollEvent extends GpuixEvent {
  readonly type: "scroll"
}

/** An `<input>` or `<textarea>` edit. */
export interface GpuixChangeEvent extends GpuixEvent {
  readonly type: "change"
  readonly value?: string
}

/**
 * Events from the built-in custom elements: `<diff>`'s `toggleFile`,
 * `showMore`, and `lineClick`; `<markdown>`'s `linkClick`; `<virtual-list>`'s
 * `visibleRange`; an element's own `highlight` match count; and an
 * accessibility action requested by assistive technology.
 */
export interface GpuixElementEvent extends GpuixEvent {
  readonly type:
    | "toggleFile"
    | "showMore"
    | "lineClick"
    | "linkClick"
    | "visibleRange"
    | "highlight"
    | "accessibilityAction"
  /** File path (`toggleFile`), hidden line count (`showMore`), line text
   *  (`lineClick`), or URL (`linkClick`). */
  readonly value?: string
  /** Line number on the pre-change side. `<diff>` `lineClick` only. */
  readonly oldLine?: number
  /** Line number on the post-change side. `<diff>` `lineClick` only. */
  readonly newLine?: number
  /** First visible logical index. `<virtual-list>` `visibleRange` only. */
  readonly startIndex?: number
  /** Exclusive end of the visible logical range. `visibleRange` only. */
  readonly endIndex?: number
  /** Matches found by this element's `highlight` prop. `highlight` only. */
  readonly matchCount?: number
  /** AccessKit action requested by assistive technology.
   *  `accessibilityAction` only. */
  readonly accessibilityAction?: "increment" | "decrement" | "focus"
}

/**
 * The React-facing event delivered for a native GPUIX payload: the union of
 * every kind above.
 *
 * A handler typed against this union must narrow on `type` before reading a
 * kind-specific member — `nativeEvent` remains the untyped escape hatch when
 * narrowing is inconvenient. A handler typed against one specific kind (e.g.
 * `(e: GpuixKeyboardEvent) => void`) still satisfies `(e: GpuixSyntheticEvent)
 * => void` call sites, because each kind is a subtype of this union.
 */
export type GpuixSyntheticEvent =
  | GpuixMouseEvent
  | GpuixDragEvent
  | GpuixWheelEvent
  | GpuixKeyboardEvent
  | GpuixFocusEvent
  | GpuixScrollEvent
  | GpuixChangeEvent
  | GpuixElementEvent

export interface GpuixEventDispatchResult {
  defaultPrevented: boolean
  propagationStopped: boolean
}

interface SyntheticEventController {
  event: GpuixSyntheticEvent
  setCurrentTarget(target: PublicInstance, phase: GpuixEventPhase): void
  /** True once `stopImmediatePropagation()` has run, so the dispatcher can skip
   *  the current target's remaining listener. */
  isImmediatePropagationStopped(): boolean
}

export function createGpuixSyntheticEvent(
  nativeEvent: EventPayload,
  target: PublicInstance,
  renderer: NativeRenderer,
  relatedTarget: PublicInstance | null = null
): SyntheticEventController {
  let currentTarget = target
  let eventPhase: GpuixEventPhase = 2
  let defaultPrevented = false
  let propagationStopped = false
  let immediatePropagationStopped = false

  const modifiers = nativeEvent.modifiers
  const isNonCancelableEvent =
    nativeEvent.eventType === "focus" ||
    nativeEvent.eventType === "blur" ||
    nativeEvent.eventType === "scroll"
  const isNonBubblingEvent = isNonCancelableEvent
  const isDragEvent =
    nativeEvent.eventType === "dragEnter" ||
    nativeEvent.eventType === "dragOver" ||
    nativeEvent.eventType === "dragLeave" ||
    nativeEvent.eventType === "drop"
  const event = {
    ...nativeEvent,
    nativeEvent,
    target,
    type: nativeEvent.eventType,
    ...(isDragEvent
      ? {
          dataTransfer: createGpuixDataTransfer(nativeEvent, nativeEvent.eventType === "drop"),
        }
      : {}),
    bubbles: !isNonBubblingEvent,
    cancelable: !isNonCancelableEvent,
    altKey: modifiers?.alt ?? false,
    ctrlKey: modifiers?.ctrl ?? false,
    metaKey: modifiers?.cmd ?? false,
    shiftKey: modifiers?.shift ?? false,
    button: nativeEvent.button ?? 0,
    detail: nativeEvent.eventType === "contextMenu" ? 0 : (nativeEvent.clickCount ?? 0),
    key: domKeyName(nativeEvent.key, nativeEvent.keyChar),
    repeat: nativeEvent.isHeld ?? false,
    clientX: nativeEvent.x ?? 0,
    clientY: nativeEvent.y ?? 0,
    pageX: nativeEvent.x ?? 0,
    pageY: nativeEvent.y ?? 0,
    relatedTarget,
    preventDefault(): void {
      if (!isNonCancelableEvent) defaultPrevented = true
    },
    stopPropagation(): void {
      propagationStopped = true
    },
    stopImmediatePropagation(): void {
      propagationStopped = true
      immediatePropagationStopped = true
    },
    isDefaultPrevented(): boolean {
      return defaultPrevented
    },
    isPropagationStopped(): boolean {
      return propagationStopped
    },
    setPointerCapture(): void {
      renderer.setPointerCapture?.(nativeEvent.elementId)
    },
    releasePointerCapture(): void {
      renderer.releasePointerCapture?.(nativeEvent.elementId)
    },
    persist(): void {},
    // The object literal carries every member every kind's interface
    // declares — `type` just narrows which subset a given caller reads. Three
    // more (`currentTarget`, `eventPhase`, `defaultPrevented`) are defined
    // below via `Object.defineProperties` because they're derived from
    // mutable closure state, so this cast goes through `unknown`: none of the
    // per-kind interfaces individually has enough overlap with this literal's
    // type for TypeScript to accept the cast directly.
  } as unknown as GpuixSyntheticEvent

  Object.defineProperties(event, {
    currentTarget: { enumerable: true, get: () => currentTarget },
    eventPhase: { enumerable: true, get: () => eventPhase },
    defaultPrevented: { enumerable: true, get: () => defaultPrevented },
  })

  return {
    event,
    setCurrentTarget(target, phase): void {
      currentTarget = target
      eventPhase = phase
    },
    isImmediatePropagationStopped(): boolean {
      return immediatePropagationStopped
    },
  }
}
