import type {
  GpuixFocusEvent,
  GpuixKeyboardEvent,
  GpuixLoadEvent,
  GpuixMouseEvent,
  GpuixPointerEvent,
  GpuixSyntheticEvent,
} from "../reconciler/synthetic-event.js"

// `key` is a plain required string on the keyboard kind.
const key: string = {} as GpuixKeyboardEvent["key"]
void key

// Keyboard events carry the flattened DOM modifier booleans too, not just
// the raw `modifiers` object.
const keyboardShiftKey: boolean = {} as GpuixKeyboardEvent["shiftKey"]
void keyboardShiftKey

// Reading a kind-specific member off the wrong kind is a type error, not just
// an absent runtime value: the per-kind types are disjoint on purpose.
// @ts-expect-error `key` is a keyboard member; mouse events do not carry one.
const mouseKey = ({} as GpuixMouseEvent).key
void mouseKey

// @ts-expect-error `button` is a mouse member; focus events do not carry one.
const focusButton = ({} as GpuixFocusEvent).button
void focusButton

// A handler typed against the union still satisfies every per-kind prop —
// each kind is a subtype of `GpuixSyntheticEvent`, so a caller that narrows
// on `type` before reading a kind-specific member works everywhere.
const onAnyEvent = (event: GpuixSyntheticEvent): void => {
  void event
}
const unionHandlerAcceptedEverywhere = (
  <div onKeyDown={onAnyEvent} onClick={onAnyEvent} onFocus={onAnyEvent} />
)
void unionHandlerAcceptedEverywhere

// A handler written against only the members two DOM event types share
// (as `React.MouseEvent<HTMLDivElement>` callers do today) still typechecks
// against the narrower GPUIX mouse type — the shared-handler use case.
const onSharedMouseFields = (
  event: Pick<GpuixMouseEvent, "clientX" | "button" | "altKey">
): void => {
  void event.clientX
  void event.button
  void event.altKey
}
const sharedHandlerAccepted = <div onClick={onSharedMouseFields} />
void sharedHandlerAccepted

// Pointer handlers expose the DOM fields Base UI-style press and drag code
// needs, and support every capture variant React exposes for these events.
const onPointer = (event: GpuixPointerEvent): void => {
  const pointerId: number = event.pointerId
  const pointerType: string = event.pointerType
  const buttons: number = event.buttons
  event.currentTarget.setPointerCapture(event.pointerId)
  event.currentTarget.releasePointerCapture(event.pointerId)
  void pointerId
  void pointerType
  void buttons
}
const pointerHandlersAccepted = (
  <div
    onPointerDownCapture={onPointer}
    onPointerDown={onPointer}
    onPointerMoveCapture={onPointer}
    onPointerMove={onPointer}
    onPointerUpCapture={onPointer}
    onPointerUp={onPointer}
    onPointerCancelCapture={onPointer}
    onPointerCancel={onPointer}
    onPointerEnter={onPointer}
    onPointerLeave={onPointer}
  />
)
void pointerHandlersAccepted

// Image lifecycle handlers use the same browser-shaped synthetic-event base:
// the event identifies its target and exposes the usual event controls without
// pretending it has pointer or keyboard fields.
const onImageLifecycle = (
  event: Pick<
    GpuixLoadEvent,
    "type" | "target" | "currentTarget" | "bubbles" | "cancelable" | "preventDefault"
  >
): void => {
  void event.type
  void event.target
  void event.currentTarget
  void event.bubbles
  void event.cancelable
  event.preventDefault()
}
const imageLifecycleHandlersAccepted = (
  <div onLoadCapture={onImageLifecycle} onErrorCapture={onImageLifecycle}>
    <img
      onLoadCapture={onImageLifecycle}
      onLoad={onImageLifecycle}
      onErrorCapture={onImageLifecycle}
      onError={onImageLifecycle}
    />
  </div>
)
void imageLifecycleHandlersAccepted
