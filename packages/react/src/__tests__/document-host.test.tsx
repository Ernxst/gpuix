/// A host `document` (a browser, jsdom, or happy-dom) present before
/// `@gpuix/react/globals` is imported. This file must stay separate from
/// `document.test.tsx`, which imports the globals with no host document;
/// vitest's forks pool isolates each test file's `globalThis`.

import React, { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import type { PublicInstance } from "../types/host.js"

const hostDocument = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getElementById: () => null,
}
Reflect.set(globalThis, "document", hostDocument)

const { createRoot, flushSync } = await import("../reconciler/reconciler.js")
await import("../globals.js")

describe("@gpuix/react/globals with a host document", () => {
  it("keeps the host document, and refs report it as their ownerDocument", () => {
    const root = createRoot({ applyBatch: vi.fn(() => []), setStrictStyles: vi.fn() })
    const ref = createRef<PublicInstance>()
    flushSync(() => root.render(<div ref={ref} />))

    expect(globalThis.document).toBe(hostDocument)
    expect(ref.current!.ownerDocument).toBe(hostDocument)

    // Base UI's `ownerDocument(node).addEventListener(...)` reaches the host.
    const listener = () => undefined
    ;(ref.current!.ownerDocument as Document).addEventListener("pointerup", listener)
    expect(hostDocument.addEventListener).toHaveBeenCalledWith("pointerup", listener)
    root.unmount()
  })
})
