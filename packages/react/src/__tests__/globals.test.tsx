/// `@gpuix/react/globals` installs the browser-compatibility shims on `globalThis`. This
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
  it("installs the browser compatibility shims without manufacturing a document", () => {
    expect(typeof globalThis.requestAnimationFrame).toBe("function")
    expect(typeof globalThis.cancelAnimationFrame).toBe("function")
    expect(globalThis.window).toBe(globalThis)
    expect(globalThis.scrollTo()).toBeUndefined()
    expect(typeof globalThis.ResizeObserver).toBe("function")
    expect(typeof globalThis.Image).toBe("function")
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

  it("leaves a pre-existing Image constructor in place on a later import", async () => {
    const existing = vi.fn()
    vi.stubGlobal("Image", existing)

    vi.resetModules()
    await import("../globals.js")

    expect(globalThis.Image).toBe(existing)
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

  it("does not install browser automation, and the globals remain stable after a mount", () => {
    // `createTestRoot`/`render()` never installs browser automation on its
    // own path, so this only proves the marker it would read stays honest:
    // `document` is still absent after a mount (the check at
    // reconciler/renderer.ts:736), so `globalThis.gpuix` — the literal key
    // `installBrowserAutomation` writes, `BROWSER_AUTOMATION_KEY` in
    // reconciler/renderer.ts — is not defined.
    root = createTestRoot()
    root.render(<text>no automation</text>)
    root.renderer.advanceAsyncClock(FRAME_MS)

    expect(Reflect.has(globalThis, "gpuix")).toBe(false)

    expect(typeof globalThis.requestAnimationFrame).toBe("function")
    expect(typeof globalThis.cancelAnimationFrame).toBe("function")
    expect(globalThis.window).toBe(globalThis)
    expect(globalThis.scrollTo()).toBeUndefined()
    expect(typeof globalThis.Image).toBe("function")
    expect(Reflect.has(globalThis, "document")).toBe(false)
  })
})
