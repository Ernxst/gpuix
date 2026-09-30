import React, { useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const ROW_COUNT = 1000
const WINDOW_SIZE = 20

function WindowedRows({ initialStartIndex = 0 }: { initialStartIndex?: number }) {
  const [range, setRange] = useState({
    startIndex: initialStartIndex,
    endIndex: initialStartIndex + WINDOW_SIZE,
  })
  const start = Math.max(0, Math.min(range.startIndex, ROW_COUNT - 1))
  const end = Math.max(range.endIndex, start + 1)

  return (
    <div style={{ width: 300, height: 200, display: "flex", flexDirection: "column" }}>
      <virtual-list
        data-testid="list"
        tabIndex={0}
        itemCount={ROW_COUNT + 1}
        windowStart={start}
        estimatedItemHeight={32}
        onVisibleRange={(event) => {
          setRange((current) => ({
            startIndex: event.startIndex ?? current.startIndex,
            endIndex: event.endIndex ?? current.endIndex,
          }))
        }}
        style={{ flexGrow: 1, minHeight: 0, width: "100%" }}
      >
        {Array.from({ length: end - start }, (_, offset) => {
          const index = start + offset
          return (
            <div
              key={index}
              data-testid={`row-${index}`}
              style={{ height: 24 + (index % 3) * 8, flexShrink: 0 }}
            >
              <text>{`row ${index}`}</text>
            </div>
          )
        })}
        {end > ROW_COUNT ? <div aria-hidden={true} style={{ height: 1 }} /> : null}
      </virtual-list>
    </div>
  )
}

describeNative("virtual-list keyboard focus", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 300, height: 200 })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  it("takes Tab focus and scrolls on End", async () => {
    testRoot.render(
      <div style={{ width: 300, height: 200, display: "flex", flexDirection: "column" }}>
        <virtual-list
          data-testid="list"
          tabIndex={0}
          aria-label="Rows"
          estimatedItemHeight={40}
          style={{ flexGrow: 1, minHeight: 0 }}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <div key={index} style={{ width: 300, height: 40, flexShrink: 0 }}>
              <text>{`row ${index}`}</text>
            </div>
          ))}
        </virtual-list>
      </div>,
    )
    const list = testRoot.renderer.findByTestId("list")!

    await testRoot.userEvent.tab()
    expect(testRoot.renderer.getActiveElement()).toBe(list.id)

    testRoot.renderer.simulateKeystrokes("end")
    expect(testRoot.renderer.getScrollOffset(list.id)).toEqual([0, -1000])
  })

  it("updates the mounted window after End on a large variable-height list", async () => {
    testRoot.render(<WindowedRows />)
    const list = testRoot.renderer.findByTestId("list")!
    expect(testRoot.renderer.findByTestId("row-0")).toBeDefined()
    expect(testRoot.renderer.findByTestId("row-999")).toBeUndefined()

    await testRoot.userEvent.tab()
    expect(testRoot.renderer.getActiveElement()).toBe(list.id)

    testRoot.renderer.simulateKeystrokes("end")
    testRoot.renderer.flush()
    testRoot.renderer.drawPendingFrame()
    testRoot.renderer.flush()

    expect(testRoot.renderer.findByTestId("row-999")).toBeDefined()
    expect(testRoot.renderer.findByTestId("row-0")).toBeUndefined()
  })

  it("updates the mounted window after Home on a large variable-height list", async () => {
    testRoot.render(<WindowedRows initialStartIndex={ROW_COUNT - WINDOW_SIZE} />)
    const list = testRoot.renderer.findByTestId("list")!
    expect(testRoot.renderer.findByTestId(`row-${ROW_COUNT - WINDOW_SIZE}`)).toBeDefined()
    expect(testRoot.renderer.findByTestId("row-0")).toBeUndefined()

    await testRoot.userEvent.tab()
    expect(testRoot.renderer.getActiveElement()).toBe(list.id)

    testRoot.renderer.scrollToItem(list.id, ROW_COUNT + 1)
    expect(testRoot.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(0)

    testRoot.renderer.simulateKeystrokes("home")
    testRoot.renderer.flush()
    testRoot.renderer.drawPendingFrame()
    testRoot.renderer.flush()

    expect(testRoot.renderer.findByTestId("row-0")).toBeDefined()
    expect(testRoot.renderer.findByTestId(`row-${ROW_COUNT - WINDOW_SIZE}`)).toBeUndefined()
  })

  it("can be focused through its ref", () => {
    const ref = React.createRef<PublicInstance>()
    testRoot.render(
      <virtual-list ref={ref} data-testid="list" tabIndex={0} style={{ width: 300, height: 200 }}>
        <div style={{ height: 40 }}><text>row 0</text></div>
        <div style={{ height: 40 }}><text>row 1</text></div>
      </virtual-list>,
    )
    const list = testRoot.renderer.findByTestId("list")!

    act(() => ref.current!.focus())

    expect(testRoot.renderer.getActiveElement()).toBe(list.id)
  })

  it("applies focusVisible styles after Tab", async () => {
    testRoot.render(
      <virtual-list
        data-testid="list"
        tabIndex={0}
        style={{
          width: 300,
          height: 200,
          focusVisible: { outlineColor: "#67e8f9", outlineWidth: 4, outlineOffset: 5 },
        }}
      >
        <div style={{ height: 40 }}><text>row 0</text></div>
        <div style={{ height: 40 }}><text>row 1</text></div>
      </virtual-list>,
    )
    const list = testRoot.renderer.findByTestId("list")!

    await testRoot.userEvent.tab()

    expect(testRoot.renderer.getActiveElement()).toBe(list.id)
    expect(testRoot.renderer.getResolvedStyle(list.id).outlineWidth).toBe(4)
  })
})
