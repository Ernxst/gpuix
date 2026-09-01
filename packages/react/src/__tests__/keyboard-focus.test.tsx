import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type TestRoot,
} from "../testing.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"

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
    const events: string[] = []
    const record = (label: string, event: GpuixSyntheticEvent): void => {
      events.push(
        `${event.type}:${label}:${event.eventPhase}:${event.bubbles}:${event.cancelable}`
      )
      event.preventDefault()
      expect(event.defaultPrevented).toBe(false)
    }
    testRoot.render(
      <div
        onFocusCapture={(event) => record("parent-capture", event)}
        onFocus={(event) => record("parent-bubble", event)}
        onBlurCapture={(event) => record("parent-capture", event)}
        onBlur={(event) => record("parent-bubble", event)}
        style={{ width: 400, height: 200 }}
      >
        <a
          href="/one"
          testId="one"
          onFocus={(event) => record("one", event)}
          onBlur={(event) => record("one", event)}
          style={{ width: 200, height: 40 }}
        >
          <text>One</text>
        </a>
        <a
          href="/two"
          onFocus={(event) => record("two", event)}
          onBlur={(event) => record("two", event)}
          style={{ width: 200, height: 40 }}
        >
          <text>Two</text>
        </a>
      </div>
    )

    const first = testRoot.renderer.findByTestId("one")!
    testRoot.renderer.focusElement(first.id)
    expect(events).toEqual([
      "focus:parent-capture:1:false:false",
      "focus:one:2:false:false",
    ])

    testRoot.renderer.simulateKeystrokes("tab")
    expect(events).toEqual([
      "focus:parent-capture:1:false:false",
      "focus:one:2:false:false",
      "blur:parent-capture:1:false:false",
      "blur:one:2:false:false",
      "focus:parent-capture:1:false:false",
      "focus:two:2:false:false",
    ])

    const bounds = testRoot.renderer.getElementBounds(first.id)!
    testRoot.renderer.nativeSimulateClick(
      bounds[0]! + bounds[2]! / 2,
      bounds[1]! + bounds[3]! / 2
    )
    expect(events).toEqual([
      "focus:parent-capture:1:false:false",
      "focus:one:2:false:false",
      "blur:parent-capture:1:false:false",
      "blur:one:2:false:false",
      "focus:parent-capture:1:false:false",
      "focus:two:2:false:false",
      "blur:parent-capture:1:false:false",
      "blur:two:2:false:false",
      "focus:parent-capture:1:false:false",
      "focus:one:2:false:false",
    ])
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
