/// ariaLive marks a node as an AccessKit live region, so a screen reader
/// announces a change to its text without moving focus. The assertions read the
/// real TreeUpdate the platform adapters diff, because that diff — a live node,
/// a stable id, a changed string — is the announcement itself.
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { announce } from "../index.js"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type AccessKitNodeSnapshot,
  type AccessKitTreeSnapshot,
  type TestRoot,
} from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("live regions", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  afterEach(() => {
    screen.unmount()
  })

  /// Painted text reaches AccessKit during paint, so the tree is only complete
  /// once the frame the render asked for has been drawn.
  const tree = (): AccessKitTreeSnapshot => {
    screen.renderer.flush()
    screen.renderer.drawPendingFrame()
    return screen.renderer.getAccessibilityTree()
  }

  const nodeFor = (testId: string): AccessKitNodeSnapshot => {
    const element = screen.getByTestId(testId)
    const node = Object.values(tree().nodes).find(
      (candidate) => candidate.host_id === element.id
    )
    expect(node, testId).toBeDefined()
    return node!
  }

  /// The descendant that carries the region's text. A painted string enters
  /// AccessKit as a `Label` node of its own, and that is the node whose changed
  /// value every platform adapter turns into an announcement.
  const textNodeOf = (testId: string): AccessKitNodeSnapshot => {
    const snapshot = tree()
    const container = Object.values(snapshot.nodes).find(
      (candidate) => candidate.host_id === screen.getByTestId(testId).id
    )
    const child = (container?.children ?? [])
      .map((id) => snapshot.nodes[id])
      .find((node) => node?.aria.value !== undefined)
    expect(child, testId).toBeDefined()
    return child!
  }

  it("marks a roled element with the politeness the author declared", () => {
    screen.render(
      <div data-testid="region" role="region" ariaLive="assertive">
        <text>Build failed</text>
      </div>
    )

    expect(nodeFor("region").aria.live).toBe("Assertive")
  })

  it("accepts the DOM spellings of both live-region props", () => {
    screen.render(
      <div data-testid="region" role="region" aria-live="polite" aria-atomic>
        <text>Build queued</text>
      </div>
    )

    expect(nodeFor("region").aria).toMatchObject({ live: "Polite", live_atomic: true })
  })

  it("takes the implicit politeness and atomicity from the role", () => {
    // The WAI-ARIA implicit values. `marquee` and `timer` are live regions that
    // announce nothing, which is not the same as carrying no politeness at all:
    // an `Off` node stops a live ancestor's politeness inheriting into it.
    screen.render(
      <div>
        <div data-testid="alert" role="alert">
          <text>Disk full</text>
        </div>
        <div data-testid="status" role="status">
          <text>Saved</text>
        </div>
        <div data-testid="log" role="log">
          <text>Connected</text>
        </div>
        <div data-testid="marquee" role="marquee">
          <text>Now playing</text>
        </div>
        <div data-testid="timer" role="timer">
          <text>00:31</text>
        </div>
        <div data-testid="plain" role="region">
          <text>Output</text>
        </div>
      </div>
    )

    expect(nodeFor("alert").aria).toMatchObject({ live: "Assertive", live_atomic: true })
    expect(nodeFor("status").aria).toMatchObject({ live: "Polite", live_atomic: true })
    expect(nodeFor("log").aria.live).toBe("Polite")
    // `LiveAtomic` is an AccessKit flag, so an atomic=false region reports no
    // flag at all rather than a false one.
    expect(nodeFor("log").aria.live_atomic).toBeUndefined()
    expect(nodeFor("marquee").aria.live).toBe("Off")
    expect(nodeFor("timer").aria.live).toBe("Off")
    expect(nodeFor("plain").aria.live).toBeUndefined()
  })

  it("lets an authored politeness override the one the role carries", () => {
    screen.render(
      <div data-testid="alert" role="alert" ariaLive="off" ariaAtomic={false}>
        <text>Disk full</text>
      </div>
    )

    expect(nodeFor("alert").aria.live).toBe("Off")
    expect(nodeFor("alert").aria.live_atomic).toBeUndefined()
  })

  it("keeps the text child's identity while its value changes", () => {
    // This triple — a live container, a child whose AccessKit id is unchanged,
    // and a value that moved — is exactly what every platform adapter diffs to
    // raise an announcement. `Live` inherits down the AccessKit tree, so the
    // child does not carry the politeness itself; the container's is enough.
    const region = (message: string) => (
      <div data-testid="status" role="status">
        <text>{message}</text>
      </div>
    )

    screen.render(region("Saved 1 file"))
    const before = textNodeOf("status")
    expect(nodeFor("status").aria.live).toBe("Polite")
    expect(before.aria.value).toBe("Saved 1 file")

    screen.render(region("Saved 3 files"))
    const after = textNodeOf("status")

    expect(nodeFor("status").aria.live).toBe("Polite")
    expect(after.accesskit_id).toBe(before.accesskit_id)
    expect(after.aria.value).toBe("Saved 3 files")
  })

  it("leaves a visible live region's container unnamed", () => {
    // The painted text already reaches AccessKit as its own child node. Naming
    // the container as well would make macOS announce the string twice.
    screen.render(
      <div data-testid="status" role="status">
        <text>Saved 3 files</text>
      </div>
    )

    expect(nodeFor("status").aria.label).toBeUndefined()
    expect(textNodeOf("status").aria.value).toBe("Saved 3 files")
  })

  it("gives a visually hidden live region both a label and a value", () => {
    // The projection is a single node with no child to carry its text. macOS
    // announces `value`; Windows and AT-SPI announce `name`. Writing both keeps
    // the sr-only status line audible on all three.
    screen.render(
      <div data-testid="status" visuallyHidden role="status">
        Saved 3 files
      </div>
    )

    expect(nodeFor("status").aria).toMatchObject({
      live: "Polite",
      label: "Saved 3 files",
      value: "Saved 3 files",
    })
  })

  it("gives a live name-from-contents role a value as well as a name", () => {
    // A role that names itself from its contents suppresses the child label
    // that painted the text, so without this the node would carry a name and
    // no value — and macOS raises an announcement only for a node that has a
    // value. A live `heading` would be permanently silent there.
    screen.render(
      <div data-testid="heading" role="heading" ariaLevel={2} ariaLive="assertive">
        <text>Chapter 3</text>
      </div>
    )

    expect(nodeFor("heading").aria).toMatchObject({
      live: "Assertive",
      label: "Chapter 3",
      value: "Chapter 3",
    })
  })

  it("gives a visually hidden name-from-contents role the same pair", () => {
    screen.render(
      <div
        data-testid="heading"
        visuallyHidden
        role="heading"
        ariaLevel={2}
        ariaLive="polite"
      >
        Chapter 3
      </div>
    )

    expect(nodeFor("heading").aria).toMatchObject({
      live: "Polite",
      label: "Chapter 3",
      value: "Chapter 3",
    })
  })

  it("leaves a heading that is not live carrying only its name", () => {
    // The doubling belongs to the live path alone; an ordinary heading keeps
    // exactly the accname it always had.
    screen.render(
      <div data-testid="heading" role="heading" ariaLevel={2}>
        <text>Chapter 3</text>
      </div>
    )

    expect(nodeFor("heading").aria.label).toBe("Chapter 3")
    expect(nodeFor("heading").aria.value).toBeUndefined()
  })

  it("reports a live region on a role that reaches no node", () => {
    // `presentation` parses but resolves to no GPUI role, so the element
    // contributes no AccessKit node at all and the politeness is inert.
    screen.render(<div data-testid="decorative" role="presentation" ariaLive="polite" />)

    const element = screen.getByTestId("decorative")
    const diagnostic = screen.renderer
      .drainStyleDiagnostics()
      .find((candidate) => candidate.property === "ariaLive")

    expect(diagnostic!.message).toContain("a live region requires an explicit supported role")
    expect(
      Object.values(tree().nodes).find((node) => node.host_id === element.id)
    ).toBeUndefined()
  })

  it("leaves an ordinary visually hidden node named the way it always was", () => {
    screen.render(
      <div data-testid="note" visuallyHidden role="note">
        Draft only
      </div>
    )

    expect(nodeFor("note").aria.value).toBe("Draft only")
    expect(nodeFor("note").aria.label).toBeUndefined()
  })

  it("reports a live region that has no role to carry it", () => {
    screen.render(<div data-testid="roleless" ariaLive="polite" />)

    const element = screen.getByTestId("roleless")
    const diagnostic = screen.renderer
      .drainStyleDiagnostics()
      .find((candidate) => candidate.property === "ariaLive")

    expect(diagnostic).toMatchObject({
      elementId: element.id,
      property: "ariaLive",
      value: '"polite"',
    })
    expect(diagnostic!.message).toContain(
      'a live region requires an explicit supported role, so it is omitted from the accessibility tree; add role="status", role="alert", or role="log"'
    )
  })

  it("rejects a politeness outside the ARIA token set", () => {
    screen.render(
      <div data-testid="region" role="status" ariaLive={"rude" as unknown as "polite"}>
        <text>Saved</text>
      </div>
    )

    const diagnostic = screen.renderer
      .drainStyleDiagnostics()
      .find((candidate) => candidate.property === "ariaLive")

    expect(diagnostic!.message).toContain('expected one of "off", "polite", or "assertive"')
    // The role's own politeness survives a rejected authored value.
    expect(nodeFor("region").aria.live).toBe("Polite")
  })
})

