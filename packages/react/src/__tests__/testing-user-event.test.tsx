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
            testId="action"
            style={{ width: 120, height: 40 }}
            onClick={() => setClicks((count) => count + 1)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          />
          <input
            testId="first"
            role="textbox"
            ariaLabel="first"
            value={first}
            style={{ width: 180, height: 40 }}
            onChange={(event) => setFirst(event.value ?? "")}
          />
          <input
            testId="second"
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

  it("re-resolves parentElement and children after a rerender", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div testId="parent">
          <text testId="child">before</text>
        </div>
      )
      const parent = screen.getByTestId("parent")
      const child = screen.getByTestId("child")

      expect(parent.parentElement).toBeNull()
      expect(parent.children).toEqual([child])
      expect(child.parentElement).toBe(parent)
      expect(Object.isFrozen(parent.children)).toBe(true)

      screen.render(
        <div testId="parent">
          <text testId="child">after</text>
          <text testId="sibling">new</text>
        </div>
      )
      const currentParent = screen.getByTestId("parent")
      const currentChild = screen.getByTestId("child")
      const sibling = screen.getByTestId("sibling")

      expect(parent.children).toEqual([currentChild, sibling])
      expect(parent.children).not.toContain(child)
      expect(child.parentElement).toBe(currentParent)

      screen.render(<div testId="parent" />)
      expect(() => child.parentElement).toThrow(/element #[0-9]+ is absent/)
    } finally {
      screen.unmount()
    }
  })

  it("reports the pending click-count dependency for dblclick", async () => {
    const screen = createTestRoot()

    try {
      screen.render(<button testId="action" style={{ width: 120, height: 40 }} />)
      await expect(
        screen.userEvent.dblclick(screen.getByTestId("action"))
      ).rejects.toThrow(/dblclick.*#216/i)
    } finally {
      screen.unmount()
    }
  })
})
