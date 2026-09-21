/// `PointerEvent` from `@gpuix/react/globals` and `PublicInstance.dispatchEvent()`.
/// Like `globals.test.tsx`, this file relies on vitest's forks pool isolating
/// its `globalThis`.

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import "../globals.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import type { GpuixPointerEvent, GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

function createMockRenderer(): NativeRenderer {
  return {
    applyBatch: vi.fn(() => []),
    setStrictStyles: vi.fn(),
  }
}

let unmount: (() => void) | undefined

function render(element: React.ReactElement): void {
  const root = createRoot(createMockRenderer(), { strictStyles: false })
  flushSync(() => root.render(element))
  unmount = () => root.unmount()
}

afterEach(() => {
  unmount?.()
  unmount = undefined
  vi.unstubAllGlobals()
})

describe("@gpuix/react/globals PointerEvent", () => {
  it("installs PointerEvent without manufacturing a document", () => {
    expect(typeof Reflect.get(globalThis, "PointerEvent")).toBe("function")
    expect(Reflect.has(globalThis, "document")).toBe(false)
    // Base UI reaches it as `ownerWindow(element).PointerEvent`, which is
    // `window` when the element has no `ownerDocument`.
    expect(Reflect.get(window, "PointerEvent")).toBe(PointerEvent)
  })

  it("applies PointerEventInit defaults and members", () => {
    const plain = new PointerEvent("pointerdown")
    expect(plain).toMatchObject({
      type: "pointerdown",
      bubbles: false,
      cancelable: false,
      composed: false,
      defaultPrevented: false,
      isTrusted: false,
      detail: 0,
      button: 0,
      buttons: 0,
      pointerId: 0,
      pointerType: "",
      isPrimary: false,
      width: 1,
      height: 1,
      altKey: false,
    })

    const click = new PointerEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: 12,
      clientY: 34,
      shiftKey: true,
      metaKey: true,
      button: 2,
      buttons: 2,
      pointerId: 7,
      pointerType: "pen",
      isPrimary: true,
    })
    expect(click).toMatchObject({
      bubbles: true,
      cancelable: true,
      detail: 1,
      x: 12,
      y: 34,
      pageX: 12,
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      button: 2,
      buttons: 2,
      pointerId: 7,
      pointerType: "pen",
      isPrimary: true,
    })
  })

  it("is cancelable only when constructed so", () => {
    const fixed = new PointerEvent("click")
    fixed.preventDefault()
    expect(fixed.defaultPrevented).toBe(false)

    const cancelable = new PointerEvent("click", { cancelable: true })
    cancelable.preventDefault()
    expect(cancelable.defaultPrevented).toBe(true)
    expect(cancelable.returnValue).toBe(false)
  })

  it("leaves a pre-existing PointerEvent in place on a later import", async () => {
    const existing = class {}
    vi.stubGlobal("PointerEvent", existing)
    vi.resetModules()
    await import("../globals.js")
    expect(Reflect.get(globalThis, "PointerEvent")).toBe(existing)
  })
})

