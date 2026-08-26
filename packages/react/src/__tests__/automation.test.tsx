/// In-process Playwright-like automation against the real GPU test renderer.

import fs from "fs"
import os from "os"
import path from "path"
import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { connectTest } from "../automation/index.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

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
})
