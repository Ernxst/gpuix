import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("host instance scroll properties", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ strictStyles: false })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  it("reports scroll geometry the way Element does", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={ref} style={{ width: 200, height: 100, overflow: "scroll" }}>
        <div style={{ height: 500, flexShrink: 0 }}>
          <text>Very tall content</text>
        </div>
      </div>
    )

    const scroller = ref.current!
    expect(scroller.clientHeight).toBe(100)
    expect(scroller.clientWidth).toBe(200)
    expect(scroller.scrollHeight).toBe(500)
    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)

    // gpui's own offset stays negative; scrollTop is the DOM's positive mirror.
    testRoot.renderer.scrollTo(scroller.id, 0, -120)
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -120])
    expect(scroller.scrollTop).toBe(120)
  })

  it("scrolls to the bottom through scrollTop, the shared DOM idiom", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={ref} style={{ width: 200, height: 100, overflow: "scroll" }}>
        <div style={{ height: 500, flexShrink: 0 }}>
          <text>Very tall content</text>
        </div>
      </div>
    )

    const scroller = ref.current!
    scroller.scrollTop = scroller.scrollHeight
    testRoot.renderer.flush()

    // Clamped natively to the last full viewport, exactly like the DOM.
    expect(scroller.scrollTop).toBe(400)
    expect(scroller.scrollTop + scroller.clientHeight).toBeGreaterThanOrEqual(
      scroller.scrollHeight
    )

    scroller.scrollTo({ top: 40 })
    testRoot.renderer.flush()
    expect(scroller.scrollTop).toBe(40)
    expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, -40])
  })

  it("reports a viewport for an element that cannot scroll", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={ref} style={{ width: 120, height: 60 }}>
        <text>Plain</text>
      </div>
    )

    const plain = ref.current!
    expect(plain.clientWidth).toBe(120)
    expect(plain.clientHeight).toBe(60)
    expect(plain.scrollHeight).toBe(60)
    expect(plain.scrollTop).toBe(0)
  })

  it("reveals a descendant with scrollIntoView", () => {
    const scrollerRef = React.createRef<PublicInstance>()
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={scrollerRef} style={{ width: 200, height: 100, overflow: "scroll" }}>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} style={{ height: 100, flexShrink: 0 }}>
            {index === 4 ? (
              <div ref={targetRef}>
                <text>target</text>
              </div>
            ) : (
              <text>{`row-${index}`}</text>
            )}
          </div>
        ))}
      </div>
    )

    const scroller = scrollerRef.current!
    expect(scroller.scrollTop).toBe(0)

    targetRef.current!.scrollIntoView()
    testRoot.renderer.flush()

    // The minimum scroll that brings the target's row fully into view.
    expect(scroller.scrollTop).toBe(400)
    expect(scroller.scrollTop + scroller.clientHeight).toBeLessThanOrEqual(
      scroller.scrollHeight
    )
  })

  it("reports virtual list scroll geometry in DOM coordinates", () => {
    const ref = React.createRef<PublicInstance>()

    testRoot.render(
      <virtual-list
        ref={ref}
        overdraw={0}
        estimatedItemHeight={40}
        style={{ width: 400, height: 160 }}
      >
        {Array.from({ length: 20 }, (_, index) => (
          <div key={index} style={{ height: 40, flexShrink: 0 }}>
            <text>{`row-${index}`}</text>
          </div>
        ))}
      </virtual-list>
    )

    const list = ref.current!
    expect(list.clientHeight).toBe(160)
    expect(list.scrollHeight).toBe(800)
    expect(list.scrollTop).toBe(0)

    list.scrollTop = 200
    testRoot.renderer.flush()
    expect(list.scrollTop).toBe(200)
    expect(testRoot.renderer.getScrollOffset(list.id)).toEqual([0, -200])
  })
})
