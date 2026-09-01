import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type TestRoot,
} from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("keyboard focus", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ strictStyles: false })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  function focusedLabel(): string | null {
    testRoot.renderer.flush()
    testRoot.renderer.drawPendingFrame()
    const tree = testRoot.renderer.getAccessibilityTree()
    return tree.gpui_focus ? (tree.nodes[tree.gpui_focus]?.aria.label ?? null) : null
  }

  it("tabs from a cold start and wraps backwards past the first control", () => {
    testRoot.render(
      <div style={{ width: 400, height: 200 }}>
        <a href="/one" ariaLabel="one" style={{ width: 200, height: 40 }}>
          <text>One</text>
        </a>
        <a href="/two" ariaLabel="two" style={{ width: 200, height: 40 }}>
          <text>Two</text>
        </a>
      </div>
    )

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("one")

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("two")

    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("one")

    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("two")
  })

  it("delivers focus and blur handlers for click, programmatic, and keyboard focus moves", () => {
    const focusEvents: string[] = []
    const blurEvents: string[] = []
    testRoot.render(
      <div style={{ width: 400, height: 200 }}>
        <a
          href="/one"
          testId="one"
          onFocus={() => focusEvents.push("one")}
          onBlur={() => blurEvents.push("one")}
          style={{ width: 200, height: 40 }}
        >
          <text>One</text>
        </a>
        <a
          href="/two"
          onFocus={() => focusEvents.push("two")}
          onBlur={() => blurEvents.push("two")}
          style={{ width: 200, height: 40 }}
        >
          <text>Two</text>
        </a>
      </div>
    )

    const first = testRoot.renderer.findByTestId("one")!
    testRoot.renderer.focusElement(first.id)
    expect(focusEvents).toEqual(["one"])
    expect(blurEvents).toEqual([])

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusEvents).toEqual(["one", "two"])
    expect(blurEvents).toEqual(["one"])

    const bounds = testRoot.renderer.getElementBounds(first.id)!
    testRoot.renderer.nativeSimulateClick(
      bounds[0]! + bounds[2]! / 2,
      bounds[1]! + bounds[3]! / 2
    )
    expect(focusEvents).toEqual(["one", "two", "one"])
    expect(blurEvents).toEqual(["one", "two"])
  })

  it("scrolls a plain overflow container only when tab focus leaves the viewport", () => {
    testRoot.render(
      <div
        testId="plain-scroller"
        style={{ width: 240, height: 80, overflowY: "scroll" }}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <a
            key={index}
            href={`/${index}`}
            ariaLabel={`row-${index}`}
            style={{ width: 200, height: 40, flexShrink: 0 }}
          >
            <text>{`Row ${index}`}</text>
          </a>
        ))}
      </div>
    )

    const scroller = testRoot.renderer.findByTestId("plain-scroller")!
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-0")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-1")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-2")
    expect(testRoot.renderer.getScrollOffset(scroller.id)?.[1] ?? 0).toBeLessThan(0)
  })

  it("scrolls a virtual list when tab focus leaves its visible rows", () => {
    testRoot.render(
      <virtual-list
        overdraw={0}
        estimatedItemHeight={40}
        style={{ width: 240, height: 80 }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <a
            key={index}
            href={`/${index}`}
            ariaLabel={`virtual-row-${index}`}
            style={{ width: 200, height: 40, flexShrink: 0 }}
          >
            <text>{`Virtual row ${index}`}</text>
          </a>
        ))}
      </virtual-list>
    )

    const list = testRoot.renderer.findByType("virtual-list")[0]!
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-0")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-1")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeLessThan(0)
  })

  it("does not race autoFocus or steal focus from editors", () => {
    function Editors() {
      const [input, setInput] = React.useState("")
      const [textarea, setTextarea] = React.useState("")
      return (
        <div style={{ width: 400, height: 200 }}>
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.value ?? "")}
          />
          <textarea
            value={textarea}
            onChange={(event) => setTextarea(event.value ?? "")}
          />
          <text>{`input:${input} textarea:${textarea}`}</text>
        </div>
      )
    }

    testRoot.render(<Editors />)
    testRoot.renderer.simulateKeystrokes("a")
    expect(testRoot.renderer.getAllText()).toContain("input:a textarea:")
    testRoot.renderer.simulateKeystrokes("b")
    expect(testRoot.renderer.getAllText()).toContain("input:ab textarea:")

    const textarea = testRoot.renderer.findByType("textarea")[0]!
    testRoot.renderer.focusElement(textarea.id)
    testRoot.renderer.simulateKeystrokes("c")
    expect(testRoot.renderer.getAllText()).toContain("input:ab textarea:c")
    testRoot.renderer.simulateKeystrokes("d")
    expect(testRoot.renderer.getAllText()).toContain("input:ab textarea:cd")
  })

  it("restores the root focus target when the focused element is removed", () => {
    const controls = (includeFirst: boolean) => (
      <div style={{ width: 400, height: 200 }}>
        {includeFirst && (
          <a
            key="one"
            href="/one"
            ariaLabel="one"
            testId="one"
            style={{ width: 200, height: 40 }}
          >
            <text>One</text>
          </a>
        )}
        <a key="two" href="/two" ariaLabel="two" style={{ width: 200, height: 40 }}>
          <text>Two</text>
        </a>
      </div>
    )

    testRoot.render(controls(true))
    const first = testRoot.renderer.findByTestId("one")!
    testRoot.renderer.focusElement(first.id)
    expect(focusedLabel()).toBe("one")

    testRoot.render(controls(false))
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("two")
  })
})
