import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing.js"
import type { StyleDesc } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

afterEach(() => {
  vi.restoreAllMocks()
})

describeNative("style diagnostics", () => {
  it("rejects one malformed field without throwing through React", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot()

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
