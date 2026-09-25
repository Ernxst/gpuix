import React, { createRef } from "react"
import { expect, it, vi } from "vitest"
import { Node } from "../element-constructors.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

function createMockRenderer(): NativeRenderer {
  return {
    applyBatch: vi.fn(() => []),
    setStrictStyles: vi.fn(),
  }
}

it("reports whether a ref's element is connected to the root", () => {
  const renderer = createMockRenderer()
  const ref = createRef<PublicInstance>()
  const root = createRoot(renderer, { strictStyles: false })

  try {
    flushSync(() => root.render(<button ref={ref} />))
    const element = ref.current!
    expect(element.isConnected).toBe(true)

    flushSync(() => root.render(<div />))
    expect(ref.current).toBeNull()
    expect(element.isConnected).toBe(false)
  } finally {
    root.unmount()
  }
})

it("exposes Node position constants used to order connected sibling refs", () => {
  const first = createRef<PublicInstance>()
  const second = createRef<PublicInstance>()
  const root = createRoot(createMockRenderer(), { strictStyles: false })

  try {
    flushSync(() =>
      root.render(
        <div>
          <button ref={first} />
          <button ref={second} />
        </div>
      )
    )
    expect(
      first.current!.compareDocumentPosition(second.current!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  } finally {
    root.unmount()
  }
})
