import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { GpuixKeyboardEvent } from "../reconciler/synthetic-event.js"

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
    const rows = Array.from({ length: 30 }, (_, index) => index)
    testRoot.render(
      <div
        data-testid="outer"
        onKeyDown={options.outerOnKeyDown}
        style={{ width: 300, height: 200, overflowX: "scroll", overflowY: "hidden" }}
      >
        <div style={{ width: 600, flexShrink: 0 }}>
          <div
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
              <textarea data-testid="textarea" style={{ width: 280, height: 40, flexShrink: 0 }} />
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
    }
  }

  async function focusFirstTabStop() {
    await testRoot.userEvent.tab()
  }

  function scrollTop(id: number) {
    return testRoot.renderer.getScrollOffset(id)![1]
  }

  it("uses Chromium line, page, space, and document steps", async () => {
    const { inner } = fixture({ innerTabIndex: 0 })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(inner.id)).toBe(-40)

    testRoot.renderer.simulateKeystrokes("pagedown")
    expect(scrollTop(inner.id)).toBe(-215)

    testRoot.renderer.simulateKeystrokes("end")
    expect(scrollTop(inner.id)).toBe(-1000)

    testRoot.renderer.simulateKeystrokes("home")
    expect(scrollTop(inner.id)).toBe(0)

    testRoot.renderer.simulateKeystrokes("space")
    expect(scrollTop(inner.id)).toBe(-175)

    testRoot.renderer.simulateKeystrokes("shift-space")
    expect(scrollTop(inner.id)).toBe(0)

    testRoot.renderer.simulateKeystrokes("space")
    testRoot.renderer.simulateKeystrokes("pageup")
    expect(scrollTop(inner.id)).toBe(0)
  })

  it("chains an axis to the nearest ancestor that can move", async () => {
    const { outer, inner } = fixture({ innerTabIndex: 0 })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("right")
    expect(testRoot.renderer.getScrollOffset(outer.id)).toEqual([-40, 0])
    expect(testRoot.renderer.getScrollOffset(inner.id)).toEqual([0, 0])

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
    const { inner } = fixture({ textarea: true })
    await focusFirstTabStop()

    testRoot.renderer.simulateKeystrokes("down")
    expect(scrollTop(inner.id)).toBe(0)
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
