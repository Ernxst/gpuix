/// The single-window `document` facade that `@gpuix/react/globals` installs.
/// Like `globals.test.tsx`, this file relies on vitest's forks pool isolating
/// its `globalThis`.

import type { EventPayload } from "@gpuix/native"
import React, { createRef, useRef, useState, type Ref } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import "../globals.js"
import { hasBrowserDocument } from "../document.js"
import type { PointerEvent } from "../pointer-event.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { act, createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { GpuixDocument, NativeRenderer, PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

/** Base UI's `ownerDocument` helper from `@base-ui/utils/owner`. */
function ownerDocument(node: PublicInstance | null | undefined): GpuixDocument {
  return node?.ownerDocument || (globalThis.document as unknown as GpuixDocument)
}

function createMockRenderer(): NativeRenderer {
  return { applyBatch: vi.fn(() => []), setStrictStyles: vi.fn() }
}

const unmounts: Array<() => void> = []

function mount(element: React.ReactElement, renderer = createMockRenderer()) {
  const root = createRoot(renderer, { strictStyles: false })
  flushSync(() => root.render(element))
  const unmount = () => root.unmount()
  unmounts.push(unmount)
  return {
    render: (next: React.ReactElement) => flushSync(() => root.render(next)),
    unmount,
  }
}

let screen: TestRoot | undefined

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  screen?.unmount()
  screen = undefined
  vi.unstubAllGlobals()
})

describe("@gpuix/react/globals document", () => {
  it("installs the facade, and a later import leaves a host document in place", async () => {
    expect(Reflect.has(globalThis, "document")).toBe(true)
    expect(hasBrowserDocument()).toBe(false)

    const host = { title: "host" }
    vi.stubGlobal("document", host)
    vi.resetModules()
    await import("../globals.js")

    expect(globalThis.document).toBe(host)
    expect(hasBrowserDocument()).toBe(true)
  })

  it("is every ref's ownerDocument, mounted or removed", () => {
    const kept = createRef<PublicInstance>()
    const removed = createRef<PublicInstance>()
    let detached: PublicInstance | null = null
    const app = mount(
      <div ref={kept}>
        <div ref={removed} />
      </div>
    )
    detached = removed.current
    app.render(<div ref={kept} />)

    expect(globalThis.document).toBeDefined()
    expect(kept.current!.ownerDocument).toBe(globalThis.document)
    expect(detached!.ownerDocument).toBe(globalThis.document)
    expect(Object.keys(kept.current!)).not.toContain("ownerDocument")
  })

  it("reports the root host element as body and the global window as defaultView", () => {
    const root = createRef<PublicInstance>()
    const doc = globalThis.document as unknown as GpuixDocument
    expect(doc.body).toBeNull()

    const app = mount(
      <div ref={root}>
        <div />
      </div>
    )
    expect(doc.body).toBe(root.current)
    expect(doc.defaultView).toBe(globalThis.window)

    app.unmount()
    expect(doc.body).toBeNull()
  })

  it("reads the most recently mounted root while two windows are open", () => {
    const olderRoot = createRef<PublicInstance>()
    const newerRoot = createRef<PublicInstance>()
    const doc = globalThis.document as unknown as GpuixDocument
    mount(
      <div ref={olderRoot}>
        <div id="older" />
      </div>
    )
    const newer = mount(
      <div ref={newerRoot}>
        <div id="newer" />
      </div>
    )

    expect(doc.body).toBe(newerRoot.current)
    expect(doc.getElementById("older")).toBeNull()

    newer.unmount()
    expect(doc.body).toBe(olderRoot.current)
    expect(doc.getElementById("older")).not.toBeNull()
  })
})

