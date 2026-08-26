/// Style props that were declared in the public type but implemented nowhere.
///
/// Each of these silently did nothing before: no error, no warning, just a prop
/// that the renderer dropped. They are easy to reintroduce, so each one gets a
/// test that fails loudly if the plumbing is removed again.

import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, expect, it } from "vitest"
import { createTestRoot } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

/** Render two trees and assert the pixels differ, so a dropped prop fails. */
function comparePixels(name: string, a: React.ReactElement, b: React.ReactElement) {
  const left = path.join(SHOTS_DIR, `${name}-a.png`)
  const right = path.join(SHOTS_DIR, `${name}-b.png`)

  const first = createTestRoot()
  first.render(a)
  first.renderer.captureScreenshot(left)

  const second = createTestRoot()
  second.render(b)
  second.renderer.captureScreenshot(right)

  expectScreenshotsDiffer(left, right)
}

describe("style props reach the renderer", () => {
  it("applies padding to a <text> node", () => {
    // `<text>` used to apply a text-only subset of the style set, so every
    // layout prop on it was dropped.
    comparePixels(
      "text-padding",
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%" }}>
        <text style={{ fontSize: 20, color: "#ffffff" }}>indent me</text>
      </div>,
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%" }}>
        <text style={{ fontSize: 20, color: "#ffffff", paddingLeft: 120, paddingTop: 60 }}>
          indent me
        </text>
      </div>
    )
  })

  it("applies width and background to a <text> node", () => {
    comparePixels(
      "text-box",
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%" }}>
        <text style={{ fontSize: 20, color: "#ffffff" }}>boxed</text>
      </div>,
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%" }}>
        <text
          style={{
            fontSize: 20,
            color: "#ffffff",
            width: 300,
            height: 80,
            backgroundColor: "#7c86ff",
            borderRadius: 12,
          }}
        >
          boxed
        </text>
      </div>
    )
  })

  it("applies textAlign", () => {
    // `textAlign` was in StyleDesc and implemented nowhere.
    comparePixels(
      "text-align",
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#101010" }}>
        <text style={{ fontSize: 20, color: "#ffffff", width: 800, textAlign: "left" }}>
          aligned
        </text>
      </div>,
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#101010" }}>
        <text style={{ fontSize: 20, color: "#ffffff", width: 800, textAlign: "right" }}>
          aligned
        </text>
      </div>
    )
  })

  it("applies textTransform before shaping", () => {
    const transformed = createTestRoot()
    transformed.render(
      <text style={{ color: "#ffffff", fontSize: 28, textTransform: "uppercase" }}>
        PlayStation 5
      </text>
    )
    transformed.renderer.flush()
    expect(transformed.renderer.getPaintedText()).toContain("PLAYSTATION 5")

    comparePixels(
      "text-transform",
      <text style={{ color: "#ffffff", fontSize: 28 }}>PlayStation 5</text>,
      <text style={{ color: "#ffffff", fontSize: 28, textTransform: "uppercase" }}>
        PlayStation 5
      </text>
    )
  })

  it("applies letterSpacing to shaped text", () => {
    comparePixels(
      "letter-spacing",
      <text style={{ color: "#ffffff", fontSize: 28, letterSpacing: 0 }}>TRACKED LABEL</text>,
      <text style={{ color: "#ffffff", fontSize: 28, letterSpacing: 8 }}>TRACKED LABEL</text>
    )
  })

  it("applies fontSize set on a div, not only on a text node", () => {
    // `fontSize` lived only in build_text, so a div that set it alongside
    // layout props had no effect on its children.
    comparePixels(
      "div-font-size",
      <div style={{ display: "flex", padding: 20, fontSize: 12, backgroundColor: "#101010" }}>
        <text style={{ color: "#ffffff" }}>inherited size</text>
      </div>,
      <div style={{ display: "flex", padding: 20, fontSize: 34, backgroundColor: "#101010" }}>
        <text style={{ color: "#ffffff" }}>inherited size</text>
      </div>
    )
  })

  it("clears a border with borderWidth 0", () => {
    // `borderWidth: 0` was skipped by a `> 0.0` guard, so an element that drew
    // its own border could never have it removed by the caller.
    comparePixels(
      "border-clear",
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div style={{ width: 300, height: 100, borderWidth: 6, borderColor: "#ff0000" }} />
      </div>,
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div style={{ width: 300, height: 100, borderWidth: 0, borderColor: "#ff0000" }} />
      </div>
    )
  })

  it("applies per-side border widths after borderWidth", () => {
    comparePixels(
      "border-side-width",
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div style={{ width: 300, height: 140, backgroundColor: "#7c86ff" }} />
      </div>,
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div
          style={{
            width: 300,
            height: 140,
            backgroundColor: "#7c86ff",
            borderWidth: 0,
            borderBottomWidth: 12,
            borderColor: "#ff5c7a",
          }}
        />
      </div>
    )
  })

  it("applies per-corner border radii after borderRadius", () => {
    comparePixels(
      "border-corner-radius",
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div
          style={{
            width: 300,
            height: 180,
            backgroundColor: "#7c86ff",
            borderRadius: 72,
          }}
        />
      </div>,
      <div style={{ display: "flex", padding: 20, backgroundColor: "#101010" }}>
        <div
          style={{
            width: 300,
            height: 180,
            backgroundColor: "#7c86ff",
            borderRadius: 72,
            borderTopLeftRadius: 0,
          }}
        />
      </div>
    )
  })

  it("applies a structured boxShadow", () => {
    comparePixels(
      "box-shadow",
      <div style={{ display: "flex", padding: 80, backgroundColor: "#101010" }}>
        <div
          style={{
            width: 300,
            height: 140,
            backgroundColor: "#ffffff",
            borderRadius: 16,
          }}
        />
      </div>,
      <div style={{ display: "flex", padding: 80, backgroundColor: "#101010" }}>
        <div
          style={{
            width: 300,
            height: 140,
            backgroundColor: "#ffffff",
            borderRadius: 16,
            boxShadow: {
              offsetX: 24,
              offsetY: 24,
              blurRadius: 12,
              spreadRadius: 6,
              color: "#ff5c7aff",
            },
          }}
        />
      </div>
    )
  })

  it("paints an outside outline without changing measured bounds", () => {
    const withoutPath = path.join(SHOTS_DIR, "outline-paint-without.png")
    const withPath = path.join(SHOTS_DIR, "outline-paint-with.png")
    const testRoot = createTestRoot()
    const card = (outlined: boolean) => (
      <div style={{ display: "flex", padding: 80, backgroundColor: "#101010" }}>
        <div
          testId="outlined-card"
          style={{
            width: 240,
            height: 120,
            backgroundColor: "#ffffff",
            borderRadius: 16,
            outlineColor: outlined ? "#7c86ff" : undefined,
            outlineWidth: outlined ? 4 : undefined,
            outlineOffset: outlined ? 6 : undefined,
          }}
        />
      </div>
    )

    testRoot.render(card(false))
    const element = testRoot.renderer.findByTestId("outlined-card")
    expect(element).toBeDefined()
    const boundsWithout = testRoot.renderer.getElementBounds(element!.id)
    testRoot.renderer.captureScreenshot(withoutPath)

    testRoot.render(card(true))
    const boundsWith = testRoot.renderer.getElementBounds(element!.id)
    testRoot.renderer.captureScreenshot(withPath)

    expect(boundsWith).toEqual(boundsWithout)
    expectScreenshotsDiffer(withoutPath, withPath)
  })

  it("applies rowGap and columnGap", () => {
    // Both were in StyleDesc and implemented nowhere; only `gap` worked.
    const boxes = [0, 1, 2, 3].map((i) => (
      <div key={i} style={{ width: 120, height: 60, backgroundColor: "#7c86ff" }} />
    ))
    comparePixels(
      "axis-gap",
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          width: 300,
          padding: 20,
          backgroundColor: "#101010",
        }}
      >
        {boxes}
      </div>,
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          width: 300,
          padding: 20,
          rowGap: 40,
          columnGap: 24,
          backgroundColor: "#101010",
        }}
      >
        {boxes}
      </div>
    )
  })

  it("applies flexBasis", () => {
    const boxes = (withBasis: boolean) => (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          width: 600,
          height: 120,
          padding: 20,
          backgroundColor: "#101010",
        }}
      >
        <div
          style={{
            flexGrow: 1,
            flexBasis: withBasis ? 80 : undefined,
            backgroundColor: "#7c86ff",
          }}
        />
        <div
          style={{
            flexGrow: 1,
            flexBasis: withBasis ? 320 : undefined,
            backgroundColor: "#ff5c7a",
          }}
        />
      </div>
    )

    comparePixels("flex-basis", boxes(false), boxes(true))
  })

  it("applies alignContent to wrapped rows", () => {
    const boxes = [0, 1, 2, 3].map((i) => (
      <div key={i} style={{ width: 120, height: 60, backgroundColor: "#7c86ff" }} />
    ))
    const layout = (alignContent?: string) => (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignContent,
          width: 300,
          height: 400,
          padding: 20,
          backgroundColor: "#101010",
        }}
      >
        {boxes}
      </div>
    )

    comparePixels("align-content", layout(), layout("center"))
  })

  it("lays out children with display grid", () => {
    const cell = (label: string, width: number) => (
      <div
        style={{
          width,
          height: 40,
          backgroundColor: "#3b82f6",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <text style={{ color: "#ffffff", fontSize: 14 }}>{label}</text>
      </div>
    )
    comparePixels(
      "display-grid",
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%", padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {cell("a", 80)}
          {cell("b", 160)}
          {cell("c", 80)}
          {cell("d", 160)}
        </div>
      </div>,
      <div style={{ display: "flex", backgroundColor: "#101010", height: "100%", padding: 20 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: 2,
            gridColumnMin: "max-content",
          }}
        >
          {cell("a", 80)}
          {cell("b", 160)}
          {cell("c", 80)}
          {cell("d", 160)}
        </div>
      </div>
    )
  })

  it("aligns grid rows with mixed column and row track lists", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ display: "flex", width: 600, height: 120, backgroundColor: "#101010" }}>
        <div
          testId="ledger"
          style={{
            display: "grid",
            width: 600,
            gridTemplateColumns: [
              { type: "max-content" },
              {
                type: "minmax",
                min: { type: "px", value: 0 },
                max: { type: "fr", value: 1 },
              },
              { type: "auto" },
            ],
            gridTemplateRows: [
              { type: "px", value: 40 },
              { type: "px", value: 40 },
            ],
          }}
        >
          <div testId="header-name" style={{ width: 140, height: 24 }} />
          <div testId="header-rate" style={{ width: 80, height: 24 }} />
          <div testId="header-status" style={{ width: 48, height: 24 }} />
          <div testId="row-name" style={{ width: 72, height: 24 }} />
          <div testId="row-rate" style={{ width: 80, height: 24 }} />
          <div testId="row-status" style={{ width: 48, height: 24 }} />
        </div>
      </div>,
    )

    const bounds = (testId: string) => {
      const element = renderer.findByTestId(testId)
      expect(element, `missing ${testId}`).toBeDefined()
      const result = renderer.getElementBounds(element!.id)
      expect(result, `no bounds for ${testId}`).toEqual(expect.any(Array))
      return result!
    }

    const headerRate = bounds("header-rate")
    const rowRate = bounds("row-rate")
    const headerStatus = bounds("header-status")
    const rowStatus = bounds("row-status")

    expect(rowRate[0]).toBeCloseTo(headerRate[0], 4)
    expect(rowStatus[0]).toBeCloseTo(headerStatus[0], 4)
    expect(rowRate[1]).toBeGreaterThan(headerRate[1])
  })

  it("focuses an element with autoFocus so it receives keys", () => {
    // `autoFocus` was declared in Props and dropped by the reconciler, so an
    // <input> was dead until clicked.
    function Typed({ auto }: { auto: boolean }) {
      const [text, setText] = React.useState("")
      return (
        <div style={{ display: "flex", flexDirection: "column", padding: 20 }}>
          <input
            value={text}
            placeholder="type"
            autoFocus={auto}
            onKeyDown={(event) => {
              if (event.keyChar) setText((t) => t + event.keyChar)
            }}
          />
        </div>
      )
    }

    const focused = createTestRoot()
    focused.render(<Typed auto />)
    focused.renderer.simulateKeystrokes("h i")
    expect(focused.renderer.getPaintedText()).toContain("hi")

    const unfocused = createTestRoot()
    unfocused.render(<Typed auto={false} />)
    unfocused.renderer.simulateKeystrokes("h i")
    expect(unfocused.renderer.getPaintedText()).toContain("type")
  })
})
