import { describe, expect, it } from "vitest"
import { hostConfig } from "../reconciler/host-config.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("host-config import first", () => {
  it("can import host config as first module in the import cycle", () => {
    expect(typeof hostConfig.createInstance).toBe("function")
  })

  it("renders after host-config first import", () => {
    const { render, renderer, unmount } = createTestRoot()

    try {
      render(<text>first import</text>)
      expect(renderer.getAllText()).toContain("first import")
    } finally {
      unmount()
    }
  })
})