describe("@gpuix/react/globals document listeners", () => {
  function windowPointer(renderer: NativeRenderer, eventType: string): void {
    handleGpuixEvent({ elementId: 0, eventType, x: 4, y: 8, button: 0 } as EventPayload, renderer)
  }

  it("runs a function once per registration of type, function, and capture flag", () => {
    const renderer = createMockRenderer()
    mount(<div />, renderer)
    const doc = globalThis.document as unknown as GpuixDocument
    const calls: string[] = []
    const onUp = (event: PointerEvent) => calls.push(`${event.type}:${event.clientX},${event.clientY}`)
    const onCancel = () => calls.push("cancel")

    doc.addEventListener("pointerup", onUp)
    doc.addEventListener("pointerup", onUp)
    doc.addEventListener("pointerup", onUp, { capture: true })
    doc.addEventListener("pointercancel", onCancel)
    windowPointer(renderer, "windowPointerUp")
    expect(calls).toEqual(["pointerup:4,8", "pointerup:4,8"])

    // Removal matches the capture flag, as in the DOM.
    doc.removeEventListener("pointerup", onUp, true)
    windowPointer(renderer, "windowPointerUp")
    windowPointer(renderer, "windowPointerCancel")
    expect(calls).toEqual(["pointerup:4,8", "pointerup:4,8", "pointerup:4,8", "cancel"])

    doc.removeEventListener("pointerup", onUp)
    doc.removeEventListener("pointercancel", onCancel)
    windowPointer(renderer, "windowPointerUp")
    windowPointer(renderer, "windowPointerCancel")
    expect(calls).toHaveLength(4)
  })

  it("skips listeners removed during the dispatch and not those added during it", () => {
    const renderer = createMockRenderer()
    mount(<div />, renderer)
    const doc = globalThis.document as unknown as GpuixDocument
    const calls: string[] = []
    const late = () => calls.push("late")
    const second = () => calls.push("second")
    doc.addEventListener("pointerup", () => {
      calls.push("first")
      doc.removeEventListener("pointerup", second)
      doc.addEventListener("pointerup", late)
    })
    doc.addEventListener("pointerup", second)

    windowPointer(renderer, "windowPointerUp")
    expect(calls).toEqual(["first"])
    windowPointer(renderer, "windowPointerUp")
    expect(calls).toEqual(["first", "first", "late"])
  })

  it("drops a root's listeners when it unmounts", () => {
    const renderer = createMockRenderer()
    const app = mount(<div />, renderer)
    const doc = globalThis.document as unknown as GpuixDocument
    const onUp = vi.fn()
    doc.addEventListener("pointerup", onUp)
    app.unmount()

    mount(<div />, renderer)
    windowPointer(renderer, "windowPointerUp")
    expect(onUp).not.toHaveBeenCalled()
  })

  it("ignores other event types and listener forms with one warning each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const doc = globalThis.document as unknown as GpuixDocument
    const listener = vi.fn()
    doc.addEventListener("pointerup", listener)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("no GPUIX root is mounted"))

    const renderer = createMockRenderer()
    mount(<div />, renderer)
    doc.addEventListener("pointerdown", listener)
    doc.addEventListener("pointerdown", listener)
    doc.addEventListener("pointerup", { handleEvent: listener } as unknown as () => void)
    doc.addEventListener("pointerup", listener, { once: true } as { capture?: boolean })
    doc.addEventListener("pointerup", null)
    windowPointer(renderer, "windowPointerUp")

    expect(listener).not.toHaveBeenCalled()
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("no GPUIX root is mounted"),
      expect.stringContaining('addEventListener("pointerdown") was ignored'),
      expect.stringContaining("only function listeners"),
      expect.stringContaining("once or signal"),
    ])
    warn.mockRestore()
  })
})


