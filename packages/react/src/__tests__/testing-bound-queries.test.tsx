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
          <div data-testid="summary">
            <text>Power</text>
            <text>Rate</text>
          </div>
          <div data-testid="details">
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
          <div data-testid="summary">
            <text data-testid="value">Power</text>
          </div>
          <div data-testid="details">
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
        'Unable to find an element with test ID "details" within <div data-testid="summary"'
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
          <text data-testid="  Primary   Action  ">{"  Save\n  factory  "}</text>
          <text data-testid="secondary-action">Delete factory</text>
          <div data-testid="wrapper">
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
      expect(screen.getByTestId("primary", { exact: false }).dataTestId).toContain("Primary")
      expect(
        screen.getByTestId(
          (content, element) =>
            content === "secondary-action" && element.dataTestId === "secondary-action"
        ).dataTestId
      ).toBe("secondary-action")
      expect(
        screen.getByTestId("PRIMARY ACTION", {
          normalizer: (content) => content.trim().replace(/\s+/g, " ").toUpperCase(),
        }).dataTestId
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

  it("resolves one test ID per element from data-testid", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="plain">Plain</text>
          <text data-testid="standard">Standard</text>
        </div>
      )

      const standard = screen.getByTestId("standard")
      expect(screen.getAllByTestId("plain")).toHaveLength(1)
      expect(screen.queryByTestId("missing")).toBeNull()
      expect(screen.renderer.findByTestId("standard")).toBe(standard)
      expect(screen.renderer.findByTestId("plain")?.dataTestId).toBe("plain")

      // renderer.findByText runs on the shared matcher, not a raw substring.
      const label = screen.renderer.findByText("Standard")
      expect(label?.text).toBe("Standard")
      expect(screen.renderer.findByText("Stand")).toBeUndefined()
      expect(screen.renderer.findByText("stand", { exact: false })).toBe(label)
    } finally {
      screen.unmount()
    }
  })

  it("answers findByTestId the same with and without matcher options", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="target">First</text>
          <text data-testid="target">Second</text>
        </div>
      )

      // Both elements carry the same test ID, so the answer is the first in
      // tree order. Passing options must not move the query onto a native
      // data-testid index that would answer with the second one instead.
      const first = screen.renderer.findByTestId("target")
      expect(first).toBeDefined()
      expect(textContent(screen.renderer, first!)).toBe("First")
      expect(first?.dataTestId).toBe("target")
      expect(screen.renderer.findByTestId("target", {})).toBe(first)
      expect(screen.renderer.findByTestId("target", { exact: false })).toBe(first)
    } finally {
      screen.unmount()
    }
  })

  it("matches accessible names through the shared matcher", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="output" role="heading" ariaLabel="  Iron   Output  " ariaLevel={2} />
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
          name: (name, element) => name === "Iron Output" && element.dataTestId === "output",
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
        <div data-testid="page">
          <text data-testid="value">Ore</text>
          <text data-testid="value">Ore rate</text>
        </div>
      )

      expect(() => screen.getByText("Moss")).toThrowError(
        /Unable to find an element with text "Moss" within <div data-testid="page" text="OreOre rate">\. Near misses:\n  <text text="Ore">\n  <text text="Ore rate">/
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
        <div data-testid="panel">
          <text>Before</text>
        </div>
      )
      const panel = screen.getByTestId("panel")
      const scoped = screen.within(panel)

      screen.render(
        <div data-testid="panel">
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
        <div data-testid="panel">
          <text data-testid="value">Rate</text>
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
          <a role="link" ariaLabel={coalCurrent.name} data-testid="site" />
          <h2 role="heading" ariaLabel="Build list" ariaLevel={2} data-testid="heading" />
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
      root.render(<div role="button" ariaLabel="Save factory" data-testid="save" />)

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
          <div data-testid="first" role="checkbox" ariaLabel="Coal input" ariaChecked />
          <div data-testid="second" role="checkbox" ariaLabel="Iron input" ariaChecked={false} />
          <div data-testid="heading-2" role="heading" ariaLabel="Build list" ariaLevel={2} />
          <div data-testid="heading-3" role="heading" ariaLabel="Build list" ariaLevel={3} />
          <input data-testid="search" role="textbox" ariaLabel="Recipe search" />
          <img data-testid="preview" role="img" ariaLabel="Recipe preview" />
        </div>
      )

      expect(root.getByRole("checkbox", { name: "Coal input" })).toBe(
        root.getByTestId("first")
      )
      expect(root.getByRole("checkbox", { name: /iron/i })).toBe(root.getByTestId("second"))
      expect(
        root.getByRole("checkbox", {
          name: (name, element) => name.endsWith("input") && element.dataTestId === "first",
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
        <div role="region" ariaLabel="Outer" data-testid="outer">
          <div role="button" ariaLabel="Save" data-testid="save" />
          <div role="button" ariaLabel="Delete" data-testid="delete" />
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
        <div data-testid="panel">
          <div role="button" ariaLabel="Before" />
        </div>
      )
      const scoped = root.within(root.getByTestId("panel"))

      root.render(
        <div data-testid="panel">
          <div>
            <div role="button" ariaLabel="After" data-testid="after" />
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
          <div role="button" ariaLabel="Visible action" data-testid="visible" />
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
          <div role="button" ariaLabel="Save factory" data-testid="save" />
          <div role="heading" ariaLabel="Production" ariaLevel={2} data-testid="heading" />
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

  it("queries labels, placeholders, and display values from the semantics block", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div>
          <input
            data-testid="search"
            ariaLabel="Recipe search"
            placeholder="Search recipes"
            value="iron plate"
          />
          <textarea
            data-testid="notes"
            ariaLabel="Build notes"
            placeholder="Add a note"
            value="needs coal"
          />
          <div data-testid="panel" ariaLabel="Production ledger" />
        </div>
      )

      expect(root.getByLabelText("Recipe search")).toBe(root.getByTestId("search"))
      expect(root.getByLabelText(/build notes/i)).toBe(root.getByTestId("notes"))
      // A label is not restricted to controls, and it is not the node's text.
      expect(root.getByLabelText("Production ledger")).toBe(root.getByTestId("panel"))
      expect(root.getByPlaceholderText("Search recipes")).toBe(root.getByTestId("search"))
      expect(root.getByPlaceholderText("add a note", { exact: false })).toBe(
        root.getByTestId("notes")
      )
      expect(root.getByDisplayValue("iron plate")).toBe(root.getByTestId("search"))
      expect(root.getByDisplayValue(/coal/)).toBe(root.getByTestId("notes"))

      // The block reaches the element itself, not only the query.
      expect(root.getByTestId("search").semantics).toEqual({
        label: "Recipe search",
        placeholder: "Search recipes",
        value: "iron plate",
      })
    } finally {
      root.unmount()
    }
  })

  it("implements singular, all, nullable, and scoped semantics queries", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div ariaLabel="Outer" data-testid="outer">
          <input data-testid="first" ariaLabel="Amount" placeholder="Qty" value="1" />
          <input data-testid="second" ariaLabel="Amount" placeholder="Qty" value="2" />
        </div>
      )

      expect(root.getAllByLabelText("Amount")).toHaveLength(2)
      expect(root.getAllByPlaceholderText("Qty")).toHaveLength(2)
      expect(root.getAllByDisplayValue(/[12]/)).toHaveLength(2)
      expect(root.queryByLabelText("Missing")).toBeNull()
      expect(root.queryAllByPlaceholderText("Missing")).toEqual([])
      expect(root.queryAllByDisplayValue("3")).toEqual([])
      expect(() => root.queryByLabelText("Amount")).toThrowError(
        /Found multiple elements with label text "Amount"/
      )

      // `within` searches descendants only, so the scope's own label is absent.
      const scoped = root.within(root.getByTestId("outer"))
      expect(scoped.queryByLabelText("Outer")).toBeNull()
      expect(scoped.getByDisplayValue("1")).toBe(root.getByTestId("first"))
    } finally {
      root.unmount()
    }
  })

  it("reports the declared labels, placeholders, and values on a miss", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div>
          <input data-testid="search" ariaLabel="Recipe search" placeholder="Search" value="ore" />
        </div>
      )

      expect(() => root.getByLabelText("Missing")).toThrowError(
        /Unable to find an element with label text "Missing"[\s\S]*Here is the label text that was declared:[\s\S]*"Recipe search"/
      )
      expect(() => root.getByPlaceholderText("Missing")).toThrowError(
        /placeholder text "Missing"[\s\S]*"Search"/
      )
      expect(() => root.getByDisplayValue("missing")).toThrowError(
        /display value "missing"[\s\S]*"ore"/
      )
      expect(() => root.getAllByLabelText("Missing")).toThrowError(
        /Unable to find an element with label text "Missing"/
      )

      // Nothing declared at all reads differently from "declared, but other".
      root.render(<div data-testid="empty" />)
      expect(() => root.getByPlaceholderText("Missing")).toThrowError(
        /No element in this scope declares placeholder\./
      )
    } finally {
      root.unmount()
    }
  })

  it("retries semantics queries through findBy while the clocks are pumped", async () => {
    const root = createTestRoot()

    try {
      function Deferred() {
        const [ready, setReady] = React.useState(false)
        React.useEffect(() => {
          const timer = setTimeout(() => setReady(true), 30)
          return () => clearTimeout(timer)
        }, [])
        return <div>{ready ? <input ariaLabel="Recipe search" value="ore" /> : null}</div>
      }

      root.render(<Deferred />)
      expect(root.queryByLabelText("Recipe search")).toBeNull()

      const found = await root.findByLabelText("Recipe search")
      expect(found.semantics?.value).toBe("ore")
      expect(await root.findAllByDisplayValue("ore")).toHaveLength(1)
    } finally {
      root.unmount()
    }
  })
})

