/// Style props that were declared in the public type but implemented nowhere.
///
/// Each of these silently did nothing before: no error, no warning, just a prop
/// that the renderer dropped. They are easy to reintroduce, so each one gets a
/// test that fails loudly if the plumbing is removed again.

import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { createTestRoot } from "../testing.js"
import {
  expectScreenshotsDiffer,
  expectScreenshotsEqual,
  SHOTS_DIR,
} from "./test-utils.js"

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

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.any(Array))
  return bounds!
}

function centerX(bounds: number[]) {
  return bounds[0] + bounds[2] / 2
}

function centerY(bounds: number[]) {
  return bounds[1] + bounds[3] / 2
}

function HoverWithinCaptureProbe({ capture }: { capture: "child" | "group" }) {
  const capturePointer = (event: React.MouseEvent) => event.setPointerCapture()

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#101010",
      }}
    >
      <div
        testId="capture-row"
        hoverGroup="capture-row"
        onMouseDown={capture === "group" ? capturePointer : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 360,
          height: 160,
          gap: 12,
          backgroundColor: "#20283a",
        }}
      >
        <div
          testId="capture-child"
          onMouseDown={capture === "child" ? capturePointer : undefined}
          style={{ width: 120, height: 60, backgroundColor: "#64748b" }}
        />
        <span
          style={{
            width: 180,
            height: 8,
            backgroundColor: "#334155",
            hoverWithin: { backgroundColor: "#f59e0b" },
          }}
        />
      </div>
    </div>
  )
}

