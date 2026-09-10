/// `@gpuix/react/globals` installs exactly four names on `globalThis`. This
/// file must never be merged with `globals-absent.test.tsx`; vitest's
/// default forks pool isolates each test file's `globalThis`, and the two
/// files assert opposite states of it.

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import "../globals.js"
import { createTestRoot, type TestRoot } from "../testing.js"

const FRAME_MS = 1000 / 60

let root: TestRoot | undefined

afterEach(() => {
  root?.unmount()
  root = undefined
  vi.unstubAllGlobals()
})

describe("@gpuix/react/globals", () => {
  it("installs requestAnimationFrame, cancelAnimationFrame, window, and scrollTo, and nothing else", () => {
    expect(typeof globalThis.requestAnimationFrame).toBe("function")
    expect(typeof globalThis.cancelAnimationFrame).toBe("function")
    expect(globalThis.window).toBe(globalThis)
    expect(globalThis.scrollTo()).toBeUndefined()
    expect(Reflect.has(globalThis, "document")).toBe(false)
  })

  it("leaves a pre-existing requestAnimationFrame in place on a later import", async () => {
    const existing = vi.fn()
    vi.stubGlobal("requestAnimationFrame", existing)

    vi.resetModules()
    await import("../globals.js")

    expect(globalThis.requestAnimationFrame).toBe(existing)
  })

  it("leaves an already-installed window in place on a later import", async () => {
    const existing = { origin: "https://example.test" }
    vi.stubGlobal("window", existing)

    vi.resetModules()
    await import("../globals.js")

    expect(globalThis.window).toBe(existing)
  })

  it("delivers exactly one callback per advanced frame through the installed global", () => {
    root = createTestRoot()
    root.render(<text>global raf</text>)
    const callback = vi.fn()

    globalThis.requestAnimationFrame(callback)
    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(callback).toHaveBeenCalledTimes(1)

    root.renderer.advanceAsyncClock(FRAME_MS)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("does not install browser automation, and the four-global invariant still holds, after a mount", () => {
    // "gpuix" is the literal key `installBrowserAutomation` writes
    // (`BROWSER_AUTOMATION_KEY` in reconciler/renderer.ts); it must stay
    // absent even though `window` is now defined, or a desktop mount would
    // stand up the production automation surface as an unrequested fifth
    // global.
    root = createTestRoot()
    root.render(<text>no automation</text>)
    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(Reflect.has(globalThis, "gpuix")).toBe(false)

    expect(typeof globalThis.requestAnimationFrame).toBe("function")
    expect(typeof globalThis.cancelAnimationFrame).toBe("function")
    expect(globalThis.window).toBe(globalThis)
    expect(globalThis.scrollTo()).toBeUndefined()
    expect(Reflect.has(globalThis, "document")).toBe(false)
  })
})
