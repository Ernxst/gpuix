import { Fragment } from "react"
import { describe, expect, it } from "vitest"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("container children", () => {
  it("keeps two top-level elements in order", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <Fragment>
          <text>first</text>
          <text>second</text>
        </Fragment>
      )

      expect(screen.renderer.getAllText()).toEqual(["first", "second"])
    } finally {
      screen.unmount()
    }
  })

  it("keeps three top-level elements in order", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <Fragment>
          <text>first</text>
          <text>second</text>
          <text>third</text>
        </Fragment>
      )

      expect(screen.renderer.getAllText()).toEqual(["first", "second", "third"])
    } finally {
      screen.unmount()
    }
  })

  it("keeps conditional top-level children both absent and present", () => {
    const screen = createTestRoot()
    const app = (showMiddle: boolean) => (
      <Fragment>
        <text>first</text>
        {showMiddle ? <text>middle</text> : null}
        <text>last</text>
      </Fragment>
    )

    try {
      screen.render(app(false))
      expect(screen.renderer.getAllText()).toEqual(["first", "last"])

      screen.render(app(true))
      expect(screen.renderer.getAllText()).toEqual(["first", "middle", "last"])
    } finally {
      screen.unmount()
    }
  })

  it("removes every top-level element when the root unmounts", () => {
    const renderer = new TestRenderer()
    const root = createRoot(renderer)

    try {
      flushSync(() =>
        root.render(
          <Fragment>
            <text>first</text>
            <text>second</text>
          </Fragment>
        )
      )
      renderer.flush()
      expect(renderer.getAllText()).toEqual(["first", "second"])

      root.unmount()
      renderer.flush()
      expect(renderer.getAllText()).toEqual([])
    } finally {
      root.unmount()
      renderer.dispose()
    }
  })

  it("reorders top-level elements", () => {
    const screen = createTestRoot()
    const app = (order: readonly string[]) => (
      <Fragment>{order.map((label) => <text key={label}>{label}</text>)}</Fragment>
    )

    try {
      screen.render(app(["first", "second", "third"]))
      expect(screen.renderer.getAllText()).toEqual(["first", "second", "third"])

      screen.render(app(["third", "first", "second"]))
      expect(screen.renderer.getAllText()).toEqual(["third", "first", "second"])
    } finally {
      screen.unmount()
    }
  })
})
