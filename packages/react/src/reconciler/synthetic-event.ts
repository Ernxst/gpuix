import type { EventPayload } from "@gpuix/native"
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
 * The React-facing event delivered for a native GPUIX payload.
 *
 * Native payload fields remain available at the top level for compatibility.
 * `nativeEvent` preserves the unmodified payload for code that needs to
 * distinguish host data from the DOM-compatible surface.
 */
export type GpuixSyntheticEvent = EventPayload & {
  readonly nativeEvent: EventPayload
  readonly target: PublicInstance
  readonly currentTarget: PublicInstance
  readonly type: string
  readonly eventPhase: GpuixEventPhase
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly defaultPrevented: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly button: number
  readonly key?: string
  readonly repeat: boolean

  preventDefault(): void
  stopPropagation(): void
  isDefaultPrevented(): boolean
  isPropagationStopped(): boolean
  /** Route this pressed-pointer sequence to the original event target. */
  setPointerCapture(): void
  /** Stop routing this pressed-pointer sequence to the original event target. */
  releasePointerCapture(): void
  /** GPUIX events are never pooled, so persist is intentionally a no-op. */
  persist(): void
}

export interface GpuixEventDispatchResult {
  defaultPrevented: boolean
  propagationStopped: boolean
}

interface SyntheticEventController {
  event: GpuixSyntheticEvent
  setCurrentTarget(target: PublicInstance, phase: GpuixEventPhase): void
}

export function createGpuixSyntheticEvent(
  nativeEvent: EventPayload,
  target: PublicInstance,
  renderer: NativeRenderer
): SyntheticEventController {
  let currentTarget = target
  let eventPhase: GpuixEventPhase = 2
  let defaultPrevented = false
  let propagationStopped = false

  const modifiers = nativeEvent.modifiers
  const isPlainFocusEvent = nativeEvent.eventType === "focus" || nativeEvent.eventType === "blur"
  const event = {
    ...nativeEvent,
    nativeEvent,
    target,
    type: nativeEvent.eventType,
    bubbles: !isPlainFocusEvent,
    cancelable: !isPlainFocusEvent,
    altKey: modifiers?.alt ?? false,
    ctrlKey: modifiers?.ctrl ?? false,
    metaKey: modifiers?.cmd ?? false,
    shiftKey: modifiers?.shift ?? false,
    button: nativeEvent.button ?? 0,
    key: domKeyName(nativeEvent.key, nativeEvent.keyChar),
    repeat: nativeEvent.isHeld ?? false,
    preventDefault(): void {
      if (!isPlainFocusEvent) defaultPrevented = true
    },
    stopPropagation(): void {
      propagationStopped = true
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
  } as GpuixSyntheticEvent

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
  }
}
