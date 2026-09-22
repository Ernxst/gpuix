import { Fragment, createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

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
      expect(renderer.getRoot()).toBeUndefined()
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

  it("keeps a singleton as the direct native root", () => {
    const screen = createTestRoot()
    const root = createRef<PublicInstance>()
    const keys: string[] = []

    try {
      screen.render(
        <div
          ref={root}
          style={{ width: 80, height: 20 }}
          onKeyDown={(event) => keys.push(event.key!)}
        >
          <text>only child</text>
        </div>
      )

      const nativeRoot = screen.renderer.getRoot()!
      expect(nativeRoot.id).toBe(root.current!.id)
      expect(nativeRoot.style).toMatchObject({ width: 80, height: 20 })
      expect(nativeRoot.children.map((child) => child.type)).toEqual(["text"])
      expect(screen.renderer.toJSON()).toMatchObject({ type: "div" })

      // With no focused element, the native renderer falls back to the direct
      // root just as it did before the container could promote.
      screen.renderer.simulateKeystrokes("k")
      expect(keys).toEqual(["k"])
    } finally {
      screen.unmount()
    }
  })

  it("creates one unstyled, inaccessible wrapper that survives removal to one child", () => {
    const screen = createTestRoot({ width: 200, height: 100 })
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    const onClick = vi.fn()
    const tree = (showSecond: boolean) => (
      <Fragment>
        <div
          ref={first}
          data-testid="first"
          role="button"
          ariaLabel="First"
          style={{ width: 40, height: 20 }}
          onClick={onClick}
        >
          <text>first</text>
        </div>
        {showSecond && (
          <div
            ref={second}
            data-testid="second"
            role="button"
            ariaLabel="Second"
            style={{ width: 60, height: 30 }}
            onClick={onClick}
          >
            <text>second</text>
          </div>
        )}
      </Fragment>
    )

    try {
      screen.render(tree(true))
      const wrapper = screen.renderer.getRoot()!
      const wrapperId = wrapper.id
      expect(wrapper.type).toBe("div")
      expect(wrapper.id).not.toBe(first.current!.id)
      expect(wrapper.style).toEqual({})
      expect(wrapper.children.map((child) => child.dataTestId)).toEqual(["first", "second"])
      expect(screen.getByTestId("second").getBoundingClientRect().top).toBe(20)
      expect(screen.getAllByRole("button").map((element) => element.id)).toEqual([
        first.current!.id,
        second.current!.id,
      ])

      screen.renderer.drawPendingFrame()
      expect(
        Object.values(screen.renderer.getAccessibilityTree().nodes).some(
          (node) => node.host_id === wrapperId
        )
      ).toBe(false)
      handleGpuixEvent({ elementId: wrapperId, eventType: "click" }, screen.renderer)
      expect(onClick).not.toHaveBeenCalled()

      const retainedAfterPromotion = screen.renderer.getRetainedElementCount()
      screen.render(tree(true))
      screen.render(tree(true))
      expect(screen.renderer.getRoot()!.id).toBe(wrapperId)
      expect(screen.renderer.getRetainedElementCount()).toBe(retainedAfterPromotion)

      screen.render(tree(false))
      const retainedWrapper = screen.renderer.getRoot()!
      expect(retainedWrapper.id).toBe(wrapperId)
      expect(retainedWrapper.children.map((child) => child.dataTestId)).toEqual(["first"])
      expect(first.current!.parentElement!.id).toBe(wrapperId)
      expect(first.current!.getBoundingClientRect()).toMatchObject({ top: 0, height: 20 })
    } finally {
      screen.unmount()
    }
  })
})
