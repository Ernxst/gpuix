import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type TestRoot,
} from "../testing.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { PublicInstance } from "../types/host.js"

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

  it("exposes HTMLElement-shaped focus and blur methods on host refs", () => {
    const ref = React.createRef<PublicInstance>()
    const otherRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div>
        <div ref={ref} tabIndex={0} ariaLabel="imperative focus target">
          <text>Target</text>
        </div>
        <div ref={otherRef} tabIndex={0} ariaLabel="other focus target">
          <text>Other</text>
        </div>
      </div>
    )

    ref.current!.focus()
    expect(testRoot.renderer.getActiveElement()).toBe(ref.current!.id)

    otherRef.current!.blur()
    expect(testRoot.renderer.getActiveElement()).toBe(ref.current!.id)

    ref.current!.blur()
    expect(testRoot.renderer.getActiveElement()).toBeNull()
  })

  it("honors focus({ preventScroll: true }) like HTMLElement.focus", () => {
    const scrollerRef = React.createRef<PublicInstance>()
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={scrollerRef} style={{ width: 200, height: 100, overflow: "scroll" }}>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} style={{ height: 40, flexShrink: 0 }}>
            {index === 4 ? (
              <div ref={targetRef} tabIndex={0} ariaLabel="deep focus target">
                <text>target</text>
              </div>
            ) : (
              <text>{`row-${index}`}</text>
            )}
          </div>
        ))}
      </div>
    )

    const scrollerId = scrollerRef.current!.id
    targetRef.current!.focus({ preventScroll: true })
    testRoot.renderer.flush()

    expect(testRoot.renderer.getActiveElement()).toBe(targetRef.current!.id)
    expect(testRoot.renderer.getScrollOffset(scrollerId)).toEqual([0, 0])

    targetRef.current!.focus()
    testRoot.renderer.flush()

    expect(testRoot.renderer.getScrollOffset(scrollerId)![1]).toBeLessThan(0)
  })

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

  it("keeps focus when Tab is prevented across phases, virtual targets, and queued presses", () => {
    let preventCapture = true
    let preventBubble = true

    testRoot.render(
      <virtual-list
        overdraw={0}
        estimatedItemHeight={40}
        onKeyDownCapture={(event) => {
          if (preventCapture && event.key === "Tab" && !event.shiftKey) {
            event.preventDefault()
          }
        }}
        onKeyDown={(event) => {
          if (preventBubble && event.key === "Tab" && event.shiftKey) {
            event.preventDefault()
          }
        }}
        style={{ width: 240, height: 120 }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <a
            key={index}
            href={`/${index}`}
            ariaLabel={`row-${index}`}
            data-testid={`row-${index}`}
            style={{ width: 200, height: 40, flexShrink: 0 }}
          >
            <text>{`Row ${index}`}</text>
          </a>
        ))}
      </virtual-list>
    )

    const list = testRoot.renderer.findByType("virtual-list")[0]!
    const third = testRoot.renderer.findByTestId("row-2")!
    testRoot.renderer.focusElement(third.id)
    expect(focusedLabel()).toBe("row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    preventCapture = false
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-3")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-40)

    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("row-3")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-40)

    preventBubble = false
    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("row-2")

    testRoot.render(
      <div style={{ width: 240, height: 120 }}>
        <a href="/first" ariaLabel="first" data-testid="first">
          <text>First</text>
        </a>
        <a
          href="/second"
          ariaLabel="second"
          onKeyDown={(event) => {
            if (event.key === "Tab") event.preventDefault()
          }}
        >
          <text>Second</text>
        </a>
        <a href="/third" ariaLabel="third">
          <text>Third</text>
        </a>
      </div>
    )

    const first = testRoot.renderer.findByTestId("first")!
    testRoot.renderer.nativeSimulateKeystrokes(first.id, "tab tab")
    expect(focusedLabel()).toBe("second")
  })

  it("continues Tab traversal after a keydown handler throws", () => {
    testRoot.render(
      <div style={{ width: 240, height: 120 }}>
        <a
          href="/first"
          ariaLabel="first"
          data-testid="throwing-tab-target"
          onKeyDown={() => {
            throw new Error("tab handler failed")
          }}
        >
          <text>First</text>
        </a>
        <a href="/second" ariaLabel="second">
          <text>Second</text>
        </a>
        <a href="/third" ariaLabel="third">
          <text>Third</text>
        </a>
      </div>
    )

    const first = testRoot.renderer.findByTestId("throwing-tab-target")!
    testRoot.renderer.focusElement(first.id)
    expect(focusedLabel()).toBe("first")

    expect(() => testRoot.renderer.simulateKeystrokes("tab")).toThrow(
      "tab handler failed"
    )
    expect(focusedLabel()).toBe("second")

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("third")
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
          data-testid="one"
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
        data-testid="plain-scroller"
        style={{ width: 240, height: 120, overflowY: "scroll" }}
      >
        {Array.from({ length: 12 }, (_, index) => (
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
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-2")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-3")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -40])

    testRoot.renderer.scrollTo(scroller.id, 0, -120)
    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("row-2")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -80])

    testRoot.renderer.scrollTo(scroller.id, 0, -120)
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-3")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-4")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-5")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -120])
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("row-6")
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -160])
  })

  it("nearest-edges focused rows in a virtual list", () => {
    testRoot.render(
      <virtual-list
        overdraw={0}
        estimatedItemHeight={40}
        style={{ width: 240, height: 120 }}
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
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-3")
    testRoot.renderer.scrollToItem(list.id, 3)
    testRoot.renderer.simulateKeystrokes("shift-tab")
    expect(focusedLabel()).toBe("virtual-row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-80)

    testRoot.renderer.scrollToItem(list.id, 3)
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-3")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-4")
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-5")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-120)
    testRoot.renderer.simulateKeystrokes("tab")
    expect(focusedLabel()).toBe("virtual-row-6")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-160)
  })

  it("focusNext reveals the next unpainted virtual row", () => {
    testRoot.render(
      <virtual-list
        overdraw={0}
        estimatedItemHeight={40}
        style={{ width: 240, height: 120 }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <a
            key={index}
            href={`/${index}`}
            ariaLabel={`imperative-row-${index}`}
            data-testid={`imperative-row-${index}`}
            style={{ width: 200, height: 40, flexShrink: 0 }}
          >
            <text>{`Imperative row ${index}`}</text>
          </a>
        ))}
      </virtual-list>
    )

    const list = testRoot.renderer.findByType("virtual-list")[0]!
    const lastPainted = testRoot.renderer.findByTestId("imperative-row-2")!
    testRoot.renderer.focusElement(lastPainted.id)
    expect(focusedLabel()).toBe("imperative-row-2")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(0)

    testRoot.renderer.focusNext()
    expect(focusedLabel()).toBe("imperative-row-3")
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1] ?? 0).toBeCloseTo(-40)
  })

  it("keeps an oversized focused row fixed when both edges are outside the viewport", () => {
    testRoot.render(
      <div style={{ width: 520, height: 520, display: "flex", flexDirection: "column" }}>
        <div
          data-testid="plain-tall-scroller"
          style={{ width: 240, height: 120, overflowY: "scroll", flexShrink: 0 }}
        >
          <a
            href="/plain-tall"
            ariaLabel="plain-tall"
            data-testid="plain-tall"
            style={{ width: 200, height: 200, flexShrink: 0 }}
          >
            <text>Plain tall row</text>
          </a>
        </div>
        <virtual-list
          itemCount={1}
          overdraw={0}
          estimatedItemHeight={200}
          style={{ width: 240, height: 120, flexShrink: 0 }}
        >
          <a
            href="/virtual-tall"
            ariaLabel="virtual-tall"
            data-testid="virtual-tall"
            style={{ width: 200, height: 200, flexShrink: 0 }}
          >
            <text>Virtual tall row</text>
          </a>
        </virtual-list>
      </div>
    )

    const plain = testRoot.renderer.findByTestId("plain-tall-scroller")!
    const plainTarget = testRoot.renderer.findByTestId("plain-tall")!
    const virtual = testRoot.renderer.findByType("virtual-list")[0]!
    const virtualTarget = testRoot.renderer.findByTestId("virtual-tall")!

    testRoot.renderer.scrollTo(plain.id, 0, -40)
    testRoot.renderer.focusElement(plainTarget.id)
    expect(focusedLabel()).toBe("plain-tall")
    expect(testRoot.renderer.getScrollOffset(plain.id)).toEqual([0, -40])

    testRoot.renderer.scrollTo(virtual.id, 0, -40)
    testRoot.renderer.focusElement(virtualTarget.id)
    expect(focusedLabel()).toBe("virtual-tall")
    expect(testRoot.renderer.getScrollOffset(virtual.id)?.[1] ?? 0).toBeCloseTo(-40)
  })

  it("reveals a focused descendant by the same distance inside a tall row", () => {
    const tallRow = (kind: "plain" | "virtual") => (
      <div
        style={{
          width: 200,
          height: 240,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 200, height: 180, flexShrink: 0 }} />
        <a
          href={`/${kind}-descendant`}
          ariaLabel={`${kind}-descendant`}
          data-testid={`${kind}-descendant`}
          style={{ width: 200, height: 40, flexShrink: 0 }}
        >
          <text>{`${kind} descendant`}</text>
        </a>
        <div style={{ width: 200, height: 20, flexShrink: 0 }} />
      </div>
    )

    testRoot.render(
      <div style={{ width: 520, height: 520, display: "flex", flexDirection: "column" }}>
        <div
          data-testid="plain-descendant-scroller"
          style={{ width: 240, height: 120, overflowY: "scroll", flexShrink: 0 }}
        >
          {tallRow("plain")}
        </div>
        <virtual-list
          itemCount={1}
          overdraw={0}
          estimatedItemHeight={240}
          style={{ width: 240, height: 120, flexShrink: 0 }}
        >
          {tallRow("virtual")}
        </virtual-list>
      </div>
    )

    const plain = testRoot.renderer.findByTestId("plain-descendant-scroller")!
    const plainTarget = testRoot.renderer.findByTestId("plain-descendant")!
    const virtual = testRoot.renderer.findByType("virtual-list")[0]!
    const virtualTarget = testRoot.renderer.findByTestId("virtual-descendant")!

    testRoot.renderer.focusElement(plainTarget.id)
    expect(focusedLabel()).toBe("plain-descendant")
    expect(testRoot.renderer.getScrollOffset(plain.id)).toEqual([0, -100])

    testRoot.renderer.focusElement(virtualTarget.id)
    expect(focusedLabel()).toBe("virtual-descendant")
    expect(testRoot.renderer.getScrollOffset(virtual.id)?.[1] ?? 0).toBeCloseTo(-100)
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
            data-testid="one"
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
