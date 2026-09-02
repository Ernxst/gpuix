import React from "react"
import { describe, expect, it, vi } from "vitest"
import {
  createTestRoot,
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
    applyBatch(json: string): number[]
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
        <div id="panel-before" data-testid="panel-before" onClick={firstClick}>
          <text data-testid="label">before</text>
          <text data-testid="removed">removed</text>
        </div>
      )
      const firstPanel = root.renderer.findByTestId("panel-before")!
      const firstLabel = root.renderer.findByTestId("label")!
      expect(firstPanel.events).toContain("click")
      expect(root.renderer.findByElementId("panel-before")).toBe(firstPanel)

      root.render(
        <div id="panel-after" data-testid="panel-after">
          <text data-testid="label">react update</text>
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
      root.renderer.applyBatch(JSON.stringify([["setText", textLeaf.id, "direct update"]]))
      expect(root.renderer.findByText("direct update")?.id).toBe(textLeaf.id)

      root.renderer.applyBatch(
        JSON.stringify([
          ["setCustomPropValue", panel.id, "data-testid", "direct-panel"],
          ["setCustomPropValue", panel.id, "id", "direct-id"],
          ["setEventListener", panel.id, "click", true],
        ])
      )
      expect(root.renderer.findByTestId("direct-panel")?.id).toBe(panel.id)
      expect(root.renderer.findByElementId("direct-id")?.id).toBe(panel.id)
      expect(root.renderer.getElement(panel.id)?.events).toContain("click")

      // The batch transport has no detach-only operation: destroying a child
      // both unlinks it from its parent and drops its whole subtree.
      expect(
        root.renderer.applyBatch(JSON.stringify([["destroyElement", label.id]]))
      ).toContain(label.id)
      expect(root.renderer.getElement(panel.id)?.children.map((child) => child.id)).not.toContain(
        label.id
      )
      expect(root.renderer.getElement(label.id)).toBeUndefined()
    } finally {
      root.unmount()
    }
  })

  it("preserves object identity while static and matches a fresh uncached walk", () => {
    const root = createTestRoot()

    try {
      root.render(
        <div data-testid="identity-root">
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
        expect(root.getAllByText("row-159")).toHaveLength(1)
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
      expect(root.getAllByText("row-159")).toHaveLength(1)

      const started = performance.now()
      for (let index = 0; index < 5; index += 1) {
        expect(root.getAllByText("row-159")).toHaveLength(1)
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

  it("routes one batch through the native transport and invalidates the snapshot", () => {
    const renderer = new TestRenderer()
    const state = internals(renderer)
    const invalidate = vi.spyOn(state, "invalidateElementMap")
    const applyBatch = vi.spyOn(state.native, "applyBatch")
    const rootId = 10_000
    const textId = 10_001
    const destroyedId = 10_002

    try {
      const batch = [
        ["createElement", rootId, "div"],
        ["setRoot", rootId],
        ["setStyle", rootId, { width: 20 }],
        ["setEventListener", rootId, "click", true],
        ["setCustomPropValue", rootId, "data-testid", "structural"],
        ["createElement", textId, "text"],
        ["appendChild", rootId, textId],
        ["setText", textId, "direct"],
        ["createElement", destroyedId, "div"],
        ["insertBefore", rootId, destroyedId, textId],
      ]
      const invalidationsBefore = invalidate.mock.calls.length
      expect(renderer.applyBatch(JSON.stringify(batch))).toEqual([])
      // One React commit is one FFI call, and one snapshot invalidation.
      expect(applyBatch.mock.calls.length).toBe(1)
      expect(JSON.parse(applyBatch.mock.calls[0]![0])).toEqual(batch)
      expect(invalidate.mock.calls.length).toBe(invalidationsBefore + 1)

      expect(renderer.findByTestId("structural")?.id).toBe(rootId)
      expect(renderer.getElement(rootId)?.events).toContain("click")
      expect(renderer.findByText("direct")?.id).toBe(textId)

      // Destroyed ids come back so the caller can drop their event handlers.
      expect(renderer.applyBatch(JSON.stringify([["destroyElement", destroyedId]]))).toEqual([
        destroyedId,
      ])
      expect(renderer.getElement(destroyedId)).toBeUndefined()

      // Disposal clears the native retained tree, so it must also drop the
      // snapshot — a cached map would keep serving the dead tree.
      const invalidationsBeforeDispose = invalidate.mock.calls.length
      renderer.dispose()
      expect(invalidate.mock.calls.length, "dispose").toBe(invalidationsBeforeDispose + 1)
    } finally {
      applyBatch.mockRestore()
      invalidate.mockRestore()
      renderer.dispose()
    }
  })
})