describeNative("document with a live window", () => {
  it("finds mounted elements by id in tree order and forgets removed ones", () => {
    screen = createTestRoot({ width: 320, height: 120 })
    const first = createRef<PublicInstance>()
    screen.render(
      <div>
        <div id="shared" ref={first} />
        <div>
          <div id="shared" />
        </div>
        <div id="panel" />
      </div>
    )

    expect(document.getElementById("shared")).toBe(first.current)
    expect(document.getElementById("panel")?.getAttribute("id")).toBe("panel")
    expect(document.getElementById("missing")).toBeNull()

    screen.render(
      <div>
        <div id="shared" ref={first} />
      </div>
    )
    expect(document.getElementById("panel")).toBeNull()
    expect(document.getElementById("shared")).toBe(first.current)

    screen.unmount()
    expect(document.getElementById("shared")).toBeNull()
  })

  it("follows focus in activeElement, falling back to body", () => {
    screen = createTestRoot({ width: 320, height: 120 })
    const root = createRef<PublicInstance>()
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    screen.render(
      <div ref={root}>
        <button ref={first} />
        <button ref={second} />
      </div>
    )
    const doc = globalThis.document as unknown as GpuixDocument

    expect(doc.activeElement).toBe(root.current)
    act(() => first.current!.focus())
    expect(doc.activeElement).toBe(first.current)
    act(() => second.current!.focus())
    expect(doc.activeElement).toBe(second.current)
    act(() => second.current!.blur())
    expect(doc.activeElement).toBe(root.current)
  })

  it("lets refs composed only when a document exists reach the live instance", async () => {
    // Base UI's `useRenderElement` merges a component's refs only when
    // `typeof document !== "undefined"`; without a document `Field.Control`'s
    // forwarded ref and its validation ref were never attached.
    screen = createTestRoot({ width: 320, height: 120 })
    const forwarded = createRef<PublicInstance>()

    function Control({ controlRef }: { controlRef: Ref<PublicInstance> }) {
      const inputRef = useRef<PublicInstance | null>(null)
      const merged =
        typeof document !== "undefined"
          ? (instance: PublicInstance | null) => {
              inputRef.current = instance
              if (typeof controlRef === "function") controlRef(instance)
              else if (controlRef) controlRef.current = instance
            }
          : undefined
      return <input ref={merged} data-testid="control" />
    }

    function Field() {
      const [count, setCount] = useState(0)
      return (
        <div>
          <Control controlRef={forwarded} />
          <button data-testid="rerender" onClick={() => setCount(count + 1)} />
        </div>
      )
    }

    screen.render(<Field />)
    await screen.userEvent.click(screen.getByTestId("rerender"))

    const control = forwarded.current!
    expect(control).not.toBeNull()
    expect(control.type).toBe("input")
    expect(typeof control.dispatchEvent).toBe("function")
    expect(control.parentElement).not.toBeNull()
    expect(ownerDocument(control).getElementById).toBeTypeOf("function")
  })

  it("lets a pressed tab read its ownerDocument and change selection", async () => {
    // Base UI's `TabsTab` reads `ownerDocument(event.currentTarget)` on
    // pointerdown and `activeElement(ownerDocument(list))` after a selection.
    screen = createTestRoot({ width: 320, height: 120 })
    const list = createRef<PublicInstance>()
    const pressed: GpuixDocument[] = []
    let focusInList: boolean | undefined

    function Tabs() {
      const [selected, setSelected] = useState("a")
      return (
        <div>
          <div ref={list} role="tablist">
            {["a", "b"].map((value) => (
              <button
                key={value}
                id={`tab-${value}`}
                role="tab"
                tabIndex={selected === value ? 0 : -1}
                style={{ width: 60, height: 30 }}
                data-testid={`tab-${value}`}
                aria-selected={selected === value}
                onPointerDown={(event) => {
                  pressed.push(ownerDocument(event.currentTarget))
                }}
                onClick={() => {
                  setSelected(value)
                  const active = ownerDocument(list.current).activeElement
                  focusInList = list.current!.contains(active)
                }}
              />
            ))}
          </div>
          <div role="tabpanel" id="panel-a" hidden={selected !== "a"} />
          <div role="tabpanel" id="panel-b" hidden={selected !== "b"} />
        </div>
      )
    }

    screen.render(<Tabs />)
    const doc = list.current!.ownerDocument
    act(() => doc.getElementById("tab-a")!.focus())
    await screen.userEvent.click(screen.getByTestId("tab-b"))

    expect(pressed).toEqual([globalThis.document])
    expect(focusInList).toBe(true)
    expect(doc.getElementById("tab-b")!.getAttribute("aria-selected")).toBe("true")
    expect(doc.getElementById("panel-a")!.hasAttribute("hidden")).toBe(true)
    expect(doc.getElementById("panel-b")!.hasAttribute("hidden")).toBe(false)
  })

  describe("pointerup and pointercancel listeners", () => {
    /**
     * Base UI's `Tabs.Tab` press handling: `onPointerDown` adds `pointerup`
     * and `pointercancel` listeners to `ownerDocument(event.currentTarget)`,
     * and the first of them to run removes both.
     */
    function PressTabs({ log }: { log: string[] }) {
      const [selected, setSelected] = useState("a")
      const pressing = useRef(false)
      return (
        <div>
          <div role="tablist" style={{ flexDirection: "row" }}>
            {["a", "b"].map((value) => (
              <button
                key={value}
                id={`tab-${value}`}
                role="tab"
                data-testid={`tab-${value}`}
                aria-selected={selected === value}
                style={{ width: 60, height: 30 }}
                onPointerDown={(event) => {
                  pressing.current = true
                  log.push(`pointerdown:${value}`)
                  const doc = ownerDocument(event.currentTarget)
                  function handlePointerEnd(end: PointerEvent) {
                    pressing.current = false
                    log.push(`document:${end.type}`)
                    doc.removeEventListener("pointerup", handlePointerEnd)
                    doc.removeEventListener("pointercancel", handlePointerEnd)
                  }
                  doc.addEventListener("pointerup", handlePointerEnd)
                  doc.addEventListener("pointercancel", handlePointerEnd)
                }}
                onClick={() => {
                  log.push(`click:${value}:pressing=${pressing.current}`)
                  setSelected(value)
                }}
              />
            ))}
          </div>
          <div data-testid="outside" style={{ width: 200, height: 40 }} />
        </div>
      )
    }

    function center(testId: string): [number, number] {
      const bounds = screen!.renderer.getElementBounds(screen!.getByTestId(testId).id)!
      return [bounds.x! + bounds.width! / 2, bounds.y! + bounds.height! / 2]
    }

    it("ends a press wherever it is released, before the click, and drops the listeners", async () => {
      screen = createTestRoot({ width: 320, height: 120 })
      const log: string[] = []
      screen.render(<PressTabs log={log} />)

      await screen.userEvent.click(screen.getByTestId("tab-b"))
      await screen.userEvent.click(screen.getByTestId("tab-a"))
      expect(log).toEqual([
        "pointerdown:b",
        "document:pointerup",
        "click:b:pressing=false",
        "pointerdown:a",
        "document:pointerup",
        "click:a:pressing=false",
      ])
      expect(document.getElementById("tab-a")!.getAttribute("aria-selected")).toBe("true")

      // Base UI listens for every button, so a secondary press ends as well.
      log.length = 0
      screen.renderer.nativeSimulateMouseDown(...center("tab-b"), 2)
      screen.renderer.nativeSimulateMouseUp(...center("tab-b"), 2)
      expect(log).toEqual(["pointerdown:b", "document:pointerup"])

      // Released over an element with no handlers: no click, but the press ends.
      log.length = 0
      screen.renderer.nativeSimulateMouseDown(...center("tab-b"))
      screen.renderer.nativeSimulateMouseUp(...center("outside"))
      expect(log).toEqual(["pointerdown:b", "document:pointerup"])
      expect(document.getElementById("tab-a")!.getAttribute("aria-selected")).toBe("true")

      // Every listener removed itself, so a later press elsewhere reaches none.
      log.length = 0
      await screen.userEvent.click(screen.getByTestId("outside"))
      expect(log).toEqual([])
    })

    it("cancels a press when the window deactivates and leaves no listener behind", () => {
      screen = createTestRoot({ width: 320, height: 120 })
      const log: string[] = []
      screen.render(<PressTabs log={log} />)

      screen.renderer.nativeSimulateMouseDown(...center("tab-b"))
      screen.renderer.nativeSimulateWindowDeactivation()
      expect(log).toEqual(["pointerdown:b", "document:pointercancel"])

      screen.renderer.nativeSimulateWindowActivation(true)
      screen.renderer.nativeSimulateMouseUp(...center("outside"))
      expect(log).toEqual(["pointerdown:b", "document:pointercancel"])
    })

    it("drops the listeners of a root unmounted mid-press", () => {
      screen = createTestRoot({ width: 320, height: 120 })
      const log: string[] = []
      screen.render(<PressTabs log={log} />)
      screen.renderer.nativeSimulateMouseDown(...center("tab-b"))
      screen.unmount()

      screen = createTestRoot({ width: 320, height: 120 })
      screen.render(<PressTabs log={[]} />)
      screen.renderer.nativeSimulateMouseDown(...center("outside"))
      screen.renderer.nativeSimulateMouseUp(...center("outside"))
      expect(log).toEqual(["pointerdown:b"])
    })
  })
})
