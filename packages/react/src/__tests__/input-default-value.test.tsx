/** DOM-compatible defaultValue behaviour for native text editors. */

import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("input and textarea defaultValue", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ width: 400, height: 180 })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  for (const type of ["input", "textarea"] as const) {
    it(`seeds an uncontrolled ${type} once and reapplies the default after remount`, () => {
      const editor = (defaultValue: string) =>
        React.createElement(type, {
          defaultValue,
          "data-testid": "field",
          style: { width: 300, height: 60 },
        })

      testRoot.render(editor("first"))
      let field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("first")

      testRoot.renderer.nativeSimulateKeystrokes(field.id, "x")
      expect(testRoot.renderer.getInputValue(field.id)).toBe("firstx")

      testRoot.render(editor("second"))
      field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("firstx")

      testRoot.render(null)
      testRoot.render(editor("second"))
      field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("second")
    })

    it(`keeps value ahead of defaultValue across ${type} control transitions`, () => {
      const editor = (value: string | undefined, defaultValue: string) =>
        React.createElement(type, {
          value,
          defaultValue,
          "data-testid": "field",
          style: { width: 300, height: 60 },
        })

      testRoot.render(editor("controlled", "default"))
      let field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("controlled")

      testRoot.render(editor(undefined, "changed default"))
      field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("controlled")

      testRoot.renderer.nativeSimulateKeystrokes(field.id, "x")
      expect(testRoot.renderer.getInputValue(field.id)).toBe("controlledx")

      testRoot.render(editor("default", "default"))
      field = testRoot.renderer.findByTestId("field")!
      expect(testRoot.renderer.getInputValue(field.id)).toBe("default")
    })
  }
})
