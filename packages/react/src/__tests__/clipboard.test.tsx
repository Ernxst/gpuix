import React from "react"
import { afterEach, describe, expect, it } from "vitest"

import { clipboard } from "../clipboard.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describe("clipboard", () => {
  it("rejects when no GPUIX root is mounted", async () => {
    await expect(clipboard.writeText("x")).rejects.toThrow("No GPUIX root is mounted")
    await expect(clipboard.readText()).rejects.toThrow("No GPUIX root is mounted")
  })

  describeNative("under a mounted root", () => {
    let testRoot: TestRoot | undefined

    afterEach(() => {
      // `unmount()` (not `renderer.dispose()` alone) so the container's
      // `rootElementId` clears too — otherwise it lingers in
      // `latestAttachedContainer()`'s registry as a stale, still-"attached"
      // root that a later test could resolve against by mistake.
      testRoot?.unmount()
      testRoot = undefined
    })

    it("round-trips writeText through readText", async () => {
      testRoot = createTestRoot()
      testRoot.render(<text>clipboard</text>)

      await clipboard.writeText("x")

      await expect(clipboard.readText()).resolves.toBe("x")
    })

    it("resolves readText to the empty string when the clipboard holds no text", async () => {
      testRoot = createTestRoot()
      testRoot.render(<text>clipboard</text>)
      testRoot.renderer.setClipboardText(null)

      await expect(clipboard.readText()).resolves.toBe("")
    })

    it("is visible through the test renderer's own getClipboardText backdoor", async () => {
      testRoot = createTestRoot()
      testRoot.render(<text>clipboard</text>)

      await clipboard.writeText("seen by the backdoor")

      expect(testRoot.renderer.getClipboardText()).toBe("seen by the backdoor")
    })

    it("rejects again once the root that was mounted unmounts", async () => {
      testRoot = createTestRoot()
      testRoot.render(<text>clipboard</text>)
      testRoot.unmount()

      await expect(clipboard.writeText("x")).rejects.toThrow("No GPUIX root is mounted")
      await expect(clipboard.readText()).rejects.toThrow("No GPUIX root is mounted")
    })
  })
})
