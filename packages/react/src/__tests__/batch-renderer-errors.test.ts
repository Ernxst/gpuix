import { describe, expect, it, vi } from "vitest"
import type { NativeRenderer } from "../types/host.js"
import { wrapWithBatching } from "../reconciler/batch-renderer.js"

describe("batch renderer error propagation", () => {
  it.each(["unusable batch envelope", "window not found"])(
    "keeps a native %s failure loud",
    (message) => {
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
          throw new Error(message)
        }),
        commitMutations: vi.fn(),
      } satisfies NativeRenderer
      const renderer = wrapWithBatching(inner)

      renderer.createElement(1, "div")
      renderer.setStyle(1, { backgroundColor: "red" })

      expect(() => renderer.commitMutations()).toThrow(message)
      expect(inner.applyBatch).toHaveBeenCalledOnce()
      expect(inner.commitMutations).not.toHaveBeenCalled()
    }
  )
})
