import React from "react"
import { describe, expect, it } from "vitest"
import {
  createTestRoot,
  getDefaultNormalizer,
  isNativeTestRendererAvailable,
  textContent,
} from "../testing.js"

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
      expect(screen.queryByText("Missing")).toBeNull()
      expect(screen.queryAllByText("Missing")).toEqual([])

      const summary = screen.getByTestId("summary")
      expect(screen.within(summary).getByText("Rate").text).toBe("Rate")
      expect(screen.within(summary).queryByText("Built")).toBeNull()

      screen.render(<text>Updated</text>)
      expect(screen.renderer).toBe(renderer)
      expect(screen.queryByText("Power")).toBeNull()
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
      expect(screen.queryByTestId("missing")).toBeNull()
      expect(screen.queryAllByTestId("missing")).toEqual([])

      const scoped = screen.within(summary)
      expect(textContent(screen.renderer, scoped.getByTestId("value"))).toBe("Power")
      expect(scoped.queryByTestId("details")).toBeNull()
      expect(() => scoped.getByTestId("details")).toThrowError(
        'Unable to find an element with test ID "details" within <div testId="summary"'
      )
    } finally {
      screen.unmount()
    }
  })

  it("uses Testing Library matcher normalization, options, and predicates", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text testId="  Primary   Action  ">{"  Save\n  factory  "}</text>
          <text data-testid="secondary-action">Delete factory</text>
          <div testId="wrapper">
            <text>Nested only</text>
          </div>
        </div>
      )

      const save = screen.getByText("Save factory")
      expect(save.text).toBe("  Save\n  factory  ")
      expect(screen.queryByText("Save")).toBeNull()
      expect(screen.getByText("save", { exact: false }).text).toContain("Save")
      expect(
        screen.getByText(
          (content, element) =>
            content === "Save factory" && element.text === "  Save\n  factory  "
        )
      ).toBe(save)
      expect(
        screen.getByText("save factory", {
          normalizer: (content) => content.trim().replace(/\s+/g, " ").toLowerCase(),
        })
      ).toBe(save)

      expect(screen.queryByTestId("primary")).toBeNull()
      expect(screen.getByTestId("primary", { exact: false }).testId).toContain("Primary")
      expect(
        screen.getByTestId(
          (content, element) =>
            content === "secondary-action" && element.dataTestId === "secondary-action"
        ).dataTestId
      ).toBe("secondary-action")
      expect(
        screen.getByTestId("PRIMARY ACTION", {
          normalizer: (content) => content.trim().replace(/\s+/g, " ").toUpperCase(),
        }).testId
      ).toBe("  Primary   Action  ")

      expect(screen.getAllByText("Nested only")).toHaveLength(1)
      expect(screen.getByTestId("wrapper").text).toBeNull()

      // trim and collapseWhitespace switch off the default normalizer's parts,
      // and getDefaultNormalizer composes them into a custom one.
      expect(screen.queryByText("Save factory", { collapseWhitespace: false })).toBeNull()
      expect(screen.getByText("Save\n  factory", { collapseWhitespace: false })).toBe(save)
      expect(screen.getByText(" Save factory ", { trim: false })).toBe(save)
      expect(
        screen.getByText("SAVE FACTORY", {
          normalizer: (content) => getDefaultNormalizer()(content).toUpperCase(),
        })
      ).toBe(save)
      expect(() =>
        screen.getByText("Save factory", { trim: false, normalizer: (content) => content })
      ).toThrowError(/trim and collapseWhitespace are not supported with a normalizer/)
    } finally {
      screen.unmount()
    }
  })

  it("resolves one test ID per element, preferring data-testid", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text testId="legacy-only">Legacy</text>
          <text data-testid="standard" testId="shadowed">
            Standard
          </text>
        </div>
      )

      const standard = screen.getByTestId("standard")
      expect(standard.testId).toBe("shadowed")
      expect(screen.getAllByTestId("legacy-only")).toHaveLength(1)

      // The legacy prop no longer answers on an element that has data-testid,
      // so a mixed tree cannot report different counts to different query paths.
      expect(screen.queryAllByTestId("shadowed")).toEqual([])
      expect(screen.queryByTestId("shadowed")).toBeNull()
      expect(screen.renderer.findByTestId("shadowed")).toBeUndefined()
      expect(screen.renderer.findByTestId("standard")).toBe(standard)
      expect(screen.renderer.findByTestId("legacy-only")?.testId).toBe("legacy-only")

      // renderer.findByText runs on the shared matcher, not a raw substring.
      const label = screen.renderer.findByText("Standard")
      expect(label?.text).toBe("Standard")
      expect(screen.renderer.findByText("Stand")).toBeUndefined()
      expect(screen.renderer.findByText("stand", { exact: false })).toBe(label)
    } finally {
      screen.unmount()
    }
  })

  it("matches accessible names through the shared matcher", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div testId="output" role="heading" ariaLabel="  Iron   Output  " ariaLevel={2} />
        </div>
      )

      const output = screen.getByTestId("output")

      expect(screen.getByRole("heading", { name: "Iron Output" })).toBe(output)
      expect(screen.queryByRole("heading", { name: "  Iron   Output  " })).toBeNull()
      expect(screen.getByRole("heading", { name: "iron out", exact: false })).toBe(output)
      expect(
        screen.getByRole("heading", {
          name: "IRON OUTPUT",
          normalizer: (content) => getDefaultNormalizer()(content).toUpperCase(),
        })
      ).toBe(output)
      expect(screen.getByRole("heading", { name: /^Iron Output$/, level: 2 })).toBe(output)
      expect(
        screen.getByRole("heading", {
          name: (name, element) => name === "Iron Output" && element.testId === "output",
        })
      ).toBe(output)
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

  it("refreshes a scoped element after rerendering its descendants", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div testId="panel">
          <text>Before</text>
        </div>
      )
      const panel = screen.getByTestId("panel")
      const scoped = screen.within(panel)

      screen.render(
        <div testId="panel">
          <div>
            <text>After</text>
          </div>
        </div>
      )

      expect(scoped.getByText("After").text).toBe("After")
    } finally {
      screen.unmount()
    }
  })

  it("uses Testing Library scoped and nullable query conventions", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div testId="panel">
          <text testId="value">Rate</text>
        </div>
      )

      const scoped = screen.within(screen.getByTestId("panel"))
      expect(scoped.queryByTestId("panel")).toBeNull()
      expect(scoped.queryAllByTestId("panel")).toEqual([])
      expect(textContent(screen.renderer, scoped.getByTestId("value"))).toBe("Rate")
      expect(screen.queryByText("Missing")).toBeNull()
      expect(scoped.queryByText("Missing")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("supports the consuming app's role-query workflow", () => {
    const root = createTestRoot()
    const coalCurrent = { name: "Coal Current" }

    try {
      root.render(
        <div>
          <section role="region" ariaLabel="Production ledger">
            <text>State</text>
          </section>
          <a role="link" ariaLabel={coalCurrent.name} testId="site" />
          <h2 role="heading" ariaLabel="Build list" ariaLevel={2} testId="heading" />
        </div>
      )

      const ledger = root.getByRole("region", { name: "Production ledger" })
      const site = root.getByRole("link", { name: coalCurrent.name })
      const heading = root.getByRole("heading", { name: "Build list", level: 2 })
      root.within(ledger).getByText("State")

      expect(site).toBe(root.getByTestId("site"))
      expect(heading).toBe(root.getByTestId("heading"))
    } finally {
      root.unmount()
    }
  })

  it("maps computed accessibility nodes back to retained host elements", () => {
    const root = createTestRoot()

    try {
      root.render(<div role="button" ariaLabel="Save factory" testId="save" />)

      const retained = root.getByTestId("save")
      const tree = root.renderer.getAccessibilityTree()
      const computedButton = Object.values(tree.nodes).find(
        (node) => node.aria.role === "Button" && node.aria.label === "Save factory"
      )

      expect(computedButton?.host_id).toBe(retained.id)
      expect(root.renderer.getElement(computedButton!.host_id!)).toBe(retained)

      expect(tree.root).not.toBeNull()
      const windowNode = tree.root === null ? undefined : tree.nodes[tree.root]
      expect(windowNode?.aria.role).toBe("Window")
      expect(windowNode).not.toHaveProperty("host_id")
    } finally {
      root.unmount()
    }
  })

  it("matches computed roles and accessible names with every matcher form", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div>
          <div testId="first" role="checkbox" ariaLabel="Coal input" ariaChecked />
          <div testId="second" role="checkbox" ariaLabel="Iron input" ariaChecked={false} />
          <div testId="heading-2" role="heading" ariaLabel="Build list" ariaLevel={2} />
          <div testId="heading-3" role="heading" ariaLabel="Build list" ariaLevel={3} />
          <input testId="search" role="textbox" ariaLabel="Recipe search" />
          <img testId="preview" role="img" ariaLabel="Recipe preview" />
        </div>
      )

      expect(root.getByRole("checkbox", { name: "Coal input" })).toBe(
        root.getByTestId("first")
      )
      expect(root.getByRole("checkbox", { name: /iron/i })).toBe(root.getByTestId("second"))
      expect(
        root.getByRole("checkbox", {
          name: (name, element) => name.endsWith("input") && element.testId === "first",
        })
      ).toBe(root.getByTestId("first"))
      expect(root.getByRole("heading", { name: "Build list", level: 2 })).toBe(
        root.getByTestId("heading-2")
      )
      expect(root.getByRole("heading", { name: "Build list", level: 3 })).toBe(
        root.getByTestId("heading-3")
      )
      expect(root.getByRole("textbox", { name: "Recipe search" })).toBe(
        root.getByTestId("search")
      )
      expect(root.getByRole("img", { name: "Recipe preview" })).toBe(
        root.getByTestId("preview")
      )
    } finally {
      root.unmount()
    }
  })

  it("implements singular, all, nullable, and descendants-only role queries", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div role="region" ariaLabel="Outer" testId="outer">
          <div role="button" ariaLabel="Save" testId="save" />
          <div role="button" ariaLabel="Delete" testId="delete" />
        </div>
      )

      expect(root.getAllByRole("button")).toEqual([
        root.getByTestId("save"),
        root.getByTestId("delete"),
      ])
      expect(root.queryAllByRole("button")).toHaveLength(2)
      expect(root.queryByRole("link")).toBeNull()
      expect(root.queryAllByRole("link")).toEqual([])
      expect(() => root.getByRole("button")).toThrowError(
        'Found multiple elements with the role "button"'
      )
      expect(() => root.queryByRole("button")).toThrowError(
        'Found multiple elements with the role "button"'
      )

      const scoped = root.within(root.getByTestId("outer"))
      expect(scoped.queryByRole("region", { name: "Outer" })).toBeNull()
      expect(scoped.getByRole("button", { name: "Save" })).toBe(root.getByTestId("save"))
    } finally {
      root.unmount()
    }
  })

  it("re-resolves root and scoped role queries after rerenders", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div testId="panel">
          <div role="button" ariaLabel="Before" />
        </div>
      )
      const scoped = root.within(root.getByTestId("panel"))

      root.render(
        <div testId="panel">
          <div>
            <div role="button" ariaLabel="After" testId="after" />
          </div>
        </div>
      )

      expect(root.queryByRole("button", { name: "Before" })).toBeNull()
      expect(scoped.getByRole("button", { name: "After" })).toBe(root.getByTestId("after"))
    } finally {
      root.unmount()
    }
  })

  it("defaults hidden to false and rejects hidden true until snapshots expose hidden nodes", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div>
          <div role="button" ariaLabel="Hidden action" ariaHidden />
          <div role="button" ariaLabel="Visible action" testId="visible" />
        </div>
      )

      expect(root.queryByRole("button", { name: "Hidden action" })).toBeNull()
      expect(root.getByRole("button", { name: "Visible action", hidden: false })).toBe(
        root.getByTestId("visible")
      )
      expect(() => root.queryAllByRole("button", { hidden: true })).toThrowError(
        "hidden: true requires native hidden-node snapshot support, not yet implemented; see issue #209"
      )
    } finally {
      root.unmount()
    }
  })

  it("reports the requested role, name matcher, and accessible roles on a miss", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div>
          <div role="button" ariaLabel="Save factory" testId="save" />
          <div role="heading" ariaLabel="Production" ariaLevel={2} testId="heading" />
        </div>
      )

      expect(() => root.getByRole("link", { name: /coal/i })).toThrowError(
        /Unable to find an accessible element with the role "link" and name \/coal\/i[\s\S]*Here are the accessible roles:[\s\S]*button:[\s\S]*Name "Save factory"[\s\S]*heading:[\s\S]*Name "Production"/
      )
      expect(() => root.getAllByRole("heading", { level: 3 })).toThrowError(
        'role "heading" and level 3'
      )
    } finally {
      root.unmount()
    }
  })
})
