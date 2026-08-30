import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing.js"
import { wrapWithBatching } from "../reconciler/batch-renderer.js"
import type { StyleDesc } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

afterEach(() => {
  vi.restoreAllMocks()
})

describeNative("style diagnostics", { timeout: 12_000 }, () => {
  it("reports malformed, incompatible, hidden-focus, and unsupported-host accessibility props", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ strictStyles: true })

    testRoot.render(
      <div>
        <div {...({ role: "bogus" } as Record<string, string>)} ariaLabel="Bad role" />
        <div ariaLabel="Missing role" />
        <a role="link" ariaLabel="Link" ariaSelected />
        <button role="button" ariaLabel="Current button" ariaCurrent="page" />
        <a
          role="link"
          ariaLabel="Malformed current"
          {...({ ariaCurrent: "chapter" } as Record<string, string>)}
        />
        <div role="switch" ariaLabel="Mode" ariaChecked="mixed" />
        <h2 role="heading" ariaLabel="Heading" ariaLevel={0} />
        <div role="slider" ariaLabel="Speed" ariaValueNow={Number.NaN} />
        <div ariaHidden tabIndex={0} />
        <markdown role="heading" ariaLabel="Unsupported host" source="# Notes" />
      </div>
    )

    const messages = warn.mock.calls.map(([message]) => String(message)).join("\n")
    expect(messages).toContain("unsupported accessibility role")
    expect(messages).toContain("requires an explicit supported role")
    expect(messages).toContain("ariaSelected")
    expect(messages).toContain("ariaCurrent")
    expect(messages).toContain("role=Button")
    expect(messages).toContain("expected one of \"page\"")
    expect(messages).toContain("ariaChecked")
    expect(messages).toContain("binary")
    expect(messages).toContain("positive integer")
    expect(messages).toContain("finite number")
    expect(messages).toContain("must not contain or be a focusable control")
    expect(messages).toContain("does not support accessibility semantics")
  })

  it("reports malformed fields and deduplicates repeated native diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ strictStyles: true })

    try {
      expect(() => {
        testRoot.render(
          <div
            testId="bad-card"
            style={
              {
                backgroundColor: "#ff0000",
                marginTop: "auto",
              } as unknown as StyleDesc
            }
          />
        )
      }).not.toThrow()

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('<div testId="bad-card">')
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("marginTop"))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"auto"'))
      expect(testRoot.renderer.findByTestId("bad-card")?.style).toMatchObject({
        backgroundColor: "#ff0000",
      })

      const renderer = wrapWithBatching(testRoot.renderer)
      renderer.createElement(10_001, "div")
      renderer.setCustomProp(10_001, "testId", "native-diagnostic")
      renderer.setStyle(10_001, { width: "banana" })
      renderer.commitMutations()

      renderer.setStyle(10_001, { width: "banana" })
      renderer.commitMutations()

      renderer.setStyle(10_001, { width: "plantain" })
      renderer.commitMutations()

      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
        expect.stringContaining('"auto"'),
        expect.stringContaining('"banana"'),
        expect.stringContaining('"plantain"'),
      ])
    } finally {
      testRoot.unmount()
    }
  })

  it("drains a rendered style diagnostic exactly once and leaves clean renders empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const invalid = createTestRoot({ strictStyles: true })

    try {
      invalid.render(
        <div
          testId="bad-width"
          style={{ width: "banana" } as unknown as StyleDesc}
        />
      )

      const element = invalid.renderer.findByTestId("bad-width")!
      const diagnostics = invalid.renderer.drainStyleDiagnostics()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        elementId: element.id,
        elementType: "div",
        testId: "bad-width",
        property: "width",
        value: '"banana"',
        message:
          `[gpuix] Invalid style on <div testId="bad-width"> (element ${element.id}): ` +
          'property "width" rejected value "banana": invalid length at byte 0: ' +
          "expected a number with px, %, or ch",
      })
      expect(invalid.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      invalid.unmount()
    }

    const clean = createTestRoot({ strictStyles: true })
    try {
      clean.render(<div testId="valid-width" style={{ width: 320 }} />)
      expect(clean.renderer.drainStyleDiagnostics()).toEqual([])
    } finally {
      clean.unmount()
    }
  })

  it("drains a rendered accessibility diagnostic with assertion metadata", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ strictStyles: true })

    try {
      testRoot.render(<div testId="roleless-ledger" ariaLabel="Production ledger" />)

      const element = testRoot.renderer.findByTestId("roleless-ledger")!
      const diagnostics = testRoot.renderer.drainStyleDiagnostics()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        elementId: element.id,
        elementType: "div",
        testId: "roleless-ledger",
        property: "ariaLabel",
        value: '"Production ledger"',
        message:
          `[gpuix] Invalid property on <div testId="roleless-ledger"> (element ${element.id}): ` +
          'property "ariaLabel" rejected value "Production ledger": ' +
          "requires an explicit supported role",
      })
    } finally {
      testRoot.unmount()
    }
  })

  it("reports an unknown direct style with element, property, and value", () => {
    const renderer = new TestRenderer()
    renderer.createElement(41, "text")
    renderer.setCustomProp(41, "testId", JSON.stringify("direct-label"))
    renderer.setStyle(41, JSON.stringify({ textTranform: "uppercase" }))

    const diagnostics = renderer.drainStyleDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      elementId: 41,
      elementType: "text",
      testId: "direct-label",
      property: "textTranform",
      value: '"uppercase"',
    })
    expect(diagnostics[0].message).toContain('<text testId="direct-label">')
    expect(diagnostics[0].message).toContain("textTranform")
    expect(diagnostics[0].message).toContain('"uppercase"')
  })

  it("reports an invalid length expression with element, property, value, and parse position", () => {
    const renderer = new TestRenderer()
    renderer.createElement(44, "div")
    renderer.setCustomProp(44, "testId", JSON.stringify("fluid-panel"))
    renderer.setStyle(44, JSON.stringify({ width: "calc(100% - 2rem)", height: 40 }))
    renderer.setRoot(44)

    expect(renderer.getElement(44)?.style).toMatchObject({ height: 40 })
    const [diagnostic] = renderer.drainStyleDiagnostics()
    expect(diagnostic).toMatchObject({
      elementId: 44,
      elementType: "div",
      testId: "fluid-panel",
      property: "width",
      value: '"calc(100% - 2rem)"',
    })
    expect(diagnostic!.message).toContain('<div testId="fluid-panel">')
    expect(diagnostic!.message).toContain("byte")
  })

  it("reports an unknown batched style after later identity metadata is applied", () => {
    const renderer = new TestRenderer()
    renderer.applyBatch(
      JSON.stringify([
        ["createElement", 73, "div"],
        ["setStyle", 73, { flex: 1, backgroundColor: "red" }],
        ["setCustomPropValue", 73, "id", "profile-card"],
        ["setCustomPropValue", 73, "data-testid", 42],
        ["setCustomPropValue", 73, "testId", "batch-card"],
        ["setRoot", 73],
      ])
    )

    expect(renderer.getElement(73)?.style).toMatchObject({ backgroundColor: "red" })
    const diagnostics = renderer.drainStyleDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      authorId: "profile-card",
      dataTestId: "42",
      testId: "batch-card",
    })
    expect(diagnostics[0].message).toContain(
      '<div id="profile-card" data-testid="42" testId="batch-card">'
    )
    expect(diagnostics[0].message).toContain("flex")
    expect(diagnostics[0].message).toContain("1")
  })

  it("normalizes boolean data-testid values in style diagnostics", () => {
    const renderer = new TestRenderer()
    renderer.applyBatch(
      JSON.stringify([
        ["createElement", 74, "div"],
        ["setStyle", 74, { flex: 1 }],
        ["setCustomPropValue", 74, "data-testid", true],
        ["setRoot", 74],
      ])
    )

    expect(renderer.findByTestId("true")?.id).toBe(74)
    const diagnostics = renderer.drainStyleDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ dataTestId: "true" })
    expect(diagnostics[0].message).toContain('<div data-testid="true">')
  })

  it("reports malformed nested grid tracks with their track index", () => {
    const renderer = new TestRenderer()
    renderer.createElement(82, "div")
    renderer.setCustomProp(82, "testId", JSON.stringify("ledger-grid"))
    renderer.setStyle(
      82,
      JSON.stringify({
        display: "grid",
        gridTemplateColumns: [
          { type: "max-content" },
          {
            type: "minmax",
            min: { type: "fr", value: 1 },
            max: { type: "fr", value: 1 },
          },
        ],
      }),
    )

    const diagnostics = renderer.drainStyleDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      elementId: 82,
      elementType: "div",
      testId: "ledger-grid",
      property: "gridTemplateColumns[1].min.type",
      value: '"fr"',
    })
    expect(diagnostics[0].message).toContain('<div testId="ledger-grid">')
  })

  it("rejects a malformed transition as one descriptor with precise paths", () => {
    const renderer = new TestRenderer()
    renderer.createElement(83, "div")
    renderer.setCustomProp(83, "testId", JSON.stringify("animated-card"))
    renderer.setStyle(
      83,
      JSON.stringify({
        opacity: 0.4,
        transition: {
          properties: ["opacity", "display"],
          durationMs: -100,
        },
      })
    )
    renderer.setRoot(83)

    expect(renderer.getElement(83)?.style).toMatchObject({ opacity: 0.4 })
    expect(renderer.getElement(83)?.style).not.toHaveProperty("transition")
    expect(
      renderer.drainStyleDiagnostics().map(({ property, testId }) => ({ property, testId }))
    ).toEqual([
      { property: "transition.properties[1]", testId: "animated-card" },
      { property: "transition.durationMs", testId: "animated-card" },
    ])
  })

  it("keeps deterministic field dropping when strict diagnostics are disabled", () => {
    const renderer = new TestRenderer()
    renderer.setStrictStyles(false)
    renderer.createElement(91, "div")
    renderer.setStyle(
      91,
      JSON.stringify({ textTranform: "uppercase", backgroundColor: "red" })
    )
    renderer.setRoot(91)

    expect(renderer.getElement(91)?.style).toMatchObject({ backgroundColor: "red" })
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })

  it.each([
    ["string", "chip focused"],
    ["array", [{ backgroundColor: "red" }]],
    ["function", () => ({ backgroundColor: "red" })],
    ["number", 42],
  ] as const)("rejects a %s style prop loudly on mount and update", (_kind, style) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const strictCreate = createTestRoot({ strictStyles: true })
    strictCreate.render(<div testId="invalid-style" style={style as unknown as StyleDesc} />)

    const strictUpdate = createTestRoot({ strictStyles: true })
    strictUpdate.render(<div testId="invalid-style" style={{ width: 10 }} />)
    strictUpdate.render(<div testId="invalid-style" style={style as unknown as StyleDesc} />)

    expect(error.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "InvalidStylePropError",
          message: expect.stringContaining("<div testId=\"invalid-style\">"),
        }),
      ])
    )
    strictCreate.unmount()
    strictUpdate.unmount()
    error.mockRestore()

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const compatibility = createTestRoot({ strictStyles: false })
    compatibility.render(<div testId="invalid-style" style={{ width: 10 }} />)
    compatibility.render(<div testId="invalid-style" style={style as unknown as StyleDesc} />)
    compatibility.render(<div testId="invalid-style" style={style as unknown as StyleDesc} />)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/<div testId="invalid-style">.*style accepts a plain style object only/)
    )
    compatibility.unmount()
  })

  it("validates outline and focus-visible fields with their full property paths", () => {
    const renderer = new TestRenderer()
    renderer.createElement(101, "div")
    renderer.setCustomProp(101, "testId", JSON.stringify("focus-card"))
    renderer.setStyle(
      101,
      JSON.stringify({
        outlineColor: "not-a-color",
        outlineWidth: -1,
        focusVisible: {
          backgroundColor: "blue",
          outlineOffset: "wide",
        },
      })
    )
    renderer.setRoot(101)

    expect(renderer.getElement(101)?.style).toMatchObject({
      focusVisible: { backgroundColor: "blue" },
    })
    const diagnostics = renderer.drainStyleDiagnostics().map((diagnostic) => ({
      property: diagnostic.property,
      elementType: diagnostic.elementType,
      testId: diagnostic.testId,
    }))
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        { property: "outlineColor", elementType: "div", testId: "focus-card" },
        { property: "outlineWidth", elementType: "div", testId: "focus-card" },
        {
          property: "focusVisible.outlineOffset",
          elementType: "div",
          testId: "focus-card",
        },
      ])
    )
  })
})
