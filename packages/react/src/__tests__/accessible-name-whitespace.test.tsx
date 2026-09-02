/// Flattening a subtree into an accessible name follows CSS, not the tree:
/// adjacent text nodes run together, element boxes separate with a space.
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

/** The query normalizer collapses every kind of whitespace. This one does not,
 *  so a test can read the name exactly as it was flattened. */
const verbatim = (content: string): string => content

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

  it("keeps the boundary of a hidden box between two text runs", () => {
    const screen = createTestRoot()

    try {
      // The box contributes no text of its own and still stands between its
      // neighbours, so they cannot run together.
      screen.render(
        <div data-testid="weight" role="button">
          5<div ariaHidden />
          kg
        </div>
      )

      expect(screen.getByRole("button", { name: "5 kg" })).toBe(screen.getByTestId("weight"))
    } finally {
      screen.unmount()
    }
  })

  it("keeps a no-break space an author wrote", () => {
    const screen = createTestRoot()

    try {
      // CSS collapses the ASCII whitespace around it and leaves U+00A0 alone,
      // which is the whole point of typing one.
      screen.render(
        <div data-testid="weight" role="button">
          {"  5\u00a0kg  "}
        </div>
      )

      expect(screen.getByRole("button", { name: "5\u00a0kg", normalizer: verbatim })).toBe(
        screen.getByTestId("weight")
      )
      expect(screen.queryByRole("button", { name: "5 kg", normalizer: verbatim })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("names a role from the labels its descendants carry", () => {
    const screen = createTestRoot()

    try {
      // accname step 2F names every descendant in its own right, so `alt`
      // reaches the button the way it does in the DOM.
      screen.render(
        <div data-testid="save" role="button">
          <img alt="Save" src={{ kind: "url", url: "https://example.com/save.png" }} />
          <text>All</text>
        </div>
      )

      expect(screen.getByRole("button", { name: "Save All" })).toBe(screen.getByTestId("save"))
    } finally {
      screen.unmount()
    }
  })

  it("normalizes the value a visually hidden text host projects", () => {
    const screen = createTestRoot()

    try {
      // The projection paints nothing, so its text reaches AccessKit through
      // the name flattener — which normalizes, unlike a painted value.
      screen.render(
        <div style={{ display: "flex", width: 480, height: 100 }}>
          <text visuallyHidden role="status">
            {"  Saved   3 \n files  "}
          </text>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      const nodes = Object.values(screen.renderer.getAccessibilityTree().nodes)
      expect(nodes.find((node) => node.aria.role === "Status")).toMatchObject({
        aria: { role: "Status", value: "Saved 3 files" },
      })
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
