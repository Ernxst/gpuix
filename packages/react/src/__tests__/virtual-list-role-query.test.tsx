import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("<virtual-list> role queries", () => {
  it("finds rows inside a virtual list", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ width: 640, height: 320 }}>
          <div role="table" ariaLabel="Demo" ariaRowCount={1}>
            <virtual-list
              role="rowgroup"
              ariaLabel="Rows"
              itemCount={1}
              windowStart={0}
              estimatedItemHeight={24}
              onVisibleRange={() => {}}
              style={{ width: 640, height: 320, display: "flex", flexDirection: "column", overflowY: "scroll" }}
            >
              <div role="row" ariaLabel="Example" ariaRowIndex={1} style={{ height: 24 }}>
                <div role="cell" ariaLabel="Value">42</div>
              </div>
            </virtual-list>
          </div>
        </div>,
      )

      expect(screen.getByRole("row", { name: "Example" })).toBeVisible()
      expect(screen.queryByRole("row", { name: "Example" })).not.toBeNull()
      expect(screen.getAllByRole("row")).toHaveLength(1)
      expect(screen.queryAllByRole("row")).toHaveLength(1)
      expect(screen.getByRole("cell", { name: "Value" })).toBeVisible()
    } finally {
      screen.unmount()
    }
  })

  it("finds a row built after the window scrolls", () => {
    const screen = createTestRoot()
    const windowed = (start: number) => (
      <div role="table" ariaLabel="Demo">
        <virtual-list
          role="rowgroup"
          ariaLabel="Rows"
          itemCount={100}
          windowStart={start}
          estimatedItemHeight={24}
          onVisibleRange={() => {}}
          style={{ width: 640, height: 320, display: "flex", flexDirection: "column", overflowY: "scroll" }}
        >
          {Array.from({ length: 8 }, (_, offset) => (
            <div
              key={start + offset}
              role="row"
              ariaLabel={`Row ${start + offset}`}
              style={{ height: 24 }}
            >
              <div role="cell" ariaLabel="Value">{start + offset}</div>
            </div>
          ))}
        </virtual-list>
      </div>
    )

    try {
      screen.render(windowed(0))
      expect(screen.getByRole("row", { name: "Row 0" })).toBeVisible()
      expect(screen.queryByRole("row", { name: "Row 50" })).toBeNull()

      const list = screen.renderer.findByType("virtual-list")[0]
      screen.render(windowed(50))
      screen.renderer.scrollToItem(list.id, 50)
      expect(screen.getByRole("row", { name: "Row 50" })).toBeVisible()
      expect(screen.queryByRole("row", { name: "Row 0" })).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("finds focusable content nested inside a row", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div role="table" ariaLabel="Demo">
          <virtual-list
            role="rowgroup"
            ariaLabel="Rows"
            itemCount={1}
            windowStart={0}
            estimatedItemHeight={24}
            onVisibleRange={() => {}}
            style={{ width: 640, height: 320, display: "flex", flexDirection: "column", overflowY: "scroll" }}
          >
            <div role="row" ariaLabel="Example" style={{ height: 24 }}>
              <div role="cell">
                <div role="button" tabIndex={0} ariaLabel="Edit">
                  Edit
                </div>
              </div>
            </div>
          </virtual-list>
        </div>,
      )

      expect(screen.getByRole("button", { name: "Edit" })).toBeVisible()
    } finally {
      screen.unmount()
    }
  })
})
