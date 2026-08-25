import { afterEach, describe, expect, it, vi } from "vitest"
import type { NativeRenderer } from "../types/host.js"
import { wrapWithBatching } from "../reconciler/batch-renderer.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("batch renderer error containment", () => {
  it("contains a native batch failure at the host boundary", () => {
    const inner = {
      createElement: vi.fn(),
      destroyElement: vi.fn(() => []),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      insertBefore: vi.fn(),
      setStyle: vi.fn(),
      setText: vi.fn(),
      setEventListener: vi.fn(),
      setRoot: vi.fn(),
      setCustomProp: vi.fn(),
      applyBatch: vi.fn(() => {
        throw new Error("unusable batch envelope")
      }),
      commitMutations: vi.fn(),
    } satisfies NativeRenderer
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const renderer = wrapWithBatching(inner)

    renderer.createElement(1, "div")
    renderer.setStyle(1, { backgroundColor: "red" })

    expect(() => renderer.commitMutations()).not.toThrow()
    expect(inner.applyBatch).toHaveBeenCalledOnce()
    expect(inner.commitMutations).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      "[gpuix] Native mutation batch was rejected atomically",
      expect.objectContaining({ message: "unusable batch envelope" })
    )
  })
})
