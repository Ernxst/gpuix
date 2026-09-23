import React from "react"
import type { CSSProperties } from "react"
import { describe, expect, it } from "vitest"
import type { NativeStateStyleKey, StyleDesc } from "../index.js"
import { createTestRoot } from "../testing.js"

type SharedStyle = {
  [Property in keyof CSSProperties & keyof StyleDesc]?: Exclude<
    CSSProperties[Property],
    undefined
  > &
    Exclude<StyleDesc[Property], undefined>
}

type WidenedShared = SharedStyle & Pick<StyleDesc, NativeStateStyleKey>

describe("resolved test-renderer styles", () => {
  it("reads the hoverWithin style applied by the issue #52 repro", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 120, backgroundColor: "#222222" }}>
          <div
            style={{
              hoverGroup: "row",
              display: "flex",
              flexDirection: "row",
              width: 400,
              height: 40,
            }}
          >
            <span style={{ width: 200, height: 40, backgroundColor: "#333333" }} />
            <span
              style={{
                width: 200,
                height: 40,
                background: "rgba(0, 0, 0, 0)",
                hoverWithin: { background: "#7d8b8c" },
              }}
            />
          </div>
        </div>
      )
      const r = root.renderer
      r.flush()
      const before = JSON.stringify(r.getElement(2)?.style)
      r.nativeSimulateMouseMove(100, 20) // into the LEFT sibling
      r.dispatchNativeEvents()
      r.flush()
      const after = JSON.stringify(r.getElement(2)?.style)
      // before === after → true   (captureScreenshot at this point shows #7d8b8c painted)
      expect(before).toBe(after)
      expect(r.getResolvedStyle(2)).toMatchObject({ background: "#7d8b8c" })
    } finally {
      root.unmount()
    }
  })

  it("resolves the activeWithin style while the nearest hoverGroup ancestor is pressed", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          style={{
            hoverGroup: "row",
            display: "flex",
            flexDirection: "row",
            width: 400,
            height: 40,
          }}
        >
          <span
            data-testid="active-within-target"
            style={{
              width: 200,
              height: 40,
              backgroundColor: "#333333",
              activeWithin: { backgroundColor: "#7d8b8c" },
            }}
          />
        </div>
      )
      const r = root.renderer
      const target = r.findByTestId("active-within-target")!
      const { x, y, width, height } = r.getElementBounds(target.id)!
      const centerX = x + width / 2
      const centerY = y + height / 2

      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#333333" })

      r.nativeSimulateMouseDown(centerX, centerY)
      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#7d8b8c" })

      r.nativeSimulateMouseUp(centerX, centerY)
      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#333333" })
    } finally {
      root.unmount()
    }
  })

  it("resolves hover and active styles at read time", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          style={{
            width: 400,
            height: 120,
            padding: 40,
            backgroundColor: "#111111",
          }}
        >
          <div
            data-testid="state-target"
            style={{
              width: 160,
              height: 40,
              backgroundColor: "#333333",
              hover: { backgroundColor: "#667788" },
              active: { backgroundColor: "#aabbcc" },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("state-target")!
      const { x, y, width, height } = root.renderer.getElementBounds(target.id)!
      const centerX = x + width / 2
      const centerY = y + height / 2

      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })

      root.renderer.nativeSimulateMouseMove(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#667788",
      })

      root.renderer.nativeSimulateMouseDown(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#aabbcc",
      })

      root.renderer.nativeSimulateMouseMove(300, 100, 0)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#aabbcc",
      })

      root.renderer.nativeSimulateMouseUp(300, 100)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves the dragOver style while OS files are dragged over the element", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="drag-over-target"
          style={{
            width: 200,
            height: 200,
            backgroundColor: "#333333",
            dragOver: { backgroundColor: "#7d8b8c" },
          }}
        />
      )
      const r = root.renderer
      const target = r.findByTestId("drag-over-target")!

      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#333333" })

      r.nativeSimulateFileDragMove(40, 40, ["/tmp/gpuix-drag.txt"])
      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#7d8b8c" })

      r.nativeSimulateFileDragExit()
      expect(r.getResolvedStyle(target.id)).toMatchObject({ backgroundColor: "#333333" })
    } finally {
      root.unmount()
    }
  })

  it.each(["space", "enter"] as const)(
    "applies the active style while a focused button is activated with %s",
    (key) => {
      const root = createTestRoot()
      try {
        let clicks = 0
        root.render(
          <button
            data-testid="tile"
            autoFocus
            onClick={() => {
              clicks += 1
            }}
            style={{
              width: 60,
              height: 40,
              backgroundColor: "#111111",
              active: { backgroundColor: "#222222" },
            }}
          >
            Save
          </button>
        )

        const tile = root.renderer.findByTestId("tile")!
        expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#111111")

        root.renderer.nativeSimulateKeyDown(tile.id, key)
        expect({
          whilePressed: root.renderer.getResolvedStyle(tile.id)?.backgroundColor,
          clicks,
        }).toEqual({ whilePressed: "#222222", clicks: 0 })

        root.renderer.nativeSimulateKeyUp(tile.id, key)
        expect({
          afterRelease: root.renderer.getResolvedStyle(tile.id)?.backgroundColor,
          clicks,
        }).toEqual({ afterRelease: "#111111", clicks: 1 })
      } finally {
        root.unmount()
      }
    }
  )

  it("clears the active style when another key cancels keyboard activation", () => {
    const root = createTestRoot()
    try {
      let clicks = 0
      root.render(
        <button
          data-testid="tile"
          autoFocus
          onClick={() => {
            clicks += 1
          }}
          style={{
            width: 60,
            height: 40,
            backgroundColor: "#111111",
            active: { backgroundColor: "#222222" },
          }}
        >
          Save
        </button>
      )

      const tile = root.renderer.findByTestId("tile")!
      root.renderer.nativeSimulateKeyDown(tile.id, "space")
      expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#222222")

      root.renderer.nativeSimulateKeyDown(tile.id, "escape")
      expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#111111")

      root.renderer.nativeSimulateKeyUp(tile.id, "escape")
      root.renderer.nativeSimulateKeyUp(tile.id, "space")
      expect(clicks).toBe(0)
    } finally {
      root.unmount()
    }
  })

  it.each(["space", "enter"] as const)(
    "clears the active style when focus moves during %s activation",
    (key) => {
      const root = createTestRoot()
      try {
        let clicks = 0
        root.render(
          <div>
            <button
              data-testid="first"
              autoFocus
              onClick={() => {
                clicks += 1
              }}
              style={{
                width: 60,
                height: 40,
                backgroundColor: "#111111",
                active: { backgroundColor: "#222222" },
              }}
            >
              First
            </button>
            <div data-testid="second" tabIndex={0} />
          </div>
        )

        const first = root.renderer.findByTestId("first")!
        const second = root.renderer.findByTestId("second")!
        root.renderer.nativeSimulateKeyDown(first.id, key)
        expect(root.renderer.getResolvedStyle(first.id)?.backgroundColor).toBe("#222222")

        root.renderer.focusElement(second.id)
        expect(root.renderer.getResolvedStyle(first.id)?.backgroundColor).toBe("#111111")
        expect(clicks).toBe(0)

        root.renderer.simulateKeyUp(key)
        expect(clicks).toBe(0)
      } finally {
        root.unmount()
      }
    }
  )

  it.each([
    ["keyboard then pointer; keyboard then pointer", ["keyboard", "pointer"], ["keyboard", "pointer"]],
    ["keyboard then pointer; pointer then keyboard", ["keyboard", "pointer"], ["pointer", "keyboard"]],
    ["pointer then keyboard; keyboard then pointer", ["pointer", "keyboard"], ["keyboard", "pointer"]],
    ["pointer then keyboard; pointer then keyboard", ["pointer", "keyboard"], ["pointer", "keyboard"]],
  ] as const)("keeps the active style while sources are held: %s", (_name, [first, second], [firstRelease, secondRelease]) => {
    const root = createTestRoot()
    try {
      root.render(
        <button
          data-testid="tile"
          autoFocus
          onClick={() => {}}
          style={{
            width: 60,
            height: 40,
            backgroundColor: "#111111",
            active: { backgroundColor: "#222222" },
          }}
        >
          Save
        </button>
      )

      const tile = root.renderer.findByTestId("tile")!
      const { x, y, width, height } = root.renderer.getElementBounds(tile.id)!
      const press = (source: "keyboard" | "pointer") => {
        if (source === "keyboard") root.renderer.nativeSimulateKeyDown(tile.id, "space")
        else root.renderer.nativeSimulateMouseDown(x + width / 2, y + height / 2)
      }
      const release = (source: "keyboard" | "pointer") => {
        if (source === "keyboard") root.renderer.nativeSimulateKeyUp(tile.id, "space")
        else root.renderer.nativeSimulateMouseUp(x + width + 20, y + height / 2)
      }

      press(first)
      press(second)
      expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#222222")

      release(firstRelease)
      expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#222222")

      release(secondRelease)
      expect(root.renderer.getResolvedStyle(tile.id)?.backgroundColor).toBe("#111111")
    } finally {
      root.unmount()
    }
  })

  it.each(["checkbox", "radio"] as const)(
    "applies the active style while a focused %s is activated with Space",
    (type) => {
      const root = createTestRoot()
      try {
        root.render(
          <input
            data-testid="choice"
            autoFocus
            type={type}
            name="choice"
            onChange={() => {}}
            style={{
              width: 60,
              height: 40,
              backgroundColor: "#111111",
              active: { backgroundColor: "#222222" },
            }}
          />
        )

        const choice = root.renderer.findByTestId("choice")!
        root.renderer.nativeSimulateKeyDown(choice.id, "space")
        expect(root.renderer.getResolvedStyle(choice.id)?.backgroundColor).toBe("#222222")

        root.renderer.nativeSimulateKeyUp(choice.id, "space")
        expect(root.renderer.getResolvedStyle(choice.id)?.backgroundColor).toBe("#111111")
      } finally {
        root.unmount()
      }
    }
  )

  it("clears a base boxShadow when hover authors an empty array", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 120, padding: 40, backgroundColor: "#111111" }}>
          <div
            data-testid="shadow-target"
            style={{
              width: 160,
              height: 40,
              backgroundColor: "#333333",
              boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 12, spreadRadius: 0, color: "#00000033" },
              hover: { boxShadow: [] },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("shadow-target")!
      const { x, y, width, height } = root.renderer.getElementBounds(target.id)!
      const centerX = x + width / 2
      const centerY = y + height / 2

      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 12, spreadRadius: 0, color: "#00000033" },
      })

      root.renderer.nativeSimulateMouseMove(centerX, centerY)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({ boxShadow: [] })

      root.renderer.nativeSimulateMouseMove(300, 100, 0)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 12, spreadRadius: 0, color: "#00000033" },
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves focus styles at read time", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 120, padding: 40 }}>
          <div
            data-testid="focus-target"
            tabIndex={0}
            style={{
              width: 160,
              height: 40,
              backgroundColor: "#333333",
              focus: { backgroundColor: "#c2415d" },
            }}
          />
        </div>
      )

      const target = root.renderer.findByTestId("focus-target")!
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#333333",
      })

      root.renderer.focusElement(target.id)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#c2415d",
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves the focusWithin style of a container while a descendant has focus", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="focus-within-container"
          style={{
            width: 400,
            height: 120,
            padding: 40,
            backgroundColor: "#333333",
            focusWithin: { backgroundColor: "#c2415d" },
          }}
        >
          <div data-testid="focus-within-child" tabIndex={0} style={{ width: 160, height: 40 }} />
        </div>
      )

      const container = root.renderer.findByTestId("focus-within-container")!
      const child = root.renderer.findByTestId("focus-within-child")!
      expect(root.renderer.getResolvedStyle(container.id)).toMatchObject({
        backgroundColor: "#333333",
      })

      root.renderer.focusElement(child.id)
      expect(root.renderer.getResolvedStyle(container.id)).toMatchObject({
        backgroundColor: "#c2415d",
      })

      root.renderer.blur()
      expect(root.renderer.getResolvedStyle(container.id)).toMatchObject({
        backgroundColor: "#333333",
      })
    } finally {
      root.unmount()
    }
  })

  it("resolves the focusWithin style when the container itself is focused", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="focus-within-self"
          tabIndex={0}
          style={{
            width: 160,
            height: 40,
            backgroundColor: "#333333",
            focusWithin: { backgroundColor: "#c2415d" },
          }}
        />
      )

      const target = root.renderer.findByTestId("focus-within-self")!
      root.renderer.focusElement(target.id)
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        backgroundColor: "#c2415d",
      })
    } finally {
      root.unmount()
    }
  })

  it("gives a focusWithin container a focus handle without making it a tab stop", () => {
    const root = createTestRoot()
    const focused: string[] = []
    try {
      root.render(
        <div style={{ width: 400, height: 120 }}>
          <div
            data-testid="focus-within-not-a-tab-stop"
            onFocus={() => focused.push("container")}
            style={{
              width: 160,
              height: 40,
              focusWithin: { backgroundColor: "#c2415d" },
            }}
          >
            <div
              data-testid="focus-within-tabbable"
              tabIndex={0}
              onFocus={() => focused.push("first")}
              style={{ width: 40, height: 40 }}
            />
          </div>
          <div
            data-testid="focus-within-next-stop"
            tabIndex={0}
            onFocus={() => focused.push("next")}
            style={{ width: 40, height: 40 }}
          />
        </div>
      )

      const first = root.renderer.findByTestId("focus-within-tabbable")!

      root.renderer.focusElement(first.id)
      expect(focused).toEqual(["first"])

      root.renderer.simulateKeystrokes("tab")
      // A focus-only handle created for `focusWithin` is skipped by tab
      // order: the next stop is "next", not the container itself.
      expect(focused).toEqual(["first", "next"])
    } finally {
      root.unmount()
    }
  })

  it("resolves focusWithin as Tab moves real keyboard focus into and out of the container", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 400, height: 160, padding: 20 }}>
          <div data-testid="before-stop" tabIndex={0} style={{ width: 40, height: 40 }} />
          <div
            data-testid="focus-within-tab-container"
            style={{
              width: 200,
              height: 40,
              backgroundColor: "#333333",
              focusWithin: { backgroundColor: "#c2415d" },
            }}
          >
            <div data-testid="focus-within-tab-child" tabIndex={0} style={{ width: 40, height: 40 }} />
          </div>
        </div>
      )

      const r = root.renderer
      const container = r.findByTestId("focus-within-tab-container")!
      const before = r.findByTestId("before-stop")!

      r.focusElement(before.id)
      expect(r.getResolvedStyle(container.id)).toMatchObject({ backgroundColor: "#333333" })

      r.simulateKeystrokes("tab")
      expect(r.getResolvedStyle(container.id)).toMatchObject({ backgroundColor: "#c2415d" })

      r.simulateKeystrokes("shift-tab")
      expect(r.getResolvedStyle(container.id)).toMatchObject({ backgroundColor: "#333333" })
    } finally {
      root.unmount()
    }
  })

  it("clears focusWithin when the focused descendant unmounts", () => {
    const root = createTestRoot()
    try {
      const render = (showChild: boolean) =>
        root.render(
          <div
            data-testid="focus-within-unmount-container"
            style={{
              width: 200,
              height: 40,
              backgroundColor: "#333333",
              focusWithin: { backgroundColor: "#c2415d" },
            }}
          >
            {showChild && (
              <div data-testid="focus-within-unmount-child" tabIndex={0} style={{ width: 40, height: 40 }} />
            )}
          </div>
        )

      render(true)
      const r = root.renderer
      const container = r.findByTestId("focus-within-unmount-container")!
      const child = r.findByTestId("focus-within-unmount-child")!

      r.focusElement(child.id)
      expect(r.getResolvedStyle(container.id)).toMatchObject({ backgroundColor: "#c2415d" })

      render(false)
      r.flush()
      expect(r.getResolvedStyle(container.id)).toMatchObject({ backgroundColor: "#333333" })
    } finally {
      root.unmount()
    }
  })

  it("applies focusWithin to every ancestor when containers nest", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="focus-within-outer"
          style={{
            width: 300,
            height: 120,
            backgroundColor: "#111111",
            focusWithin: { backgroundColor: "#1f2937" },
          }}
        >
          <div
            data-testid="focus-within-inner"
            style={{
              width: 200,
              height: 80,
              backgroundColor: "#333333",
              focusWithin: { backgroundColor: "#c2415d" },
            }}
          >
            <div data-testid="focus-within-nested-child" tabIndex={0} style={{ width: 40, height: 40 }} />
          </div>
        </div>
      )

      const r = root.renderer
      const outer = r.findByTestId("focus-within-outer")!
      const inner = r.findByTestId("focus-within-inner")!
      const child = r.findByTestId("focus-within-nested-child")!

      expect(r.getResolvedStyle(outer.id)).toMatchObject({ backgroundColor: "#111111" })
      expect(r.getResolvedStyle(inner.id)).toMatchObject({ backgroundColor: "#333333" })

      r.focusElement(child.id)
      expect(r.getResolvedStyle(outer.id)).toMatchObject({ backgroundColor: "#1f2937" })
      expect(r.getResolvedStyle(inner.id)).toMatchObject({ backgroundColor: "#c2415d" })
    } finally {
      root.unmount()
    }
  })

  it("resolves a widened shared focusVisible style after keyboard focus", () => {
    const root = createTestRoot()
    const style: WidenedShared = {
      width: 160,
      height: 40,
      backgroundColor: "#333333",
      focusVisible: { outlineColor: "#67e8f9", outlineWidth: 4, outlineOffset: 5 },
    }

    try {
      root.render(
        <div style={{ width: 400, height: 120, padding: 40 }}>
          <div autoFocus tabIndex={0} style={{ width: 1, height: 1 }} />
          <div data-testid="focus-visible-target" tabIndex={0} style={style} />
        </div>
      )

      const target = root.renderer.findByTestId("focus-visible-target")!
      root.renderer.simulateKeystrokes("tab")
      expect(root.renderer.getResolvedStyle(target.id)).toMatchObject({
        outlineColor: "#67e8f9",
        outlineWidth: 4,
        outlineOffset: 5,
      })
    } finally {
      root.unmount()
    }
  })
})
