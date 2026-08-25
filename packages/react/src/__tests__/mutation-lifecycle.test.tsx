import { Suspense } from "react"
import { describe, expect, it, vi } from "vitest"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("mutation lifecycle", () => {
  it("renders structural JSX aliases as native divs", () => {
    const { render, renderer, unmount } = createTestRoot()

    try {
      render(
        <section testId="content">
          <text>content</text>
        </section>
      )

      expect(renderer.findByTestId("content")?.type).toBe("div")
      expect(renderer.findByType("section")).toEqual([])
    } finally {
      unmount()
    }
  })

  it("does not paint host nodes from an abandoned Suspense render", () => {
    const { render, renderer, unmount } = createTestRoot()
    const pending = new Promise<never>(() => {})

    function Suspend(): never {
      throw pending
    }

    try {
      render(
        <Suspense fallback={<text>fallback</text>}>
          <div>
            <text>abandoned</text>
          </div>
          <Suspend />
        </Suspense>
      )

      expect(renderer.getPaintedText()).toEqual(["fallback"])
    } finally {
      unmount()
    }
  })

  it("keeps unchanged event handlers registered across renders", () => {
    const { render, renderer, unmount } = createTestRoot()
    const onClick = vi.fn()
    const clickable = (
      <div style={{ width: 100, height: 100 }} onClick={onClick}>
        click
      </div>
    )

    try {
      render(clickable)
      renderer.nativeSimulateClick(10, 10)
      render(clickable)
      renderer.nativeSimulateClick(10, 10)

      expect(onClick).toHaveBeenCalledTimes(2)
    } finally {
      unmount()
    }
  })

  it("keeps element ids and click handlers isolated across live roots", () => {
    const a = createTestRoot()
    const b = createTestRoot()
    const onA = vi.fn()
    const onB = vi.fn()

    try {
      a.render(
        <div style={{ width: 100, height: 100 }} onClick={onA}>
          a
        </div>
      )
      b.render(
        <div style={{ width: 100, height: 100 }} onClick={onB}>
          b
        </div>
      )

      expect(a.renderer.findByType("text")[0]?.id).toBe(1)
      expect(b.renderer.findByType("text")[0]?.id).toBe(1)
      expect(a.renderer.getRoot()?.id).toBe(2)
      expect(b.renderer.getRoot()?.id).toBe(2)

      const click = { elementId: 2, eventType: "click" }
      handleGpuixEvent(click, a.renderer)
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).not.toHaveBeenCalled()

      handleGpuixEvent(click, b.renderer)
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).toHaveBeenCalledTimes(1)
    } finally {
      a.unmount()
      b.unmount()
    }
  })

  it("does not give a remounted root the old element ids", () => {
    const renderer = new TestRenderer()
    const first = createRoot(renderer)
    const onFirst = vi.fn()
    const onSecond = vi.fn()
    const tree = (onClick: () => void) => (
      <div style={{ width: 100, height: 100 }} onClick={onClick}>
        row
      </div>
    )

    flushSync(() => first.render(tree(onFirst)))
    renderer.flush()
    const firstRootId = renderer.getRoot()?.id
    expect(firstRootId).toBe(2)
    first.unmount()

    const second = createRoot(renderer)
    try {
      flushSync(() => second.render(tree(onSecond)))
      renderer.flush()
      expect(renderer.getRoot()?.id).not.toBe(firstRootId)

      handleGpuixEvent({ elementId: firstRootId!, eventType: "click" }, renderer)
      expect(onSecond).not.toHaveBeenCalled()
    } finally {
      second.unmount()
    }
  })
})
