/**
 * A browser-shaped `PointerEvent` constructor for `@gpuix/react/globals`.
 *
 * It exists so code written against the DOM can construct an event and hand it
 * to a GPUIX ref's `dispatchEvent()`, as Base UI's checkbox, switch, and radio
 * do with `new (ownerWindow(input).PointerEvent)("click", init)`. It is a plain
 * event object: it carries the `PointerEventInit` members and the cancellation
 * and propagation flags, and is not an `EventTarget` or tied to a document.
 */

const clearPropagationFlags = Symbol("clearPropagationFlags")

/**
 * The end of `EventTarget.dispatchEvent()`: the DOM unsets an event's stop
 * propagation flags once its dispatch finishes, so `cancelBubble` reads
 * `false` again and the event can be dispatched afresh. Events this module did
 * not construct keep whatever state their own class gives them.
 */
export function finishEventDispatch(event: object): void {
  if (event instanceof PointerEvent) event[clearPropagationFlags]()
}

/** The members a `PointerEventInit` dictionary may set. */
export interface GpuixPointerEventInit {
  bubbles?: boolean
  cancelable?: boolean
  composed?: boolean
  detail?: number
  view?: unknown
  screenX?: number
  screenY?: number
  clientX?: number
  clientY?: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  button?: number
  buttons?: number
  relatedTarget?: unknown
  movementX?: number
  movementY?: number
  pointerId?: number
  width?: number
  height?: number
  pressure?: number
  tangentialPressure?: number
  tiltX?: number
  tiltY?: number
  twist?: number
  altitudeAngle?: number
  azimuthAngle?: number
  pointerType?: string
  isPrimary?: boolean
}

/**
 * The event shape `PublicInstance.dispatchEvent()` accepts: a `PointerEvent`
 * from `@gpuix/react/globals` or the host, or any object with the same
 * members. Mouse and pointer members are optional and default as the DOM's
 * `PointerEventInit` does.
 */
export interface GpuixDispatchableEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly defaultPrevented: boolean
  preventDefault(): void
  /** Set when propagation was stopped. Absent means it was not. */
  readonly cancelBubble?: boolean
  stopPropagation?(): void
  stopImmediatePropagation?(): void
  readonly detail?: number
  readonly clientX?: number
  readonly clientY?: number
  readonly ctrlKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
  readonly button?: number
  readonly buttons?: number
  readonly pointerId?: number
  readonly pointerType?: string
  readonly isPrimary?: boolean
}

export class PointerEvent implements GpuixDispatchableEvent {
  static readonly NONE = 0
  static readonly CAPTURING_PHASE = 1
  static readonly AT_TARGET = 2
  static readonly BUBBLING_PHASE = 3

  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly composed: boolean
  readonly isTrusted = false
  readonly timeStamp: number
  readonly eventPhase = 0
  readonly target = null
  readonly currentTarget = null

  readonly detail: number
  readonly view: unknown
  readonly screenX: number
  readonly screenY: number
  readonly clientX: number
  readonly clientY: number
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly button: number
  readonly buttons: number
  readonly relatedTarget: unknown
  readonly movementX: number
  readonly movementY: number

  readonly pointerId: number
  readonly width: number
  readonly height: number
  readonly pressure: number
  readonly tangentialPressure: number
  readonly tiltX: number
  readonly tiltY: number
  readonly twist: number
  readonly altitudeAngle: number
  readonly azimuthAngle: number
  readonly pointerType: string
  readonly isPrimary: boolean

  #canceled = false
  #propagationStopped = false

  constructor(type: string, init: GpuixPointerEventInit = {}) {
    if (arguments.length === 0) {
      throw new TypeError(
        "Failed to construct 'PointerEvent': 1 argument required, but only 0 present."
      )
    }
    this.type = String(type)
    this.bubbles = init.bubbles ?? false
    this.cancelable = init.cancelable ?? false
    this.composed = init.composed ?? false
    this.timeStamp = globalThis.performance?.now() ?? Date.now()

    this.detail = init.detail ?? 0
    this.view = init.view ?? null
    this.screenX = init.screenX ?? 0
    this.screenY = init.screenY ?? 0
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
    this.ctrlKey = init.ctrlKey ?? false
    this.shiftKey = init.shiftKey ?? false
    this.altKey = init.altKey ?? false
    this.metaKey = init.metaKey ?? false
    this.button = init.button ?? 0
    this.buttons = init.buttons ?? 0
    this.relatedTarget = init.relatedTarget ?? null
    this.movementX = init.movementX ?? 0
    this.movementY = init.movementY ?? 0

    this.pointerId = init.pointerId ?? 0
    this.width = init.width ?? 1
    this.height = init.height ?? 1
    this.pressure = init.pressure ?? 0
    this.tangentialPressure = init.tangentialPressure ?? 0
    this.tiltX = init.tiltX ?? 0
    this.tiltY = init.tiltY ?? 0
    this.twist = init.twist ?? 0
    this.altitudeAngle = init.altitudeAngle ?? Math.PI / 2
    this.azimuthAngle = init.azimuthAngle ?? 0
    this.pointerType = init.pointerType ?? ""
    this.isPrimary = init.isPrimary ?? false
  }

  get defaultPrevented(): boolean {
    return this.#canceled
  }

  get returnValue(): boolean {
    return !this.#canceled
  }

  get cancelBubble(): boolean {
    return this.#propagationStopped
  }

  /** `MouseEvent.x`, an alias of {@link clientX}. */
  get x(): number {
    return this.clientX
  }

  /** `MouseEvent.y`, an alias of {@link clientY}. */
  get y(): number {
    return this.clientY
  }

  /** There is no scrolling document, so page coordinates equal client ones. */
  get pageX(): number {
    return this.clientX
  }

  get pageY(): number {
    return this.clientY
  }

  preventDefault(): void {
    if (this.cancelable) this.#canceled = true
  }

  stopPropagation(): void {
    this.#propagationStopped = true
  }

  stopImmediatePropagation(): void {
    this.#propagationStopped = true
  }

  [clearPropagationFlags](): void {
    this.#propagationStopped = false
  }

  composedPath(): never[] {
    return []
  }

  getCoalescedEvents(): PointerEvent[] {
    return []
  }

  getPredictedEvents(): PointerEvent[] {
    return []
  }
}
