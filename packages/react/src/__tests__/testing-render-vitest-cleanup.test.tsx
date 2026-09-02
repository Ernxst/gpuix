import React from "react"
import { describe, expect, it } from "vitest"
// The auto-cleanup entry: importing it registers the afterEach that unmounts
// whatever the test rendered, without this file wiring anything itself.
import {
  isNativeTestRendererAvailable,
  render,
  textContent,
  type TestRenderer,
} from "../testing-vitest.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("@gpuix/react/testing/vitest auto-cleanup", () => {
  let renderer: TestRenderer | null = null

  it("renders a tree", () => {
    const screen = render(<text data-testid="mounted">mounted</text>)
    renderer = screen.renderer
    expect(textContent(screen.renderer, screen.getByTestId("mounted"))).toBe("mounted")
  })

  it("starts with an empty tree in the same window", () => {
    expect(renderer).not.toBeNull()
    expect(renderer!.getAllText()).toEqual([])

    const screen = render(<text data-testid="next">next</text>)
    expect(screen.renderer).toBe(renderer)
    expect(textContent(screen.renderer, screen.getByTestId("next"))).toBe("next")
  })
})
