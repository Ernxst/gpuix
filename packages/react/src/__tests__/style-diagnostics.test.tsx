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
  it("keeps accessibility diagnostics honest about whether each value landed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ strictStyles: true })

    const cases = (validRoleAdded: boolean, nativeDisabled: boolean) => (
      <div>
        <div
          testId="invalid-role"
          {...({ role: "bogus" } as Record<string, string>)}
          ariaLabel="Bad role"
        />
        <div
          testId="roleless-ledger"
          role={validRoleAdded ? "button" : undefined}
          ariaLabel="Production ledger"
        />
        <div
          testId="roleless-description"
          role={validRoleAdded ? "button" : undefined}
          ariaDescription="Deployment summary"
        />
        <div
          testId="roleless-selected"
          role={validRoleAdded ? "option" : undefined}
          ariaSelected
        />
        <div testId="unsupported-selected" role="button" ariaLabel="Save" ariaSelected />
        <div testId="mixed-switch" role="switch" ariaLabel="Mode" ariaChecked="mixed" />
        <div
          testId="double-disabled"
          role="button"
          ariaLabel="Double disabled"
          disabled={nativeDisabled}
          ariaDisabled
        />
        <div
          testId="hidden-focus"
          role="button"
          ariaLabel="Hidden focus"
          ariaHidden
          tabIndex={0}
        />
        <markdown
          testId="unsupported-host"
          role="heading"
          ariaLabel="Unsupported host"
          source="Unsupported host contents"
        />
        <div
          testId="malformed-label"
          role="button"
          ariaDescription="Malformed label marker"
          ariaLabel={42 as unknown as string}
        />
        <div
          testId="malformed-current"
          role="link"
          ariaLabel="Malformed current"
          ariaCurrent={"chapter" as unknown as "page"}
        />
        <div
          testId="malformed-hidden"
          role="button"
          ariaLabel="Malformed hidden"
          ariaHidden={"yes" as unknown as boolean}
        />
        <div testId="malformed-level" role="heading" ariaLabel="Malformed level" ariaLevel={0} />
        <div
          testId="malformed-value"
          role="slider"
          ariaLabel="Malformed value"
          ariaValueNow={Number.POSITIVE_INFINITY}
        />
        <div
          testId="malformed-checked"
          role="checkbox"
          ariaLabel="Malformed checked"
          ariaChecked={"yes" as unknown as boolean}
        />
      </div>
    )

    try {
      testRoot.render(cases(false, true))

      const diagnostics = testRoot.renderer.drainStyleDiagnostics()
      expect(diagnostics).toHaveLength(15)
      const byTestId = (testId: string) => {
        const diagnostic = diagnostics.find((candidate) => candidate.testId === testId)
        expect(diagnostic, testId).toBeDefined()
        return diagnostic!
      }
      const expectDiagnostic = (
        testId: string,
        elementType: string,
        property: string,
        value: string,
        effect: "applied" | "ignored" | "rejected",
        reason: string,
        appliedAs?: string
      ) => {
        const element = testRoot.renderer.findByTestId(testId)!
        const prefix =
          effect === "rejected"
            ? `[gpuix] Invalid property on <${elementType} testId="${testId}"> (element ${element.id}): `
            : `[gpuix] Accessibility issue on <${elementType} testId="${testId}"> (element ${element.id}): `
        const computedValue = appliedAs === undefined ? "" : ` as ${appliedAs}`
        expect(byTestId(testId)).toMatchObject({
          elementId: element.id,
          elementType,
          testId,
          property,
          value,
          message: `${prefix}property "${property}" ${effect} value ${value}${computedValue}: ${reason}`,
        })
      }

      expectDiagnostic(
        "invalid-role",
        "div",
        "role",
        '"bogus"',
        "rejected",
        "unsupported accessibility role; expected a WAI-ARIA role with an AccessKit mapping"
      )
      expectDiagnostic(
        "roleless-ledger",
        "div",
        "ariaLabel",
        '"Production ledger"',
        "ignored",
        "a name requires an explicit supported role, so it is omitted from the accessibility tree"
      )
      expectDiagnostic(
        "roleless-description",
        "div",
        "ariaDescription",
        '"Deployment summary"',
        "ignored",
        "a description requires an explicit supported role, so it is omitted from the accessibility tree"
      )
      expectDiagnostic(
        "roleless-selected",
        "div",
        "ariaSelected",
        "true",
        "ignored",
        "the property requires an explicit supported role, so it is omitted from the accessibility tree"
      )
      expectDiagnostic(
        "unsupported-selected",
        "div",
        "ariaSelected",
        "true",
        "ignored",
        "role=Button does not support ariaSelected, so it is omitted from the accessibility tree"
      )
      expectDiagnostic(
        "mixed-switch",
        "div",
        "ariaChecked",
        '"mixed"',
        "applied",
        'role="switch" is binary; WAI-ARIA computes ariaChecked="mixed" as false',
        "false"
      )
      expectDiagnostic(
        "double-disabled",
        "div",
        "ariaDisabled",
        "true",
        "ignored",
        "disabled takes precedence and already sets disabled=true, so ariaDisabled does not change the accessibility tree"
      )
      expectDiagnostic(
        "hidden-focus",
        "div",
        "ariaHidden",
        "true",
        "applied",
        "removes the focusable control from the accessibility tree; an ariaHidden subtree must not contain or be a focusable control"
      )
      expectDiagnostic(
        "unsupported-host",
        "markdown",
        "role",
        '"heading"',
        "rejected",
        "<markdown> does not support accessibility semantics; use a <div>, <text>, <input>, <textarea>, or <img> semantic root"
      )
      expectDiagnostic(
        "malformed-label",
        "div",
        "ariaLabel",
        "42",
        "rejected",
        "expected a string"
      )
      expectDiagnostic(
        "malformed-current",
        "div",
        "ariaCurrent",
        '"chapter"',
        "rejected",
        'expected one of "page", "step", "location", "date", "time", "true", or "false"'
      )
      expectDiagnostic(
        "malformed-hidden",
        "div",
        "ariaHidden",
        '"yes"',
        "rejected",
        "expected a boolean"
      )
      expectDiagnostic(
        "malformed-level",
        "div",
        "ariaLevel",
        "0",
        "rejected",
        "expected a positive integer"
      )
      expectDiagnostic(
        "malformed-value",
        "div",
        "ariaValueNow",
        '"Infinity"',
        "rejected",
        "expected a finite number"
      )
      expectDiagnostic(
        "malformed-checked",
        "div",
        "ariaChecked",
        '"yes"',
        "rejected",
        'expected a boolean or "mixed"'
      )

      const nodes = Object.values(testRoot.renderer.getAccessibilityTree().nodes)
      const ariaByLabel = (label: string) =>
        nodes.find((node) => node.aria.label === label)?.aria
      const malformedLabel = nodes.find(
        (node) => node.aria.description === "Malformed label marker"
      )?.aria

      expect(ariaByLabel("Bad role")).toBeUndefined()
      expect(ariaByLabel("Production ledger")).toBeUndefined()
      expect(nodes.some((node) => node.aria.description === "Deployment summary")).toBe(false)
      expect(nodes.some((node) => node.aria.role === "ListBoxOption")).toBe(false)
      expect(ariaByLabel("Save")).toMatchObject({ role: "Button" })
      expect(ariaByLabel("Save")?.selected).toBeUndefined()
      expect(ariaByLabel("Mode")).toMatchObject({ role: "Switch", toggled: "False" })
      expect(ariaByLabel("Double disabled")).toMatchObject({ role: "Button", disabled: true })
      expect(ariaByLabel("Hidden focus")).toBeUndefined()
      expect(ariaByLabel("Unsupported host")).toBeUndefined()
      expect(malformedLabel).toMatchObject({ role: "Button" })
      expect(malformedLabel?.label).toBeUndefined()
      expect(ariaByLabel("Malformed current")?.current).toBeUndefined()
      expect(ariaByLabel("Malformed hidden")).toMatchObject({ role: "Button" })
      expect(ariaByLabel("Malformed level")?.level).toBeUndefined()
      expect(ariaByLabel("Malformed value")?.numeric_value).toBeUndefined()
      expect(ariaByLabel("Malformed checked")?.toggled).toBeUndefined()

      testRoot.render(cases(true, false))
      expect(testRoot.renderer.drainStyleDiagnostics()).toEqual([])
      const updatedNodes = Object.values(testRoot.renderer.getAccessibilityTree().nodes)
      const updatedAriaByLabel = (label: string) =>
        updatedNodes.find((node) => node.aria.label === label)?.aria
      expect(updatedAriaByLabel("Production ledger")).toMatchObject({ role: "Button" })
      expect(
        updatedNodes.find((node) => node.aria.description === "Deployment summary")?.aria
      ).toMatchObject({ role: "Button", description: "Deployment summary" })
      expect(
        updatedNodes.find((node) => node.aria.role === "ListBoxOption")?.aria
      ).toMatchObject({ role: "ListBoxOption", selected: true })
      expect(updatedAriaByLabel("Double disabled")).toMatchObject({
        role: "Button",
        disabled: true,
      })
    } finally {
      testRoot.unmount()
    }
  })

  it("omits every well-formed state that its role does not support", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot({ strictStyles: true })

    try {
      testRoot.render(
        <div
          testId="unsupported-state-set"
          role="img"
          ariaLabel="Unsupported state set"
          ariaChecked
          ariaExpanded
          ariaCurrent="page"
          ariaSelected
          ariaValue="42 percent"
          ariaValueMin={0}
          ariaValueMax={100}
          ariaValueNow={42}
          ariaLevel={2}
          ariaRowIndex={1}
          ariaColIndex={1}
          ariaRowCount={2}
          ariaColCount={2}
          ariaRowSpan={1}
          ariaColSpan={1}
          disabled
          ariaDisabled
        />
      )

      const element = testRoot.renderer.findByTestId("unsupported-state-set")!
      const diagnostics = testRoot.renderer.drainStyleDiagnostics()
      const properties = [
        "ariaChecked",
        "ariaColCount",
        "ariaColIndex",
        "ariaColSpan",
        "ariaCurrent",
        "ariaDisabled",
        "ariaExpanded",
        "ariaLevel",
        "ariaRowCount",
        "ariaRowIndex",
        "ariaRowSpan",
        "ariaSelected",
        "ariaValue",
        "ariaValueMax",
        "ariaValueMin",
        "ariaValueNow",
        "disabled",
      ]
      expect(diagnostics.map((diagnostic) => diagnostic.property).sort()).toEqual(
        properties
      )
      for (const diagnostic of diagnostics) {
        expect(diagnostic).toMatchObject({
          elementId: element.id,
          elementType: "div",
          testId: "unsupported-state-set",
        })
        expect(diagnostic.message).toBe(
          `[gpuix] Accessibility issue on <div testId="unsupported-state-set"> (element ${element.id}): ` +
            `property "${diagnostic.property}" ignored value ${diagnostic.value}: ` +
            `role=Image does not support ${diagnostic.property}, so it is omitted from the accessibility tree`
        )
      }

      const node = Object.values(testRoot.renderer.getAccessibilityTree().nodes).find(
        (candidate) => candidate.aria.label === "Unsupported state set"
      )
      expect(node?.aria).toEqual({ role: "Image", label: "Unsupported state set" })
    } finally {
      testRoot.unmount()
    }
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
      renderer.flushMutations()

      renderer.setStyle(10_001, { width: "banana" })
      renderer.flushMutations()

      renderer.setStyle(10_001, { width: "plantain" })
      renderer.flushMutations()

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

  it("drains an ignored accessibility diagnostic with assertion metadata", () => {
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
          `[gpuix] Accessibility issue on <div testId="roleless-ledger"> (element ${element.id}): ` +
          'property "ariaLabel" ignored value "Production ledger": ' +
          "a name requires an explicit supported role, so it is omitted from the accessibility tree",
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
