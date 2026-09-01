import { describe, expect, it, vi } from "vitest"
import type { NativeRenderer } from "../types/host.js"
import { wrapWithBatching } from "../reconciler/batch-renderer.js"

describe("batch renderer error propagation", () => {
  it("sends JSON-looking custom-prop strings as raw batch values", () => {
    const inner = {
      applyBatch: vi.fn(() => []),
    } satisfies NativeRenderer
    const renderer = wrapWithBatching(inner)

    for (const [index, value] of ["true", "null", '{"a":1}', '"quoted"'].entries()) {
      renderer.setCustomProp(index + 1, "code", value)
    }
    renderer.flushMutations()

    expect(JSON.parse(inner.applyBatch.mock.calls[0][0])).toEqual([
      ["setCustomProp", 1, "code", "true"],
      ["setCustomProp", 2, "code", "null"],
      ["setCustomProp", 3, "code", '{"a":1}'],
      ["setCustomProp", 4, "code", '"quoted"'],
    ])
  })

  it.each(["unusable batch envelope", "window not found"])(
    "keeps a native %s failure loud",
    (message) => {
      const inner = {
        applyBatch: vi.fn(() => {
          throw new Error(message)
        }),
      } satisfies NativeRenderer
      const renderer = wrapWithBatching(inner)

      renderer.createElement(1, "div")
      renderer.setStyle(1, { backgroundColor: "red" })

      expect(() => renderer.flushMutations()).toThrow(message)
      expect(() => renderer.flushMutations()).toThrow(message)
      expect(inner.applyBatch).toHaveBeenCalledTimes(2)
      expect(inner.applyBatch.mock.calls[1]).toEqual(inner.applyBatch.mock.calls[0])
    }
  )

  it("checks style diagnostics after empty and non-empty flushes", () => {
    const takeStyleDiagnosticsForReporting = vi.fn(() => [])
    const inner = {
      applyBatch: vi.fn(() => []),
      takeStyleDiagnosticsForReporting,
    } satisfies NativeRenderer
    const renderer = wrapWithBatching(inner)

    renderer.flushMutations()
    renderer.createElement(1, "div")
    renderer.flushMutations()

    expect(takeStyleDiagnosticsForReporting).toHaveBeenCalledTimes(2)
  })
})
