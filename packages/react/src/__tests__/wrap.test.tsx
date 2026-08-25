/// Geometry tests for text wrap, nowrap overflow, and flex min-width.

import path from "path"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const PROSE =
  "The longest word in any of the major English language dictionaries is pneumonoultramicroscopicsilicovolcanoconiosis"

function rect(renderer: ReturnType<typeof createTestRoot>["renderer"], testId: string) {
  const el = renderer.findByTestId(testId)
  expect(el, `missing testId ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(el!.id)
  expect(bounds, `no painted bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: bounds![0], y: bounds![1], width: bounds![2], height: bounds![3] }
}

function expectInside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) {
  const slop = 1
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - slop)
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - slop)
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + slop)
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + slop)
}

describeNative("text wrapping", () => {
  it("wraps prose inside a definite width", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="box"
        style={{
          width: 200,
          padding: 8,
          backgroundColor: "#111",
        }}
      >
        <text testId="prose" style={{ fontSize: 14, lineHeight: 20, color: "#eee" }}>
          {PROSE}
        </text>
      </div>,
    )

    const box = rect(renderer, "box")
    const prose = rect(renderer, "prose")
    expectInside(prose, box)
    expect(prose.width).toBeLessThanOrEqual(200)
    expect(prose.height).toBeGreaterThan(20)
  })

  it("grows taller in a narrower box", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 160 }}>
        <text testId="prose" style={{ fontSize: 14, lineHeight: 20, color: "#eee" }}>
          {PROSE}
        </text>
      </div>,
    )
    const narrowHeight = rect(renderer, "prose").height

    render(
      <div style={{ width: 480 }}>
        <text testId="prose" style={{ fontSize: 14, lineHeight: 20, color: "#eee" }}>
          {PROSE}
        </text>
      </div>,
    )
    expect(narrowHeight).toBeGreaterThan(rect(renderer, "prose").height)
  })

  it("breaks a long unbreakable token instead of overflowing", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="box"
        style={{ width: 140, padding: 4, backgroundColor: "#111" }}
      >
        <text testId="token" style={{ fontSize: 14, lineHeight: 20, color: "#eee" }}>
          pneumonoultramicroscopicsilicovolcanoconiosis
        </text>
      </div>,
    )

    const box = rect(renderer, "box")
    const token = rect(renderer, "token")
    expectInside(token, box)
    expect(token.height).toBeGreaterThan(20)
  })

  it("keeps nowrap text on one line while the same string wraps", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 120 }}>
        <text testId="line" style={{ fontSize: 14, lineHeight: 20, color: "#eee" }}>
          {PROSE}
        </text>
      </div>,
    )
    const wrappedHeight = rect(renderer, "line").height

    render(
      <div style={{ width: 120 }}>
        <text
          testId="line"
          style={{ fontSize: 14, lineHeight: 20, color: "#eee", whiteSpace: "nowrap" }}
        >
          {PROSE}
        </text>
      </div>,
    )
    const nowrapHeight = rect(renderer, "line").height
    expect(wrappedHeight).toBeGreaterThan(nowrapHeight)
    expect(nowrapHeight).toBeLessThanOrEqual(22)
  })

  it("wraps in a flex row when the text has minWidth 0", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="row"
        style={{
          display: "flex",
          flexDirection: "row",
          width: 240,
          backgroundColor: "#111",
        }}
      >
        <div style={{ width: 48, flexShrink: 0, backgroundColor: "#333" }} />
        <text
          testId="prose"
          style={{
            fontSize: 14,
            lineHeight: 20,
            color: "#eee",
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          {PROSE}
        </text>
      </div>,
    )

    const row = rect(renderer, "row")
    const prose = rect(renderer, "prose")
    expectInside(prose, row)
    expect(prose.height).toBeGreaterThan(20)
  })

  it("keeps a markdown list item inside a flex column", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="col"
        style={{
          display: "flex",
          flexDirection: "row",
          width: 280,
          backgroundColor: "#111",
        }}
      >
        <div style={{ width: 40, flexShrink: 0 }} />
        <markdown
          testId="md"
          source="- a second item with a long sentence that must wrap without leaving the transcript column"
          style={{ flexGrow: 1, minWidth: 0 }}
        />
      </div>,
    )

    expectInside(rect(renderer, "md"), rect(renderer, "col"))
    expect(rect(renderer, "md").width).toBeLessThanOrEqual(240)
    expect(rect(renderer, "md").height).toBeGreaterThan(20)
  })

  it("keeps markdown inside a flex row without an explicit minWidth", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="col"
        style={{
          display: "flex",
          flexDirection: "row",
          width: 280,
          backgroundColor: "#111",
        }}
      >
        <div style={{ width: 40, flexShrink: 0 }} />
        <markdown
          testId="md"
          source="This paragraph is long enough that it must wrap once the flex item is allowed to shrink below its max-content width."
          style={{ flexGrow: 1 }}
        />
      </div>,
    )

    expectInside(rect(renderer, "md"), rect(renderer, "col"))
    expect(rect(renderer, "md").width).toBeLessThanOrEqual(240)
  })

  it("keeps a fenced markdown code line inside a narrow column", () => {
    const { render, renderer } = createTestRoot()
    const line = "const tree = mdxParse(source) // ".padEnd(180, "x")
    render(
      <div testId="col" style={{ width: 240, backgroundColor: "#111" }}>
        <markdown testId="md" source={"```ts\n" + line + "\n```"} />
      </div>,
    )

    expectInside(rect(renderer, "md"), rect(renderer, "col"))
    expect(renderer.getPaintedText()).toContain(line)
  })

  it("records bounds on an empty markdown node", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div testId="col" style={{ width: 240, height: 40, backgroundColor: "#111" }}>
        <markdown testId="md" source="" />
      </div>,
    )
    expect(rect(renderer, "md").width).toBeGreaterThan(0)
  })

  it("pans a wide markdown fence on a horizontal wheel", () => {
    const { render, renderer } = createTestRoot()
    const line = "const wide = '".padEnd(220, "x") + "'"
    render(
      <div testId="col" style={{ width: 240, padding: 8, backgroundColor: "#111" }}>
        <markdown source={"```ts\n" + line + "\n```"} />
      </div>,
    )
    const before = path.join(SHOTS_DIR, "wrap-md-code-x-before.png")
    const after = path.join(SHOTS_DIR, "wrap-md-code-x-after.png")
    renderer.captureScreenshot(before)
    renderer.nativeSimulateScrollWheel(80, 50, -160, 0)
    renderer.captureScreenshot(after)
    expectScreenshotsDiffer(before, after)
  })

  it("pans a wide <code> block on a horizontal wheel", () => {
    const { render, renderer } = createTestRoot()
    const line = "const wide = '".padEnd(220, "x") + "'"
    render(
      <div testId="col" style={{ width: 240, padding: 8, backgroundColor: "#111" }}>
        <code code={line + "\n" + line} language="ts" />
      </div>,
    )
    const before = path.join(SHOTS_DIR, "wrap-code-x-before.png")
    const after = path.join(SHOTS_DIR, "wrap-code-x-after.png")
    renderer.captureScreenshot(before)
    renderer.nativeSimulateScrollWheel(80, 50, -160, 0)
    renderer.captureScreenshot(after)
    expectScreenshotsDiffer(before, after)
  })

  it("lets a parent scroller take a vertical wheel over a wide markdown fence", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div testId="scroller" style={{ width: 240, height: 120, overflowY: "scroll" }}>
        <markdown source={"```ts\n" + "const wide = '".padEnd(200, "x") + "'\n```"} />
        <div style={{ height: 400 }}>
          <text>below</text>
        </div>
      </div>,
    )

    const scroller = renderer.findByTestId("scroller")
    expect(scroller).toBeDefined()
    expect(renderer.getScrollOffset(scroller!.id)).toEqual([0, 0])

    renderer.nativeSimulateScrollWheel(80, 50, 0, -80)
    const offset = renderer.getScrollOffset(scroller!.id)
    expect(offset).not.toBeNull()
    expect(offset![1]).toBeLessThan(0)
  })
})