describe("PublicInstance.dispatchEvent", () => {
  it("runs a click through capture, target, and bubble, and returns true", () => {
    const calls: string[] = []
    const record = (label: string) => (event: GpuixSyntheticEvent) =>
      calls.push(`${label}:${event.eventPhase}`)
    const target = React.createRef<PublicInstance>()
    render(
      <div onClickCapture={record("outer-capture")} onClick={record("outer")}>
        <div ref={target} onClickCapture={record("target-capture")} onClick={record("target")} />
      </div>
    )

    const event = new PointerEvent("click", { bubbles: true, cancelable: true })
    expect(target.current!.dispatchEvent(event)).toBe(true)
    expect(calls).toEqual(["outer-capture:1", "target-capture:2", "target:2", "outer:3"])
  })

  it("returns false and marks the event when a handler cancels it", () => {
    const target = React.createRef<PublicInstance>()
    const outer = vi.fn()
    render(
      <div onClick={(event) => outer(event.defaultPrevented)}>
        <div ref={target} onClick={(event) => event.preventDefault()} />
      </div>
    )

    const event = new PointerEvent("click", { bubbles: true, cancelable: true })
    expect(target.current!.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(outer).toHaveBeenCalledWith(true)
  })

  it("ignores preventDefault on an event that is not cancelable", () => {
    const target = React.createRef<PublicInstance>()
    const seen: Array<[boolean, boolean]> = []
    render(
      <div
        ref={target}
        onClick={(event) => {
          event.preventDefault()
          seen.push([event.cancelable, event.defaultPrevented])
        }}
      />
    )

    const event = new PointerEvent("click", { bubbles: true })
    expect(target.current!.dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(seen).toEqual([[false, false]])
  })

  it("reports an event canceled before dispatch", () => {
    const target = React.createRef<PublicInstance>()
    const seen = vi.fn()
    render(<div ref={target} onClick={(event) => seen(event.defaultPrevented)} />)

    const event = new PointerEvent("click", { bubbles: true, cancelable: true })
    event.preventDefault()
    expect(target.current!.dispatchEvent(event)).toBe(false)
    expect(seen).toHaveBeenCalledWith(true)
  })

  it("keeps a non-bubbling event off the ancestors' bubble handlers", () => {
    const calls: string[] = []
    const target = React.createRef<PublicInstance>()
    render(
      <div onClickCapture={() => calls.push("outer-capture")} onClick={() => calls.push("outer")}>
        <div ref={target} onClick={(event) => calls.push(`target:${event.bubbles}`)} />
      </div>
    )

    expect(target.current!.dispatchEvent(new PointerEvent("click"))).toBe(true)
    expect(calls).toEqual(["outer-capture", "target:false"])
  })

  it("stops at stopPropagation", () => {
    const outer = vi.fn()
    const target = React.createRef<PublicInstance>()
    render(
      <div onClick={outer}>
        <div ref={target} onClick={(event) => event.stopPropagation()} />
      </div>
    )

    target.current!.dispatchEvent(new PointerEvent("click", { bubbles: true }))
    expect(outer).not.toHaveBeenCalled()
  })

  it("stops the dispatched event when a handler stops propagation", () => {
    const calls: string[] = []
    const target = React.createRef<PublicInstance>()
    const event = new PointerEvent("click", { bubbles: true })
    render(
      <div onClick={() => calls.push("outer")}>
        <div
          ref={target}
          onClickCapture={(synthetic) => synthetic.stopPropagation()}
          onClick={() => calls.push(`target:${event.cancelBubble}`)}
        />
      </div>
    )

    target.current!.dispatchEvent(event)
    // The target's other listener still runs, and sees the flag; ancestors do not.
    expect(calls).toEqual(["target:true"])
    // As in the DOM, the flag is unset once the dispatch finishes.
    expect(event.cancelBubble).toBe(false)
  })

  it("skips the target's remaining listener after stopImmediatePropagation", () => {
    const calls: string[] = []
    const target = React.createRef<PublicInstance>()
    const event = new PointerEvent("click", { bubbles: true })
    render(
      <div onClick={() => calls.push("outer")}>
        <div
          ref={target}
          onClickCapture={(synthetic) => {
            synthetic.stopImmediatePropagation()
            calls.push(`capture:${event.cancelBubble}`)
          }}
          onClick={() => calls.push("target")}
        />
      </div>
    )

    target.current!.dispatchEvent(event)
    expect(calls).toEqual(["capture:true"])
  })

  it("forwards stopping to an event of the host's own shape", () => {
    const target = React.createRef<PublicInstance>()
    render(<div ref={target} onClick={(synthetic) => synthetic.stopPropagation()} />)
    const event = {
      type: "click",
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    }

    expect(target.current!.dispatchEvent(event)).toBe(true)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it("runs no listener for an event stopped before dispatch", () => {
    const handler = vi.fn()
    const target = React.createRef<PublicInstance>()
    render(
      <div onClickCapture={handler} onClick={handler}>
        <div ref={target} onClickCapture={handler} onClick={handler} />
      </div>
    )

    const event = new PointerEvent("click", { bubbles: true, cancelable: true })
    event.stopPropagation()
    expect(target.current!.dispatchEvent(event)).toBe(true)
    expect(handler).not.toHaveBeenCalled()
    expect(event.cancelBubble).toBe(false)

    // The same event dispatches normally once the flag is unset.
    target.current!.dispatchEvent(event)
    expect(handler).toHaveBeenCalledTimes(4)
  })

  it("delivers no click to a disabled form control or its ancestors", () => {
    const handler = vi.fn()
    const onSubmit = vi.fn()
    const button = React.createRef<PublicInstance>()
    const checkbox = React.createRef<PublicInstance>()
    const textarea = React.createRef<PublicInstance>()
    const wrapper = React.createRef<PublicInstance>()
    render(
      <form onSubmit={onSubmit} onClickCapture={handler} onClick={handler}>
        <button ref={button} type="submit" disabled onClickCapture={handler} onClick={handler} />
        <input ref={checkbox} type="checkbox" disabled onClick={handler} onChange={handler} />
        <textarea ref={textarea} disabled onClick={handler} />
        <div ref={wrapper} ariaDisabled onClick={handler} />
      </form>
    )

    for (const ref of [button, checkbox, textarea]) {
      const event = new PointerEvent("click", { bubbles: true, cancelable: true })
      expect(ref.current!.dispatchEvent(event)).toBe(true)
    }
    expect(handler).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    // Pointer events still reach a disabled control, as they do in a browser.
    const onPointerDown = vi.fn()
    unmount?.()
    render(<button ref={button} disabled onPointerDown={onPointerDown} />)
    button.current!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(onPointerDown).toHaveBeenCalledTimes(1)

    // Only native disabling blocks the click: aria-disabled does not.
    unmount?.()
    render(<div ref={wrapper} ariaDisabled onClick={handler} />)
    wrapper.current!.dispatchEvent(new PointerEvent("click", { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("runs no handler once the ref's element has unmounted", () => {
    const handler = vi.fn()
    const target = React.createRef<PublicInstance>()
    render(<div ref={(instance) => {
      if (instance) (target as { current: PublicInstance | null }).current = instance
    }} onClick={handler} />)
    const detached = target.current!
    unmount!()
    unmount = undefined

    const event = new PointerEvent("click", { bubbles: true, cancelable: true })
    expect(detached.dispatchEvent(event)).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it("carries modifiers, button, detail, and pointer members to handlers", () => {
    const target = React.createRef<PublicInstance>()
    const seen: GpuixPointerEvent[] = []
    render(<div ref={target} onPointerDown={(event) => seen.push(event)} />)

    target.current!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 5,
        clientY: 6,
        ctrlKey: true,
        altKey: true,
        button: 1,
        buttons: 4,
        pointerId: 3,
        pointerType: "touch",
        isPrimary: true,
      })
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      type: "pointerDown",
      target: target.current,
      detail: 1,
      clientX: 5,
      clientY: 6,
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      button: 1,
      buttons: 4,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
    })
  })

  it("dispatches each pointer type to its prop", () => {
    const calls: string[] = []
    const target = React.createRef<PublicInstance>()
    const record = (label: string) => () => calls.push(label)
    render(
      <div
        onPointerUp={record("outer-up")}
        onPointerEnter={record("outer-enter")}
        onPointerLeave={record("outer-leave")}
      >
        <div
          ref={target}
          onPointerDown={record("down")}
          onPointerUp={record("up")}
          onPointerMove={record("move")}
          onPointerCancel={record("cancel")}
          onPointerEnter={record("enter")}
          onPointerLeave={record("leave")}
          onMouseDown={record("mouse-down")}
        />
      </div>
    )

    for (const type of [
      "pointerdown",
      "pointerup",
      "pointermove",
      "pointercancel",
      "pointerenter",
      "pointerleave",
    ]) {
      target.current!.dispatchEvent(new PointerEvent(type, { bubbles: true }))
    }
    // Enter and leave run on their target only, even when constructed to
    // bubble. A dispatched pointer event fires no compatibility mouse event.
    expect(calls).toEqual(["down", "up", "outer-up", "move", "cancel", "enter", "leave"])
  })

  it("reaches no handler for a type GPUIX does not dispatch", () => {
    const target = React.createRef<PublicInstance>()
    const onMouseDown = vi.fn()
    render(<div ref={target} onMouseDown={onMouseDown} />)

    const event = new PointerEvent("mousedown", { bubbles: true, cancelable: true })
    expect(target.current!.dispatchEvent(event)).toBe(true)
    expect(onMouseDown).not.toHaveBeenCalled()
  })

  it("rejects dispatching an event that is already being dispatched", () => {
    const target = React.createRef<PublicInstance>()
    const event = new PointerEvent("click", { bubbles: true })
    let error: unknown
    render(
      <div
        ref={target}
        onClick={() => {
          try {
            target.current!.dispatchEvent(event)
          } catch (caught) {
            error = caught
          }
        }}
      />
    )

    target.current!.dispatchEvent(event)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe("InvalidStateError")
    // The flag clears after dispatch, so the same event can be dispatched again.
    expect(() => target.current!.dispatchEvent(event)).not.toThrow()
  })

  it("submits a form from a dispatched click on its submit button unless prevented", () => {
    const onSubmit = vi.fn((event: GpuixSyntheticEvent) => event.preventDefault())
    const button = React.createRef<PublicInstance>()
    let prevent = false
    render(
      <form onSubmit={onSubmit}>
        <button
          ref={button}
          type="submit"
          onClick={(event) => {
            if (prevent) event.preventDefault()
          }}
        />
      </form>
    )

    button.current!.dispatchEvent(new PointerEvent("click", { bubbles: true, cancelable: true }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    prevent = true
    button.current!.dispatchEvent(new PointerEvent("click", { bubbles: true, cancelable: true }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
