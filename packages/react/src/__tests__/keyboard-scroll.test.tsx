import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { GpuixKeyboardEvent } from "../reconciler/synthetic-event.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("keyboard scrolling", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 300, height: 200 })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  function fixture(options: {
    innerTabIndex?: number
    innerOnKeyDown?: (event: GpuixKeyboardEvent) => void
    outerOnKeyDown?: (event: GpuixKeyboardEvent) => void
    childTabIndex?: number
    textarea?: boolean
  } = {}) {
    const outerRef = React.createRef<PublicInstance>()
    const innerRef = React.createRef<PublicInstance>()
    const textareaRef = React.createRef<PublicInstance>()
    const rows = Array.from({ length: 30 }, (_, index) => index)
    testRoot.render(
      <div
        ref={outerRef}
        data-testid="outer"
        onKeyDown={options.outerOnKeyDown}
        style={{ width: 300, height: 200, overflowX: "scroll", overflowY: "hidden" }}
      >
        <div style={{ width: 600, flexShrink: 0 }}>
          <div
            ref={innerRef}
            data-testid="inner"
            tabIndex={options.innerTabIndex}
            onKeyDown={options.innerOnKeyDown}
            style={{
              width: 300,
              height: 200,
              overflowY: "scroll",
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {options.textarea ? (
              <textarea
                ref={textareaRef}
                data-testid="textarea"
                style={{ width: 280, height: 40, flexShrink: 0 }}
              />
            ) : (
              rows.map((row) => (
                <div
                  key={row}
                  tabIndex={options.childTabIndex}
                  style={{ width: 300, height: 40, flexShrink: 0 }}
                >
                  <text>{`row ${row}`}</text>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )
    return {
      outer: testRoot.renderer.findByTestId("outer")!,
      inner: testRoot.renderer.findByTestId("inner")!,
      outerRef,
      innerRef,
      textareaRef,
    }
  }

  async function focusFirstTabStop() {
    await testRoot.userEvent.tab()
  }

  function scrollTop(id: number) {
    return testRoot.renderer.getScrollOffset(id)![1]
  }

  it("uses Chromium line, page, space, and document steps", async () => {
    const { inner, innerRef } = fixture({ innerTabIndex: 0 })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(inner.id)).toBe(-40)
    expect(innerRef.current!.scrollTop).toBe(40)

    testRoot.renderer.simulateKeystrokes("pagedown")
    expect(scrollTop(inner.id)).toBe(-215)
    expect(innerRef.current!.scrollTop).toBe(215)

    testRoot.renderer.simulateKeystrokes("end")
    expect(scrollTop(inner.id)).toBe(-1000)
    expect(innerRef.current!.scrollTop).toBe(1000)

    testRoot.renderer.simulateKeystrokes("home")
    expect(scrollTop(inner.id)).toBe(0)
    expect(innerRef.current!.scrollTop).toBe(0)

    testRoot.renderer.simulateKeystrokes("space")
    expect(scrollTop(inner.id)).toBe(-175)
    expect(innerRef.current!.scrollTop).toBe(175)

    testRoot.renderer.simulateKeystrokes("shift-space")
    expect(scrollTop(inner.id)).toBe(0)
    expect(innerRef.current!.scrollTop).toBe(0)

    testRoot.renderer.simulateKeystrokes("space")
    expect(innerRef.current!.scrollTop).toBe(175)
    testRoot.renderer.simulateKeystrokes("pageup")
    expect(scrollTop(inner.id)).toBe(0)
    expect(innerRef.current!.scrollTop).toBe(0)
  })

  it("chains an axis to the nearest ancestor that can move", async () => {
    const { outer, inner, outerRef, innerRef } = fixture({ innerTabIndex: 0 })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("right")
    expect(testRoot.renderer.getScrollOffset(outer.id)).toEqual([-40, 0])
    expect(testRoot.renderer.getScrollOffset(inner.id)).toEqual([0, 0])
    expect(outerRef.current!.scrollLeft).toBe(40)
    expect(innerRef.current!.scrollLeft).toBe(0)
    expect(innerRef.current!.scrollTop).toBe(0)

    testRoot.renderer.scrollTo(inner.id, 0, -1000)
    const before = testRoot.renderer.getScrollOffset(outer.id)
    testRoot.renderer.simulateKeystrokes("down")
    expect(testRoot.renderer.getScrollOffset(inner.id)).toEqual([0, -1000])
    expect(testRoot.renderer.getScrollOffset(outer.id)).toEqual(before)
  })

  it("scrolls an unfocusable scroller for a focused child", async () => {
    const { inner } = fixture({ childTabIndex: 0 })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(inner.id)).toBe(-40)
  })

  it("emits one focused-target keydown through an ancestor listener", async () => {
    const calls: GpuixKeyboardEvent[] = []
    const { inner, outerRef, innerRef } = fixture({
      innerTabIndex: 0,
      outerOnKeyDown: (event) => calls.push(event),
    })
    await focusFirstTabStop()
    calls.length = 0

    testRoot.renderer.simulateKeystrokes("down")

    expect(calls).toHaveLength(1)
    expect(calls[0]!.target.id).toBe(innerRef.current!.id)
    expect(calls[0]!.currentTarget.id).toBe(outerRef.current!.id)
    expect(scrollTop(inner.id)).toBe(-40)
  })

  it("lets keydown prevention cancel the scroll default", async () => {
    const preventedOnScroller = fixture({
      innerTabIndex: 0,
      innerOnKeyDown: (event) => event.preventDefault(),
    })
    await focusFirstTabStop()
    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(preventedOnScroller.inner.id)).toBe(0)

    testRoot.render(null)
    const preventedOnAncestor = fixture({
      innerTabIndex: 0,
      outerOnKeyDown: (event) => event.preventDefault(),
    })
    await focusFirstTabStop()
    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(preventedOnAncestor.inner.id)).toBe(0)

    testRoot.render(null)
    const allowed = fixture({
      innerTabIndex: 0,
      outerOnKeyDown: () => {},
    })
    await focusFirstTabStop()
    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(allowed.inner.id)).toBe(-40)
  })

  it("does not scroll an input or textarea editor", async () => {
    const calls: GpuixKeyboardEvent[] = []
    const { inner } = fixture({
      textarea: true,
      outerOnKeyDown: (event) => calls.push(event),
    })
    await focusFirstTabStop()
    calls.length = 0

    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(inner.id)).toBe(0)
    // Editor action bindings consume the key before raw listeners; editor
    // keydown delivery is tracked separately.
    expect(calls).toHaveLength(0)
  })

  it("chains past a virtual list already at its bottom", () => {
    const rowRef = React.createRef<PublicInstance>()
    testRoot.render(
      <div
        data-testid="outer-list-scroller"
        style={{ width: 300, height: 200, overflowY: "scroll" }}
      >
        <virtual-list
          data-testid="keyboard-list"
          estimatedItemHeight={40}
          style={{ width: 300, height: 200 }}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <div
              key={index}
              ref={index === 0 ? rowRef : undefined}
              tabIndex={index === 0 ? 0 : undefined}
              style={{ width: 300, height: 40, flexShrink: 0 }}
            />
          ))}
        </virtual-list>
        <div style={{ width: 300, height: 200, flexShrink: 0 }} />
      </div>,
    )
    const outer = testRoot.renderer.findByTestId("outer-list-scroller")!
    const list = testRoot.renderer.findByTestId("keyboard-list")!
    rowRef.current!.focus()
    testRoot.renderer.scrollTo(list.id, 0, -1000)

    testRoot.renderer.simulateKeystrokes("down")

    expect(testRoot.renderer.getScrollOffset(list.id)).toEqual([0, -1000])
    expect(testRoot.renderer.getScrollOffset(outer.id)).toEqual([0, -40])
  })

  it("targets the root once when nothing is focused", () => {
    let keyDowns = 0
    testRoot.render(
      <div onKeyDown={() => keyDowns++}>
        <div data-testid="scroller" style={{ width: 200, height: 100, overflowY: "scroll" }}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} style={{ height: 40, flexShrink: 0 }} />
          ))}
        </div>
      </div>
    )
    const scroller = testRoot.renderer.findByTestId("scroller")!

    testRoot.renderer.simulateKeystrokes("down")
    expect(keyDowns).toBe(1)
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])
  })
})
