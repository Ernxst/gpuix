import React from "react"
import { describe, expect, it, vi } from "vitest"
import {
  createTestRoot,
  getAllByText,
  isNativeTestRendererAvailable,
  readMacCpuThrottle,
  TestRenderer,
  textContent,
  type TestElement,
} from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip
const throttle = readMacCpuThrottle()
const LARGE_TREE_ROWS = 160

interface TestRendererInternals {
  native: {
    getTreeJson(): string
  }
  elementMap: Map<number, TestElement> | null
  invalidateElementMap(): void
}

function internals(renderer: TestRenderer): TestRendererInternals {
  return renderer as unknown as TestRendererInternals
}

function largeTree() {
  return (
    <div>
      {Array.from({ length: LARGE_TREE_ROWS }, (_, index) => (
        <div key={index}>
          <text>row-{index}</text>
        </div>
      ))}
    </div>
  )
}

describeNative("TestRenderer query cache", () => {
  it("keeps cached inspection fresh across React and direct native-tree mutations", () => {
    const root = createTestRoot()
    const firstClick = () => {}

    try {
      root.render(
        <div id="panel-before" testId="panel-before" onClick={firstClick}>
          <text testId="label">before</text>
          <text testId="removed">removed</text>
        </div>
      )
      const firstPanel = root.renderer.findByTestId("panel-before")!
      const firstLabel = root.renderer.findByTestId("label")!
      expect(firstPanel.events).toContain("click")
      expect(root.renderer.findByElementId("panel-before")).toBe(firstPanel)

      root.render(
        <div id="panel-after" testId="panel-after">
          <text testId="label">react update</text>
        </div>
      )
      const panel = root.renderer.findByTestId("panel-after")!
      const label = root.renderer.findByTestId("label")!
      expect(panel).not.toBe(firstPanel)
      expect(label).not.toBe(firstLabel)
      expect(root.renderer.findByTestId("panel-before")).toBeUndefined()
      expect(root.renderer.findByElementId("panel-before")).toBeUndefined()
      expect(root.renderer.findByElementId("panel-after")).toBe(panel)
      expect(panel.events).not.toContain("click")
      expect(textContent(root.renderer, label)).toBe("react update")
      expect(root.renderer.findByTestId("removed")).toBeUndefined()

      const textLeaf = root.renderer.findByText("react update")!
      root.renderer.setText(textLeaf.id, "direct update")
      expect(root.renderer.findByText("direct update")?.id).toBe(textLeaf.id)

      root.renderer.setCustomProp(panel.id, "testId", JSON.stringify("direct-panel"))
      root.renderer.setCustomProp(panel.id, "id", JSON.stringify("direct-id"))
      root.renderer.setEventListener(panel.id, "click", true)
      expect(root.renderer.findByTestId("direct-panel")?.id).toBe(panel.id)
      expect(root.renderer.findByElementId("direct-id")?.id).toBe(panel.id)
      expect(root.renderer.getElement(panel.id)?.events).toContain("click")

      root.renderer.removeChild(panel.id, label.id)
      expect(root.renderer.getElement(panel.id)?.children).not.toContain(label.id)
      root.renderer.destroyElement(label.id)
      expect(root.renderer.getElement(label.id)).toBeUndefined()
    } finally {
      root.unmount()
    }
  })

  it("preserves object identity while static and matches a fresh uncached walk", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div testId="identity-root">
          <text>identity</text>
        </div>
      )
      const first = root.renderer.findByTestId("identity-root")!
      expect(root.renderer.getElement(first.id)).toBe(first)

      internals(root.renderer).elementMap = null
      const fresh = root.renderer.getElement(first.id)
      expect(fresh).toEqual(first)
      expect(fresh).not.toBe(first)

      // The shared snapshot is frozen: consumer mutation fails loudly instead
      // of corrupting later queries.
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.children)).toBe(true)
      expect(() => {
        ;(first as { text: string | null }).text = "mutated"
      }).toThrow(TypeError)
    } finally {
      root.unmount()
    }
  })

  it("reads the native tree JSON once for a query over at least 300 nodes", () => {
    const root = createTestRoot()

    try {
      root.render(largeTree())
      expect(root.renderer.getRetainedElementCount()).toBeGreaterThanOrEqual(300)

      const native = internals(root.renderer).native
      const getTreeJson = native.getTreeJson.bind(native)
      let treeJsonReads = 0
      native.getTreeJson = () => {
        treeJsonReads += 1
        return getTreeJson()
      }

      try {
        expect(getAllByText(root.renderer, "row-159")).toHaveLength(1)
        expect(treeJsonReads).toBe(1)
      } finally {
        native.getTreeJson = getTreeJson
      }
    } finally {
      root.unmount()
    }
  })

  it("keeps repeated findAllByText walks under a generous wall-clock budget", () => {
    const root = createTestRoot()

    try {
      root.render(largeTree())
      expect(getAllByText(root.renderer, "row-159")).toHaveLength(1)

      const started = performance.now()
      for (let index = 0; index < 5; index += 1) {
        expect(getAllByText(root.renderer, "row-159")).toHaveLength(1)
      }
      const elapsed = performance.now() - started
      console.log(
        `[testing-query-cache] findAllByText throttle=${throttle ?? "off"} ` +
          `rows=${LARGE_TREE_ROWS} repeats=5 ms=${elapsed.toFixed(2)}`
      )

      if (!throttle) {
        expect(elapsed, `five queries took ${elapsed.toFixed(1)}ms`).toBeLessThan(1_000)
      }
    } finally {
      root.unmount()
    }
  }, 10_000)

  it("routes every native tree mutator through the invalidation helper", () => {
    const renderer = new TestRenderer()
    const state = internals(renderer)
    const invalidate = vi.spyOn(state, "invalidateElementMap")
    const exercised: string[] = []
    const rootId = 10_000
    const textId = 10_001
    const insertedId = 10_002

    const expectInvalidation = (name: string, mutate: () => unknown) => {
      const callsBefore = invalidate.mock.calls.length
      mutate()
      expect(invalidate.mock.calls.length, name).toBe(callsBefore + 1)
      exercised.push(name)
    }

    try {
      expectInvalidation("createElement", () => renderer.createElement(rootId, "div"))
      expectInvalidation("setRoot", () => renderer.setRoot(rootId))
      expectInvalidation("createElement", () => renderer.createElement(textId, "text"))
      expectInvalidation("appendChild", () => renderer.appendChild(rootId, textId))
      expectInvalidation("setText", () => renderer.setText(textId, "direct"))
      expectInvalidation("setStyle", () => renderer.setStyle(rootId, JSON.stringify({ width: 20 })))
      expectInvalidation("setEventListener", () =>
        renderer.setEventListener(rootId, "click", true)
      )
      expectInvalidation("setCustomProp", () =>
        renderer.setCustomProp(rootId, "testId", JSON.stringify("structural"))
      )
      expectInvalidation("createElement", () => renderer.createElement(insertedId, "div"))
      expectInvalidation("insertBefore", () =>
        renderer.insertBefore(rootId, insertedId, textId)
      )
      expectInvalidation("removeChild", () => renderer.removeChild(rootId, insertedId))
      expectInvalidation("destroyElement", () => renderer.destroyElement(insertedId))
      expectInvalidation("applyBatch", () =>
        renderer.applyBatch(JSON.stringify([["setText", textId, "batched"]]))
      )
      // Disposal clears the native retained tree, so it must also drop the
      // snapshot — a cached map would keep serving the dead tree.
      expectInvalidation("dispose", () => renderer.dispose())

      expect(new Set(exercised)).toEqual(
        new Set([
          "dispose",
          "createElement",
          "destroyElement",
          "appendChild",
          "removeChild",
          "insertBefore",
          "setStyle",
          "setText",
          "setEventListener",
          "setRoot",
          "setCustomProp",
          "applyBatch",
        ])
      )
    } finally {
      invalidate.mockRestore()
      renderer.dispose()
    }
  })
})
