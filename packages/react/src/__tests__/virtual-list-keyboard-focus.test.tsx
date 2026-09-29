import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

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
