/** DOM-shaped spellings on refs and events, and the semantics behind them. */

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { NativeRenderer, PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describe("getBoundingClientRect without a painted box", () => {
  it("reports an all-zero rect rather than nothing", () => {
    // `getBounds()` returns null for an element the renderer never painted.
    // The DOM has no such answer for `getBoundingClientRect()`: an element
    // with no boxes is an all-zero rect, so `.width` reads without a guard.
    const renderer: NativeRenderer = {
      applyBatch: vi.fn(() => []),
      setStrictStyles: vi.fn(),
      getElementBounds: vi.fn(() => null),
    }
    const ref = React.createRef<PublicInstance>()
    const root = createRoot(renderer, { strictStyles: false })

    try {
      flushSync(() => root.render(<div ref={ref} />))

      expect(ref.current!.getBounds()).toBeNull()
      expect(ref.current!.getBoundingClientRect()).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      })
    } finally {
      root.unmount()
    }
  })
})

describeNative("DOM parity on refs and events", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ strictStyles: false })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  describe("getBoundingClientRect", () => {
    it("returns the same box as getBounds in DOMRect shape", () => {
      const ref = React.createRef<PublicInstance>()
      testRoot.render(
        <div style={{ padding: 20 }}>
          <div ref={ref} style={{ width: 120, height: 40 }} />
        </div>
      )

      const bounds = ref.current!.getBounds()!
      const rect = ref.current!.getBoundingClientRect()

      expect(rect.x).toBe(bounds.x)
      expect(rect.y).toBe(bounds.y)
      expect(rect.width).toBe(bounds.width)
      expect(rect.height).toBe(bounds.height)
      expect(rect.left).toBe(bounds.x)
      expect(rect.top).toBe(bounds.y)
      expect(rect.right).toBe(bounds.x + bounds.width)
      expect(rect.bottom).toBe(bounds.y + bounds.height)
    })

  })

  describe("mouse event coordinates", () => {
    it("spells x and y as clientX/clientY and pageX/pageY", () => {
      let seen: GpuixSyntheticEvent | null = null
      testRoot.render(
        <div
          data-testid="coords"
          style={{ width: 120, height: 40, margin: 30 }}
          onMouseDown={(event) => {
            seen = event
          }}
        />
      )

      const node = testRoot.renderer.findByTestId("coords")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(node.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      const event = seen! as unknown as GpuixSyntheticEvent
      expect(event.clientX).toBe(event.x)
      expect(event.clientY).toBe(event.y)
      // No scrolling document exists here, so page and client coordinates are
      // the same number rather than differing by a document scroll offset.
      expect(event.pageX).toBe(event.clientX)
      expect(event.pageY).toBe(event.clientY)
      expect(event.clientX).toBeGreaterThan(0)
    })

    it("reports zero coordinates on an event that carries no pointer position", () => {
      let seen: GpuixSyntheticEvent | null = null
      testRoot.render(
        <input
          data-testid="keys"
          autoFocus
          style={{ width: 200, height: 40 }}
          onKeyDown={(event) => {
            seen = event
          }}
        />
      )

      const node = testRoot.renderer.findByTestId("keys")!
      testRoot.renderer.nativeSimulateKeystrokes(node.id, "a")

      const event = seen! as unknown as GpuixSyntheticEvent
      expect(event.clientX).toBe(0)
      expect(event.clientY).toBe(0)
    })
  })

  describe("stopImmediatePropagation", () => {
    it("suppresses the other listener on the same target and stops the bubble", () => {
      const calls: string[] = []
      testRoot.render(
        <div
          style={{ width: 200, height: 100 }}
          onMouseDown={() => calls.push("parent-bubble")}
        >
          <div
            data-testid="immediate"
            style={{ width: 120, height: 40 }}
            onMouseDownCapture={(event) => {
              calls.push("target-capture")
              event.stopImmediatePropagation()
            }}
            onMouseDown={() => calls.push("target-bubble")}
          />
        </div>
      )

      const node = testRoot.renderer.findByTestId("immediate")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(node.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      // Both target listeners are AT_TARGET, so plain stopPropagation would
      // still have run `target-bubble`.
      expect(calls).toEqual(["target-capture"])
    })

    it("still runs the target's other listener for a plain stopPropagation", () => {
      const calls: string[] = []
      testRoot.render(
        <div
          style={{ width: 200, height: 100 }}
          onMouseDown={() => calls.push("parent-bubble")}
        >
          <div
            data-testid="plain"
            style={{ width: 120, height: 40 }}
            onMouseDownCapture={(event) => {
              calls.push("target-capture")
              event.stopPropagation()
            }}
            onMouseDown={() => calls.push("target-bubble")}
          />
        </div>
      )

      const node = testRoot.renderer.findByTestId("plain")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(node.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(calls).toEqual(["target-capture", "target-bubble"])
    })
  })

  describe("relatedTarget", () => {
    it("names the other side of a hover transition", () => {
      const transitions: Array<[string, number | null]> = []
      const record =
        (name: string) =>
        (event: GpuixSyntheticEvent): void => {
          transitions.push([name, event.relatedTarget?.id ?? null])
        }

      testRoot.render(
        <div style={{ width: 400, height: 200, flexDirection: "row" }}>
          <div
            data-testid="left"
            style={{ width: 100, height: 100 }}
            onMouseEnter={record("left-enter")}
            onMouseLeave={record("left-leave")}
          />
          <div
            data-testid="right"
            style={{ width: 100, height: 100 }}
            onMouseEnter={record("right-enter")}
            onMouseLeave={record("right-leave")}
          />
        </div>
      )

      const left = testRoot.renderer.findByTestId("left")!
      const right = testRoot.renderer.findByTestId("right")!
      const leftBox = testRoot.renderer.getElementBounds(left.id)!
      const rightBox = testRoot.renderer.getElementBounds(right.id)!

      testRoot.renderer.nativeSimulateMouseMove(
        leftBox[0] + leftBox[2] / 2,
        leftBox[1] + leftBox[3] / 2
      )
      // Nothing was hovered before, so the pointer came from nowhere.
      expect(transitions).toEqual([["left-enter", null]])

      transitions.length = 0
      testRoot.renderer.nativeSimulateMouseMove(
        rightBox[0] + rightBox[2] / 2,
        rightBox[1] + rightBox[3] / 2
      )
      expect(transitions).toEqual([
        ["left-leave", right.id],
        ["right-enter", left.id],
      ])
    })

    it("is null for events that have no other side", () => {
      let seen: GpuixSyntheticEvent | null = null
      testRoot.render(
        <div
          data-testid="down"
          style={{ width: 120, height: 40 }}
          onMouseDown={(event) => {
            seen = event
          }}
        />
      )

      const node = testRoot.renderer.findByTestId("down")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(node.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect((seen! as unknown as GpuixSyntheticEvent).relatedTarget).toBeNull()
    })

    it("stays null on focus and blur, as documented", () => {
      // Pins the documented gap rather than the ideal. GPUI's focus
      // subscriptions report only the element whose own focus changed; the
      // other side lives in `WindowFocusEvent.previous_focus_path`, which is
      // `pub(crate)`. Closing it needs a change in the GPUI fork first, and
      // this test is what will fail when that lands.
      const seen: Array<[string, unknown]> = []
      testRoot.render(
        <div style={{ width: 400, height: 200 }}>
          <input
            data-testid="first"
            style={{ width: 200, height: 40 }}
            onFocus={(event) => seen.push(["first-focus", event.relatedTarget])}
            onBlur={(event) => seen.push(["first-blur", event.relatedTarget])}
          />
          <input
            data-testid="second"
            style={{ width: 200, height: 40 }}
            onFocus={(event) => seen.push(["second-focus", event.relatedTarget])}
          />
        </div>
      )

      const first = testRoot.renderer.findByTestId("first")!
      const second = testRoot.renderer.findByTestId("second")!
      testRoot.renderer.focusElement(first.id)
      testRoot.renderer.focusElement(second.id)

      // Blur before focus, so the transition really does have two sides.
      expect(seen.map(([name]) => name)).toEqual([
        "first-focus",
        "first-blur",
        "second-focus",
      ])
      expect(seen.every(([, related]) => related === null)).toBe(true)
    })
  })

  describe("anchor role", () => {
    const anchorRoles = (): string[] => {
      testRoot.renderer.flush()
      testRoot.renderer.drawPendingFrame()
      return Object.values(testRoot.renderer.getAccessibilityTree().nodes)
        .map((node) => node.aria.role)
        .filter((role): role is string => role !== undefined)
    }

    it("exposes an anchor with an href as a link", () => {
      testRoot.render(
        <a href="/factory" ariaLabel="Factory" style={{ width: 120, height: 40 }} />
      )

      expect(anchorRoles()).toContain("Link")
    })

    it("leaves an anchor without an href generic", () => {
      // HTML-AAM computes `generic` for a bare `<a>`. Announcing it as a link
      // promises a destination that does not exist.
      testRoot.render(<a ariaLabel="Factory" style={{ width: 120, height: 40 }} />)

      expect(anchorRoles()).not.toContain("Link")
    })

    it("keeps an explicit role on an anchor without an href", () => {
      testRoot.render(
        <a role="link" ariaLabel="Factory" style={{ width: 120, height: 40 }} />
      )

      expect(anchorRoles()).toContain("Link")
    })

    it("gives link keyboard activation only to an anchor with an href", () => {
      // The activation kind has to agree with the role: a bare `<a>` that
      // computes `generic` must not also decline Space the way a link does.
      testRoot.render(
        <div>
          <a href="/factory" data-testid="with-href" style={{ width: 120, height: 40 }} />
          <a data-testid="without-href" style={{ width: 120, height: 40 }} />
        </div>
      )

      const withHref = testRoot.renderer.findByTestId("with-href")!
      const withoutHref = testRoot.renderer.findByTestId("without-href")!

      expect(withHref.customProps?.activationKind).toBe("anchor")
      expect(withoutHref.customProps?.activationKind).toBeUndefined()
    })
  })

  it("gives an input key events after Tab, with no autoFocus and no click", () => {
    // `<input>` gets an implicit tab index of 0, so it is in the tab order on
    // its own. The prop docs used to claim autoFocus or a click was required.
    const keys: string[] = []
    testRoot.render(
      <div style={{ width: 400, height: 200 }}>
        <input
          data-testid="tabbed"
          style={{ width: 200, height: 40 }}
          onKeyDown={(event) => keys.push(event.key ?? "")}
        />
      </div>
    )

    testRoot.renderer.focusNext()
    const node = testRoot.renderer.findByTestId("tabbed")!
    expect(testRoot.renderer.getActiveElement()).toBe(node.id)

    testRoot.renderer.nativeSimulateKeystrokes(node.id, "a")
    expect(keys).toEqual(["a"])
  })
})
