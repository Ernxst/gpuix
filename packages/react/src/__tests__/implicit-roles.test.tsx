import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("implicit ARIA roles for semantic aliases", () => {
  it("gives each landmark alias its HTML-AAM role", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <main data-testid="main">
            <nav data-testid="nav" />
            <article data-testid="article" />
            <aside data-testid="aside" />
          </main>
        </div>
      )

      expect(screen.getByRole("main")).toBe(screen.getByTestId("main"))
      expect(screen.getByRole("navigation")).toBe(screen.getByTestId("nav"))
      expect(screen.getByRole("article")).toBe(screen.getByTestId("article"))
      expect(screen.getByRole("complementary")).toBe(screen.getByTestId("aside"))
    } finally {
      screen.unmount()
    }
  })

  it("makes a list item in a list a listitem", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <ul data-testid="list">
          <li data-testid="first">
            <text>Coal</text>
          </li>
          <li data-testid="second">
            <text>Iron</text>
          </li>
        </ul>
      )

      expect(screen.getByRole("list")).toBe(screen.getByTestId("list"))
      expect(screen.getAllByRole("listitem")).toEqual([
        screen.getByTestId("first"),
        screen.getByTestId("second"),
      ])
    } finally {
      screen.unmount()
    }
  })

  it("treats an ordered list the same as an unordered one", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <ol data-testid="list">
          <li data-testid="only">
            <text>Coal</text>
          </li>
        </ol>
      )

      expect(screen.getByRole("list")).toBe(screen.getByTestId("list"))
      expect(screen.getByRole("listitem")).toBe(screen.getByTestId("only"))
    } finally {
      screen.unmount()
    }
  })

  it("leaves a list item outside a list generic, as HTML-AAM does", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <li data-testid="orphan">
            <text>Coal</text>
          </li>
        </div>
      )

      expect(screen.queryByRole("listitem")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("counts a container carrying role=list as the list owner", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div role="list" data-testid="list">
          <li data-testid="row">
            <text>Coal</text>
          </li>
        </div>
      )

      expect(screen.getByRole("listitem")).toBe(screen.getByTestId("row"))
    } finally {
      screen.unmount()
    }
  })

  it("gives every heading alias the heading role and its level", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <h1 data-testid="h1">
            <text>One</text>
          </h1>
          <h2 data-testid="h2">
            <text>Two</text>
          </h2>
          <h3 data-testid="h3">
            <text>Three</text>
          </h3>
          <h4 data-testid="h4">
            <text>Four</text>
          </h4>
          <h5 data-testid="h5">
            <text>Five</text>
          </h5>
          <h6 data-testid="h6">
            <text>Six</text>
          </h6>
        </div>
      )

      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(screen.getByRole("heading", { level })).toBe(
          screen.getByTestId(`h${level}`)
        )
      }
    } finally {
      screen.unmount()
    }
  })

  it("derives a heading name from contents the same way for implicit and explicit roles", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <h2 data-testid="implicit">
            <text>Reactor output</text>
          </h2>
          <div role="heading" ariaLevel={2} data-testid="explicit">
            <text>Reactor output</text>
          </div>
        </div>
      )

      expect(screen.getAllByRole("heading", { name: "Reactor output", level: 2 })).toEqual([
        screen.getByTestId("implicit"),
        screen.getByTestId("explicit"),
      ])
    } finally {
      screen.unmount()
    }
  })

  it("lets an authored ariaLevel win over the tag's level", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <h2 ariaLevel={4} data-testid="heading">
          <text>Reactor output</text>
        </h2>
      )

      expect(screen.getByRole("heading", { level: 4 })).toBe(screen.getByTestId("heading"))
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("scopes header and footer to the body element", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <header data-testid="banner">
            <text>Factory</text>
          </header>
          <footer data-testid="contentinfo">
            <text>Built</text>
          </footer>
        </div>
      )

      expect(screen.getByRole("banner")).toBe(screen.getByTestId("banner"))
      expect(screen.getByRole("contentinfo")).toBe(screen.getByTestId("contentinfo"))
    } finally {
      screen.unmount()
    }
  })

  it("drops the banner and contentinfo landmarks inside sectioning content", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <article>
            <header data-testid="article-header">
              <text>Factory</text>
            </header>
          </article>
          <section>
            <footer data-testid="section-footer">
              <text>Built</text>
            </footer>
          </section>
        </div>
      )

      expect(screen.queryByRole("banner")).toBeNull()
      expect(screen.queryByRole("contentinfo")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("treats a landmark role on an ancestor as sectioning content too", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div role="navigation">
          <header data-testid="header">
            <text>Factory</text>
          </header>
        </div>
      )

      expect(screen.queryByRole("banner")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("makes a section a region only when it has an accessible name", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <section ariaLabel="Production ledger" data-testid="named">
            <text>State</text>
          </section>
          <section data-testid="unnamed">
            <text>State</text>
          </section>
        </div>
      )

      expect(screen.getAllByRole("region")).toEqual([screen.getByTestId("named")])
      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("named")
      )
    } finally {
      screen.unmount()
    }
  })

  it("adds and removes the region role as the section's name appears and goes", () => {
    const screen = createTestRoot()

    function Ledger({ named }: { named: boolean }): React.ReactElement {
      return (
        <section ariaLabel={named ? "Production ledger" : undefined} data-testid="ledger">
          <text>State</text>
        </section>
      )
    }

    try {
      screen.render(<Ledger named={false} />)
      expect(screen.queryByRole("region")).toBeNull()

      screen.render(<Ledger named={true} />)
      expect(screen.getByRole("region", { name: "Production ledger" })).toBe(
        screen.getByTestId("ledger")
      )

      screen.render(<Ledger named={false} />)
      expect(screen.queryByRole("region")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("resolves the role of a list item inserted into an already-mounted list", () => {
    const screen = createTestRoot()

    function List({ extra }: { extra: boolean }): React.ReactElement {
      return (
        <ul data-testid="list">
          <li data-testid="first">
            <text>Coal</text>
          </li>
          {extra ? (
            <li data-testid="second">
              <text>Iron</text>
            </li>
          ) : null}
        </ul>
      )
    }

    try {
      screen.render(<List extra={false} />)
      expect(screen.getAllByRole("listitem")).toEqual([screen.getByTestId("first")])

      screen.render(<List extra={true} />)
      expect(screen.getAllByRole("listitem")).toEqual([
        screen.getByTestId("first"),
        screen.getByTestId("second"),
      ])
    } finally {
      screen.unmount()
    }
  })

  it("resolves the scope of a header inserted into an already-mounted article", () => {
    const screen = createTestRoot()

    function Page({ withHeader }: { withHeader: boolean }): React.ReactElement {
      return (
        <div>
          <article data-testid="article">
            <text>Body</text>
            {withHeader ? (
              <header data-testid="header">
                <text>Factory</text>
              </header>
            ) : null}
          </article>
        </div>
      )
    }

    try {
      screen.render(<Page withHeader={false} />)
      expect(screen.queryByRole("banner")).toBeNull()

      screen.render(<Page withHeader={true} />)
      expect(screen.queryByRole("banner")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("keeps the banner landmark for a header inserted outside sectioning content", () => {
    const screen = createTestRoot()

    function Page({ withHeader }: { withHeader: boolean }): React.ReactElement {
      return (
        <div>
          <text>Body</text>
          {withHeader ? (
            <header data-testid="header">
              <text>Factory</text>
            </header>
          ) : null}
        </div>
      )
    }

    try {
      screen.render(<Page withHeader={false} />)
      expect(screen.queryByRole("banner")).toBeNull()

      screen.render(<Page withHeader={true} />)
      expect(screen.getByRole("banner")).toBe(screen.getByTestId("header"))
    } finally {
      screen.unmount()
    }
  })

  it("re-resolves list items when the owner's role stops being a list", () => {
    const screen = createTestRoot()

    function Rows({ role }: { role: "list" | "group" }): React.ReactElement {
      return (
        <div role={role} data-testid="owner">
          <li data-testid="row">
            <text>Coal</text>
          </li>
        </div>
      )
    }

    try {
      screen.render(<Rows role="list" />)
      expect(screen.getByRole("listitem")).toBe(screen.getByTestId("row"))

      screen.render(<Rows role="group" />)
      expect(screen.queryByRole("listitem")).toBeNull()

      screen.render(<Rows role="list" />)
      expect(screen.getByRole("listitem")).toBe(screen.getByTestId("row"))
    } finally {
      screen.unmount()
    }
  })

  it("re-resolves header scope when an ancestor's landmark role changes", () => {
    const screen = createTestRoot()

    function Page({ role }: { role?: "navigation" }): React.ReactElement {
      return (
        <div role={role} data-testid="wrapper">
          <header data-testid="header">
            <text>Factory</text>
          </header>
        </div>
      )
    }

    try {
      screen.render(<Page />)
      expect(screen.getByRole("banner")).toBe(screen.getByTestId("header"))

      screen.render(<Page role="navigation" />)
      expect(screen.queryByRole("banner")).toBeNull()

      screen.render(<Page />)
      expect(screen.getByRole("banner")).toBe(screen.getByTestId("header"))
    } finally {
      screen.unmount()
    }
  })

  it("lets an explicit role override the alias's implicit role", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <ul>
          <li role="button" data-testid="row">
            <text>Coal</text>
          </li>
        </ul>
      )

      expect(screen.getByRole("button")).toBe(screen.getByTestId("row"))
      expect(screen.queryByRole("listitem")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("keeps the aliases HTML gives no role to out of the accessibility tree", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <p data-testid="p">
            <text>Coal</text>
          </p>
          <span data-testid="span">
            <text>Iron</text>
          </span>
          <strong data-testid="strong">
            <text>Steel</text>
          </strong>
          <em data-testid="em">
            <text>Copper</text>
          </em>
          <kbd data-testid="kbd">
            <text>Ctrl</text>
          </kbd>
        </div>
      )

      expect(screen.queryByRole("paragraph")).toBeNull()
      expect(screen.queryByRole("strong")).toBeNull()
      expect(screen.queryByRole("emphasis")).toBeNull()
      expect(screen.queryByRole("generic")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("keeps the button and link aliases working", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <button data-testid="button">
            <text>Save</text>
          </button>
          <a href="https://example.com" data-testid="link">
            <text>Docs</text>
          </a>
        </div>
      )

      expect(screen.getByRole("button", { name: "Save" })).toBe(screen.getByTestId("button"))
      expect(screen.getByRole("link", { name: "Docs" })).toBe(screen.getByTestId("link"))
    } finally {
      screen.unmount()
    }
  })
})
