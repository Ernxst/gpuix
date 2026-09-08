import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot } from "../testing.js"

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.any(Array))
  return bounds!
}

function expectBounds(
  renderer: TestRenderer,
  testId: string,
  expected: [number, number, number, number],
) {
  const bounds = boundsFor(renderer, testId)
  expected.forEach((value, index) => expect(bounds[index]).toBeCloseTo(value, 3))
}

function createGridRoot() {
  return createTestRoot({ scaleFactor: 1 })
}

function gridStyle(
  gridTemplateColumns: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return {
    display: "grid" as const,
    width: 600,
    height: 200,
    gridTemplateColumns,
    ...extra,
  }
}

describe("CSS Grid track-list layout", { timeout: 16_000 }, () => {
  it("lays out px tracks at their declared widths", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([
          { type: "px", value: 100 },
          { type: "px", value: 200 },
          { type: "px", value: 300 },
        ])}
      >
        <div data-testid="px-a" style={{ width: "100%", height: 20 }} />
        <div data-testid="px-b" style={{ width: "100%", height: 20 }} />
        <div data-testid="px-c" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    // Grid tracks start at 0; the third x coordinate is 100 + 200.
    expectBounds(renderer, "px-a", [0, 0, 100, 20])
    expectBounds(renderer, "px-b", [100, 0, 200, 20])
    expectBounds(renderer, "px-c", [300, 0, 300, 20])
  })

  it("divides free space equally across fr tracks", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div style={gridStyle([{ type: "fr", value: 1 }, { type: "fr", value: 1 }, { type: "fr", value: 1 }])}>
        <div data-testid="fr-a" style={{ width: "100%", height: 20 }} />
        <div data-testid="fr-b" style={{ width: "100%", height: 20 }} />
        <div data-testid="fr-c" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    // 600px / 3 equal fractions = 200px per track.
    expectBounds(renderer, "fr-a", [0, 0, 200, 20])
    expectBounds(renderer, "fr-b", [200, 0, 200, 20])
    expectBounds(renderer, "fr-c", [400, 0, 200, 20])
  })

  it("stretches auto tracks after sizing them from content", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div style={gridStyle([{ type: "auto" }, { type: "auto" }, { type: "auto" }])}>
        {(["a", "b", "c"] as const).map((id, index) => (
          <div data-testid={`auto-${id}`} key={id} style={{ height: 20 }}>
            <div style={{ width: 50 * (index + 1), height: 20 }} />
          </div>
        ))}
      </div>,
    )

    // 50/100/150px max-content tracks leave 300px; auto-track stretching adds
    // 300px / 3 = 100px to each, making the tracks 150/200/250px wide.
    expectBounds(renderer, "auto-a", [0, 0, 150, 20])
    expectBounds(renderer, "auto-b", [150, 0, 200, 20])
    expectBounds(renderer, "auto-c", [350, 0, 250, 20])
  })

  it("sizes a min-content track to the longest word", () => {
    const label = "grid layout"
    const { render, renderer } = createGridRoot()
    render(
      <div>
        <div style={gridStyle([{ type: "min-content" }])}>
          <div data-testid="min-content-cell" style={{ height: 20 }}>
            <text style={{ fontSize: 20 }}>{label}</text>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row" }}>
          <text data-testid="min-content-reference" style={{ fontSize: 20 }}>
            layout
          </text>
          <text data-testid="max-content-reference" style={{ fontSize: 20 }}>
            {label}
          </text>
        </div>
      </div>,
    )

    const cell = boundsFor(renderer, "min-content-cell")
    const minReference = boundsFor(renderer, "min-content-reference")
    const maxReference = boundsFor(renderer, "max-content-reference")
    expect(cell[2]).toBeCloseTo(minReference[2], 3)
    expect(cell[2]).toBeLessThan(maxReference[2])
  })

  it("sizes a max-content track to the whole line", () => {
    const label = "grid layout"
    const { render, renderer } = createGridRoot()
    render(
      <div>
        <div style={gridStyle([{ type: "max-content" }])}>
          <div data-testid="max-content-cell" style={{ height: 20 }}>
            <text style={{ fontSize: 20 }}>{label}</text>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row" }}>
          <text data-testid="max-content-reference" style={{ fontSize: 20 }}>
            {label}
          </text>
          <text data-testid="min-content-reference" style={{ fontSize: 20 }}>
            layout
          </text>
        </div>
      </div>,
    )

    const cell = boundsFor(renderer, "max-content-cell")
    const maxReference = boundsFor(renderer, "max-content-reference")
    const minReference = boundsFor(renderer, "min-content-reference")
    expect(cell[2]).toBeCloseTo(maxReference[2], 3)
    expect(cell[2]).toBeGreaterThan(minReference[2])
  })

  it("clamps minmax tracks at both their minimum and maximum", () => {
    const renderCase = (containerWidth: number, contentWidth: number, prefix: string) => {
      const root = createGridRoot()
      root.render(
        <div
          style={gridStyle(
            [{ type: "minmax", min: { type: "px", value: 100 }, max: { type: "px", value: 150 } }],
            {
              width: containerWidth,
              gridTemplateRows: [{ type: "px", value: 20 }, { type: "px", value: 20 }],
            },
          )}
        >
          <div data-testid={`${prefix}-content`} style={{ width: contentWidth, height: 20 }} />
          <div data-testid={`${prefix}-track`} style={{ width: "100%", height: 20 }} />
        </div>,
      )
      return root.renderer
    }

    // The 600px container is far larger than the 150px max, so the clamp
    // (not the container) is what limits the track: 300px content is capped
    // at the 150px max track size.
    const maximum = renderCase(600, 300, "minmax-maximum")
    expectBounds(maximum, "minmax-maximum-track", [0, 20, 150, 20])

    // A 60px container is smaller than the 100px min, so the clamp (not the
    // container) is what grows the track: 50px content is raised to the
    // 100px min track size, overflowing the container.
    const minimum = renderCase(60, 50, "minmax-minimum")
    expectBounds(minimum, "minmax-minimum-track", [0, 20, 100, 20])
  })

  it("expands repeat tracks in source order", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([
          {
            type: "repeat",
            count: 3,
            tracks: [
              { type: "px", value: 100 },
              { type: "fr", value: 1 },
            ],
          },
        ])}
      >
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div data-testid={`repeat-${index}`} key={index} style={{ width: "100%", height: 20 }} />
        ))}
      </div>,
    )

    // Each repeat contributes 100px + (600px - 3 * 100px) / 3 = 200px.
    ;[0, 100, 200, 300, 400, 500].forEach((x, index) => {
      expectBounds(renderer, `repeat-${index}`, [x, 0, 100, 20])
    })
  })

  it("applies column and row gaps between grid tracks", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle(
          [{ type: "fr", value: 1 }, { type: "fr", value: 1 }],
          {
            gridTemplateRows: [{ type: "px", value: 40 }, { type: "px", value: 40 }],
            columnGap: 20,
            rowGap: 20,
          },
        )}
      >
        <div data-testid="gap-0" style={{ width: "100%", height: 20 }} />
        <div data-testid="gap-1" style={{ width: "100%", height: 20 }} />
        <div data-testid="gap-2" style={{ width: "100%", height: 20 }} />
        <div data-testid="gap-3" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    // (600px - 20px column gap) / 2 = 290px; the second column starts at 310px.
    expectBounds(renderer, "gap-0", [0, 0, 290, 20])
    expectBounds(renderer, "gap-1", [310, 0, 290, 20])
    // The second row starts after its 40px row plus the 20px row gap.
    expectBounds(renderer, "gap-2", [0, 60, 290, 20])
    expectBounds(renderer, "gap-3", [310, 60, 290, 20])
  })

  it("aligns grid content, items, and individual children", () => {
    const centered = createGridRoot()
    centered.render(
      <div
        style={gridStyle(
          [{ type: "px", value: 100 }, { type: "px", value: 100 }],
          { justifyContent: "center", gridTemplateRows: [{ type: "px", value: 40 }] },
        )}
      >
        <div data-testid="justify-center" style={{ width: "100%", height: 20 }} />
        <div data-testid="justify-center-second" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    // The 200px grid content is centered in 600px: (600 - 200) / 2 = 200.
    expectBounds(centered.renderer, "justify-center", [200, 0, 100, 20])
    expectBounds(centered.renderer, "justify-center-second", [300, 0, 100, 20])

    const contentEnd = createGridRoot()
    contentEnd.render(
      <div
        style={gridStyle(
          [{ type: "px", value: 100 }],
          { gridTemplateRows: [{ type: "px", value: 40 }], alignContent: "end" },
        )}
      >
        <div data-testid="align-content-end" style={{ width: "100%", height: 40 }} />
      </div>,
    )

    // The 40px row ends at the bottom of the 200px container: 200 - 40 = 160.
    expectBounds(contentEnd.renderer, "align-content-end", [0, 160, 100, 40])

    const items = createGridRoot()
    items.render(
      <div
        style={gridStyle(
          [{ type: "px", value: 100 }, { type: "px", value: 100 }],
          { gridTemplateRows: [{ type: "px", value: 40 }], alignItems: "center" },
        )}
      >
        <div data-testid="align-items-center" style={{ width: "100%", height: 20 }} />
        <div data-testid="align-self-end" style={{ width: "100%", height: 20, alignSelf: "end" }} />
      </div>,
    )

    // (40px row - 20px child) / 2 = 10px; align-self:end gives 40px - 20px = 20px.
    expectBounds(items.renderer, "align-items-center", [0, 10, 100, 20])
    expectBounds(items.renderer, "align-self-end", [100, 20, 100, 20])
  })

  it("uses the tallest auto row before placing a fixed row", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle(
          [{ type: "fr", value: 1 }, { type: "fr", value: 1 }],
          {
            gridTemplateRows: [{ type: "auto" }, { type: "px", value: 60 }],
            alignContent: "start",
          },
        )}
      >
        <div data-testid="auto-row-tall" style={{ width: "100%", height: 30 }} />
        <div data-testid="auto-row-short" style={{ width: "100%", height: 20 }} />
        <div data-testid="fixed-row" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    // The first auto row is 30px tall, so the fixed 60px row begins at y = 30.
    expectBounds(renderer, "auto-row-tall", [0, 0, 300, 30])
    expectBounds(renderer, "auto-row-short", [300, 0, 300, 20])
    expectBounds(renderer, "fixed-row", [0, 30, 300, 20])
  })
})