/** A component that renders nothing, so the renderer holds no root element. */
function Empty(): React.ReactNode {
  return null
}

/** Every query family, paired with the noun its "Unable to find" message uses. */
const EMPTY_TREE_FAMILIES = [
  { family: "Text", argument: "Missing", noun: 'element with text "Missing"' },
  { family: "TestId", argument: "missing", noun: 'element with test ID "missing"' },
  { family: "Role", argument: "button", noun: 'accessible element with the role "button"' },
  { family: "LabelText", argument: "Missing", noun: 'element with label text "Missing"' },
  {
    family: "PlaceholderText",
    argument: "Missing",
    noun: 'element with placeholder text "Missing"',
  },
  { family: "DisplayValue", argument: "missing", noun: 'element with display value "missing"' },
] as const

describeNative("queries against an empty rendered tree", () => {
  const waitForOptions = { timeout: 30, interval: 5 }

  for (const { family, argument, noun } of EMPTY_TREE_FAMILIES) {
    it(`resolves the ${family} family against a component that renders null`, async () => {
      const root = createTestRoot()

      try {
        root.render(<Empty />)
        expect(root.renderer.getRoot()).toBeUndefined()

        const queries = root as unknown as Record<string, (...args: unknown[]) => unknown>
        const notFound = new RegExp(`Unable to find an? ${noun}`)

        expect(queries[`queryBy${family}`]!(argument)).toBeNull()
        expect(queries[`queryAllBy${family}`]!(argument)).toEqual([])
        expect(() => queries[`getBy${family}`]!(argument)).toThrowError(notFound)
        expect(() => queries[`getAllBy${family}`]!(argument)).toThrowError(notFound)
        await expect(
          queries[`findBy${family}`]!(argument, undefined, waitForOptions)
        ).rejects.toThrowError(notFound)
        await expect(
          queries[`findAllBy${family}`]!(argument, undefined, waitForOptions)
        ).rejects.toThrowError(notFound)
      } finally {
        root.unmount()
      }
    })
  }

  it("names the empty tree as the searched scope", () => {
    const root = createTestRoot()

    try {
      root.render(<Empty />)

      expect(() => root.getByText("Missing")).toThrowError(/within the empty render tree/)
      expect(() => root.getByTestId("missing")).toThrowError(/within the empty render tree/)
      expect(() => root.getByRole("button")).toThrowError(/within the empty render tree/)
      expect(() => root.getByLabelText("Missing")).toThrowError(/within the empty render tree/)
    } finally {
      root.unmount()
    }
  })

  it("keeps querying after a tree empties and refills", () => {
    const root = createTestRoot()

    try {
      root.render(<text>Present</text>)
      expect(root.getByText("Present").text).toBe("Present")

      root.render(<Empty />)
      expect(root.queryByText("Present")).toBeNull()
      expect(root.queryAllByText("Present")).toEqual([])

      root.render(<text>Present</text>)
      expect(root.getByText("Present").text).toBe("Present")
    } finally {
      root.unmount()
    }
  })

  for (const { family, argument, noun } of EMPTY_TREE_FAMILIES) {
    it(`resolves the ${family} family within an element with an empty subtree`, async () => {
      const root = createTestRoot()

      try {
        root.render(<div data-testid="shell" />)

        const scoped = root.within(root.getByTestId("shell")) as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >
        const notFound = new RegExp(`Unable to find an? ${noun}`)

        expect(scoped[`queryBy${family}`]!(argument)).toBeNull()
        expect(scoped[`queryAllBy${family}`]!(argument)).toEqual([])
        expect(() => scoped[`getBy${family}`]!(argument)).toThrowError(notFound)
        expect(() => scoped[`getAllBy${family}`]!(argument)).toThrowError(notFound)
        await expect(
          scoped[`findBy${family}`]!(argument, undefined, waitForOptions)
        ).rejects.toThrowError(notFound)
      } finally {
        root.unmount()
      }
    })
  }
})
