/// Navigator-presence edge cases for `@gpuix/react/globals`, isolated in
/// their own file: each test replaces the global `navigator` outright with
/// a shape that would misbehave under a naive `!navigator.clipboard` read,
/// which would otherwise leak into globals.test.tsx's and
/// globals-absent.test.tsx's assumptions about `globalThis` under vitest's
/// per-file forks pool.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let originalNavigator: PropertyDescriptor | undefined

beforeEach(() => {
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  vi.resetModules()
})

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator)
  } else {
    Reflect.deleteProperty(globalThis, "navigator")
  }
  vi.unstubAllGlobals()
})

describe("@gpuix/react/globals — navigator.clipboard edge cases", () => {
  it("leaves an existing falsy own clipboard in place", async () => {
    const nav: { clipboard?: unknown } = { clipboard: undefined }
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav })

    await import("../globals.js")

    expect(Reflect.has(nav, "clipboard")).toBe(true)
    expect(nav.clipboard).toBeUndefined()
  })

  it("leaves an accessor clipboard property in place without invoking it", async () => {
    let invoked = false
    const nav = {}
    Object.defineProperty(nav, "clipboard", {
      configurable: true,
      get() {
        invoked = true
        return "real clipboard"
      },
    })
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav })

    await import("../globals.js")

    expect(invoked).toBe(false)
    expect(typeof Object.getOwnPropertyDescriptor(nav, "clipboard")?.get).toBe("function")
  })

  it("does not abort when navigator's getter throws, and the other four globals still install", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      get() {
        throw new Error("boom")
      },
    })

    await expect(import("../globals.js")).resolves.toBeDefined()

    expect(typeof globalThis.requestAnimationFrame).toBe("function")
    expect(typeof globalThis.cancelAnimationFrame).toBe("function")
    expect(globalThis.window).toBe(globalThis)
    expect(globalThis.scrollTo()).toBeUndefined()
  })
})
