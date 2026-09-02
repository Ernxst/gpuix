import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

  /** Eight 40px rows in a 100px viewport, targeting row 4 (160..200). Nearest
   *  reveal stops at scrollTop 100, `block: "start"` lands on 160, and the
   *  320px extent leaves both unclamped. */
  const renderRowScroller = (): { scroller: PublicInstance; target: PublicInstance } => {
    const scrollerRef = React.createRef<PublicInstance>()
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={scrollerRef} style={{ width: 200, height: 100, overflow: "scroll" }}>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} style={{ height: 40, flexShrink: 0 }}>
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

    return { scroller: scrollerRef.current!, target: targetRef.current! }
  }

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

  it("reports scroll extent inside the mount layout effect, before any frame", () => {
    // The chat-autoscroll idiom runs in a layout effect on first mount, before
    // the renderer has drawn a frame for this commit. A metrics read that does
    // not force layout reports scrollHeight === clientHeight there, and
    // `scrollTop = scrollHeight` under-scrolls.
    const seen: { scrollHeight: number; clientHeight: number }[] = []
    let scroller: PublicInstance | null = null

    function Chat(): React.ReactElement {
      const ref = React.useRef<PublicInstance>(null)
      React.useLayoutEffect(() => {
        const element = ref.current!
        seen.push({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })
        element.scrollTop = element.scrollHeight
        scroller = element
      }, [])
      return (
        <div ref={ref} style={{ width: 200, height: 100, overflow: "scroll" }}>
          <div style={{ height: 500, flexShrink: 0 }}>
            <text>Very tall content</text>
          </div>
        </div>
      )
    }

    testRoot.render(<Chat />)

    expect(seen).toEqual([{ scrollHeight: 500, clientHeight: 100 }])
    testRoot.renderer.flush()
    expect(scroller!.scrollTop).toBe(400)
  })

  it("reveals a descendant with scrollIntoView, top-aligned like the DOM", () => {
    const { scroller, target } = renderRowScroller()

    expect(scroller.scrollTop).toBe(0)

    target.scrollIntoView()
    testRoot.renderer.flush()

    // DOM default is block: "start" — the row's top edge meets the viewport
    // top. A nearest-edge reveal would stop at 100.
    expect(scroller.scrollTop).toBe(160)
  })

  it("honors block: \"nearest\" in scrollIntoView", () => {
    const { scroller, target } = renderRowScroller()

    target.scrollIntoView({ block: "nearest" })
    testRoot.renderer.flush()

    // Smallest scroll that makes row 4 (160..200) fully visible in a 100px
    // viewport: its bottom edge meets the viewport bottom.
    expect(scroller.scrollTop).toBe(100)
  })

  it("treats scrollIntoView(true) as the DOM's align-to-top", () => {
    const { scroller, target } = renderRowScroller()

    target.scrollIntoView(true)
    testRoot.renderer.flush()

    expect(scroller.scrollTop).toBe(160)
  })

  it("warns and reveals by the nearest edge for alignments gpui cannot express", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { scroller, target } = renderRowScroller()

    expect(() => target.scrollIntoView({ block: "center" })).not.toThrow()
    testRoot.renderer.flush()

    // Same fallback the rest of the host config takes outside strict styles:
    // warn once, then do the closest supported thing rather than crash a
    // component shared with the web.
    expect(scroller.scrollTop).toBe(100)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scrollIntoView.*block: "center"/))

    target.scrollIntoView(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("rejects unsupported scrollIntoView alignments under strictStyles", () => {
    const strict = createTestRoot({ strictStyles: true })
    const targetRef = React.createRef<PublicInstance>()

    strict.render(
      <div style={{ width: 200, height: 100, overflow: "scroll" }}>
        <div style={{ height: 400, flexShrink: 0 }}>
          <div ref={targetRef} style={{ height: 40, flexShrink: 0 }}>
            <text>target</text>
          </div>
        </div>
      </div>
    )

    const target = targetRef.current!
    expect(() => target.scrollIntoView({ block: "center" })).toThrow(
      /scrollIntoView.*block: "center"/
    )
    expect(() => target.scrollIntoView(false)).toThrow(/scrollIntoView.*block: "end"/)
    strict.renderer.dispose()
  })

  it("keeps block: \"start\" off the axis an x-only scroller does not own", () => {
    const scrollerRef = React.createRef<PublicInstance>()
    const targetRef = React.createRef<PublicInstance>()

    // Eight 100px columns in a 200px viewport. Column 4 (400..500) sits 60px
    // down, and the 240px columns overflow the 100px height — so a vertical
    // write survives gpui's own clamp even though nothing here scrolls
    // vertically.
    testRoot.render(
      <div ref={scrollerRef} style={{ width: 200, height: 100, overflowX: "scroll" }}>
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            ref={index === 4 ? targetRef : undefined}
            style={{ width: 100, height: 240, marginTop: index === 4 ? 60 : 0 }}
          >
            <text>{`col-${index}`}</text>
          </div>
        ))}
      </div>
    )

    const scroller = scrollerRef.current!
    targetRef.current!.scrollIntoView()
    testRoot.renderer.flush()

    // The column's right edge meets the viewport's, as a horizontal reveal does.
    expect(scroller.scrollLeft).toBe(300)
    // `block: "start"` has no vertical component on a scroller that declares no
    // vertical overflow.
    expect(scroller.scrollTop).toBe(0)
  })

  it("reveals a focused element through nested scrollers", () => {
    const outerRef = React.createRef<PublicInstance>()
    const innerRef = React.createRef<PublicInstance>()
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div ref={outerRef} style={{ width: 200, height: 100, overflow: "scroll" }}>
        <div style={{ height: 120, flexShrink: 0 }}>
          <text>outer-row-0</text>
        </div>
        <div
          ref={innerRef}
          style={{ width: 200, height: 100, flexShrink: 0, overflow: "scroll" }}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} style={{ height: 40, flexShrink: 0 }}>
              {index === 4 ? (
                <div ref={targetRef} tabIndex={0} ariaLabel="nested target">
                  <text>target</text>
                </div>
              ) : (
                <text>{`inner-row-${index}`}</text>
              )}
            </div>
          ))}
        </div>
      </div>
    )

    targetRef.current!.focus()
    testRoot.renderer.flush()

    expect(testRoot.renderer.getActiveElement()).toBe(targetRef.current!.id)
    // Both scrollers move: the inner one to reveal the row, the outer one to
    // reveal the inner scroller.
    expect(innerRef.current!.scrollTop).toBeGreaterThan(0)
    expect(outerRef.current!.scrollTop).toBeGreaterThan(0)
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

  it("clamps a virtual list reveal to the last scroll position", () => {
    const listRef = React.createRef<PublicInstance>()
    const lastRef = React.createRef<PublicInstance>()

    testRoot.render(
      <virtual-list
        ref={listRef}
        overdraw={0}
        estimatedItemHeight={40}
        style={{ width: 400, height: 160 }}
      >
        {Array.from({ length: 20 }, (_, index) => (
          <div
            key={index}
            ref={index === 19 ? lastRef : undefined}
            style={{ height: 40, flexShrink: 0 }}
          >
            <text>{`row-${index}`}</text>
          </div>
        ))}
      </virtual-list>
    )

    const list = listRef.current!
    lastRef.current!.scrollIntoView()
    testRoot.renderer.flush()

    // The last row's top is 760px down, past the 640px the DOM allows: a
    // reveal cannot scroll further than scrollHeight - clientHeight.
    expect(list.scrollTop).toBe(list.scrollHeight - list.clientHeight)
    expect(list.scrollTop).toBe(640)
  })
})
