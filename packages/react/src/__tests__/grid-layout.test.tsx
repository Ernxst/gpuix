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

function expectBounds(
  renderer: TestRenderer,
  testId: string,
  expected: { x: number; y: number; width: number; height: number },
) {
  const bounds = boundsFor(renderer, testId)
  expect(bounds.x).toBeCloseTo(expected.x, 3)
  expect(bounds.y).toBeCloseTo(expected.y, 3)
  expect(bounds.width).toBeCloseTo(expected.width, 3)
  expect(bounds.height).toBeCloseTo(expected.height, 3)
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
    expectBounds(renderer, "px-a", { x: 0, y: 0, width: 100, height: 20 })
    expectBounds(renderer, "px-b", { x: 100, y: 0, width: 200, height: 20 })
    expectBounds(renderer, "px-c", { x: 300, y: 0, width: 300, height: 20 })
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
    expectBounds(renderer, "fr-a", { x: 0, y: 0, width: 200, height: 20 })
    expectBounds(renderer, "fr-b", { x: 200, y: 0, width: 200, height: 20 })
    expectBounds(renderer, "fr-c", { x: 400, y: 0, width: 200, height: 20 })
  })

  it("sizes percentage tracks from the grid container", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([
          { type: "percent", value: 25 },
          { type: "px", value: 100 },
        ])}
      >
        <div data-testid="percent-track" style={{ width: "100%", height: 20 }} />
        <div data-testid="percent-px-track" style={{ width: "100%", height: 20 }} />
      </div>,
    )

    expectBounds(renderer, "percent-track", { x: 0, y: 0, width: 150, height: 20 })
    expectBounds(renderer, "percent-px-track", { x: 150, y: 0, width: 100, height: 20 })
  })

  it("clamps fit-content tracks between content contributions and their limit", () => {
    const label = "a long single-line grid label"
    const { render, renderer } = createGridRoot()
    render(
      <div>
        <div style={gridStyle([{ type: "fit-content", limit: { type: "px", value: 200 } }])}>
          <text data-testid="fit-content-long" style={{ fontSize: 20 }}>
            {label}
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "row" }}>
          <text data-testid="fit-content-long-reference" style={{ fontSize: 20 }}>
            {label}
          </text>
        </div>
        <div style={gridStyle([{ type: "fit-content", limit: { type: "px", value: 200 } }])}>
          <text data-testid="fit-content-short" style={{ fontSize: 20 }}>
            short
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "row" }}>
          <text data-testid="fit-content-short-reference" style={{ fontSize: 20 }}>
            short
          </text>
        </div>
      </div>,
    )

    const long = boundsFor(renderer, "fit-content-long")
    const longReference = boundsFor(renderer, "fit-content-long-reference")
    const short = boundsFor(renderer, "fit-content-short")
    const shortReference = boundsFor(renderer, "fit-content-short-reference")
    expect(long.width).toBeCloseTo(200, 3)
    expect(long.width).toBeLessThan(longReference.width)
    expect(short.width).toBeCloseTo(shortReference.width, 3)
  })

  it("uses percentage minmax bounds when distributing flexible tracks", () => {
    const low = createGridRoot()
    low.render(
      <div
        style={gridStyle([
          { type: "minmax", min: { type: "percent", value: 10 }, max: { type: "fr", value: 1 } },
          { type: "fr", value: 1 },
        ])}
      >
        <div data-testid="minmax-percent-low" style={{ width: "100%", minWidth: 0, height: 20 }} />
        <div data-testid="minmax-percent-low-second" style={{ width: "100%", minWidth: 0, height: 20 }} />
      </div>,
    )

    expectBounds(low.renderer, "minmax-percent-low", { x: 0, y: 0, width: 300, height: 20 })
    expectBounds(low.renderer, "minmax-percent-low-second", { x: 300, y: 0, width: 300, height: 20 })

    const high = createGridRoot()
    high.render(
      <div
        style={gridStyle([
          { type: "minmax", min: { type: "percent", value: 60 }, max: { type: "fr", value: 1 } },
          { type: "fr", value: 1 },
        ])}
      >
        <div data-testid="minmax-percent-high" style={{ width: "100%", minWidth: 0, height: 20 }} />
        <div data-testid="minmax-percent-high-second" style={{ width: "100%", minWidth: 0, height: 20 }} />
      </div>,
    )

    expectBounds(high.renderer, "minmax-percent-high", { x: 0, y: 0, width: 360, height: 20 })
    expectBounds(high.renderer, "minmax-percent-high-second", { x: 360, y: 0, width: 240, height: 20 })
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
    expectBounds(renderer, "auto-a", { x: 0, y: 0, width: 150, height: 20 })
    expectBounds(renderer, "auto-b", { x: 150, y: 0, width: 200, height: 20 })
    expectBounds(renderer, "auto-c", { x: 350, y: 0, width: 250, height: 20 })
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
    expect(cell.width).toBeCloseTo(minReference.width, 3)
    expect(cell.width).toBeLessThan(maxReference.width)
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
    expect(cell.width).toBeCloseTo(maxReference.width, 3)
    expect(cell.width).toBeGreaterThan(minReference.width)
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
    expectBounds(maximum, "minmax-maximum-track", { x: 0, y: 20, width: 150, height: 20 })

    // A 60px container is smaller than the 100px min, so the clamp (not the
    // container) is what grows the track: 50px content is raised to the
    // 100px min track size, overflowing the container.
    const minimum = renderCase(60, 50, "minmax-minimum")
    expectBounds(minimum, "minmax-minimum-track", { x: 0, y: 20, width: 100, height: 20 })
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
      expectBounds(renderer, `repeat-${index}`, { x: x, y: 0, width: 100, height: 20 })
    })
  })

  it("repeats auto-fill tracks as many times as the container permits", () => {
    const autoFillColumns = [
      {
        type: "repeat",
        count: "auto-fill",
        tracks: [{ type: "minmax", min: { type: "px", value: 180 }, max: { type: "fr", value: 1 } }],
      },
    ]

    // 800px / 180px-minimum tracks fits 4 repetitions (800 / 180 = 4.44).
    const wide = createGridRoot()
    wide.render(
      <div style={gridStyle(autoFillColumns, { width: 800 })}>
        {[0, 1, 2, 3].map((index) => (
          <div data-testid={`auto-fill-wide-${index}`} key={index} style={{ width: "100%", height: 20 }} />
        ))}
      </div>,
    )
    ;[0, 200, 400, 600].forEach((x, index) => {
      expectBounds(wide.renderer, `auto-fill-wide-${index}`, { x: x, y: 0, width: 200, height: 20 })
    })

    // 400px / 180px-minimum tracks fits 2 repetitions (400 / 180 = 2.22).
    const narrow = createGridRoot()
    narrow.render(
      <div style={gridStyle(autoFillColumns, { width: 400 })}>
        {[0, 1].map((index) => (
          <div data-testid={`auto-fill-narrow-${index}`} key={index} style={{ width: "100%", height: 20 }} />
        ))}
      </div>,
    )
    ;[0, 200].forEach((x, index) => {
      expectBounds(narrow.renderer, `auto-fill-narrow-${index}`, { x: x, y: 0, width: 200, height: 20 })
    })
  })

  it("distinguishes auto-fill from auto-fit by whether empty repetitions collapse", () => {
    const columnsFor = (kind: "auto-fill" | "auto-fit") => [
      {
        type: "repeat",
        count: kind,
        tracks: [{ type: "minmax", min: { type: "px", value: 100 }, max: { type: "fr", value: 1 } }],
      },
    ]

    // 800px / 100px-minimum tracks fits 8 repetitions; only 2 hold items, so
    // the other 6 are empty. auto-fill keeps them, leaving 100px per item.
    const fill = createGridRoot()
    fill.render(
      <div style={gridStyle(columnsFor("auto-fill"), { width: 800 })}>
        <div data-testid="auto-fill-item-0" style={{ width: "100%", height: 20 }} />
        <div data-testid="auto-fill-item-1" style={{ width: "100%", height: 20 }} />
      </div>,
    )
    expectBounds(fill.renderer, "auto-fill-item-0", { x: 0, y: 0, width: 100, height: 20 })
    expectBounds(fill.renderer, "auto-fill-item-1", { x: 100, y: 0, width: 100, height: 20 })

    // auto-fit collapses those same empty repetitions to zero size, so the
    // two remaining tracks stretch to fill the 800px container.
    const fit = createGridRoot()
    fit.render(
      <div style={gridStyle(columnsFor("auto-fit"), { width: 800 })}>
        <div data-testid="auto-fit-item-0" style={{ width: "100%", height: 20 }} />
        <div data-testid="auto-fit-item-1" style={{ width: "100%", height: 20 }} />
      </div>,
    )
    expectBounds(fit.renderer, "auto-fit-item-0", { x: 0, y: 0, width: 400, height: 20 })
    expectBounds(fit.renderer, "auto-fit-item-1", { x: 400, y: 0, width: 400, height: 20 })
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
    expectBounds(renderer, "gap-0", { x: 0, y: 0, width: 290, height: 20 })
    expectBounds(renderer, "gap-1", { x: 310, y: 0, width: 290, height: 20 })
    // The second row starts after its 40px row plus the 20px row gap.
    expectBounds(renderer, "gap-2", { x: 0, y: 60, width: 290, height: 20 })
    expectBounds(renderer, "gap-3", { x: 310, y: 60, width: 290, height: 20 })
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
    expectBounds(centered.renderer, "justify-center", { x: 200, y: 0, width: 100, height: 20 })
    expectBounds(centered.renderer, "justify-center-second", { x: 300, y: 0, width: 100, height: 20 })

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
    expectBounds(contentEnd.renderer, "align-content-end", { x: 0, y: 160, width: 100, height: 40 })

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
    expectBounds(items.renderer, "align-items-center", { x: 0, y: 10, width: 100, height: 20 })
    expectBounds(items.renderer, "align-self-end", { x: 100, y: 20, width: 100, height: 20 })
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
    expectBounds(renderer, "auto-row-tall", { x: 0, y: 0, width: 300, height: 30 })
    expectBounds(renderer, "auto-row-short", { x: 300, y: 0, width: 300, height: 20 })
    expectBounds(renderer, "fixed-row", { x: 0, y: 30, width: 300, height: 20 })
  })

  it("keeps absolute track lengths in logical pixels at a device scale factor", () => {
    const label = "a long single-line grid label"
    const { render, renderer } = createTestRoot({ scaleFactor: 2 })
    render(
      <div
        style={gridStyle([
          { type: "px", value: 100 },
          { type: "px", value: 200 },
          { type: "fit-content", limit: { type: "px", value: 150 } },
        ])}
      >
        <div data-testid="scale-px-a" style={{ width: "100%", height: 20 }} />
        <div data-testid="scale-px-b" style={{ width: "100%", height: 20 }} />
        <text data-testid="scale-fit-content" style={{ fontSize: 20 }}>
          {label}
        </text>
      </div>,
    )

    expectBounds(renderer, "scale-px-a", { x: 0, y: 0, width: 100, height: 20 })
    expectBounds(renderer, "scale-px-b", { x: 100, y: 0, width: 200, height: 20 })
    expect(boundsFor(renderer, "scale-fit-content").width).toBeCloseTo(150, 3)
  })

  it("auto-places items column-major when gridAutoFlow is column", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle(
          [{ type: "px", value: 100 }, { type: "px", value: 100 }],
          {
            gridAutoFlow: "column",
            gridTemplateRows: [
              { type: "px", value: 40 },
              { type: "px", value: 40 },
              { type: "px", value: 40 },
            ],
          },
        )}
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            data-testid={`auto-flow-item-${index}`}
            key={index}
            style={{ width: "100%", height: "100%" }}
          />
        ))}
      </div>,
    )

    // Column-major placement fills column 0's three rows before moving to
    // column 1: the third item (index 2) lands at column 0, row 2, and the
    // fourth item (index 3) starts the second column at row 0.
    expectBounds(renderer, "auto-flow-item-2", { x: 0, y: 80, width: 100, height: 40 })
    expectBounds(renderer, "auto-flow-item-3", { x: 100, y: 0, width: 100, height: 40 })
  })

  it("sizes implicit rows from gridAutoRows when no row template is declared", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([{ type: "px", value: 100 }, { type: "px", value: 100 }], {
          gridAutoRows: [{ type: "px", value: 40 }],
        })}
      >
        {[0, 1, 2, 3].map((index) => (
          <div
            data-testid={`auto-row-item-${index}`}
            key={index}
            style={{ width: "100%", height: "100%" }}
          />
        ))}
      </div>,
    )

    // Row-major auto-placement fills the two columns before wrapping: the
    // third item (index 2) starts the implicit second row at y = 40.
    expectBounds(renderer, "auto-row-item-0", { x: 0, y: 0, width: 100, height: 40 })
    expectBounds(renderer, "auto-row-item-1", { x: 100, y: 0, width: 100, height: 40 })
    expectBounds(renderer, "auto-row-item-2", { x: 0, y: 40, width: 100, height: 40 })
  })

  it("sizes implicit columns from gridAutoColumns when flowing column-major", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={{
          display: "grid" as const,
          width: 600,
          height: 200,
          gridAutoFlow: "column",
          gridAutoColumns: [{ type: "px", value: 150 }],
          gridTemplateRows: [{ type: "px", value: 40 }],
        }}
      >
        {[0, 1, 2].map((index) => (
          <div
            data-testid={`auto-col-item-${index}`}
            key={index}
            style={{ width: "100%", height: "100%" }}
          />
        ))}
      </div>,
    )

    // With a single explicit row and no explicit columns, column-major
    // auto-placement gives every item its own implicit column at the
    // declared 150px width.
    expectBounds(renderer, "auto-col-item-0", { x: 0, y: 0, width: 150, height: 40 })
    expectBounds(renderer, "auto-col-item-1", { x: 150, y: 0, width: 150, height: 40 })
    expectBounds(renderer, "auto-col-item-2", { x: 300, y: 0, width: 150, height: 40 })
  })

  it("centers items on the inline axis with justifyItems, overridden by justifySelf", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([{ type: "px", value: 200 }], {
          gridTemplateRows: [
            { type: "px", value: 40 },
            { type: "px", value: 40 },
          ],
          justifyItems: "center",
        })}
      >
        <div data-testid="justify-items-center" style={{ width: 50, height: 40 }} />
        <div
          data-testid="justify-self-end"
          style={{ width: 50, height: 40, justifySelf: "end" }}
        />
      </div>,
    )

    // A 50px item centered in a 200px column sits at (200 - 50) / 2 = 75.
    expectBounds(renderer, "justify-items-center", { x: 75, y: 0, width: 50, height: 40 })
    // justifySelf: "end" overrides the inherited justifyItems, pushing the
    // item flush with the column's end edge: 200 - 50 = 150.
    expectBounds(renderer, "justify-self-end", { x: 150, y: 40, width: 50, height: 40 })
  })

  it("packs an auto-placed item into an earlier hole with gridAutoFlow: column dense", () => {
    const runFlow = (flow: "column" | "column dense") => {
      const testId = `hole-fill-${flow.replace(" ", "-")}`
      const root = createGridRoot()
      root.render(
        <div
          style={{
            display: "grid" as const,
            width: 600,
            height: 200,
            gridAutoFlow: flow,
            gridAutoColumns: [{ type: "px", value: 100 }],
            gridTemplateRows: [
              { type: "px", value: 40 },
              { type: "px", value: 40 },
            ],
          }}
        >
          {/* Column 1 is fully reserved by a two-row span. Column 2's second
              row is explicitly taken, but its first row is too small a gap
              for the auto-placed two-row span below, so sparse placement
              skips over it (leaving a hole) and lands that span in column 3.
              The final auto-placed cell, with no explicit position, is what
              distinguishes the two flows. */}
          <div style={{ gridColumn: "1", gridRow: "span 2" }} />
          <div style={{ gridColumn: "2", gridRow: "2" }} />
          <div style={{ gridRow: "span 2" }} />
          <div data-testid={testId} style={{ width: "100%", height: "100%" }} />
        </div>,
      )
      return { renderer: root.renderer, testId }
    }

    // Sparse "column" placement never revisits column 2's first-row hole
    // once its cursor has advanced past it, so the final item continues on
    // to a new, fourth column.
    const sparse = runFlow("column")
    expectBounds(sparse.renderer, sparse.testId, { x: 300, y: 0, width: 100, height: 40 })

    // "column dense" rescans from the start for every item and finds that
    // same hole still open, packing the final item into column 2 instead.
    const dense = runFlow("column dense")
    expectBounds(dense.renderer, dense.testId, { x: 100, y: 0, width: 100, height: 40 })
  })

  it("aligns an item to the start or stretches it across the column with justifySelf", () => {
    const { render, renderer } = createGridRoot()
    render(
      <div
        style={gridStyle([{ type: "px", value: 200 }], {
          gridTemplateRows: [
            { type: "px", value: 40 },
            { type: "px", value: 40 },
          ],
        })}
      >
        <div
          data-testid="justify-self-start"
          style={{ width: 50, height: 40, justifySelf: "start" }}
        />
        <div data-testid="justify-self-stretch" style={{ height: 40, justifySelf: "stretch" }} />
      </div>,
    )

    // justifySelf: "start" leaves a 50px item flush with the column's start.
    expectBounds(renderer, "justify-self-start", { x: 0, y: 0, width: 50, height: 40 })
    // justifySelf: "stretch" fills the full 200px column, but only because
    // this item declares no explicit width of its own.
    expectBounds(renderer, "justify-self-stretch", { x: 0, y: 40, width: 200, height: 40 })
  })
})
