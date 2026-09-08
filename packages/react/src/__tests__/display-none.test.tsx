import React, { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function roles(tree: ReturnType<TestRoot["renderer"]["getAccessibilityTree"]>): string[] {
  return Object.values(tree.nodes)
    .map((node) => node.aria.role)
    .filter((role): role is string => role !== undefined)
}

describeNative('display: "none"', () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  it("takes no space in a flex row", () => {
    testRoot.render(
      <div style={{ display: "flex", width: 300, height: 40 }}>
        <div data-testid="first" style={{ width: 100, height: 20 }} />
        <div data-testid="hidden" style={{ display: "none", width: 100, height: 20 }} />
        <div data-testid="third" style={{ width: 100, height: 20 }} />
      </div>,
    )

    const first = testRoot.renderer.findByTestId("first")!
    const third = testRoot.renderer.findByTestId("third")!
    expect(testRoot.renderer.getElementBounds(first.id)?.[0]).toBe(0)
    expect(testRoot.renderer.getElementBounds(third.id)?.[0]).toBe(100)
  })

  it("reports a zero rect and omits hidden text", () => {
    testRoot.render(
      <div>
        <text>visible</text>
        <text data-testid="hidden-text" style={{ display: "none", width: 100, height: 20 }}>
          hidden
        </text>
      </div>,
    )

    const hidden = testRoot.renderer.findByTestId("hidden-text")!
    expect(testRoot.renderer.getElementBounds(hidden.id)).toEqual([0, 0, 0, 0])
    expect(hidden.getBoundingClientRect()).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
    expect(testRoot.renderer.getAllText()).toEqual(["visible"])
  })

  it("omits hidden roles and their descendants from the accessibility tree", () => {
    testRoot.render(
      <div>
        <div
          role="button"
          ariaLabel="Hidden"
          visuallyHidden
          style={{ display: "none" }}
        >
          <div role="button" ariaLabel="Child" />
        </div>
      </div>,
    )

    expect(roles(testRoot.renderer.getAccessibilityTree())).not.toContain("Button")
    const labels = Object.values(testRoot.renderer.getAccessibilityTree().nodes).map(
      (node) => node.aria.label,
    )
    expect(labels).not.toContain("Hidden")
    expect(labels).not.toContain("Child")
  })

  it("does not receive clicks in its former layout area", () => {
    const onClick = vi.fn()
    testRoot.render(
      <div style={{ display: "flex", width: 300, height: 40 }}>
        <div style={{ width: 100, height: 20 }} />
        <div
          data-testid="hidden-click"
          onClick={onClick}
          style={{ display: "none", width: 100, height: 20 }}
        />
        <div style={{ width: 100, height: 20 }} />
      </div>,
    )

    testRoot.renderer.nativeSimulateClick(150, 10)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("re-lays out when changed from none to flex", () => {
    function Toggle() {
      const [visible, setVisible] = useState(false)
      return (
        <div style={{ display: "flex", width: 300, height: 40 }}>
          <div
            data-testid="toggle"
            onClick={() => setVisible(true)}
            style={{ width: 100, height: 20 }}
          />
          <div
            data-testid="target"
            style={{ display: visible ? "flex" : "none", width: 100, height: 20 }}
          />
          <div data-testid="after-target" style={{ width: 100, height: 20 }} />
        </div>
      )
    }

    testRoot.render(<Toggle />)
    const target = testRoot.renderer.findByTestId("target")!
    expect(testRoot.renderer.getElementBounds(target.id)).toEqual([0, 0, 0, 0])

    testRoot.renderer.nativeSimulateClick(50, 10)
    expect(testRoot.renderer.getElementBounds(target.id)).toEqual([100, 0, 100, 20])
  })
})
