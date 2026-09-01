import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, textContent } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("createTestRoot bound queries", () => {
  it("queries text synchronously through the screen and a scoped element", () => {
    const screen = createTestRoot()
    const renderer = screen.renderer

    try {
      screen.render(
        <div>
          <div testId="summary">
            <text>Power</text>
            <text>Rate</text>
          </div>
          <div testId="details">
            <text>Built</text>
            <text>Rate</text>
          </div>
        </div>
      )

      const power = screen.getByText("Power")
      expect(power).not.toBeInstanceOf(Promise)
      expect(power.text).toBe("Power")
      expect(screen.getAllByText("Rate").map((element) => element.text)).toEqual([
        "Rate",
        "Rate",
      ])
      expect(screen.queryByText("Missing")).toBeUndefined()
      expect(screen.queryAllByText("Missing")).toEqual([])

      const summary = screen.getByTestId("summary")
      expect(screen.within(summary).getByText("Rate").text).toBe("Rate")
      expect(screen.within(summary).queryByText("Built")).toBeUndefined()

      screen.render(<text>Updated</text>)
      expect(screen.renderer).toBe(renderer)
      expect(screen.queryByText("Power")).toBeUndefined()
      expect(screen.getByText("Updated").text).toBe("Updated")
    } finally {
      screen.unmount()
    }
  })

  it("queries test IDs synchronously through the screen and a scoped element", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div testId="summary">
            <text data-testid="value">Power</text>
          </div>
          <div testId="details">
            <text data-testid="value">Built</text>
          </div>
        </div>
      )

      const summary = screen.getByTestId("summary")
      expect(summary).not.toBeInstanceOf(Promise)
      expect(screen.getAllByTestId("value")).toHaveLength(2)
      expect(screen.getAllByTestId(/^val/)).toHaveLength(2)
      expect(screen.queryByTestId("missing")).toBeUndefined()
      expect(screen.queryAllByTestId("missing")).toEqual([])

      const scoped = screen.within(summary)
      expect(textContent(screen.renderer, scoped.getByTestId("value"))).toBe("Power")
      expect(scoped.queryByTestId("details")).toBeUndefined()
      expect(() => scoped.getByTestId("details")).toThrowError(
        'Unable to find an element with test ID "details" within <div testId="summary"'
      )
    } finally {
      screen.unmount()
    }
  })

  it("keeps singular and required query errors when queries are bound", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div testId="page">
          <text data-testid="value">Ore</text>
          <text data-testid="value">Ore rate</text>
        </div>
      )

      expect(() => screen.getByText("Moss")).toThrowError(
        /Unable to find an element with text "Moss" within <div testId="page" text="OreOre rate">\. Near misses:\n  <text text="Ore">\n  <text text="Ore rate">/
      )
      expect(() => screen.getByText(/Ore/)).toThrowError("Found multiple elements with text /Ore/")
      expect(() => screen.queryByText(/Ore/)).toThrowError("Found multiple elements with text /Ore/")
      expect(() => screen.getAllByText("Moss")).toThrowError(
        'Unable to find an element with text "Moss"'
      )

      expect(() => screen.getByTestId("missing")).toThrowError(
        'Unable to find an element with test ID "missing"'
      )
      expect(() => screen.getByTestId("value")).toThrowError(
        'Found multiple elements with test ID "value"'
      )
      expect(() => screen.queryByTestId("value")).toThrowError(
        'Found multiple elements with test ID "value"'
      )
      expect(() => screen.getAllByTestId("missing")).toThrowError(
        'Unable to find an element with test ID "missing"'
      )
    } finally {
      screen.unmount()
    }
  })
})
