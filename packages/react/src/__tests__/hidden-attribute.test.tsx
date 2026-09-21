/// The HTML `hidden` attribute, `aria-controls`, and tab selection: what Base UI
/// disclosure and tabs compositions rely on from the host.

import React, { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type { PublicInstance } from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const ZERO = { x: 0, y: 0, width: 0, height: 0 }

function labels(testRoot: TestRoot): Array<string | undefined> {
  return Object.values(testRoot.renderer.getAccessibilityTree().nodes).map(
    (node) => node.aria.label,
  )
}

function tabs(testRoot: TestRoot) {
  return Object.values(testRoot.renderer.getAccessibilityTree().nodes)
    .map((node) => node.aria)
    .filter((aria) => aria.role === "Tab")
}

describeNative("hidden", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  afterEach(() => {
    testRoot.unmount()
  })

  it("removes the subtree from layout, paint, hit testing, focus and accessibility until cleared", () => {
    const onClick = vi.fn()
    let setHidden: ((hidden: boolean | undefined) => void) | undefined

    function Row() {
      const [hidden, update] = useState<boolean | undefined>(true)
      setHidden = update
      return (
        <div style={{ display: "flex", width: 300, height: 40 }}>
          <div style={{ width: 100, height: 20 }} />
          <div
            data-testid="panel"
            hidden={hidden}
            onClick={onClick}
            role="region"
            ariaLabel="Panel"
            style={{ width: 100, height: 20 }}
          >
            <text>panel text</text>
            <input data-testid="field" style={{ width: 10, height: 10 }} />
          </div>
          <div data-testid="after" style={{ width: 100, height: 20 }} />
        </div>
      )
    }

    testRoot.render(<Row />)
    const panel = testRoot.renderer.findByTestId("panel")!
    const field = testRoot.renderer.findByTestId("field")!
    const after = testRoot.renderer.findByTestId("after")!

    const expectHidden = () => {
      expect(testRoot.renderer.getElementBounds(panel.id)).toEqual(ZERO)
      expect(testRoot.renderer.getElementBounds(after.id)?.x).toBe(100)
      expect(testRoot.renderer.getAllText()).not.toContain("panel text")
      expect(labels(testRoot)).not.toContain("Panel")
      testRoot.renderer.nativeSimulateClick(150, 10)
      expect(onClick).not.toHaveBeenCalled()
      testRoot.renderer.focusElement(field.id)
      expect(testRoot.renderer.getActiveElement()).toBeNull()
      testRoot.renderer.focusNext()
      expect(testRoot.renderer.getActiveElement()).toBeNull()
    }
    const expectShown = () => {
      expect(testRoot.renderer.getElementBounds(panel.id)).toEqual({
        x: 100,
        y: 0,
        width: 100,
        height: 20,
      })
      expect(testRoot.renderer.getElementBounds(after.id)?.x).toBe(200)
      expect(testRoot.renderer.getAllText()).toContain("panel text")
      expect(labels(testRoot)).toContain("Panel")
      testRoot.renderer.nativeSimulateClick(150, 15)
      expect(onClick).toHaveBeenCalledTimes(1)
      onClick.mockClear()
      testRoot.renderer.focusNext()
      expect(testRoot.renderer.getActiveElement()).toBe(field.id)
      testRoot.renderer.blur()
    }

    expectHidden()

    flushSync(() => setHidden!(false))
    testRoot.renderer.flush()
    expectShown()

    flushSync(() => setHidden!(true))
    testRoot.renderer.flush()
    expectHidden()

    flushSync(() => setHidden!(undefined))
    testRoot.renderer.flush()
    expectShown()
  })

  it("blurs a focused descendant when the panel becomes hidden", () => {
    const onBlur = vi.fn()
    let hide: (() => void) | undefined

    function Panel() {
      const [hidden, setHidden] = useState(false)
      hide = () => setHidden(true)
      return (
        <div hidden={hidden}>
          <input data-testid="field" onBlur={onBlur} />
        </div>
      )
    }

    testRoot.render(<Panel />)
    const field = testRoot.renderer.findByTestId("field")!
    testRoot.renderer.focusElement(field.id)
    expect(testRoot.renderer.getActiveElement()).toBe(field.id)

    flushSync(() => hide!())
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()

    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(testRoot.renderer.getActiveElement()).toBeNull()
  })

  it("yields to the author's own display, as the user-agent rule does", () => {
    testRoot.render(
      <div>
        <div data-testid="styled" hidden style={{ display: "flex", width: 50, height: 10 }} />
        <div data-testid="plain" hidden style={{ width: 50, height: 10 }} />
      </div>,
    )

    const styled = testRoot.renderer.findByTestId("styled")!
    const plain = testRoot.renderer.findByTestId("plain")!
    expect(testRoot.renderer.getElementBounds(styled.id)?.width).toBe(50)
    expect(testRoot.renderer.getElementBounds(plain.id)).toEqual(ZERO)
  })

  it("answers getAttribute and toHaveAttribute as the DOM does", () => {
    const ref = React.createRef<PublicInstance>()
    let setHidden: ((hidden: boolean | "until-found") => void) | undefined

    function Panel() {
      const [hidden, update] = useState<boolean | "until-found">(true)
      setHidden = update
      return <section ref={ref} data-testid="panel" hidden={hidden} />
    }

    testRoot.render(<Panel />)
    const panel = testRoot.getByTestId("panel")
    expect(ref.current!.getAttribute("hidden")).toBe("")
    expect(panel).toHaveAttribute("hidden", "")

    flushSync(() => setHidden!("until-found"))
    testRoot.renderer.flush()
    expect(ref.current!.getAttribute("hidden")).toBe("until-found")
    expect(testRoot.getByTestId("panel")).toHaveAttribute("hidden", "until-found")
    expect(testRoot.renderer.getElementBounds(panel.id)).toEqual(ZERO)

    flushSync(() => setHidden!(false))
    testRoot.renderer.flush()
    expect(ref.current!.hasAttribute("hidden")).toBe(false)
    expect(testRoot.getByTestId("panel")).not.toHaveAttribute("hidden")
  })
})