function HoverWithinSiblingProbe({
  forceHovered = false,
  onClick,
}: {
  forceHovered?: boolean
  onClick?: () => void
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#101010",
      }}
    >
      <div
        hoverGroup="destination-row"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 360,
          height: 120,
          gap: 8,
          backgroundColor: "#20283a",
        }}
      >
        <text
          testId="destination-label"
          onClick={onClick}
          style={{ color: "#ffffff", fontSize: 22 }}
        >
          Copper Basin
        </text>
        <span
          data-testid="destination-hover-underline"
          style={{
            width: 180,
            height: 8,
            pointerEvents: "none",
            backgroundColor: forceHovered ? "#f59e0b" : "#334155",
            hoverWithin: forceHovered ? undefined : { backgroundColor: "#f59e0b" },
          }}
        />
      </div>
    </div>
  )
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

  it("aligns mixed-size text to a flex row baseline", () => {
    const pair = (alignItems: "baseline" | "flex-end") => (
      <div style={{ display: "flex", flexDirection: "row", alignItems }}>
        <text testId={`${alignItems}-figure`} style={{ color: "#ffffff", fontSize: 32 }}>
          13
        </text>
        <text testId={`${alignItems}-unit`} style={{ color: "#ffffff", fontSize: 12 }}>
          MW
        </text>
      </div>
    )

    const baseline = createTestRoot()
    baseline.render(pair("baseline"))
    expect(baseline.renderer.drainStyleDiagnostics()).toEqual([])

    const baselineFigure = boundsFor(baseline.renderer, "baseline-figure")
    const baselineUnit = boundsFor(baseline.renderer, "baseline-unit")

    const selfBaseline = createTestRoot()
    selfBaseline.render(
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
        <text
          testId="self-baseline-figure"
          style={{ color: "#ffffff", fontSize: 32, alignSelf: "baseline" }}
        >
          13
        </text>
        <text
          testId="self-baseline-unit"
          style={{ color: "#ffffff", fontSize: 12, alignSelf: "baseline" }}
        >
          MW
        </text>
      </div>,
    )
    expect(selfBaseline.renderer.drainStyleDiagnostics()).toEqual([])
    const selfBaselineUnit = boundsFor(selfBaseline.renderer, "self-baseline-unit")

    const flexEnd = createTestRoot()
    flexEnd.render(pair("flex-end"))

    const flexEndUnit = boundsFor(flexEnd.renderer, "flex-end-unit")

    // GPUI passes the measured font baseline into Taffy's flex layout. The
    // smaller unit therefore sits above the flex-end approximation while
    // sharing the figure's baseline.
    expect(baselineUnit[1]).toBeLessThan(flexEndUnit[1])
    expect(selfBaselineUnit[1]).toBeLessThan(flexEndUnit[1])
    expect(baselineUnit[1] + baselineUnit[3]).toBeLessThan(
      baselineFigure[1] + baselineFigure[3],
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

  it("applies hoverWithin to a descendant of the nearest hoverGroup", () => {
    const { render, renderer } = createTestRoot()
    render(<HoverWithinSiblingProbe />)

    const label = renderer.findByTestId("destination-label")!
    const underline = renderer.findByTestId("destination-hover-underline")!
    expect(underline.type).toBe("div")
    const [x, y, width, height] = renderer.getElementBounds(label.id)!
    const before = path.join(SHOTS_DIR, "hover-within-before.png")
    const after = path.join(SHOTS_DIR, "hover-within-after.png")

    renderer.nativeSimulateMouseMove(10, 10)
    expect(renderer.getResolvedStyle(underline.id)).toMatchObject({
      backgroundColor: "#334155",
    })
    renderer.captureScreenshot(before)
    renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    expect(renderer.getResolvedStyle(underline.id)).toMatchObject({
      backgroundColor: "#f59e0b",
    })
    renderer.captureScreenshot(after)

    expectScreenshotsDiffer(before, after)
  })

  it("keeps hover and click interaction isolated between two live offscreen roots", () => {
    const clicked = vi.fn()
    const first = createTestRoot()
    let second: ReturnType<typeof createTestRoot> | undefined
    let reference: ReturnType<typeof createTestRoot> | undefined
    try {
      first.render(<HoverWithinSiblingProbe onClick={clicked} />)

      const label = first.renderer.findByTestId("destination-label")!
      const [x, y, width, height] = first.renderer.getElementBounds(label.id)!
      const after = path.join(SHOTS_DIR, "multi-root-hover-after.png")
      const expected = path.join(SHOTS_DIR, "multi-root-hover-expected.png")

      second = createTestRoot()
      second.render(
        <div style={{ width: "100%", height: "100%", backgroundColor: "#440000" }} />
      )

      expect(() => first.renderer.toJSON()).not.toThrow()
      expect(() => second.renderer.toJSON()).not.toThrow()

      const targetX = x + width / 2
      const targetY = y + height / 2
      first.renderer.nativeSimulateMouseMove(targetX, targetY)
      first.renderer.captureScreenshot(after)
      first.renderer.nativeSimulateClick(targetX, targetY)

      reference = createTestRoot()
      reference.render(<HoverWithinSiblingProbe forceHovered />)
      reference.renderer.captureScreenshot(expected)

      expectScreenshotsEqual(after, expected)
      expect(clicked).toHaveBeenCalledTimes(1)
    } finally {
      reference?.unmount()
      second?.unmount()
      first.unmount()
    }
  })

  it("keeps hoverWithin painted when a captured child stays inside the group", () => {
    const { render, renderer } = createTestRoot()
    render(<HoverWithinCaptureProbe capture="child" />)

    const rowBounds = boundsFor(renderer, "capture-row")
    const childBounds = boundsFor(renderer, "capture-child")
    const idle = path.join(SHOTS_DIR, "hover-within-child-capture-idle.png")
    const hovered = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-hovered.png"
    )
    const capturedInside = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-inside.png"
    )

    renderer.nativeSimulateMouseMove(10, 10)
    renderer.captureScreenshot(idle)
    renderer.nativeSimulateMouseMove(centerX(childBounds), centerY(childBounds))
    renderer.captureScreenshot(hovered)
    expectScreenshotsDiffer(idle, hovered)

    renderer.nativeSimulateMouseDown(centerX(childBounds), centerY(childBounds), 0)
    renderer.nativeSimulateMouseMove(
      rowBounds[0] + rowBounds[2] - 20,
      centerY(rowBounds),
      0
    )
    renderer.captureScreenshot(capturedInside)

    expectScreenshotsEqual(hovered, capturedInside)
    renderer.nativeSimulateMouseUp(
      rowBounds[0] + rowBounds[2] - 20,
      centerY(rowBounds),
      0
    )
  })

  it("retains hoverWithin outside the group until child capture releases", () => {
    const { render, renderer } = createTestRoot()
    render(<HoverWithinCaptureProbe capture="child" />)

    const rowBounds = boundsFor(renderer, "capture-row")
    const childBounds = boundsFor(renderer, "capture-child")
    const idle = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-leave-idle.png"
    )
    const hovered = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-leave-hovered.png"
    )
    const capturedOutside = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-outside.png"
    )
    const releasedOutside = path.join(
      SHOTS_DIR,
      "hover-within-child-capture-released.png"
    )

    renderer.nativeSimulateMouseMove(10, 10)
    renderer.captureScreenshot(idle)
    renderer.nativeSimulateMouseMove(centerX(childBounds), centerY(childBounds))
    renderer.captureScreenshot(hovered)
    expectScreenshotsDiffer(idle, hovered)
    renderer.nativeSimulateMouseDown(centerX(childBounds), centerY(childBounds), 0)
    renderer.nativeSimulateMouseMove(
      rowBounds[0] + rowBounds[2] + 40,
      centerY(rowBounds),
      0
    )
    renderer.captureScreenshot(capturedOutside)

    expectScreenshotsEqual(hovered, capturedOutside)
    renderer.nativeSimulateMouseUp(
      rowBounds[0] + rowBounds[2] + 40,
      centerY(rowBounds),
      0
    )
    renderer.captureScreenshot(releasedOutside)
    expectScreenshotsEqual(idle, releasedOutside)
  })

  it("retains hoverWithin outside the group until group capture releases", () => {
    const { render, renderer } = createTestRoot()
    render(<HoverWithinCaptureProbe capture="group" />)

    const rowBounds = boundsFor(renderer, "capture-row")
    const idle = path.join(SHOTS_DIR, "hover-within-group-capture-idle.png")
    const capturedOutside = path.join(
      SHOTS_DIR,
      "hover-within-group-capture-outside.png"
    )
    const releasedOutside = path.join(
      SHOTS_DIR,
      "hover-within-group-capture-released.png"
    )
    const captureX = rowBounds[0] + 20
    const captureY = rowBounds[1] + 20

    renderer.nativeSimulateMouseMove(10, 10)
    renderer.captureScreenshot(idle)
    renderer.nativeSimulateMouseMove(captureX, captureY)
    const hovered = path.join(SHOTS_DIR, "hover-within-group-capture-hovered.png")
    renderer.captureScreenshot(hovered)
    renderer.nativeSimulateMouseDown(captureX, captureY, 0)
    renderer.nativeSimulateMouseMove(
      rowBounds[0] + rowBounds[2] + 40,
      centerY(rowBounds),
      0
    )
    renderer.captureScreenshot(capturedOutside)

    expectScreenshotsEqual(hovered, capturedOutside)
    renderer.nativeSimulateMouseUp(
      rowBounds[0] + rowBounds[2] + 40,
      centerY(rowBounds),
      0
    )
    renderer.captureScreenshot(releasedOutside)
    expectScreenshotsEqual(idle, releasedOutside)
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

  it('lays out position: "fixed" like "absolute"', () => {
    // "fixed" already blocked hits like "absolute" but stayed in flow, so a
    // box moved when its siblings changed. Taffy has no viewport-fixed mode
    // and GPUI has no scrolling document, so the two are the same layout.
    const box = (position: "absolute" | "fixed") => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#101010",
          height: "100%",
          position: "relative",
        }}
      >
        <div style={{ height: 120, backgroundColor: "#1f2937" }} />
        <div
          style={{
            position,
            top: 20,
            left: 20,
            width: 160,
            height: 60,
            backgroundColor: "#f97316",
          }}
        />
      </div>
    )

    const absolute = path.join(SHOTS_DIR, "position-absolute.png")
    const fixed = path.join(SHOTS_DIR, "position-fixed.png")

    const first = createTestRoot()
    first.render(box("absolute"))
    first.renderer.captureScreenshot(absolute)

    const second = createTestRoot()
    second.render(box("fixed"))
    second.renderer.captureScreenshot(fixed)

    expectScreenshotsEqual(absolute, fixed)
  })
})