/// `announce()` writes into hidden host regions React never rendered, so these
/// assertions locate a node by its live-region shape rather than a testId —
/// exactly what a screen reader itself has for an identity, since nothing
/// authored one.
describeNative("announce()", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  afterEach(() => {
    screen.unmount()
  })

  const tree = (): AccessKitTreeSnapshot => {
    screen.renderer.flush()
    screen.renderer.drawPendingFrame()
    return screen.renderer.getAccessibilityTree()
  }

  const regionWithValue = (role: string, value: string): AccessKitNodeSnapshot | undefined =>
    Object.values(tree().nodes).find(
      (node) => node.aria.role === role && node.aria.value === value
    )

  it("speaks a polite message through a status region", () => {
    screen.render(<div />)

    announce("Saved")

    const region = regionWithValue("Status", "Saved")
    expect(region).toBeDefined()
    expect(region!.aria).toMatchObject({ live: "Polite", live_atomic: true, value: "Saved" })
  })

  it("speaks an assertive message through an alert region", () => {
    screen.render(<div />)

    announce("Failed", { politeness: "assertive" })

    const region = regionWithValue("Alert", "Failed")
    expect(region).toBeDefined()
    expect(region!.aria).toMatchObject({ live: "Assertive", live_atomic: true, value: "Failed" })
  })

  it("announces the same message twice by alternating regions", () => {
    screen.render(<div />)

    announce("Saved")
    const first = regionWithValue("Status", "Saved")
    expect(first).toBeDefined()

    announce("Saved")
    const second = regionWithValue("Status", "Saved")
    expect(second).toBeDefined()
    // A second identical announcement lands in the other region, not the one
    // that already carried the string — otherwise the value never changes and
    // AccessKit's frame diff raises no announcement at all.
    expect(second!.accesskit_id).not.toBe(first!.accesskit_id)
  })

  it("warns once and does not throw when no root is attached", () => {
    screen.unmount()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(() => announce("Saved")).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("recovers after the root renders null and then a new tree", () => {
    screen.render(<div />)
    announce("Saved")
    const beforeUnmount = regionWithValue("Status", "Saved")
    expect(beforeUnmount).toBeDefined()

    // Rendering nothing destroys the top-level element `announce()` attached
    // its regions under, cascading away the regions with it.
    screen.render(null)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => announce("Saved")).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()

    screen.render(<div />)
    announce("Saved")
    const afterRemount = regionWithValue("Status", "Saved")
    expect(afterRemount).toBeDefined()
    // A fresh root element gets fresh regions, not the destroyed ones.
    expect(afterRemount!.accesskit_id).not.toBe(beforeUnmount!.accesskit_id)
  })

  it("clears the region it wrote to previously when alternating", () => {
    screen.render(<div />)

    announce("Saved 1")
    const first = regionWithValue("Status", "Saved 1")
    expect(first).toBeDefined()

    announce("Saved 2")
    const clearedFirst = Object.values(tree().nodes).find(
      (node) => node.accesskit_id === first!.accesskit_id
    )
    expect(clearedFirst).toBeDefined()
    expect(clearedFirst!.aria.value ?? "").toBe("")
  })

  it("keeps the polite and assertive pairs as independent nodes", () => {
    screen.render(<div />)

    announce("Saved")
    announce("Failed", { politeness: "assertive" })

    const status = regionWithValue("Status", "Saved")
    const alert = regionWithValue("Alert", "Failed")
    expect(status).toBeDefined()
    expect(alert).toBeDefined()
    expect(status!.accesskit_id).not.toBe(alert!.accesskit_id)
  })
})
