/// `@gpuix/react`'s root entry installs no global. This file must never
/// import `@gpuix/react/globals`; vitest's default forks pool isolates each
/// test file's `globalThis`, so importing the root entry here proves nothing
/// about the globals entry leaked into it.

import React, { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { createRoot, flushSync } from "../index.js"
import type { PublicInstance } from "../types/host.js"

describe("@gpuix/react (root entry)", () => {
  it("installs no globals", () => {
    expect(typeof window).toBe("undefined")
    expect(Reflect.has(globalThis, "requestAnimationFrame")).toBe(false)
    expect(Reflect.has(globalThis, "cancelAnimationFrame")).toBe(false)
    expect(Reflect.has(globalThis, "scrollTo")).toBe(false)
    expect(Reflect.has(globalThis, "Image")).toBe(false)
    expect(Reflect.has(globalThis, "document")).toBe(false)
    for (const name of ["Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLButtonElement"]) {
      expect(Reflect.has(globalThis, name), name).toBe(false)
    }
    // Node has had a global `navigator` since v21, so assert on `clipboard`
    // rather than on `navigator` itself.
    expect(globalThis.navigator?.clipboard).toBeUndefined()
  })
  it("still gives refs the document facade without installing it", () => {
    const root = createRoot({ applyBatch: vi.fn(() => []), setStrictStyles: vi.fn() })
    const ref = createRef<PublicInstance>()
    flushSync(() => root.render(<div ref={ref} id="app" />))

    const doc = ref.current!.ownerDocument
    expect(doc.body).toBe(ref.current)
    expect(doc.getElementById("app")).toBe(ref.current)
    expect(doc.defaultView).toBeNull()
    expect(Reflect.has(globalThis, "document")).toBe(false)
    root.unmount()
  })
})
