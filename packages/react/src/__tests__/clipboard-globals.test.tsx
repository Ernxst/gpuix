/// Isolated from clipboard.test.tsx and globals.test.tsx: vitest's default
/// forks pool isolates each test file's `globalThis`, and this file needs
/// `@gpuix/react/globals` actually imported to observe what it installs.

import { describe, expect, it } from "vitest"

import { clipboard } from "../clipboard.js"
import "../globals.js"

describe("@gpuix/react/globals — navigator.clipboard", () => {
  it("installs navigator.clipboard as the same object exported from clipboard.js", () => {
    expect(globalThis.navigator?.clipboard).toBe(clipboard)
    expect(globalThis.navigator?.clipboard.writeText).toBe(clipboard.writeText)
    expect(globalThis.navigator?.clipboard.readText).toBe(clipboard.readText)
  })
})
