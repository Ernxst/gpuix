/// In-process Playwright-like automation against the real GPU test renderer.

import fs from "fs"
import os from "os"
import path from "path"
import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import {
  browserRendererAsTest,
  connectTest,
  type LiveAutomationRenderer,
} from "../automation/index.js"
import { createRenderer } from "../reconciler/renderer.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"
import type { RendererCapabilities } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ width: 400, height: 200 }}>
      <div
        testId="inc"
        style={{ width: 200, height: 80 }}
        onClick={() => setCount((value) => value + 1)}
      >
        <text>{`Count: ${count}`}</text>
      </div>
    </div>
  )
}

describeNative("automation", () => {
  it("reads the active live native frame clock", () => {
    const renderer = createRenderer()
    const platform = process.platform === "darwin" ? "macos" : "windows"

    expect(renderer.capabilities()).toMatchObject({
      platform,
      frameClock:
        platform === "macos"
          ? { kind: "timer", requiresTick: true, externalFrame: true }
          : { kind: "timer", requiresTick: false, externalFrame: false },
      window: { activation: true, activate: platform === "macos", resize: true, multiple: false },
      images: { privateNetwork: true },
      automation: {
        click: true,
        hover: true,
        drag: true,
        scrollWheel: true,
        keyboard: "native",
        screenshot: true,
        screenshotFormats: ["png"],
        clock: true,
        tree: true,
      },
    })

    if (platform === "macos") {
      expect(renderer.setFrameRequestHandler(() => {})).toBe(true)
      expect(renderer.capabilities().frameClock.kind).toBe("display-link")
      renderer.setFrameRequestHandler(null)
      expect(renderer.capabilities().frameClock.kind).toBe("timer")
    }
  })

  it("reads offscreen renderer capabilities separately from the display clock", () => {
    const renderer = new TestRenderer()
    try {
      expect(renderer.capabilities()).toMatchObject({
        platform: process.platform === "darwin" ? "macos" : "windows",
        frameClock: { kind: "manual", requiresTick: false, externalFrame: false },
        window: { activation: true, activate: false, resize: true, multiple: false },
        images: { privateNetwork: true },
        automation: {
          hover: true,
          drag: true,
          scrollWheel: true,
          screenshot: true,
          screenshotFormats: ["png"],
        },
      })
      try {
        renderer.activateWindow()
        throw new Error("Expected offscreen activation to be unsupported")
      } catch (error) {
        expect(error).toMatchObject({
          name: "UnsupportedCapabilityError",
          code: "ERR_GPUX_UNSUPPORTED_CAPABILITY",
          capability: "window.activate",
        })
      }
    } finally {
      renderer.dispose()
    }
  })

  it("preserves identity attributes for native automation and synthetic events", async () => {
    const attributes: Array<string | null> = []
    const { render, renderer } = createTestRoot()

    render(
      <div
        id="site-state"
        data-testid="hover-underline"
        data-state="ready"
        onClick={(event) => {
          attributes.push(
            event.currentTarget.getAttribute("id"),
            event.currentTarget.getAttribute("data-testid"),
            event.currentTarget.getAttribute("data-state")
          )
        }}
        style={{ width: 200, height: 80 }}
      />
    )

    const heading = renderer.findByElementId("site-state")
    expect(heading).toMatchObject({
      authorId: "site-state",
      dataTestId: "hover-underline",
      customProps: { "data-testid": "hover-underline", "data-state": "ready" },
    })
    expect(renderer.findByTestId("hover-underline")).toMatchObject({
      id: heading?.id,
      type: "div",
    })
    expect(renderer.findByElementId("missing")).toBeUndefined()

    const app = await connectTest(renderer)
    await expect(app.call("getTree", {})).resolves.toMatchObject({
      tree: { authorId: "site-state" },
    })
    await expect(app.getByTestId("hover-underline").element()).resolves.toMatchObject({
      id: heading?.id,
      dataTestId: "hover-underline",
    })
    await app.close()

    renderer.nativeSimulateClick(100, 40)
    expect(attributes).toEqual(["site-state", "hover-underline", "ready"])
  })

  it("removes identity attributes instead of retaining a literal null value", () => {
    const { render, renderer } = createTestRoot()

    render(<div id="site" data-testid="row" />)
    expect(renderer.findByElementId("site")).toBeDefined()
    expect(renderer.findByTestId("row")).toBeDefined()

    render(<div />)
    expect(renderer.findByElementId("site")).toBeUndefined()
    expect(renderer.findByTestId("row")).toBeUndefined()
    expect(renderer.findByElementId("null")).toBeUndefined()
    expect(renderer.findByTestId("null")).toBeUndefined()
  })

  it("publishes a labelled button and dispatches AccessKit activate once", () => {
    const actions: string[] = []
    const { render, renderer } = createTestRoot()

    render(
      <button
        id="save"
        role="button"
        ariaLabel="Save factory"
        onAccessibilityAction={(event) => actions.push(event.accessibilityAction ?? "missing")}
      />
    )

    const tree = renderer.getAccessibilityTree()
    const button = Object.values(tree.nodes).find(
      (node) => node.aria.role === "Button" && node.aria.label === "Save factory"
    )
    expect(button).toMatchObject({
      aria: {
        role: "Button",
        label: "Save factory",
        on_action: expect.arrayContaining(["Click", "Focus"]),
      },
    })

    renderer.nativeSimulateAccessibilityAction(button!.accesskit_id, "activate")
    expect(actions).toEqual(["activate"])
  })

  it("normalizes numeric and boolean data-testid props for lookup", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <div data-testid={42} />
        <div data-testid />
      </div>
    )

    expect(renderer.findByTestId("42")?.dataTestId).toBe("42")
    expect(renderer.findByTestId("true")?.dataTestId).toBe("true")
  })

  it("clicks a testId locator and waits for text", async () => {
    const { render, renderer } = createTestRoot()
    render(<Counter />)
    const app = await connectTest(renderer)

    expect(await app.getByText("Count: 0").textContent()).toBe("Count: 0")
    await app.getByTestId("inc").click()
    await app.getByText("Count: 1").waitFor()
    expect(renderer.getAllText()).toEqual(["Count: 1"])
    await app.close()
  })

  it("captures review frames at frozen clock times", async () => {
    function Fade() {
      return (
        <div
          testId="box"
          style={{ width: 200, height: 80, backgroundColor: "#1e1e2e" }}
          motion={{
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.3, ease: "linear" },
          }}
        >
          <text>box</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Fade />)
    const app = await connectTest(renderer)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-automation-"))
    const frames = await app.captureFrames(dir, [0, 300])
    expect(frames).toHaveLength(2)
    expect(fs.statSync(frames[0]).size).toBeGreaterThan(0)
    expect(fs.statSync(frames[1]).size).toBeGreaterThan(0)
    await app.close()
  })

  it("drags a locator through interpolated moves", async () => {
    const log: string[] = []

    function Draggable() {
      const [x, setX] = useState(20)
      const [origin, setOrigin] = useState<{ pointer: number; box: number } | null>(
        null
      )
      return (
        <div style={{ width: 600, height: 200, position: "relative" }}>
          <div
            testId="handle"
            style={{
              position: "absolute",
              left: x,
              top: 40,
              width: 80,
              height: 40,
              backgroundColor: "#3366ff",
            }}
            onMouseDown={(event) => {
              log.push("down")
              setOrigin({ pointer: event.x ?? 0, box: x })
            }}
            onMouseMove={(event) => {
              if (!origin) return
              log.push("move")
              setX(origin.box + (event.x ?? 0) - origin.pointer)
            }}
            onMouseUp={() => {
              log.push("up")
              setOrigin(null)
            }}
          >
            <text>{`x=${Math.round(x)}`}</text>
          </div>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Draggable />)
    const app = await connectTest(renderer)

    await app.getByTestId("handle").dragBy(200, 0, { steps: 4 })

    expect(log).toEqual(["down", "move", "move", "move", "move", "up"])
    expect(renderer.getAllText()).toEqual(["x=220"])

    const bounds = await app.getByTestId("handle").bounds()
    expect(Math.round(bounds.x)).toBe(220)
    await app.close()
  })

  it("sends the button a click asks for", async () => {
    const seen: Array<{ button?: number; click?: boolean; aux?: boolean }> = []

    function Target() {
      return (
        <div
          testId="target"
          style={{ width: 200, height: 80, backgroundColor: "#101010" }}
          onMouseDown={(event) => seen.push({ button: event.button })}
          onClick={(event) => seen.push({ click: event.isRightClick })}
          onAuxClick={(event) => seen.push({ aux: event.isRightClick })}
        >
          <text>target</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Target />)
    const app = await connectTest(renderer)

    await app.getByTestId("target").click()
    await app.getByTestId("target").click({ button: 2 })

    // `onClick` is the primary button only, like the DOM. A right click
    // reaches `onMouseDown` and `onAuxClick`.
    expect(seen).toEqual([
      { button: 0 },
      { click: false },
      { button: 2 },
      { aux: true },
    ])
    await app.close()
  })

  it("wheels over a locator and reports held modifiers", async () => {
    const seen: Array<{ deltaY: number; cmd: boolean }> = []

    function Surface() {
      return (
        <div
          testId="surface"
          style={{ width: 300, height: 200, backgroundColor: "#101010" }}
          onScroll={(event) =>
            seen.push({
              deltaY: event.deltaY ?? 0,
              cmd: event.modifiers?.cmd ?? false,
            })
          }
        >
          <text>surface</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Surface />)
    const app = await connectTest(renderer)

    await app.getByTestId("surface").wheel(0, -60)
    await app.getByTestId("surface").wheel(0, -60, { modifiers: "cmd" })

    expect(seen).toEqual([
      { deltaY: -60, cmd: false },
      { deltaY: -60, cmd: true },
    ])
    await app.close()
  })

  // Custom elements paint themselves, so they only appear in the bounds
  // registry if their builder attaches `automation::bounds_tracker`. Without
  // it, `click()` on an editor fails with "Element has no painted bounds" and
  // the only workaround is a hard-coded pixel coordinate.
  it("gives an input and a textarea painted bounds", async () => {
    function Form() {
      const [single, setSingle] = useState("one")
      const [multi, setMulti] = useState("two")
      return (
        <div style={{ display: "flex", flexDirection: "column", width: 400, height: 200 }}>
          <input
            testId="single"
            style={{ width: 300, height: 40 }}
            value={single}
            onChange={(event) => setSingle(event.value)}
          />
          <textarea
            testId="multi"
            style={{ width: 300, height: 60 }}
            value={multi}
            onChange={(event) => setMulti(event.value)}
          />
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Form />)
    const app = await connectTest(renderer)

    const single = await app.getByTestId("single").bounds()
    const multi = await app.getByTestId("multi").bounds()
    expect(single).not.toBeNull()
    expect(multi).not.toBeNull()
    expect(single!.width).toBeGreaterThan(0)
    expect(single!.height).toBeGreaterThan(0)
    // The textarea is laid out under the input, so its box must start lower.
    expect(multi!.y).toBeGreaterThan(single!.y)

    await app.close()
  })
})

describe("browser renderer capability adapter", () => {
  it("retains browser capabilities and omits unsupported screenshots from automation", async () => {
    const capabilities: RendererCapabilities = {
      platform: "browser",
      frameClock: { kind: "raf", requiresTick: false, externalFrame: false },
      window: { activation: false, activate: false, resize: true, multiple: false },
      images: { privateNetwork: false },
      automation: {
        click: true,
        hover: true,
        drag: true,
        scrollWheel: true,
        keyboard: "browser",
        screenshot: false,
        screenshotFormats: [],
        clock: true,
        tree: true,
      },
    }
    const renderer: LiveAutomationRenderer = {
      capabilities: () => capabilities,
      simulateClick() {},
      simulateMouseDown() {},
      simulateMouseUp() {},
      simulateMouseMove() {},
      simulateScrollWheel() {},
      focusElement() {},
      blur() {},
      scrollTo() {},
      getScrollOffset: () => null,
      getAllText: () => [],
      getPaintedText: () => [],
      getSelectedText: () => null,
      clearSelection() {},
      getAutomationTree: () => "{}",
      getElementBounds: () => null,
      clockPause: () => 0,
      clockSet: (nowMs) => nowMs,
      clockFastForward: (deltaMs) => deltaMs,
      clockResume: () => 0,
    }
    const adapter = browserRendererAsTest(renderer)
    expect(adapter.capabilities?.()).toEqual(capabilities)

    const app = await connectTest(adapter)
    const initialized = await app.call("initialize", {
      protocolVersion: 1,
      client: "browser-capability-test",
    })
    expect(initialized.capabilities).toEqual(["input", "clock", "tree"])
    await app.close()
  })
})
