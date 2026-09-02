/// Flattening a subtree into an accessible name follows CSS, not the tree:
/// adjacent text nodes run together, element boxes separate with a space.
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("accessible name whitespace", () => {
  it("runs adjacent text nodes together", () => {
    const screen = createTestRoot()
    const suffix = "s"

    try {
      // React splits an interpolation into its own host node. Neither node has
      // a box, so the browser names this "Items".
      screen.render(<div data-testid="items" role="button">Item{suffix}</div>)

      expect(screen.getByRole("button", { name: "Items" })).toBe(screen.getByTestId("items"))
    } finally {
      screen.unmount()
    }
  })

  it("keeps the space an author wrote between two text nodes", () => {
    const screen = createTestRoot()
    const count = 5

    try {
      screen.render(<div data-testid="items" role="button">Item {count}</div>)

      expect(screen.getByRole("button", { name: "Item 5" })).toBe(screen.getByTestId("items"))
    } finally {
      screen.unmount()
    }
  })

  it("separates sibling element boxes with a space", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="save" role="button">
          <text>Save</text>
          <text>All</text>
        </div>
      )

      expect(screen.getByRole("button", { name: "Save All" })).toBe(screen.getByTestId("save"))
    } finally {
      screen.unmount()
    }
  })

  it("runs a nested text run into the line it is painted on", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="save" role="button">
          <text>
            Save<text style={{ fontWeight: "bold" }}>All</text>
          </text>
        </div>
      )

      expect(screen.getByRole("button", { name: "SaveAll" })).toBe(screen.getByTestId("save"))
    } finally {
      screen.unmount()
    }
  })

  it("mixes inline runs with block boundaries", () => {
    const screen = createTestRoot()
    const count = 5

    try {
      screen.render(
        <div data-testid="items" role="button">
          Item{count}
          <text>left</text>
          <div>
            <text>in stock</text>
          </div>
        </div>
      )

      expect(screen.getByRole("button", { name: "Item5 left in stock" })).toBe(
        screen.getByTestId("items")
      )
    } finally {
      screen.unmount()
    }
  })

  it("normalizes the whitespace an author painted", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="save" role="button">
          {"  Save   the \n ledger  "}
        </div>
      )

      expect(screen.getByRole("button", { name: "Save the ledger" })).toBe(
        screen.getByTestId("save")
      )
    } finally {
      screen.unmount()
    }
  })

  it("flattens a referenced subtree by the same rules", () => {
    const screen = createTestRoot()
    const suffix = "s"

    try {
      screen.render(
        <div>
          <div id="heading">
            Item{suffix}
            <text>left</text>
          </div>
          <div data-testid="ledger" role="region" ariaLabelledBy="heading" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Items left" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })
})
