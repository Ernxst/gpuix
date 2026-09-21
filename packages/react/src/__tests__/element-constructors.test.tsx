/// The element constructors `@gpuix/react/globals` installs. Like `globals.test.tsx`,
/// this file relies on vitest's forks pool isolating its `globalThis`.

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import "../globals.js"
import { hasBrowserDocument } from "../document.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

const CONSTRUCTOR_NAMES = [
  "Node",
  "Element",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
] as const

function createMockRenderer(): NativeRenderer {
  return {
    applyBatch: vi.fn(() => []),
    setStrictStyles: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("@gpuix/react/globals element constructors", () => {
  it("installs each constructor without manufacturing a browser document", () => {
    for (const name of CONSTRUCTOR_NAMES) {
      expect(typeof Reflect.get(globalThis, name), name).toBe("function")
    }
    expect(hasBrowserDocument()).toBe(false)
  })

  it("throws on direct construction, as a browser does", () => {
    expect(() => new HTMLElement()).toThrow(TypeError)
    expect(() => new HTMLButtonElement()).toThrow(TypeError)
  })

  it("matches refs by their authored host type", () => {
    const [div, button, input, textarea, section, text, svg] = Array.from({ length: 7 }, () =>
      React.createRef<PublicInstance>()
    )
    const root = createRoot(createMockRenderer(), { strictStyles: false })
    flushSync(() =>
      root.render(
        <div ref={div}>
          <button ref={button} />
          <input ref={input} />
          <textarea ref={textarea} />
          <section ref={section} />
          <text ref={text}>label</text>
          <svg ref={svg} />
        </div>
      )
    )

    try {
      for (const ref of [div, button, input, textarea, section, text]) {
        expect(ref.current).toBeInstanceOf(Node)
        expect(ref.current).toBeInstanceOf(Element)
        expect(ref.current).toBeInstanceOf(HTMLElement)
      }

      expect(div.current).toBeInstanceOf(HTMLDivElement)
      expect(button.current).toBeInstanceOf(HTMLButtonElement)
      expect(input.current).toBeInstanceOf(HTMLInputElement)
      expect(textarea.current).toBeInstanceOf(HTMLTextAreaElement)

      // `<button>` and `<section>` paint through a native GPUI div, but their
      // DOM identity is the authored type.
      expect(button.current).not.toBeInstanceOf(HTMLDivElement)
      expect(section.current).not.toBeInstanceOf(HTMLDivElement)
      expect(div.current).not.toBeInstanceOf(HTMLButtonElement)
      expect(input.current).not.toBeInstanceOf(HTMLTextAreaElement)
      expect(textarea.current).not.toBeInstanceOf(HTMLInputElement)

      // `<svg>` is an `SVGElement` in the DOM: an `Element`, never an `HTMLElement`.
      expect(svg.current).toBeInstanceOf(Element)
      expect(svg.current).not.toBeInstanceOf(HTMLElement)
    } finally {
      root.unmount()
    }
  })

  it("does not match values the reconciler did not create", () => {
    const forged = { id: 1, type: "div", tagName: "DIV" }
    for (const value of [forged, {}, null, undefined, "div", 1]) {
      expect(value).not.toBeInstanceOf(Node)
      expect(value).not.toBeInstanceOf(HTMLElement)
      expect(value).not.toBeInstanceOf(HTMLDivElement)
    }
  })

  it("recognises refs created by a later module evaluation", async () => {
    const installed = HTMLButtonElement
    vi.resetModules()
    const fresh = await import("../reconciler/reconciler.js")
    await import("../globals.js")
    expect(HTMLButtonElement).toBe(installed)

    const button = React.createRef<PublicInstance>()
    const root = fresh.createRoot(createMockRenderer(), { strictStyles: false })
    fresh.flushSync(() => root.render(<button ref={button} />))
    try {
      expect(button.current).toBeInstanceOf(installed)
    } finally {
      root.unmount()
    }
  })

  it("leaves pre-existing constructors in place on a later import", async () => {
    const existing = Object.fromEntries(CONSTRUCTOR_NAMES.map((name) => [name, class {}]))
    for (const name of CONSTRUCTOR_NAMES) vi.stubGlobal(name, existing[name])

    vi.resetModules()
    await import("../globals.js")

    for (const name of CONSTRUCTOR_NAMES) {
      expect(Reflect.get(globalThis, name), name).toBe(existing[name])
    }
    expect(hasBrowserDocument()).toBe(false)
  })
})
