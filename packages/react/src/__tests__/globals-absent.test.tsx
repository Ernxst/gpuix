/// `@gpuix/react`'s root entry installs no global. This file must never
/// import `@gpuix/react/globals`; vitest's default forks pool isolates each
/// test file's `globalThis`, so importing the root entry here proves nothing
/// about the globals entry leaked into it.

import { describe, expect, it } from "vitest"

import "../index.js"

describe("@gpuix/react (root entry)", () => {
  it("installs no globals", () => {
    expect(typeof window).toBe("undefined")
    expect(Reflect.has(globalThis, "requestAnimationFrame")).toBe(false)
    expect(Reflect.has(globalThis, "cancelAnimationFrame")).toBe(false)
    expect(Reflect.has(globalThis, "scrollTo")).toBe(false)
  })
})
