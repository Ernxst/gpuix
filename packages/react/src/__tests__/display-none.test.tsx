import React, { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "../reconciler/reconciler.js"
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
    expect(testRoot.renderer.getElementBounds(first.id)?.x).toBe(0)
    expect(testRoot.renderer.getElementBounds(third.id)?.x).toBe(100)
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
    expect(testRoot.renderer.getElementBounds(hidden.id)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
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
    expect(testRoot.renderer.getElementBounds(target.id)).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    testRoot.renderer.nativeSimulateClick(50, 10)
    expect(testRoot.renderer.getElementBounds(target.id)).toEqual({ x: 100, y: 0, width: 100, height: 20 })
  })
})

describeNative('display: "none" and focus (issue #426)', () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  it("refuses programmatic focus on an input beneath a hidden ancestor", () => {
    testRoot.render(
      <div>
        <div style={{ display: "none" }}>
          <input data-testid="hidden-input" />
        </div>
        <input data-testid="shown" />
      </div>,
    )

    const hidden = testRoot.renderer.findByTestId("hidden-input")!
    const shown = testRoot.renderer.findByTestId("shown")!

    testRoot.renderer.focusElement(hidden.id)
    expect(testRoot.renderer.getActiveElement()).toBeNull()

    testRoot.renderer.focusNext()
    expect(testRoot.renderer.getActiveElement()).toBe(shown.id)
  })

  it("refuses programmatic focus on an input whose own display is none", () => {
    testRoot.render(<input data-testid="hidden-input" style={{ display: "none" }} />)

    const hidden = testRoot.renderer.findByTestId("hidden-input")!
    testRoot.renderer.focusElement(hidden.id)

    expect(testRoot.renderer.getActiveElement()).toBeNull()
  })

  it("blurs a focused input once when an ancestor becomes hidden", () => {
    const onBlur = vi.fn()
    let hide: (() => void) | undefined

    function Toggle() {
      const [hidden, setHidden] = useState(false)
      hide = () => setHidden(true)
      return (
        <div style={{ display: hidden ? "none" : "flex" }}>
          <input data-testid="target" onBlur={onBlur} />
        </div>
      )
    }

    testRoot.render(<Toggle />)
    const target = testRoot.renderer.findByTestId("target")!
    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)

    flushSync(() => hide!())
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(testRoot.renderer.getActiveElement()).toBeNull()
  })

  it("still delivers exactly one blur when focus moves away before the old target is hidden in the same draw", () => {
    const onBlur = vi.fn()
    let hide: (() => void) | undefined

    function Toggle() {
      const [hidden, setHidden] = useState(false)
      hide = () => setHidden(true)
      return (
        <div>
          <div style={{ display: hidden ? "none" : "flex" }}>
            <input data-testid="target" onBlur={onBlur} />
          </div>
          <input data-testid="other" />
        </div>
      )
    }

    testRoot.render(<Toggle />)
    const target = testRoot.renderer.findByTestId("target")!
    const other = testRoot.renderer.findByTestId("other")!

    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)

    // GPUI records the new focus target immediately but only finalizes
    // `target`'s focus-path change (and its `blur`) on the next drawn
    // frame. Move focus to `other` and hide `target` before that frame, so
    // both land together in one draw.
    testRoot.renderer.focusElementWithoutDrawing(other.id)
    flushSync(() => hide!())
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    expect(testRoot.renderer.getActiveElement()).toBe(other.id)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it("keeps working across a hide/show cycle, including a keystroke round trip", () => {
    const onFocus = vi.fn()
    let hide: (() => void) | undefined
    let show: (() => void) | undefined

    function Toggle() {
      const [hidden, setHidden] = useState(false)
      hide = () => setHidden(true)
      show = () => setHidden(false)
      return (
        <div style={{ display: hidden ? "none" : "flex" }}>
          <input data-testid="target" onFocus={onFocus} />
        </div>
      )
    }

    testRoot.render(<Toggle />)
    const target = testRoot.renderer.findByTestId("target")!

    // Hide and show on consecutive draws: the same handle (and so the same
    // `FocusId`) must survive both, or the input's cached focus handle
    // diverges from the renderer's and focus silently stops working.
    flushSync(() => hide!())
    testRoot.renderer.flush()
    flushSync(() => show!())
    testRoot.renderer.flush()

    // The revealed input is reachable by Tab again, not just by
    // programmatic focus — closing the issue's stated done-means.
    testRoot.renderer.focusNext()
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)

    testRoot.renderer.focusElement(target.id)
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)

    testRoot.renderer.simulateKeystrokes("x")
    expect(testRoot.renderer.getInputValue(target.id)).toBe("x")
  })

  it("never autofocuses an input inserted under display: none, even after it is later shown", () => {
    // Browsers run autofocus once, at insertion, and drop a candidate that
    // isn't rendered rather than deferring it: an input mounted inside a
    // hidden subtree never autofocuses, whether or not it is later shown.
    let show: (() => void) | undefined

    function Toggle() {
      const [hidden, setHidden] = useState(true)
      show = () => setHidden(false)
      return (
        <div>
          <div style={{ display: hidden ? "none" : "flex" }}>
            <input data-testid="target" autoFocus />
          </div>
          <input data-testid="other" autoFocus />
        </div>
      )
    }

    testRoot.render(<Toggle />)
    const target = testRoot.renderer.findByTestId("target")!
    const other = testRoot.renderer.findByTestId("other")!
    expect(testRoot.renderer.getActiveElement()).not.toBe(target.id)

    flushSync(() => show!())
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    // Showing the subtree later does not retroactively autofocus it: focus
    // stays wherever it already was (here, `other`'s own autoFocus, which
    // fired at insertion because it was visible then).
    expect(testRoot.renderer.getActiveElement()).toBe(other.id)
    expect(testRoot.renderer.getActiveElement()).not.toBe(target.id)
  })

  it("still autofocuses a visible input on mount", () => {
    // Existing coverage for the ordinary case lives in style-coverage.test
    // and elsewhere; this keeps one assertion of it alongside the
    // hidden-subtree case above for contrast.
    testRoot.render(<input data-testid="target" autoFocus />)
    const target = testRoot.renderer.findByTestId("target")!
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)
  })
})

