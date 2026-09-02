import React, { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("createTestRoot userEvent", () => {
  it("drives pointer and keyboard interactions through TestElements", async () => {
    const screen = createTestRoot({ width: 480, height: 240 })

    function Harness() {
      const [clicks, setClicks] = useState(0)
      const [hovered, setHovered] = useState(false)
      const [first, setFirst] = useState("")
      const [second, setSecond] = useState("")

      return (
        <div style={{ width: 480, height: 240, gap: 8 }}>
          <button
            data-testid="action"
            style={{ width: 120, height: 40 }}
            onClick={() => setClicks((count) => count + 1)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          />
          <input
            data-testid="first"
            role="textbox"
            ariaLabel="first"
            value={first}
            style={{ width: 180, height: 40 }}
            onChange={(event) => setFirst(event.value ?? "")}
          />
          <input
            data-testid="second"
            role="textbox"
            ariaLabel="second"
            value={second}
            style={{ width: 180, height: 40 }}
            onChange={(event) => setSecond(event.value ?? "")}
          />
          <text>{`clicks:${clicks} hovered:${hovered} first:${first} second:${second}`}</text>
        </div>
      )
    }

    try {
      screen.render(<Harness />)
      const action = screen.getByTestId("action")
      const first = screen.getByTestId("first")
      const second = screen.getByTestId("second")
      const [x, y, width, height] = screen.renderer.getElementBounds(action.id)!
      const click = vi.spyOn(screen.renderer, "nativeSimulateClick")
      const move = vi.spyOn(screen.renderer, "nativeSimulateMouseMove")
      const focusedLabel = (): string | undefined => {
        const tree = screen.renderer.getAccessibilityTree()
        const focused = tree.gpui_focus === null ? undefined : tree.nodes[tree.gpui_focus]
        return focused?.aria.label
      }

      await screen.userEvent.click(action)
      expect(click).toHaveBeenCalledWith(x + width / 2, y + height / 2)
      expect(screen.getByText(/clicks:1/)).toBeDefined()

      await screen.userEvent.hover(action)
      expect(move).toHaveBeenCalledWith(x + width / 2, y + height / 2)
      expect(screen.getByText(/hovered:true/)).toBeDefined()
      await screen.userEvent.unhover(action)
      expect(screen.getByText(/hovered:false/)).toBeDefined()

      await screen.userEvent.keyboard(first, "a b")
      expect(screen.getByText(/first:ab/)).toBeDefined()
      await screen.userEvent.type(first, " cd")
      expect(screen.getByText(/first:ab cd/)).toBeDefined()
      await screen.userEvent.clear(first)
      expect(screen.getByText(/first: second:/)).toBeDefined()

      await screen.userEvent.type(second, "done")
      expect(screen.getByText(/second:done/)).toBeDefined()

      screen.render(
        <div>
          <a href="/one" role="link" ariaLabel="one" style={{ width: 120, height: 40 }} />
          <a href="/two" role="link" ariaLabel="two" style={{ width: 120, height: 40 }} />
        </div>
      )
      await screen.userEvent.tab()
      expect(focusedLabel()).toBe("one")
      await screen.userEvent.tab()
      expect(focusedLabel()).toBe("two")
      await screen.userEvent.tab({ shift: true })
      expect(focusedLabel()).toBe("one")
    } finally {
      screen.unmount()
    }
  })

  it("commits each keystroke before sending the next", async () => {
    const screen = createTestRoot({ width: 480, height: 240 })

    function Harness() {
      const [first, setFirst] = useState("")
      const [second, setSecond] = useState("")

      return (
        <div style={{ width: 480, height: 240, gap: 8 }}>
          <input
            data-testid="first"
            value={first}
            style={{ width: 180, height: 40 }}
            onChange={(event) => setFirst(event.value ?? "")}
          />
          <input
            data-testid="second"
            value={second}
            style={{ width: 180, height: 40 }}
            onChange={(event) => setSecond(event.value ?? "")}
          />
          <text>{`first:${first} second:${second}`}</text>
        </div>
      )
    }

    try {
      screen.render(<Harness />)

      // The tab inside the string has to move focus through React before the
      // next character is sent, as a real platform event stream would.
      await screen.userEvent.type(screen.getByTestId("first"), "a\tb")
      expect(screen.getByText("first:a second:b")).toBeDefined()
    } finally {
      screen.unmount()
    }
  })

  it("leaves the window to unhover an element that fills it", async () => {
    const screen = createTestRoot({ width: 200, height: 120 })

    function Harness() {
      const [hovered, setHovered] = useState(false)

      return (
        <div
          data-testid="surface"
          style={{ width: 200, height: 120 }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <text>{`hovered:${hovered}`}</text>
        </div>
      )
    }

    try {
      screen.render(<Harness />)
      const surface = screen.getByTestId("surface")
      const move = vi.spyOn(screen.renderer, "nativeSimulateMouseMove")

      await screen.userEvent.hover(surface)
      expect(screen.getByText("hovered:true")).toBeDefined()

      await screen.userEvent.unhover(surface)
      expect(move).toHaveBeenLastCalledWith(-1, -1)
      expect(screen.getByText("hovered:false")).toBeDefined()
    } finally {
      screen.unmount()
    }
  })

  it("re-resolves parentElement and children after a rerender", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="parent">
          <text data-testid="child">before</text>
        </div>
      )
      const parent = screen.getByTestId("parent")
      const child = screen.getByTestId("child")

      expect(parent.parentElement).toBeNull()
      // children and parentElement are non-enumerable getters, so toEqual on
      // TestElements cannot see tree position. Assert identity and order.
      expect(parent.children).toHaveLength(1)
      expect(parent.children[0]).toBe(child)
      expect(child.parentElement).toBe(parent)
      expect(Object.isFrozen(parent.children)).toBe(true)

      screen.render(
        <div data-testid="parent">
          <text data-testid="child">after</text>
          <text data-testid="sibling">new</text>
        </div>
      )
      const currentParent = screen.getByTestId("parent")
      const currentChild = screen.getByTestId("child")
      const sibling = screen.getByTestId("sibling")

      expect(parent.children).toHaveLength(2)
      expect(parent.children[0]).toBe(currentChild)
      expect(parent.children[1]).toBe(sibling)
      expect(parent.children.map((element) => element.dataTestId)).toEqual(["child", "sibling"])
      expect(parent.children).not.toContain(child)
      expect(child.parentElement).toBe(currentParent)

      screen.render(<div data-testid="parent" />)
      expect(() => child.parentElement).toThrow(/element #[0-9]+ is absent/)
    } finally {
      screen.unmount()
    }
  })

  it("sends dblClick as two clicks, the second carrying the repeat count", async () => {
    const screen = createTestRoot()
    const calls: Array<{ type: string; detail: number }> = []

    try {
      screen.render(
        <button
          data-testid="action"
          style={{ width: 120, height: 40 }}
          onClick={(event) => calls.push({ type: "click", detail: event.detail })}
          onDoubleClick={(event) =>
            calls.push({ type: "doubleClick", detail: event.detail })
          }
        />
      )

      await screen.userEvent.dblClick(screen.getByTestId("action"))

      // DOM order: dblclick follows the second click rather than replacing it.
      expect(calls).toEqual([
        { type: "click", detail: 1 },
        { type: "click", detail: 2 },
        { type: "doubleClick", detail: 2 },
      ])
    } finally {
      screen.unmount()
    }
  })

  it("fails loudly on a typo'd modifier instead of dropping it", () => {
    const screen = createTestRoot()

    try {
      screen.render(<button data-testid="action" style={{ width: 120, height: 40 }} />)

      // A silently ignored name dispatched an unmodified click, so a test
      // asserting the modified path passed while exercising the other one.
      expect(() => screen.renderer.nativeSimulateClick(10, 10, 0, "comand")).toThrow(
        /Unknown modifier 'comand' in 'comand'/
      )
      expect(() => screen.renderer.nativeSimulateClick(10, 10, 0, "cmd-shfit")).toThrow(
        /Unknown modifier 'shfit'/
      )
      expect(() => screen.renderer.nativeSimulateMouseDown(10, 10, 0, "ctrll")).toThrow(
        /Unknown modifier 'ctrll'/
      )
      expect(() => screen.renderer.nativeSimulateMouseUp(10, 10, 0, "ctrll")).toThrow(
        /Unknown modifier 'ctrll'/
      )
      expect(() => screen.renderer.nativeSimulateMouseMove(10, 10, undefined, "optn")).toThrow(
        /Unknown modifier 'optn'/
      )

      // Real names, including aliases and an empty string, still pass.
      expect(() =>
        screen.renderer.nativeSimulateClick(10, 10, 0, "cmd-shift-alt-ctrl-fn")
      ).not.toThrow()
      expect(() => screen.renderer.nativeSimulateClick(10, 10, 0, "")).not.toThrow()
    } finally {
      screen.unmount()
    }
  })
})
