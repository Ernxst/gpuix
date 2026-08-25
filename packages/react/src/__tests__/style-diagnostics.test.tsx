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

  it("reports an unknown batched style after later testId metadata is applied", () => {
    const renderer = new TestRenderer()
    renderer.applyBatch(
      JSON.stringify([
        ["createElement", 73, "div"],
        ["setStyle", 73, { flex: 1, backgroundColor: "red" }],
        ["setCustomPropValue", 73, "testId", "batch-card"],
        ["setRoot", 73],
      ])
    )

    expect(renderer.getElement(73)?.style).toMatchObject({ backgroundColor: "red" })
    const diagnostics = renderer.drainStyleDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('<div testId="batch-card">')
    expect(diagnostics[0].message).toContain("flex")
    expect(diagnostics[0].message).toContain("1")
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
})
