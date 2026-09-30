import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot } from "../testing.js"

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(
    expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }),
  )
  return bounds!
}

describe("percentage spacing lengths", () => {
  it("resolves percentage padding and margins against the containing block width", () => {
    const root = createTestRoot({ width: 400, height: 400 })

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div data-testid="padding-parent" style={{ width: 200, height: 100 }}>
            <div data-testid="padding-box" style={{ width: 100, height: 80, paddingTop: "10%", paddingLeft: "10%" }}>
              <div data-testid="padded-child" style={{ height: 10 }} />
            </div>
          </div>
          <div data-testid="margin-parent" style={{ width: 200, height: 100 }}>
            <div data-testid="margin-child" style={{ height: 10, marginTop: "10%" }} />
          </div>
        </div>,
      )

      const paddingParent = boundsFor(root.renderer, "padding-parent")
      const paddingBox = boundsFor(root.renderer, "padding-box")
      const paddedChild = boundsFor(root.renderer, "padded-child")
      const marginParent = boundsFor(root.renderer, "margin-parent")
      const marginChild = boundsFor(root.renderer, "margin-child")
      expect(paddingBox.width).toBeCloseTo(100, 3)
      expect(paddedChild.y - paddingParent.y).toBeCloseTo(20, 3)
      expect(paddedChild.x - paddingParent.x).toBeCloseTo(20, 3)
      expect(marginChild.y - marginParent.y).toBeCloseTo(20, 3)
    } finally {
      root.unmount()
    }
  })

  it("resolves row and column gaps against their matching content-box axes", () => {
    const root = createTestRoot({ width: 400, height: 400 })

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div
            style={{
              display: "flex",
              width: 200,
              height: 100,
              columnGap: "10%",
            }}
          >
            <div data-testid="column-gap-first" style={{ width: 50, height: 10 }} />
            <div data-testid="column-gap-second" style={{ width: 50, height: 10 }} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 200,
              height: 100,
              rowGap: "10%",
            }}
          >
            <div data-testid="row-gap-first" style={{ width: 10, height: 20 }} />
            <div data-testid="row-gap-second" style={{ width: 10, height: 20 }} />
          </div>
        </div>,
      )

      const columnGapFirst = boundsFor(root.renderer, "column-gap-first")
      const columnGapSecond = boundsFor(root.renderer, "column-gap-second")
      const rowGapFirst = boundsFor(root.renderer, "row-gap-first")
      const rowGapSecond = boundsFor(root.renderer, "row-gap-second")

      expect(columnGapSecond.x - columnGapFirst.x).toBeCloseTo(70, 3)
      expect(rowGapSecond.y - rowGapFirst.y).toBeCloseTo(30, 3)
    } finally {
      root.unmount()
    }
  })

  it("resolves the gap shorthand on both grid axes", () => {
    const root = createTestRoot({ width: 400, height: 400 })

    try {
      root.render(
        <div
          style={{
            display: "grid",
            width: 200,
            height: 100,
            gridTemplateColumns: [
              { type: "px", value: 50 },
              { type: "px", value: 50 },
            ],
            gridTemplateRows: [
              { type: "px", value: 20 },
              { type: "px", value: 20 },
            ],
            gap: "10%",
          }}
        >
          <div data-testid="grid-gap-first" />
          <div data-testid="grid-gap-column-second" />
          <div data-testid="grid-gap-row-second" />
        </div>,
      )

      const first = boundsFor(root.renderer, "grid-gap-first")
      const secondColumn = boundsFor(root.renderer, "grid-gap-column-second")
      const secondRow = boundsFor(root.renderer, "grid-gap-row-second")

      expect(secondColumn.x - first.x).toBeCloseTo(70, 3)
      expect(secondRow.y - first.y).toBeCloseTo(30, 3)
    } finally {
      root.unmount()
    }
  })

  it("resolves insets per axis and flexBasis against the main-axis size", () => {
    const root = createTestRoot({ width: 400, height: 400 })

    try {
      root.render(
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div
            style={{ position: "relative", width: 200, height: 100 }}
          >
            <div
              data-testid="inset-child"
              style={{
                position: "absolute",
                top: "10%",
                left: "10%",
                width: 10,
                height: 10,
              }}
            />
          </div>
          <div data-testid="relative-inset-parent" style={{ width: 200, height: 100 }}>
            <div
              data-testid="relative-inset-child"
              style={{ position: "relative", top: "10%", left: "10%", width: 10, height: 10 }}
            />
          </div>
          <div style={{ display: "flex", width: 200, height: 100 }}>
            <div
              data-testid="flex-basis-child"
              style={{ flexBasis: "25%", flexGrow: 0, flexShrink: 0, height: 10 }}
            />
          </div>
        </div>,
      )

      const insetChild = boundsFor(root.renderer, "inset-child")
      const relativeInsetParent = boundsFor(root.renderer, "relative-inset-parent")
      const relativeInsetChild = boundsFor(root.renderer, "relative-inset-child")
      const flexBasisChild = boundsFor(root.renderer, "flex-basis-child")

      expect(insetChild.x).toBeCloseTo(20, 3)
      expect(insetChild.y).toBeCloseTo(10, 3)
      expect(relativeInsetChild.x - relativeInsetParent.x).toBeCloseTo(20, 3)
      expect(relativeInsetChild.y - relativeInsetParent.y).toBeCloseTo(10, 3)
      expect(flexBasisChild.width).toBeCloseTo(50, 3)
    } finally {
      root.unmount()
    }
  })
})