describeNative('state-refined display: "none" (issue #430)', () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  it("treats a hoverWithin-hidden subtree as hidden for focus and Tab", () => {
    testRoot.render(
      <div>
        <div
          data-testid="group"
          style={{ hoverGroup: "g", width: 200, height: 100 }}
        >
          <div data-testid="wrapper" style={{ hoverWithin: { display: "none" } }}>
            <input data-testid="target" />
          </div>
        </div>
        <input data-testid="shown" />
      </div>,
    )

    const group = testRoot.renderer.findByTestId("group")!
    const target = testRoot.renderer.findByTestId("target")!
    const shown = testRoot.renderer.findByTestId("shown")!
    const { x, y, width, height } = testRoot.renderer.getElementBounds(group.id)!

    // Focusing below activates the test window and resets its simulated pointer.
    testRoot.renderer.nativeSimulateWindowActivation(true)
    testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    testRoot.renderer.flush()

    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBeNull()
    const wrapper = testRoot.renderer.findByTestId("wrapper")!
    expect(testRoot.renderer.getElementBounds(wrapper.id)).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    testRoot.renderer.focusNext()
    expect(testRoot.renderer.getActiveElement()).toBe(shown.id)

    const window = testRoot.renderer.getWindowSize()
    testRoot.renderer.nativeSimulateMouseMove(window.width - 1, window.height - 1)
    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)
  })

  it("lets hoverWithin reveal a base-hidden element and its focusable child", () => {
    testRoot.render(
      <div>
        <div
          data-testid="group"
          style={{ hoverGroup: "g", width: 200, height: 100 }}
        >
          <div
            data-testid="revealed"
            style={{
              display: "none",
              hoverWithin: { display: "flex", width: 100, height: 20 },
            }}
          >
            <input data-testid="target" />
          </div>
        </div>
      </div>,
    )

    const group = testRoot.renderer.findByTestId("group")!
    const revealed = testRoot.renderer.findByTestId("revealed")!
    const target = testRoot.renderer.findByTestId("target")!
    expect(testRoot.renderer.getElementBounds(revealed.id)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    const { x, y, width, height } = testRoot.renderer.getElementBounds(group.id)!

    testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    testRoot.renderer.flush()

    const bounds = testRoot.renderer.getElementBounds(revealed.id)!
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)
  })

  it("blurs a focused input when hoverWithin makes it hidden", () => {
    const onBlur = vi.fn()
    testRoot.render(
      <div>
        <div
          data-testid="group"
          style={{ hoverGroup: "g", width: 200, height: 100 }}
        >
          <div style={{ hoverWithin: { display: "none" } }}>
            <input data-testid="target" onBlur={onBlur} />
          </div>
        </div>
      </div>,
    )

    const group = testRoot.renderer.findByTestId("group")!
    const target = testRoot.renderer.findByTestId("target")!
    const { x, y, width, height } = testRoot.renderer.getElementBounds(group.id)!

    testRoot.renderer.focusElement(target.id)
    expect(testRoot.renderer.getActiveElement()).toBe(target.id)

    testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(testRoot.renderer.getActiveElement()).toBeNull()
  })

  it("refuses focus on an input whose focus style hides it, firing no events", () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    testRoot.render(
      <input
        data-testid="target"
        onFocus={onFocus}
        onBlur={onBlur}
        style={{ focus: { display: "none" } }}
      />,
    )

    const target = testRoot.renderer.findByTestId("target")!

    testRoot.renderer.focusElement(target.id)
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    // OBSERVED: focusing the element also resolves its `focus` refinement to
    // display: none within the same frame, so GPUI's focus-path finalization
    // nets the focus and blur to no change: neither event fires, the active
    // element stays null, and the input remains visible (never actually
    // hidden, since it never held focus long enough for the refinement to
    // take effect).
    expect(onFocus).not.toHaveBeenCalled()
    expect(onBlur).not.toHaveBeenCalled()
    expect(testRoot.renderer.getActiveElement()).toBeNull()
    const bounds = testRoot.renderer.getElementBounds(target.id)!
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })
})
