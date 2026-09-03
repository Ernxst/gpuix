/// Issue #301: box-sizing is border-box, so `borderWidth` must shrink the
/// content box, never the border box, and `borderStyle` must be accepted the
/// way a browser stylesheet declares it.

import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { createTestRoot } from "../testing.js"
import type { StyleDesc } from "../types/host.js"
import {
  expectScreenshotsDiffer,
  expectScreenshotsEqual,
  SHOTS_DIR,
} from "./test-utils.js"

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

type TestRenderer = ReturnType<typeof createTestRoot>["renderer"]

function boundsFor(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: bounds![0], y: bounds![1], width: bounds![2], height: bounds![3] }
}

function shoot(name: string, tree: React.ReactElement) {
  const file = path.join(SHOTS_DIR, `${name}.png`)
  const root = createTestRoot()
  try {
    root.render(tree)
    root.renderer.captureScreenshot(file)
  } finally {
    root.unmount()
  }
  return file
}

describe("borderWidth keeps the border box (issue #301)", () => {
  it("keeps a stretched scroller's border box and shrinks its content box", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div style={{ display: "flex", width: 400, height: 100 }}>
          <div
            data-testid="outer"
            style={{ display: "flex", flexGrow: 1, overflowX: "scroll", borderWidth: 4 }}
          >
            <div data-testid="inner" style={{ flexShrink: 0, minWidth: "100%", height: 20 }} />
          </div>
        </div>,
      )

      const outer = boundsFor(root.renderer, "outer")
      const inner = boundsFor(root.renderer, "inner")

      expect(outer.width).toBeCloseTo(400, 4)
      expect(outer.x).toBeCloseTo(0, 4)
      expect(inner.width).toBeCloseTo(392, 4)
      // The content box starts inside the border, like the DOM.
      expect(inner.x).toBeCloseTo(4, 4)
    } finally {
      root.unmount()
    }
  })

  it("reports the border box for a plain bordered, padded box", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div style={{ display: "flex", width: 400, height: 100 }}>
          <div
            data-testid="padded-outer"
            style={{ display: "flex", flexGrow: 1, borderWidth: 4, padding: 10 }}
          >
            <div data-testid="padded-inner" style={{ width: "100%", height: 20 }} />
          </div>
        </div>,
      )

      // getBoundingClientRect semantics: the recorded box is the border box.
      const outer = boundsFor(root.renderer, "padded-outer")
      const inner = boundsFor(root.renderer, "padded-inner")

      expect(outer.x).toBeCloseTo(0, 4)
      expect(outer.width).toBeCloseTo(400, 4)
      expect(outer.height).toBeCloseTo(100, 4)
      // Percentages resolve against the content box: 400 - 2*(4 + 10).
      expect(inner.width).toBeCloseTo(372, 4)
      expect(inner.x).toBeCloseTo(14, 4)
    } finally {
      root.unmount()
    }
  })
})

describe("borderStyle (issue #301)", () => {
  const bordered = (testId: string, style: StyleDesc = {}) => (
    <div style={{ display: "flex", width: 400, height: 100, backgroundColor: "#101010" }}>
      <div
        data-testid={testId}
        style={{
          display: "flex",
          flexGrow: 1,
          overflowX: "scroll",
          borderWidth: 4,
          borderColor: "#ff0000",
          ...style,
        }}
      >
        <div
          data-testid={`${testId}-inner`}
          style={{ flexShrink: 0, minWidth: "100%", height: 20 }}
        />
      </div>
    </div>
  )

  it("accepts solid without a diagnostic and paints it like the default", () => {
    const root = createTestRoot()
    try {
      root.render(bordered("solid-outer", { borderStyle: "solid" }))
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      root.unmount()
    }

    expectScreenshotsEqual(
      shoot("border-style-default", bordered("a")),
      shoot("border-style-solid", bordered("b", { borderStyle: "solid" })),
    )
  })

  it("none computes the used border width to zero", () => {
    const root = createTestRoot()
    try {
      root.render(bordered("none-outer", { borderStyle: "none" }))
      expect(root.renderer.drainStyleDiagnostics()).toEqual([])

      // The space returns to the content box, like CSS.
      expect(boundsFor(root.renderer, "none-outer").width).toBeCloseTo(400, 4)
      expect(boundsFor(root.renderer, "none-outer-inner").width).toBeCloseTo(400, 4)
    } finally {
      root.unmount()
    }

    // And nothing paints: identical to never declaring a border.
    expectScreenshotsEqual(
      shoot("border-style-none", bordered("c", { borderStyle: "none" })),
      shoot("border-style-borderless", bordered("d", { borderWidth: 0 })),
    )
  })

  it("dashed paints a different line from solid", () => {
    expectScreenshotsDiffer(
      shoot("border-style-dashed", bordered("e", { borderStyle: "dashed" })),
      shoot("border-style-solid-b", bordered("f", { borderStyle: "solid" })),
    )
  })

  it("rejects a value outside the CSS border-style set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = createTestRoot({ strictStyles: true })
    try {
      root.render(bordered("wavy-outer", { borderStyle: "wavy" as never }))
      const diagnostics = root.renderer.drainStyleDiagnostics()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]!.property).toBe("borderStyle")
    } finally {
      root.unmount()
      warn.mockRestore()
    }
  })
})
