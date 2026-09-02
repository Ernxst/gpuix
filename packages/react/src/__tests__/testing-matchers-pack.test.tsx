/** The jest-dom-shaped matcher pack, wired the way a consumer wires it. */

import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("gpuix matcher pack", () => {
  it("asserts document membership and re-resolves after a rerender", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="row">Coal</text>
        </div>
      )
      const row = screen.getByTestId("row")
      expect(row).toBeInTheDocument()

      screen.render(<div />)
      expect(row).not.toBeInTheDocument()
      expect(() => expect(row).toBeInTheDocument()).toThrowError(
        /is not in the renderer's tree/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reports painted bounds, not CSS visibility", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <text data-testid="shown" style={{ width: 100, height: 20 }}>
            Coal
          </text>
          <text data-testid="faded" style={{ width: 100, height: 20, opacity: 0 }}>
            Iron
          </text>
          <text data-testid="sr-only" visuallyHidden role="status">
            Copper
          </text>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByTestId("shown")).toBeVisible()
      // A visually hidden node is projected as an unpainted accessibility node,
      // so it is still in the tree and still has no bounds.
      expect(screen.getByTestId("sr-only")).toBeInTheDocument()
      expect(screen.getByTestId("sr-only")).not.toBeVisible()
      // The documented conflation, from the other side: a fully transparent
      // element still paints, so this calls it visible where a browser
      // would not.
      expect(screen.getByTestId("faded")).toBeVisible()

      expect(() => expect(screen.getByTestId("sr-only")).toBeVisible()).toThrowError(
        /painted no bounds/
      )
    } finally {
      screen.unmount()
    }
  })

  it("asserts the element's own disabled state, declared either way", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="native" role="button" ariaLabel="Save" disabled />
          <div data-testid="aria" role="button" ariaLabel="Delete" ariaDisabled />
          <div data-testid="enabled" role="button" ariaLabel="Build" />
          <div data-testid="child-of-disabled" role="button" ariaLabel="Nested" />
        </div>
      )

      expect(screen.getByTestId("native")).toBeDisabled()
      expect(screen.getByTestId("aria")).toBeDisabled()
      expect(screen.getByTestId("enabled")).not.toBeDisabled()
      // No disabling container exists, so nothing is inherited.
      expect(screen.getByTestId("child-of-disabled")).not.toBeDisabled()

      expect(() => expect(screen.getByTestId("enabled")).toBeDisabled()).toThrowError(
        /is not disabled/
      )
    } finally {
      screen.unmount()
    }
  })

  it("follows the window's keyboard focus, with or without a declared role", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ width: 400, height: 120 }}>
          <input data-testid="search" value="" style={{ width: 200, height: 30 }} />
          <input data-testid="notes" value="" style={{ width: 200, height: 30 }} />
        </div>
      )

      const search = screen.getByTestId("search")
      const notes = screen.getByTestId("notes")
      screen.renderer.focusElement(search.id)

      // Neither input declares a role, so neither has an AccessKit node to be
      // found by; the window's own focus still answers.
      expect(search).toHaveFocus()
      expect(notes).not.toHaveFocus()

      screen.renderer.focusElement(notes.id)
      expect(notes).toHaveFocus()
      expect(() => expect(search).toHaveFocus()).toThrowError(/focus is on <input/)
    } finally {
      screen.unmount()
    }
  })

  it("matches text content by substring, regex, and predicate through one normalizer", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="panel">
          <text>{"  Iron   plate  "}</text>
          <text>{" x2"}</text>
        </div>
      )
      const panel = screen.getByTestId("panel")

      // jest-dom's rules: a bare string is a case-sensitive substring.
      expect(panel).toHaveTextContent("Iron plate")
      expect(panel).toHaveTextContent("plate x2")
      expect(panel).not.toHaveTextContent("iron plate")
      expect(panel).toHaveTextContent(/^Iron plate x2$/)
      expect(panel).toHaveTextContent((content) => content.endsWith("x2"))

      // The queries' normalization, and the options that change it.
      expect(panel).toHaveTextContent("Iron   plate", { collapseWhitespace: false })
      expect(panel).toHaveTextContent("IRON PLATE X2", {
        normalizer: (content) => content.trim().replace(/\s+/g, " ").toUpperCase(),
      })

      expect(() => expect(panel).toHaveTextContent("Copper")).toThrowError(
        /have text content "Copper"[\s\S]*text content "Iron plate x2"/
      )
    } finally {
      screen.unmount()
    }
  })

  it("separates the exact value from the matcher-based display value", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <input data-testid="search" value="iron plate" placeholder="Search" />
          <div data-testid="panel" ariaLabel="Ledger" />
        </div>
      )
      const search = screen.getByTestId("search")

      expect(search).toHaveValue("iron plate")
      expect(search).not.toHaveValue("iron")
      expect(search).toHaveDisplayValue("iron plate")
      expect(search).toHaveDisplayValue(/^iron/)
      expect(search).toHaveDisplayValue("IRON", { exact: false })
      expect(search).not.toHaveDisplayValue("copper")

      // An element with no value prop fails both rather than matching "".
      expect(screen.getByTestId("panel")).not.toHaveValue("")
      expect(screen.getByTestId("panel")).not.toHaveDisplayValue("")
      expect(() => expect(screen.getByTestId("panel")).toHaveValue("")).toThrowError(
        /value is not declared/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reads the computed accessible name, not the raw ariaLabel prop", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="save" role="button" ariaLabel="Save factory" />
          <div data-testid="named-by-contents" role="heading" ariaLevel={2}>
            <text>Build list</text>
          </div>
          <div data-testid="unroled" ariaLabel="Ignored without a role" />
        </div>
      )

      expect(screen.getByTestId("save")).toHaveAccessibleName()
      expect(screen.getByTestId("save")).toHaveAccessibleName("Save factory")
      expect(screen.getByTestId("save")).toHaveAccessibleName(/factory/)
      expect(screen.getByTestId("named-by-contents")).toHaveAccessibleName("Build list")

      // GPUI only projects a name where the element projects semantics, so an
      // ariaLabel with no role has no accessible name. The matcher reports the
      // computation rather than falling back to the prop.
      expect(screen.getByTestId("unroled")).not.toHaveAccessibleName()
      expect(() =>
        expect(screen.getByTestId("unroled")).toHaveAccessibleName("Ignored without a role")
      ).toThrowError(/accessible name ""/)
    } finally {
      screen.unmount()
    }
  })

  it("fails rather than throws for every matcher on an unmounted element", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <input
            data-testid="field"
            ariaLabel="Amount"
            value="one"
            style={{ width: 100, height: 30 }}
          />
        </div>
      )
      const field = screen.getByTestId("field")
      screen.renderer.focusElement(field.id)
      expect(field).toBeVisible()
      expect(field).toHaveFocus()

      screen.render(<div style={{ display: "flex", width: 200, height: 100 }} />)

      // A removed node is exactly what the negated form is asked about, so it
      // must answer, not throw. Throwing made `.not.` unusable after unmount.
      expect(field).not.toBeInTheDocument()
      expect(field).not.toBeVisible()
      expect(field).not.toBeDisabled()
      expect(field).not.toHaveFocus()
      expect(field).not.toHaveTextContent("one")
      expect(field).not.toHaveValue("one")
      expect(field).not.toHaveDisplayValue("one")
      expect(field).not.toHaveAccessibleName()

      // The positive form fails, and says why.
      expect(() => expect(field).toBeVisible()).toThrowError(
        /is no longer in the renderer's tree/
      )
      expect(() => expect(field).toHaveValue("one")).toThrowError(
        /is no longer in the renderer's tree/
      )
    } finally {
      screen.unmount()
    }
  })

  it("rejects an empty string that could never fail", () => {
    const screen = createTestRoot()

    try {
      screen.render(<div data-testid="panel" />)
      const panel = screen.getByTestId("panel")

      // "" is a substring of everything, so the assertion is unfalsifiable.
      expect(() => expect(panel).toHaveTextContent("")).toThrowError(
        /empty string always matches/
      )
      expect(() => expect(panel).not.toHaveTextContent("")).toThrowError(
        /empty string always matches/
      )
      // The suggested alternative does work.
      expect(panel).toHaveTextContent(/^$/)
    } finally {
      screen.unmount()
    }
  })

  it("rejects a value that is not a test element", () => {
    expect(() => expect(null).toBeInTheDocument()).toThrowError(
      /toBeInTheDocument expects a TestElement/
    )
    expect(() => expect({ id: 1 }).toBeDisabled()).toThrowError(
      /toBeDisabled expects a TestElement/
    )
  })

  it("tracks live state through the same captured element", () => {
    const screen = createTestRoot()

    try {
      function Editable() {
        const [value, setValue] = useState("one")
        return (
          <div style={{ width: 300, height: 80 }}>
            <div data-testid="bump" role="button" ariaLabel="Bump" onClick={() => setValue("two")}>
              <text>Bump</text>
            </div>
            <input data-testid="field" value={value} style={{ width: 200, height: 30 }} />
          </div>
        )
      }

      screen.render(<Editable />)
      const field = screen.getByTestId("field")
      expect(field).toHaveValue("one")

      screen.renderer.nativeSimulateClick(10, 10)
      expect(field).toHaveValue("two")
    } finally {
      screen.unmount()
    }
  })
})
