import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot } from "../testing.js"

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }))
  return bounds!
}

function bottom(bounds: { y: number; height: number }) {
  return bounds.y + bounds.height
}

describe("flex baseline layout", () => {
  it("aligns every virtual-list row root independently", () => {
    const { render, renderer } = createTestRoot()
    render(
      <virtual-list
        overdraw={0}
        estimatedItemHeight={52}
        style={{ width: 240, height: 104 }}
      >
        {[0, 1].map((index) => (
          <div
            key={index}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
              height: 52,
              flexShrink: 0,
            }}
          >
            <text data-testid={`row-${index}-large`} style={{ fontSize: 32 }}>
              13
            </text>
            <text data-testid={`row-${index}-small`} style={{ fontSize: 12 }}>
              MW
            </text>
          </div>
        ))}
      </virtual-list>,
    )

    for (const index of [0, 1]) {
      const large = boundsFor(renderer, `row-${index}-large`)
      const small = boundsFor(renderer, `row-${index}-small`)
      expect(bottom(small)).toBeLessThan(bottom(large))
    }
  })

  it("aligns each wrapped flex line independently", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "baseline",
          alignContent: "stretch",
          width: 60,
          height: 104,
        }}
      >
        {[32, 12, 32, 12].map((fontSize, index) => (
          <text key={index} data-testid={`wrapped-${index}`} style={{ width: 30, fontSize }}>
            X
          </text>
        ))}
      </div>,
    )

    const firstLine = [boundsFor(renderer, "wrapped-0"), boundsFor(renderer, "wrapped-1")]
    const secondLine = [boundsFor(renderer, "wrapped-2"), boundsFor(renderer, "wrapped-3")]

    expect(Math.max(...firstLine.map(bottom))).toBeLessThanOrEqual(
      Math.min(...secondLine.map((bounds) => bounds.y)),
    )
    expect(bottom(firstLine[1])).toBeLessThan(bottom(firstLine[0]))
    expect(bottom(secondLine[1])).toBeLessThan(bottom(secondLine[0]))
  })

  it("uses the border-box bottom as a synthesized baseline", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div
        data-testid="synthesized-baseline-row"
        style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}
      >
        <div data-testid="baseline-box" style={{ width: 32, height: 32 }} />
        <text data-testid="baseline-text" style={{ fontSize: 16 }}>
          MW
        </text>
      </div>,
    )

    const box = boundsFor(renderer, "baseline-box")
    const text = boundsFor(renderer, "baseline-text")
    const row = boundsFor(renderer, "synthesized-baseline-row")
    expect(bottom(text)).toBeGreaterThan(bottom(box))
    expect(row.height).toBeGreaterThan(box.height)
  })

  it("exports the resolved baseline of a nested container", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
          <text data-testid="nested-small" style={{ fontSize: 12 }}>
            MW
          </text>
          <text data-testid="nested-large" style={{ fontSize: 32 }}>
            13
          </text>
        </div>
        <text data-testid="outer-small" style={{ fontSize: 12 }}>
          MW
        </text>
      </div>,
    )

    const nestedSmall = boundsFor(renderer, "nested-small")
    const nestedLarge = boundsFor(renderer, "nested-large")
    const outerSmall = boundsFor(renderer, "outer-small")

    expect(nestedSmall.y).toBeCloseTo(outerSmall.y, 0)
    expect(nestedLarge.y).toBeLessThan(nestedSmall.y)
  })

  it("uses the shaped font metrics of a flattened inline run", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
        <text
          data-testid="inline-run-baseline"
          style={{ fontFamily: "Courier New", fontSize: 32, lineHeight: 40 }}
        >
          <text style={{ fontFamily: "Times New Roman" }}>Ag</text>
        </text>
        <text
          data-testid="inline-run-reference"
          style={{ fontFamily: "Times New Roman", fontSize: 32, lineHeight: 40 }}
        >
          Ag
        </text>
      </div>,
    )

    const inlineRun = boundsFor(renderer, "inline-run-baseline")
    const reference = boundsFor(renderer, "inline-run-reference")
    expect(inlineRun.y).toBeCloseTo(reference.y, 0)
    expect(inlineRun.height).toBeCloseTo(reference.height, 0)
  })
})