describeNative("disclosure panels", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  afterEach(() => {
    testRoot.unmount()
  })

  it("hides a closed panel and restores it when reopened", () => {
    function Collapsible() {
      const [open, setOpen] = useState(true)
      return (
        <div style={{ display: "flex", flexDirection: "column", width: 200 }}>
          <button
            aria-controls="details-panel"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            style={{ width: 200, height: 20 }}
          >
            <text>Details</text>
          </button>
          <div
            id="details-panel"
            data-testid="panel"
            hidden={!open}
            role="region"
            ariaLabel="Details panel"
            style={{ height: 40 }}
          >
            <text>Panel body</text>
          </div>
        </div>
      )
    }

    testRoot.render(<Collapsible />)
    const trigger = testRoot.getByRole("button", { name: "Details" })
    expect(trigger).toHaveAttribute("aria-controls", "details-panel")
    expect(testRoot.queryByRole("region", { name: "Details panel" })).not.toBeNull()
    expect(testRoot.renderer.getAllText()).toContain("Panel body")

    testRoot.renderer.nativeSimulateClick(10, 10)
    expect(testRoot.queryByRole("region", { name: "Details panel" })).toBeNull()
    expect(testRoot.renderer.getAllText()).not.toContain("Panel body")
    expect(testRoot.getByTestId("panel")).toHaveAttribute("hidden", "")

    testRoot.renderer.nativeSimulateClick(10, 10)
    expect(testRoot.queryByRole("region", { name: "Details panel" })).not.toBeNull()
    expect(testRoot.renderer.getAllText()).toContain("Panel body")
    expect(testRoot.getByTestId("panel")).not.toHaveAttribute("hidden")
    expect(testRoot.renderer.getElementBounds(testRoot.getByTestId("panel").id)?.height).toBe(40)
  })
})

describeNative("tabs", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 200 })
  })

  afterEach(() => {
    testRoot.unmount()
  })

  it("projects true, false and omitted ariaSelected and hides inactive panels", () => {
    let select: ((value: string) => void) | undefined

    function Tabs() {
      const [value, setValue] = useState("one")
      select = setValue
      return (
        <div>
          <div role="tablist" style={{ display: "flex" }}>
            <button
              role="tab"
              id="tab-one"
              aria-controls="panel-one"
              aria-selected={value === "one"}
              style={{ width: 60, height: 20 }}
            >
              <text>One</text>
            </button>
            <button
              role="tab"
              id="tab-two"
              ariaControls="panel-two"
              ariaSelected={value === "two"}
              style={{ width: 60, height: 20 }}
            >
              <text>Two</text>
            </button>
            <button role="tab" style={{ width: 60, height: 20 }}>
              <text>Three</text>
            </button>
          </div>
          <div id="panel-one" role="tabpanel" ariaLabelledBy="tab-one" hidden={value !== "one"}>
            <text>First panel</text>
          </div>
          <div id="panel-two" role="tabpanel" ariaLabelledBy="tab-two" hidden={value !== "two"}>
            <text>Second panel</text>
          </div>
        </div>
      )
    }

    testRoot.render(<Tabs />)
    expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
    expect(tabs(testRoot)).toEqual([
      expect.objectContaining({ label: "One", selected: true }),
      expect.objectContaining({ label: "Two", selected: false }),
      expect.not.objectContaining({ selected: expect.anything() }),
    ])
    expect(testRoot.getAllByRole("tabpanel").map((panel) => panel.id)).toEqual([
      testRoot.getByRole("tabpanel", { name: "One" }).id,
    ])
    expect(testRoot.getByRole("tab", { name: "One" })).toHaveAttribute("aria-controls", "panel-one")
    expect(testRoot.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-controls", "panel-two")
    expect(testRoot.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "false")
    expect(testRoot.getByRole("tab", { name: "Three" })).not.toHaveAttribute("aria-selected")

    flushSync(() => select!("two"))
    testRoot.renderer.flush()
    expect(tabs(testRoot)).toEqual([
      expect.objectContaining({ label: "One", selected: false }),
      expect.objectContaining({ label: "Two", selected: true }),
      expect.not.objectContaining({ selected: expect.anything() }),
    ])
    expect(testRoot.queryByRole("tabpanel", { name: "One" })).toBeNull()
    expect(testRoot.queryByRole("tabpanel", { name: "Two" })).not.toBeNull()
    expect(testRoot.renderer.getAllText()).not.toContain("First panel")
    expect(testRoot.renderer.getAllText()).toContain("Second panel")
  })

  it("keeps aria-controls off the accessibility snapshot and drops it on removal", () => {
    const ref = React.createRef<PublicInstance>()
    let clear: (() => void) | undefined

    function Tab() {
      const [controls, setControls] = useState<string | undefined>("panel")
      clear = () => setControls(undefined)
      return <div ref={ref} role="tab" aria-controls={controls} ariaLabel="Tab" />
    }

    testRoot.render(<Tab />)
    expect(ref.current!.getAttribute("aria-controls")).toBe("panel")
    const [tab] = tabs(testRoot)
    expect(Object.keys(tab!).some((key) => key.toLowerCase().includes("control"))).toBe(false)

    flushSync(() => clear!())
    testRoot.renderer.flush()
    expect(ref.current!.getAttribute("aria-controls")).toBeNull()
    expect(testRoot.getByRole("tab", { name: "Tab" })).not.toHaveAttribute("aria-controls")
  })
})
