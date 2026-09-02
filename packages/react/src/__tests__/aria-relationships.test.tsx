/// aria-labelledby / aria-describedby resolve id references against the retained
/// tree, and <img alt> names the image, per the accname computation.
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const IMAGE = { kind: "url", url: "https://example.com/photo.png" } as const

describeNative("aria-labelledby and aria-describedby", () => {
  it("names a node from the text of the element it references", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="ledger-title">Production ledger</text>
          <div data-testid="ledger" role="region" ariaLabelledBy="ledger-title" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("joins several references in the order they are written", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="first">Production</text>
          <text id="second">ledger</text>
          <div data-testid="ledger" role="region" ariaLabelledBy="first second" />
          <div data-testid="reversed" role="region" ariaLabelledBy="second first" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
      expect(screen.getByRole("region", { name: "ledger Production" })).toBe(
        screen.getByTestId("reversed")
      )
    } finally {
      screen.unmount()
    }
  })

  it("flattens a referenced subtree into one name", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div id="heading">
            <text>Production</text>
            <text>ledger</text>
          </div>
          <div data-testid="ledger" role="region" ariaLabelledBy="heading" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("takes a referenced element's own ariaLabel over its contents", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div id="heading" role="heading" ariaLevel={2} ariaLabel="Authored name">
            <text>Painted text</text>
          </div>
          <div data-testid="ledger" role="region" ariaLabelledBy="heading" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Authored name" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("lets a reference win over ariaLabel, as the accname order does", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="ledger-title">Referenced name</text>
          <div
            data-testid="ledger"
            role="region"
            ariaLabel="Direct name"
            ariaLabelledBy="ledger-title"
          />
        </div>
      )

      expect(screen.getByRole("region", { name: "Referenced name" })).toBe(
        screen.getByTestId("ledger")
      )
      expect(screen.queryByRole("region", { name: "Direct name" })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("falls back to ariaLabel when no reference resolves", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="ledger" role="region" ariaLabel="Direct name" ariaLabelledBy="missing" />
      )

      expect(screen.getByRole("region", { name: "Direct name" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("skips the ids that resolve to nothing and keeps the rest", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="present">Production ledger</text>
          <div data-testid="ledger" role="region" ariaLabelledBy="missing present absent" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("describes a node from the text of the element it references", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="hint">Applies on the next build</text>
          <div
            data-testid="save"
            role="button"
            ariaLabel="Save factory"
            ariaDescribedBy="hint"
          />
        </div>
      )

      const tree = screen.renderer.getAccessibilityTree()
      const save = screen.getByTestId("save")
      const node = Object.values(tree.nodes).find((candidate) => candidate.host_id === save.id)

      expect(node?.aria.description).toBe("Applies on the next build")
      expect(node?.aria.label).toBe("Save factory")
    } finally {
      screen.unmount()
    }
  })

  it("lets a described-by reference win over ariaDescription", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="hint">Referenced description</text>
          <div
            data-testid="save"
            role="button"
            ariaLabel="Save factory"
            ariaDescription="Direct description"
            ariaDescribedBy="hint"
          />
        </div>
      )

      const tree = screen.renderer.getAccessibilityTree()
      const save = screen.getByTestId("save")
      const node = Object.values(tree.nodes).find((candidate) => candidate.host_id === save.id)

      expect(node?.aria.description).toBe("Referenced description")
    } finally {
      screen.unmount()
    }
  })

  it("accepts the DOM spellings of both props", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="ledger-title">Production ledger</text>
          <div data-testid="ledger" role="region" aria-labelledby="ledger-title" />
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("makes a section a region when a reference names it", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="ledger-title">Production ledger</text>
          <section data-testid="ledger" ariaLabelledBy="ledger-title">
            <text>State</text>
          </section>
        </div>
      )

      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )
    } finally {
      screen.unmount()
    }
  })

  it("follows the reference when the referenced text changes", () => {
    const screen = createTestRoot()

    function Ledger({ title }: { title: string }): React.ReactElement {
      return (
        <div>
          <text id="ledger-title">{title}</text>
          <div data-testid="ledger" role="region" ariaLabelledBy="ledger-title" />
        </div>
      )
    }

    try {
      screen.render(<Ledger title="Production ledger" />)
      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )

      screen.render(<Ledger title="Consumption ledger" />)
      expect(screen.getByRole("region", { name: "Consumption ledger" })).toBe(
        screen.getByTestId("ledger")
      )
      expect(screen.queryByRole("region", { name: "Production ledger" })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("takes the image's accessible name from alt", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <img data-testid="photo" alt="Sales for March" src={IMAGE} style={{ width: 40, height: 40 }} />
      )

      expect(screen.getByRole("img", { name: "Sales for March" })).toBe(
        screen.getByTestId("photo")
      )
    } finally {
      screen.unmount()
    }
  })

  it("lets a reference name an image over its alt", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="caption">Referenced caption</text>
          <img
            data-testid="photo"
            alt="Sales for March"
            ariaLabelledBy="caption"
            src={IMAGE}
            style={{ width: 40, height: 40 }}
          />
        </div>
      )

      expect(screen.getByRole("img", { name: "Referenced caption" })).toBe(
        screen.getByTestId("photo")
      )
    } finally {
      screen.unmount()
    }
  })
})
