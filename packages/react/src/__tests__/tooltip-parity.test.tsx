import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import * as Tooltip from "../components/tooltip.js"
import type { TooltipChangeEventDetails } from "../components/tooltip.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Tooltip Base UI parity tree", () => {
  async function readPositionerBounds(offset: {
    sideOffset?: number | ((data: { positioner: DOMRect; anchor: DOMRect; side: string; align: string }) => number)
    alignOffset?: number | ((data: { positioner: DOMRect; anchor: DOMRect; side: string; align: string }) => number)
    side?: "top" | "right" | "bottom" | "left" | "inline-start" | "inline-end" | "block-start" | "block-end"
    align?: "start" | "center" | "end"
    triggerLeft?: number
    triggerTop?: number
  }) {
    const { side = "top", align = "start", triggerLeft = 280, triggerTop = 180, ...offsetProps } = offset
    const testRoot = createTestRoot({ width: 600, height: 400 })
    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Root defaultOpen defaultTriggerId="position-trigger">
          <Tooltip.Trigger id="position-trigger" style={{ position: "absolute", left: triggerLeft, top: triggerTop, width: 72, height: 36 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner data-testid="positioner" side={side} align={align} {...offsetProps}>
              <Tooltip.Popup style={{ width: 52, height: 24 }}>Popup</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    )
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("positioner")).toBeDefined(), { timeout: 5_000 })
    await testRoot.waitFor(() => {
      const positioner = testRoot.renderer.findByTestId("positioner")!
      expect(positioner.customProps?.["data-side"]).not.toBe("none")
      expect(positioner.getBoundingClientRect().width).toBeGreaterThan(0)
      expect(positioner.getBoundingClientRect().height).toBeGreaterThan(0)
    }, { timeout: 5_000 })
    const bounds = testRoot.renderer.findByTestId("positioner")!.getBoundingClientRect()
    testRoot.unmount()
    return bounds
  }

  it("applies numeric sideOffset to the Tooltip.Positioner", async () => {
    const baseline = await readPositionerBounds({ sideOffset: 0 })
    const offset = await readPositionerBounds({ sideOffset: 7 })
    expect(offset.top - baseline.top).toBeCloseTo(-7, 0)
  })

  it("uses positioner and anchor bounds in Tooltip.Positioner sideOffset", async () => {
    const baseline = await readPositionerBounds({ sideOffset: 0 })
    const offset = await readPositionerBounds({ sideOffset: ({ positioner, anchor }) => positioner.width + anchor.width })
    expect(offset.top - baseline.top).toBeCloseTo(-(52 + 72), 0)
  })

  it("applies numeric alignOffset to the Tooltip.Positioner", async () => {
    const baseline = await readPositionerBounds({ alignOffset: 0 })
    const offset = await readPositionerBounds({ alignOffset: 7 })
    expect(offset.left - baseline.left).toBeCloseTo(7, 0)
  })

  it("uses positioner bounds in Tooltip.Positioner alignOffset", async () => {
    const baseline = await readPositionerBounds({ alignOffset: 0 })
    const offset = await readPositionerBounds({ alignOffset: ({ positioner }) => positioner.width })
    expect(offset.left - baseline.left).toBeCloseTo(52, 0)
  })

  it.each(["sideOffset", "alignOffset"] as const)("reads the resolved side inside Tooltip.Positioner %s", async (offsetName) => {
    let resolvedSide = "none"
    const callback = (data: { positioner: DOMRect; anchor: DOMRect; side: string; align: string }) => {
      resolvedSide = data.side
      return 0
    }
    await readPositionerBounds({ side: "left", triggerLeft: 0, [offsetName]: callback })
    expect(resolvedSide).toBe("right")
  })

  it.each(["sideOffset", "alignOffset"] as const)("passes a resolved logical side to Tooltip.Positioner %s", async (offsetName) => {
    let resolvedSide = "none"
    const callback = (data: { positioner: DOMRect; anchor: DOMRect; side: string; align: string }) => {
      resolvedSide = data.side
      return 0
    }
    await readPositionerBounds({ side: "inline-start", triggerLeft: 0, [offsetName]: callback })
    expect(resolvedSide).toBe("inline-end")
  })

  it.each(["sideOffset", "alignOffset"] as const)("reads the resolved align inside Tooltip.Positioner %s", async (offsetName) => {
    let resolvedAlign = "none"
    await readPositionerBounds({
      align: "start",
      triggerLeft: 550,
      [offsetName]: (data) => { resolvedAlign = data.align; return 0 },
    })
    expect(["start", "end"]).toContain(resolvedAlign)
  })

  it("renders Tooltip.Popup children inside the positioner", () => {
    const testRoot = createTestRoot()

    testRoot.render(
      <Tooltip.Root defaultOpen>
        <Tooltip.Positioner>
          <Tooltip.Popup>Popup content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    expect(testRoot.renderer.getAllText()).toContain("Popup content")
    testRoot.unmount()
  })

  it("does not render Tooltip.Popup outside Tooltip.Positioner", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root defaultOpen><Tooltip.Popup>Popup content</Tooltip.Popup></Tooltip.Root>
    )
    expect(testRoot.renderer.getAllText()).not.toContain("Popup content")
    testRoot.unmount()
  })

  it("keeps a closed Tooltip.Popup unmounted by default", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root>
        <Tooltip.Positioner><Tooltip.Popup data-testid="closed-popup">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(testRoot.renderer.findByTestId("closed-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it("renders a Tooltip.Arrow hidden from assistive technology with the resolved side", () => {
    const testRoot = createTestRoot({ width: 600, height: 400 })

    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Root defaultOpen>
          <Tooltip.Trigger style={{ width: 80, height: 28 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="top">
              <Tooltip.Popup style={{ width: 120, height: 28 }}>
                <Tooltip.Arrow data-testid="tooltip-arrow" />
                Tip
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    )

    const arrow = testRoot.renderer.findByTestId("tooltip-arrow")
    expect(arrow?.customProps?.["aria-hidden"]).toBe("true")
    expect(arrow?.customProps?.["data-side"]).toBe("top")
    testRoot.unmount()
  })

  it("uses the rendered Tooltip.Trigger element's own id", async () => {
    const testRoot = createTestRoot()

    testRoot.render(
      <div style={{ width: 400, height: 300 }}>
        <Tooltip.Root>
          <Tooltip.Trigger
            delay={0}
            closeDelay={0}
            render={<button id="custom-button" data-testid="custom-trigger" type="button" style={{ width: 120, height: 32 }} />}
          >
            Trigger
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup data-testid="custom-trigger-popup">Content</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    )

    const trigger = testRoot.renderer.findByTestId("custom-trigger")
    expect(trigger).toBeDefined()
    await testRoot.userEvent.hover(trigger!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("custom-trigger-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("waits for Tooltip.Provider delay before opening on hover", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="delayed-trigger" style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Popup>Delayed content</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("delayed-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    expect(testRoot.renderer.getAllText()).not.toContain("Delayed content")
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.getAllText()).not.toContain("Delayed content")
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Delayed content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("uses Tooltip.Trigger delay in preference to Tooltip.Provider delay", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={10}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="override-trigger" delay={100} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Popup>Override content</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("override-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.getAllText()).not.toContain("Override content")
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Override content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens immediately when Tooltip.Provider delay is zero", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="zero-delay-trigger" style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Zero-delay content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
    const trigger = testRoot.renderer.findByTestId("zero-delay-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    testRoot.renderer.advanceAsyncClock(0)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Zero-delay content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("waits for Tooltip.Provider closeDelay before closing on pointer leave", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0} closeDelay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="close-delay-trigger" style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Popup>Close delay content</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("close-delay-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Close delay content"), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(500, 500)
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.getAllText()).toContain("Close delay content")
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Close delay content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("uses the latest Tooltip.Provider closeDelay after it changes", async () => {
    const testRoot = createTestRoot()
    const render = (closeDelay: number) => testRoot.render(
      <Tooltip.Provider delay={0} closeDelay={closeDelay}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="updated-close-delay-trigger" style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Updated close-delay content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
    render(20)
    const trigger = testRoot.renderer.findByTestId("updated-close-delay-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    testRoot.renderer.advanceAsyncClock(0)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Updated close-delay content"), { timeout: 5_000 })
    render(100)
    testRoot.renderer.nativeSimulateMouseMove(590, 390)
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.getAllText()).toContain("Updated close-delay content")
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Updated close-delay content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens an adjacent Tooltip.Root immediately while the Provider group is active", async () => {
    const testRoot = createTestRoot({ width: 500, height: 300 })
    testRoot.render(
      <Tooltip.Provider delay={80} timeout={400}>
        <div style={{ width: 500, height: 300 }}>
          {[0, 1].map((index) => (
            <Tooltip.Root key={index}>
              <Tooltip.Trigger data-testid={`group-trigger-${index}`} style={{ position: "absolute", left: index * 180, top: 80, width: 120, height: 32 }}>Trigger {index}</Tooltip.Trigger>
              <Tooltip.Positioner><Tooltip.Popup data-testid={`group-popup-${index}`}>Content {index}</Tooltip.Popup></Tooltip.Positioner>
            </Tooltip.Root>
          ))}
        </div>
      </Tooltip.Provider>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("group-trigger-0")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("group-popup-0")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("group-trigger-1")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("group-popup-1")).toBeDefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("group-popup-0")).toBeUndefined()
    testRoot.unmount()
  })

  it("requires the full Tooltip.Provider delay again after its timeout expires", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={100} timeout={400}>
        <div style={{ width: 500, height: 300 }}>
          {[0, 1].map((index) => (
            <Tooltip.Root key={index}>
              <Tooltip.Trigger data-testid={`timeout-trigger-${index}`} style={{ position: "absolute", left: index * 180, top: 80, width: 120, height: 32 }}>
                Trigger {index}
              </Tooltip.Trigger>
              <Tooltip.Positioner><Tooltip.Popup data-testid={`timeout-popup-${index}`}>Content {index}</Tooltip.Popup></Tooltip.Positioner>
            </Tooltip.Root>
          ))}
        </div>
      </Tooltip.Provider>
    )

    const trigger0 = testRoot.renderer.findByTestId("timeout-trigger-0")!
    const bounds0 = trigger0.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds0.x + bounds0.width / 2, bounds0.y + bounds0.height / 2)
    testRoot.renderer.advanceAsyncClock(100)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("timeout-popup-0")).toBeDefined(), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(590, 390)
    testRoot.renderer.advanceAsyncClock(400)
    const trigger1 = testRoot.renderer.findByTestId("timeout-trigger-1")!
    const bounds1 = trigger1.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds1.x + bounds1.width / 2, bounds1.y + bounds1.height / 2)
    expect(testRoot.renderer.findByTestId("timeout-popup-1")).toBeUndefined()
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.findByTestId("timeout-popup-1")).toBeUndefined()
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("timeout-popup-1")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("respects Tooltip.Trigger delay over Tooltip.Provider delay zero outside the instant phase", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0} timeout={400}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="instant-trigger" delay={100} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup data-testid="instant-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("instant-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    testRoot.renderer.advanceAsyncClock(99)
    expect(testRoot.renderer.findByTestId("instant-popup")).toBeUndefined()
    testRoot.renderer.advanceAsyncClock(1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("instant-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens on hover when Tooltip.Root uses defaultOpen=false", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root defaultOpen={false}>
        <Tooltip.Trigger data-testid="hover-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Hover content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("hover-trigger")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Hover content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("closes Tooltip.Root when its trigger is unhovered", async () => {
    const testRoot = createTestRoot({ width: 400, height: 300 })
    testRoot.render(
      <div style={{ width: 400, height: 300 }}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="leave-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Leave content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    )

    const trigger = testRoot.renderer.findByTestId("leave-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Leave content"), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(380, 280)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Leave content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("closes Tooltip.Root when its trigger loses focus", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="blur-trigger">Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Blur content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
        <button data-testid="blur-next">Next</button>
      </div>
    )

    const trigger = testRoot.renderer.findByTestId("blur-trigger")!
    testRoot.renderer.focusElement(trigger.id)
    expect(testRoot.renderer.getAllText()).toContain("Blur content")
    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("blur-next")!.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Blur content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("opens the %s Tooltip.Root when its trigger is hovered", async (mode) => {
    const testRoot = createTestRoot()
    const trigger = renderModeTooltip(testRoot, mode)
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("closes the %s Tooltip.Root when its trigger is unhovered", async (mode) => {
    const testRoot = createTestRoot({ width: 400, height: 300 })
    const trigger = renderModeTooltip(testRoot, mode)
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(380, 280)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("opens the %s Tooltip.Root when its trigger is focused", async (mode) => {
    const testRoot = createTestRoot()
    const trigger = renderModeTooltip(testRoot, mode)
    testRoot.renderer.focusElement(trigger.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("closes the %s Tooltip.Root when its trigger loses focus", async (mode) => {
    const testRoot = createTestRoot()
    const trigger = renderModeTooltip(testRoot, mode)
    testRoot.renderer.focusElement(trigger.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("mode-next")!.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens Tooltip.Root on keyboard focus and closes after Tab moves focus away", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="tab-focus-trigger">Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Focus content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
        <button data-testid="tab-focus-next">Next</button>
      </div>
    )

    const trigger = testRoot.renderer.findByTestId("tab-focus-trigger")!
    const next = testRoot.renderer.findByTestId("tab-focus-next")!
    testRoot.renderer.focusElement(trigger.id)
    expect(testRoot.renderer.getAllText()).toContain("Focus content")
    await testRoot.userEvent.tab()
    expect(testRoot.renderer.getActiveElement()).toBe(next.id)
    testRoot.renderer.advanceAsyncClock(0)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Focus content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each([false, true])(
    "shows only the newly focused tooltip when Tab moves across independent roots with positioned ancestor=%s",
    async (positionedAncestor) => {
      const testRoot = createTestRoot()
      const roots = [0, 1, 2].map((index) => (
        <Tooltip.Root key={index}>
          <Tooltip.Trigger data-testid={`independent-trigger-${index}`}>Trigger {index}</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup data-testid={`independent-popup-${index}`}>Content {index}</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      ))
      testRoot.render(
        <Tooltip.Provider delay={0} closeDelay={0}>
          <div style={positionedAncestor ? { position: "absolute", zIndex: 1 } : undefined}>
            {roots}
            <button data-testid="independent-next">Next</button>
          </div>
        </Tooltip.Provider>
      )

      testRoot.renderer.focusElement(testRoot.renderer.findByTestId("independent-trigger-0")!.id)
      expect(testRoot.renderer.findByTestId("independent-popup-0")).toBeDefined()
      await testRoot.userEvent.tab()
      testRoot.renderer.advanceAsyncClock(0)
      const openPopupIndexes = [0, 1, 2].filter((index) => testRoot.renderer.findByTestId(`independent-popup-${index}`) !== undefined)
      expect(openPopupIndexes).toEqual([1])
      testRoot.unmount()
    }
  )

  it("closes an independently rooted focus tooltip when Tab moves to the next trigger", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0} closeDelay={0}>
        {[0, 1, 2].map((index) => (
          <Tooltip.Root key={index}>
            <Tooltip.Trigger data-testid={`focus-root-trigger-${index}`}>Trigger {index}</Tooltip.Trigger>
            <Tooltip.Positioner><Tooltip.Popup data-testid={`focus-root-popup-${index}`}>Content {index}</Tooltip.Popup></Tooltip.Positioner>
          </Tooltip.Root>
        ))}
        <button data-testid="focus-root-next">Next</button>
      </Tooltip.Provider>
    )

    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("focus-root-trigger-0")!.id)
    expect(testRoot.renderer.findByTestId("focus-root-popup-0")).toBeDefined()
    await testRoot.userEvent.tab()
    testRoot.renderer.advanceAsyncClock(0)
    await testRoot.waitFor(() => {
      const visiblePopups = [0, 1, 2].filter((index) => testRoot.renderer.findByTestId(`focus-root-popup-${index}`) !== undefined)
      expect(visiblePopups).toEqual([1])
    }, { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens Tooltip.Root when defaultOpen is true", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root defaultOpen>
        <Tooltip.Positioner><Tooltip.Popup>Initially open content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(testRoot.renderer.getAllText()).toContain("Initially open content")
    testRoot.unmount()
  })

  it("does not let defaultOpen override controlled Tooltip.Root open=false", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root defaultOpen open={false}>
        <Tooltip.Positioner>
          <Tooltip.Popup>Controlled content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    expect(testRoot.renderer.getAllText()).not.toContain("Controlled content")
    testRoot.unmount()
  })

  it("does not open a controlled Tooltip.Root when the trigger is hovered", async () => {
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    testRoot.render(
      <Tooltip.Root open={false} onOpenChange={(open) => changes.push(open)}>
        <Tooltip.Trigger data-testid="controlled-closed-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner><Tooltip.Popup>Controlled content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("controlled-closed-trigger")!)
    expect(testRoot.renderer.getAllText()).not.toContain("Controlled content")
    expect(changes).toEqual([true])
    testRoot.unmount()
  })

  it("does not call onOpenChange when a controlled Tooltip.Root stays open", async () => {
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    testRoot.render(
      <Tooltip.Root open onOpenChange={(open) => changes.push(open)}>
        <Tooltip.Trigger data-testid="controlled-open-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner><Tooltip.Popup>Controlled content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("controlled-open-trigger")!)
    expect(testRoot.renderer.getAllText()).toContain("Controlled content")
    expect(changes).toEqual([])
    testRoot.unmount()
  })

  it("calls onOpenChange when uncontrolled Tooltip.Root opens", async () => {
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    testRoot.render(
      <Tooltip.Root onOpenChange={(open) => changes.push(open)}>
        <Tooltip.Trigger data-testid="callback-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Callback content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("callback-trigger")!)
    await testRoot.waitFor(() => expect(changes).toEqual([true]), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("does not open when Tooltip.Root is disabled", async () => {
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    testRoot.render(
      <Tooltip.Root disabled onOpenChange={(open) => changes.push(open)}>
        <Tooltip.Trigger data-testid="disabled-root-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Disabled content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("disabled-root-trigger")!)
    expect(testRoot.renderer.getAllText()).not.toContain("Disabled content")
    expect(changes).toEqual([])
    testRoot.unmount()
  })

  it("closes an open Tooltip.Root when it becomes disabled", () => {
    const testRoot = createTestRoot()
    const render = (disabled: boolean) => testRoot.render(
      <Tooltip.Root defaultOpen disabled={disabled}>
        <Tooltip.Positioner><Tooltip.Popup data-testid="became-disabled-popup">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    render(false)
    expect(testRoot.renderer.findByTestId("became-disabled-popup")).toBeDefined()
    render(true)
    expect(testRoot.renderer.findByTestId("became-disabled-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it("does not open on focus when Tooltip.Trigger is disabled", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="disabled-trigger" disabled>Disabled</Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Popup>Disabled focus content</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    )

    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("disabled-trigger")!.id)
    expect(testRoot.renderer.getAllText()).not.toContain("Disabled focus content")
    testRoot.unmount()
  })

  it("cancels an uncontrolled Tooltip.Root open from onOpenChange", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root onOpenChange={(open, details) => { if (open) details.cancel() }}>
        <Tooltip.Trigger data-testid="cancel-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Cancelled content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("cancel-trigger")!)
    expect(testRoot.renderer.getAllText()).not.toContain("Cancelled content")
    testRoot.unmount()
  })

  it("allows Tooltip.Root onOpenChange to preserve Escape propagation", async () => {
    const testRoot = createTestRoot()
    let missingMethodError: unknown
    testRoot.render(
      <div onKeyDown={() => {}}>
        <Tooltip.Root
          defaultOpen
          onOpenChange={(open, details) => {
            if (!open) {
              try {
                (details as TooltipChangeEventDetails & { allowPropagation: () => void }).allowPropagation()
              } catch (error) {
                missingMethodError = error
              }
            }
          }}
        >
          <Tooltip.Trigger data-testid="propagation-trigger">Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup>Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    )

    await testRoot.userEvent.keyboard(testRoot.renderer.findByTestId("propagation-trigger")!, "escape")
    expect(missingMethodError).toBeUndefined()
    testRoot.unmount()
  })

  it("sets Tooltip.Root payload and renders content for the active trigger", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Root>
          {({ payload }: { payload: number | undefined }) => (
            <>
              <Tooltip.Trigger data-testid="payload-trigger-1" payload={1} delay={0} style={{ position: "absolute", left: 30, top: 40, width: 100, height: 32 }}>One</Tooltip.Trigger>
              <Tooltip.Trigger data-testid="payload-trigger-2" payload={2} delay={0} style={{ position: "absolute", left: 220, top: 80, width: 100, height: 32 }}>Two</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup data-testid="payload-popup">{payload}</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
            </>
          )}
        </Tooltip.Root>
      </div>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("payload-trigger-1")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("1"), { timeout: 5_000 })
    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("payload-trigger-2")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("2"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens a detached Tooltip.Trigger from its handle and uses its payload", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<{ source: string }>()
    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Provider delay={0}>
          <Tooltip.Root handle={handle}>
            {({ payload }: { payload: { source: string } | undefined }) => (
              <Tooltip.Portal>
                <Tooltip.Positioner>
                  <Tooltip.Popup data-testid="handle-popup">{payload?.source}</Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            )}
          </Tooltip.Root>
          <Tooltip.Trigger id="copy-trigger" data-testid="copy-trigger" handle={handle} payload={{ source: "clipboard" }}>Copy</Tooltip.Trigger>
        </Tooltip.Provider>
      </div>
    )

    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("copy-trigger")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("clipboard"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("opens and closes a detached Tooltip.Root through its handle", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle()
    testRoot.render(
      <div>
        <Tooltip.Root handle={handle}>
          <Tooltip.Positioner><Tooltip.Popup data-testid="imperative-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
        <Tooltip.Trigger id="imperative-trigger" handle={handle}>Trigger</Tooltip.Trigger>
      </div>
    )

    handle.open("imperative-trigger")
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("imperative-popup")).toBeDefined(), { timeout: 5_000 })
    handle.close()
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("imperative-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("throws when a detached Tooltip handle opens an unregistered trigger id", () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle()
    testRoot.render(
      <>
        <Tooltip.Root handle={handle}><Tooltip.Positioner><Tooltip.Popup>Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>
        <Tooltip.Trigger id="registered-trigger" handle={handle}>Trigger</Tooltip.Trigger>
      </>
    )

    expect(() => handle.open("missing-trigger")).toThrow('was called with the trigger id "missing-trigger"')
    testRoot.unmount()
  })

  it("ignores Tooltip handle calls made before a Root is attached", () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => { warnings.push(args) }

    try {
      handle.open("trigger", 1)
      handle.close()
    } finally {
      console.warn = originalWarn
    }

    expect(handle.isOpen).toBe(false)
    expect(warnings).toHaveLength(2)
    expect(warnings.every(([message]) => String(message).includes("no root using this handle is mounted"))).toBe(true)
    testRoot.unmount()
  })

  it("ignores Tooltip handle calls after its Root is detached", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    testRoot.render(
      <>
        <Tooltip.Root handle={handle}>
          <Tooltip.Positioner><Tooltip.Popup data-testid="detached-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
        <Tooltip.Trigger id="detached-trigger" handle={handle}>Trigger</Tooltip.Trigger>
      </>
    )
    handle.open("detached-trigger", 1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("detached-popup")).toBeDefined(), { timeout: 5_000 })

    testRoot.render(<Tooltip.Trigger id="detached-trigger" handle={handle}>Trigger</Tooltip.Trigger>)
    expect(handle.isOpen).toBe(false)
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    try {
      handle.open("detached-trigger", 1)
      handle.close()
    } finally {
      console.warn = originalWarn
    }
    expect(handle.isOpen).toBe(false)
    expect(warnings).toHaveLength(2)
    expect(warnings.every(([message]) => String(message).includes("no root using this handle is mounted"))).toBe(true)
    testRoot.unmount()
  })

  it("warns when a Tooltip handle remains attached to multiple mounted Roots", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle()
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    try {
      testRoot.render(
        <>
          <Tooltip.Root handle={handle}><Tooltip.Positioner><Tooltip.Popup>First</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>
          <Tooltip.Root handle={handle}><Tooltip.Positioner><Tooltip.Popup>Second</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>
        </>
      )
      testRoot.renderer.advanceAsyncClock(20)
      expect(warnings.some(([message]) => String(message).includes("more than one mounted root"))).toBe(true)
    } finally {
      console.warn = originalWarn
      testRoot.unmount()
    }
  })

  it("closes a detached Tooltip when focus moves to a disabled trigger", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    testRoot.render(
      <>
        <Tooltip.Trigger data-testid="disabled-focus-active" handle={handle} payload={1}>Active</Tooltip.Trigger>
        <Tooltip.Trigger data-testid="disabled-focus-target" handle={handle} payload={2} disabled>Disabled</Tooltip.Trigger>
        <Tooltip.Root handle={handle}>
          {({ payload }) => <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="disabled-focus-popup">{payload}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>}
        </Tooltip.Root>
      </>
    )
    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("disabled-focus-active")!.id)
    expect(testRoot.renderer.getAllText()).toContain("1")
    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("disabled-focus-target")!.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("disabled-focus-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("closes a detached Tooltip when hovering a disabled trigger", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    testRoot.render(
      <>
        <Tooltip.Trigger data-testid="disabled-hover-active" handle={handle} payload={1} delay={0}>Active</Tooltip.Trigger>
        <Tooltip.Trigger data-testid="disabled-hover-target" handle={handle} payload={2} disabled>Disabled</Tooltip.Trigger>
        <Tooltip.Root handle={handle}>
          {({ payload }) => <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="disabled-hover-popup">{payload}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>}
        </Tooltip.Root>
      </>
    )
    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("disabled-hover-active")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("disabled-hover-popup")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("disabled-hover-target")!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("disabled-hover-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("closes a detached Tooltip.Root when its active trigger unmounts", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    const render = (includeActiveTrigger: boolean) => testRoot.render(
      <>
        {includeActiveTrigger && <Tooltip.Trigger id="active-trigger" handle={handle} payload={1}>Active</Tooltip.Trigger>}
        <Tooltip.Trigger id="other-trigger" handle={handle} payload={2}>Other</Tooltip.Trigger>
        <Tooltip.Root handle={handle}>
          {({ payload }) => <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="active-popup">{payload}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>}
        </Tooltip.Root>
      </>
    )
    render(true)
    handle.open("active-trigger", 1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("active-popup")).toBeDefined(), { timeout: 5_000 })
    render(false)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("active-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("hands open state and payload to a detached trigger with its own DOM id", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    let renderedPayload: number | undefined
    testRoot.render(
      <>
        <Tooltip.Trigger id="first-trigger" handle={handle} payload={1}>First</Tooltip.Trigger>
        <Tooltip.Trigger id="custom-second-trigger" handle={handle} payload={2} render={<button id="custom-second-trigger">Second</button>} />
        <Tooltip.Root handle={handle}>
          {({ payload }) => {
            renderedPayload = payload
            return <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="handoff-popup">{payload}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          }}
        </Tooltip.Root>
      </>
    )
    handle.open("first-trigger", 1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("handoff-popup")).toBeDefined(), { timeout: 5_000 })
    handle.open("custom-second-trigger", 2)
    await testRoot.waitFor(() => expect(renderedPayload).toBe(2), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("handoff-popup")).toBeDefined()
    expect(testRoot.renderer.findByTestId("custom-second-trigger")?.customProps?.["data-popup-open"]).toBeDefined()
    testRoot.unmount()
  })

  it("reuses the detached Tooltip popup and positioner when switching triggers", async () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle<number>()
    let renderedPayload: number | undefined
    testRoot.render(
      <>
        <Tooltip.Trigger id="reuse-first" handle={handle} payload={1}>First</Tooltip.Trigger>
        <Tooltip.Trigger id="reuse-second" handle={handle} payload={2}>Second</Tooltip.Trigger>
        <Tooltip.Root handle={handle}>
          {({ payload }) => {
            renderedPayload = payload
            return <Tooltip.Portal><Tooltip.Positioner data-testid="reuse-positioner"><Tooltip.Popup data-testid="reuse-popup">{payload}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          }}
        </Tooltip.Root>
      </>
    )
    handle.open("reuse-first", 1)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("reuse-popup")).toBeDefined(), { timeout: 5_000 })
    const positionerId = testRoot.renderer.findByTestId("reuse-positioner")?.id
    const popupId = testRoot.renderer.findByTestId("reuse-popup")?.id
    handle.open("reuse-second", 2)
    expect(testRoot.renderer.findByTestId("reuse-positioner")?.id).toBe(positionerId)
    expect(testRoot.renderer.findByTestId("reuse-popup")?.id).toBe(popupId)
    await testRoot.waitFor(() => expect(renderedPayload).toBe(2), { timeout: 5_000 })
    expect(renderedPayload).toBe(2)
    testRoot.unmount()
  })

  it("keeps a Tooltip.Root open when it is rendered with controlled open=true", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root defaultOpen open>
        <Tooltip.Positioner><Tooltip.Popup data-testid="controlled-initially-open">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(testRoot.renderer.findByTestId("controlled-initially-open")).toBeDefined()
    testRoot.unmount()
  })

  it.each([true, false])("sets positioner pointer-events when disableHoverablePopup=%s", async (disableHoverablePopup) => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root disableHoverablePopup={disableHoverablePopup}>
        <Tooltip.Trigger data-testid="pointer-events-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner data-testid="pointer-events-positioner" trackCursorAxis="both">
          <Tooltip.Popup>Content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    )
    const trigger = testRoot.renderer.findByTestId("pointer-events-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseDown(bounds.x + 8, bounds.y + 8)
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("pointer-events-positioner")).toBeDefined(), { timeout: 5_000 })
    const style = testRoot.renderer.findByTestId("pointer-events-positioner")?.customProps?.style as Record<string, unknown> | undefined
    expect(style?.pointerEvents).toBe(disableHoverablePopup ? "none" : undefined)
    testRoot.unmount()
  })

  it("does not emit an open change when a closed Tooltip.Root mounts", () => {
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    testRoot.render(
      <Tooltip.Root onOpenChange={(open) => changes.push(open)}>
        <Tooltip.Positioner><Tooltip.Popup>Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(changes).toEqual([])
    expect(testRoot.renderer.getAllText()).toEqual([])
    testRoot.unmount()
  })

  it("does not open when pointerdown happens before the Tooltip delay expires", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="pointerdown-delay-trigger">Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup data-testid="pointerdown-delay-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
    const trigger = testRoot.renderer.findByTestId("pointerdown-delay-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    testRoot.renderer.advanceAsyncClock(50)
    testRoot.renderer.nativeSimulateMouseDown(bounds.x + 8, bounds.y + 8)
    testRoot.renderer.advanceAsyncClock(100)
    expect(testRoot.renderer.findByTestId("pointerdown-delay-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it("opens after an early trigger press when closeOnClick is false", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="early-press-trigger" closeOnClick={false}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup data-testid="early-press-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
    const trigger = testRoot.renderer.findByTestId("early-press-trigger")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    await testRoot.userEvent.click(trigger)
    testRoot.renderer.advanceAsyncClock(100)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("early-press-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("reopens on hover after a trigger press closes the Tooltip", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root>
        <Tooltip.Trigger data-testid="reopen-after-press" delay={100}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner><Tooltip.Popup data-testid="reopen-after-press-popup">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    const trigger = testRoot.renderer.findByTestId("reopen-after-press")!
    const bounds = trigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    testRoot.renderer.advanceAsyncClock(100)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("reopen-after-press-popup")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.click(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("reopen-after-press-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(500, 500)
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    testRoot.renderer.advanceAsyncClock(100)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("reopen-after-press-popup")).toBeDefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("calls the Tooltip action to unmount content after a prevented close", async () => {
    const testRoot = createTestRoot()
    const actionsRef = React.createRef<Tooltip.TooltipRootActions>()
    testRoot.render(
      <Tooltip.Root
        defaultOpen
        actionsRef={actionsRef}
        onOpenChange={(open, details) => { if (!open) details.preventUnmountOnClose() }}
      >
        <Tooltip.Positioner><Tooltip.Popup data-testid="action-unmount-popup">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(testRoot.renderer.findByTestId("action-unmount-popup")).toBeDefined()
    actionsRef.current!.unmount()
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("action-unmount-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("marks focus-opened popup instant but not hover-opened popup", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="instant-state-trigger" delay={0}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner><Tooltip.Popup data-testid="instant-state-popup">Content</Tooltip.Popup></Tooltip.Positioner>
        </Tooltip.Root>
        <button data-testid="instant-state-next">Next</button>
      </div>
    )
    const trigger = testRoot.renderer.findByTestId("instant-state-trigger")!
    testRoot.renderer.focusElement(trigger.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("instant-state-popup")).toBeDefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("instant-state-popup")?.customProps?.["data-instant"]).toBe("focus")
    testRoot.renderer.focusElement(testRoot.renderer.findByTestId("instant-state-next")!.id)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("instant-state-popup")).toBeUndefined(), { timeout: 5_000 })
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("instant-state-popup")).toBeDefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("instant-state-popup")?.customProps?.["data-instant"]).not.toBe("focus")
    testRoot.unmount()
  })

  it("removes data-popup-open when close unmount is prevented", async () => {
    const testRoot = createTestRoot()
    function PreventUnmountTooltip() {
      const [open, setOpen] = useState(false)
      return (
        <Tooltip.Root
          open={open}
          onOpenChange={(nextOpen, details) => {
            if (!nextOpen) details.preventUnmountOnClose()
            setOpen(nextOpen)
          }}
        >
          <Tooltip.Trigger data-testid="kept-trigger" delay={0} closeDelay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup data-testid="kept-content">Content</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )
    }
    testRoot.render(<PreventUnmountTooltip />)

    const trigger = testRoot.renderer.findByTestId("kept-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("kept-trigger")?.customProps?.["data-popup-open"]).toBeDefined(), { timeout: 5_000 })
    testRoot.renderer.nativeSimulateMouseMove(490, 290)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("kept-trigger")?.customProps?.["data-popup-open"]).toBeUndefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("kept-content")).toBeDefined()
    testRoot.unmount()
  })

  it("closes Tooltip.Root when Escape is pressed", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0}>
        <Tooltip.Root>
        <Tooltip.Trigger data-testid="escape-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Escape content</Tooltip.Popup>
        </Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("escape-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Escape content"), { timeout: 5_000 })
    await testRoot.userEvent.keyboard(trigger, "escape")
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Escape content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("closes the %s Tooltip.Root when Escape is pressed", async (mode) => {
    const testRoot = createTestRoot()
    const trigger = renderModeTooltip(testRoot, mode)
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.keyboard(trigger, "escape")
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("closes an open Tooltip.Root through its actionsRef", async () => {
    const testRoot = createTestRoot()
    const actionsRef = React.createRef<Tooltip.TooltipRootActions>()
    testRoot.render(
      <Tooltip.Root defaultOpen actionsRef={actionsRef}>
        <Tooltip.Positioner><Tooltip.Popup data-testid="action-popup">Content</Tooltip.Popup></Tooltip.Positioner>
      </Tooltip.Root>
    )
    expect(testRoot.renderer.findByTestId("action-popup")).toBeDefined()
    actionsRef.current!.close()
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("action-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("does not open Tooltip.Root when the trigger is clicked before the delay", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={100}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="early-click-trigger" style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Popup>Early click content</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    await testRoot.userEvent.click(testRoot.renderer.findByTestId("early-click-trigger")!)
    testRoot.renderer.advanceAsyncClock(100)
    expect(testRoot.renderer.getAllText()).not.toContain("Early click content")
    testRoot.unmount()
  })

  it("closes Tooltip.Root when its trigger is clicked after hover opens it", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Provider delay={0}>
      <Tooltip.Root>
        <Tooltip.Trigger data-testid="click-close-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>Click close content</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
      </Tooltip.Provider>
    )

    const trigger = testRoot.renderer.findByTestId("click-close-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Click close content"), { timeout: 5_000 })
    await testRoot.userEvent.click(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).not.toContain("Click close content"), { timeout: 5_000 })
    testRoot.unmount()
  })

  it.each(["in-Root", "detached", "multiple detached"] as const)("keeps the %s Tooltip.Root open after a trigger press when closeOnClick is false", async (mode) => {
    const testRoot = createTestRoot()
    const trigger = renderModeTooltip(testRoot, mode, { closeOnClick: false })
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.click(trigger)
    expect(testRoot.renderer.findByTestId("mode-popup")).toBeDefined()
    testRoot.unmount()
  })

  it("keeps a Tooltip.Root open while the pointer moves from its trigger into its popup", async () => {
    const testRoot = createTestRoot({ width: 600, height: 400 })
    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Root>
          <Tooltip.Trigger data-testid="hoverable-trigger" delay={0} style={{ position: "absolute", left: 220, top: 180, width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner side="top">
            <Tooltip.Popup data-testid="hoverable-popup" style={{ width: 120, height: 32 }}>Popup</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    )

    const trigger = testRoot.renderer.findByTestId("hoverable-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("hoverable-popup")).toBeDefined(), { timeout: 5_000 })
    await testRoot.userEvent.hover(testRoot.renderer.findByTestId("hoverable-popup")!)
    expect(testRoot.renderer.findByTestId("hoverable-popup")).toBeDefined()
    testRoot.unmount()
  })

  it("closes when the pointer enters a popup whose Tooltip disables hoverable content", async () => {
    const testRoot = createTestRoot({ width: 600, height: 400 })
    testRoot.render(
      <div style={{ width: 600, height: 400 }}>
        <Tooltip.Root disableHoverablePopup>
          <Tooltip.Trigger data-testid="non-hoverable-trigger" delay={0} style={{ position: "absolute", left: 220, top: 180, width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Positioner side="top">
            <Tooltip.Popup data-testid="non-hoverable-popup" style={{ width: 120, height: 32 }}>Popup</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    )
    const trigger = testRoot.renderer.findByTestId("non-hoverable-trigger")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("non-hoverable-popup")).toBeDefined(), { timeout: 5_000 })
    const popup = testRoot.renderer.findByTestId("non-hoverable-popup")!
    const bounds = popup.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 8, bounds.y + 8)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("non-hoverable-popup")).toBeUndefined(), { timeout: 5_000 })
    testRoot.unmount()
  })

  it("does not open the outer Tooltip.Root when the pointer enters a nested trigger", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <Tooltip.Root>
        <Tooltip.Trigger data-testid="nested-outer-trigger" render={<span />} delay={80}>
          Outer
          <Tooltip.Root>
            <Tooltip.Trigger data-testid="nested-inner-trigger" delay={80}>Inner</Tooltip.Trigger>
            <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="nested-inner-popup">Inner tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="nested-outer-popup">Outer tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
      </Tooltip.Root>
    )
    const outer = testRoot.renderer.findByTestId("nested-outer-trigger")!
    const inner = testRoot.renderer.findByTestId("nested-inner-trigger")
    expect(inner).toBeDefined()
    const outerBounds = outer.getBoundingClientRect()
    const innerBounds = inner.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(outerBounds.x + 4, outerBounds.y + 4)
    testRoot.renderer.nativeSimulateMouseMove(innerBounds.x + 4, innerBounds.y + 4)
    testRoot.renderer.advanceAsyncClock(100)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("nested-inner-popup")).toBeDefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("nested-outer-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it.each([false, true])(
    "closes the previous focus-opened tooltip when focus moves to another trigger with an absolute z-index ancestor=%s",
    async (positionedAncestor) => {
      const testRoot = createTestRoot({ width: 600, height: 400 })
      const labels = ["First tip", "Second tip", "Third tip"]
      const observedOpenTooltips: number[][] = []
      const blurredTriggers: number[] = []
      const siblingCloseDetails: Array<{ index: number; details: TooltipChangeEventDetails }> = []

      testRoot.render(
        <div style={{ width: 600, height: 400 }}>
          {positionedAncestor ? (
            <div style={{ position: "absolute", zIndex: 1, left: 40, top: 60 }}>
              <TooltipSequence
                labels={labels}
                onTriggerBlur={(index) => blurredTriggers.push(index)}
                onOpenChange={(index, open, details) => {
                  if (!open) siblingCloseDetails.push({ index, details })
                }}
              />
            </div>
          ) : (
            <TooltipSequence
              labels={labels}
              onTriggerBlur={(index) => blurredTriggers.push(index)}
              onOpenChange={(index, open, details) => {
                if (!open) siblingCloseDetails.push({ index, details })
              }}
            />
          )}
          <button data-testid="after-tooltip-triggers">After tooltips</button>
        </div>
      )

      for (let index = 0; index < labels.length; index += 1) {
        await testRoot.userEvent.tab()
        const openTooltips = labels.flatMap((_, tooltipIndex) =>
          testRoot.renderer.findByTestId(`focus-tooltip-${tooltipIndex}`) ? [tooltipIndex] : []
        )
        observedOpenTooltips.push(openTooltips)
      }

      await testRoot.userEvent.tab()
      await testRoot.waitFor(
        () => expect(labels.map((_, index) => testRoot.renderer.findByTestId(`focus-tooltip-${index}`))).toEqual([undefined, undefined, undefined]),
        { timeout: 5_000 }
      )
      expect(blurredTriggers).toEqual([0, 1, 2])
      expect(observedOpenTooltips, "only the focused trigger's tooltip should be open after each Tab").toEqual([[0], [1], [2]])
      expect(siblingCloseDetails.map(({ index, details }) => [index, details.reason, details.event])).toEqual([
        [0, "none", undefined],
        [1, "none", undefined],
        [2, "trigger-focus", expect.anything()],
      ])
      testRoot.unmount()
    },
    15_000
  )

  it.each([false, true])(
    "positions each focus-opened tooltip above its rendered trigger with an absolute z-index ancestor=%s",
    async (positionedAncestor) => {
      const testRoot = createTestRoot({ width: 600, height: 400 })
      const labels = ["First tip", "Second tip", "Third tip"]

      testRoot.render(
        <div style={{ width: 600, height: 400 }}>
          {positionedAncestor ? (
            <div style={{ position: "absolute", zIndex: 1, left: 40, top: 60 }}>
              <TooltipSequence labels={labels} />
            </div>
          ) : (
            <TooltipSequence labels={labels} />
          )}
        </div>
      )

      for (let index = 0; index < labels.length; index += 1) {
        await testRoot.userEvent.tab()
        const popup = testRoot.renderer.findByTestId(`focus-tooltip-${index}`)
        expect(popup, `tooltip ${index} should open on focus`).toBeDefined()
        const trigger = testRoot.renderer.findByTestId(`focus-trigger-${index}`)!
        await testRoot.waitFor(() => {
          const triggerBounds = trigger.getBoundingClientRect()
          const popupBounds = popup!.getBoundingClientRect()
          expect(popupBounds.left + popupBounds.width / 2, `tooltip ${index} should align with its trigger`).toBeCloseTo(triggerBounds.left + triggerBounds.width / 2, 0)
          expect(popupBounds.bottom, `tooltip ${index} should be above its trigger`).toBeLessThanOrEqual(triggerBounds.top)
        }, { timeout: 5_000 })
      }

      testRoot.render(null)
    },
    15_000
  )

  it("applies provider delays, reports controlled changes, and positions the full popup tree", async () => {
    const testRoot = createTestRoot()
    const tooltipHandle = Tooltip.createTooltipHandle()
    let trigger: PublicInstance | null = null
    const changes: Array<{ open: boolean; reason: string }> = []

    function Demo() {
      const [open, setOpen] = useState(false)
      return (
        <div style={{ width: 420, height: 300, padding: 16 }}>
          <Tooltip.Provider delay={40} closeDelay={70} timeout={400}>
            <Tooltip.Root
              open={open}
              handle={tooltipHandle}
              onOpenChange={(nextOpen, details) => {
                changes.push({ open: nextOpen, reason: details.reason })
                setOpen(nextOpen)
              }}
            >
              <Tooltip.Portal>
                <Tooltip.Positioner side="top" align="center" sideOffset={6}>
                  <Tooltip.Viewport>
                    <Tooltip.Popup data-testid="tooltip-popup" style={{ width: 160, height: 28, backgroundColor: "#020617" }}>
                      <Tooltip.Arrow data-testid="arrow" />
                      Copy message
                    </Tooltip.Popup>
                  </Tooltip.Viewport>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Tooltip.Trigger
              id="copy-trigger"
              handle={tooltipHandle}
              payload={{ source: "clipboard" }}
              ref={(instance) => { trigger = instance }}
              style={{ width: 120, height: 32, backgroundColor: "#334155" }}
            >
              Copy
            </Tooltip.Trigger>
          </Tooltip.Provider>
        </div>
      )
    }

    testRoot.render(<Demo />)
    expect(trigger).not.toBeNull()
    expect(testRoot.renderer.getAllText()).toEqual(["Copy"])

    const triggerBounds = trigger!.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(
      triggerBounds.x + triggerBounds.width / 2,
      triggerBounds.y + triggerBounds.height / 2
    )
    expect(testRoot.renderer.getAllText()).toEqual(["Copy"])

    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toContain("Copy message"), { timeout: 5_000 })
    expect(testRoot.renderer.getAllText()).toContain("Copy message")
    expect(changes.at(-1)).toEqual({ open: true, reason: "trigger-hover" })

    const popup = testRoot.renderer.findByTestId("tooltip-popup")!
    expect(popup.customProps?.["data-side"]).toBe("bottom")
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(triggerBounds.bottom)
    expect(testRoot.renderer.findByTestId("arrow")).toBeDefined()

    testRoot.renderer.nativeSimulateMouseMove(380, 260)
    expect(testRoot.renderer.getAllText()).toContain("Copy message")
    await testRoot.waitFor(() => expect(testRoot.renderer.getAllText()).toEqual(["Copy"]), { timeout: 5_000 })
    expect(testRoot.renderer.getAllText()).toEqual(["Copy"])
    expect(changes.at(-1)).toEqual({ open: false, reason: "trigger-hover" })

    testRoot.render(null)
  })

  it("keeps disabled triggers operable and closes an open Root when disabled", () => {
    const testRoot = createTestRoot()
    const changes: Array<{ open: boolean; reason: string }> = []

    const render = (disabled: boolean) => testRoot.render(
      <Tooltip.Provider>
        <Tooltip.Root
          defaultOpen
          defaultTriggerId="disabled-trigger"
          disabled={disabled}
          onOpenChange={(open, details) => changes.push({ open, reason: details.reason })}
        >
          <Tooltip.Positioner>
            <Tooltip.Popup data-testid="disabled-popup">Tip</Tooltip.Popup>
          </Tooltip.Positioner>
          <Tooltip.Trigger id="disabled-trigger" data-testid="disabled-trigger" disabled>
            Action
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    render(false)
    expect(testRoot.renderer.findByTestId("disabled-trigger")?.customProps?.disabled).toBeUndefined()
    expect(testRoot.renderer.findByTestId("disabled-popup")).toBeDefined()

    render(true)
    expect(testRoot.renderer.findByTestId("disabled-trigger")?.customProps?.disabled).toBeUndefined()
    expect(testRoot.renderer.findByTestId("disabled-popup")).toBeUndefined()
    expect(changes.at(-1)).toEqual({ open: false, reason: "disabled" })
    testRoot.render(null)
  })

  it("keeps in-Root trigger anchors and change details associated with their trigger", async () => {
    const testRoot = createTestRoot()
    let first: PublicInstance | null = null
    let lastChangeTrigger: Element | undefined

    testRoot.render(
      <div style={{ width: 420, height: 300 }}>
        <Tooltip.Root onOpenChange={(_open, details) => { lastChangeTrigger = details.trigger }}>
          <Tooltip.Positioner side="top" sideOffset={4}>
            <Tooltip.Popup data-testid="multiple-trigger-popup">Tip</Tooltip.Popup>
          </Tooltip.Positioner>
          <Tooltip.Trigger
            id="first-trigger"
            ref={(instance) => { first = instance }}
            delay={0}
            style={{ position: "absolute", left: 40, top: 80, width: 80, height: 28 }}
          >
            First
          </Tooltip.Trigger>
          <Tooltip.Trigger
            id="last-trigger"
            delay={0}
            style={{ position: "absolute", left: 260, top: 180, width: 80, height: 28 }}
          >
            Last
          </Tooltip.Trigger>
        </Tooltip.Root>
      </div>
    )

    const firstBounds = first!.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(firstBounds.x + 8, firstBounds.y + 8)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("multiple-trigger-popup")).toBeDefined(), { timeout: 5_000 })

    const popup = testRoot.renderer.findByTestId("multiple-trigger-popup")!
    expect(lastChangeTrigger).toBe(first)
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(firstBounds.top)
    testRoot.render(null)
  })

  it.each(["in-Root", "detached Handle"] as const)("uses Trigger.closeDelay after focus opens a %s tooltip", async (mode) => {
    const testRoot = createTestRoot()
    const detached = mode === "detached Handle"
    const tooltipHandle = Tooltip.createTooltipHandle()
    let trigger: PublicInstance | null = null

    testRoot.render(
      <div style={{ width: 420, height: 300, padding: 16 }}>
        <Tooltip.Provider closeDelay={0}>
          <Tooltip.Root handle={detached ? tooltipHandle : undefined}>
            <Tooltip.Positioner side="top">
              <Tooltip.Popup data-testid="focus-delay-popup" style={{ width: 150, height: 28 }}>Tip</Tooltip.Popup>
            </Tooltip.Positioner>
            {!detached && (
              <Tooltip.Trigger id="focus-trigger" ref={(instance) => { trigger = instance }} closeDelay={60}>
                Focus trigger
              </Tooltip.Trigger>
            )}
          </Tooltip.Root>
          {detached && (
            <Tooltip.Trigger id="focus-trigger" handle={tooltipHandle} ref={(instance) => { trigger = instance }} closeDelay={60}>
              Focus trigger
            </Tooltip.Trigger>
          )}
        </Tooltip.Provider>
      </div>
    )

    testRoot.renderer.focusElement(trigger!.id)
    expect(testRoot.renderer.findByTestId("focus-delay-popup")).toBeDefined()
    const popupBounds = testRoot.renderer.findByTestId("focus-delay-popup")!.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(popupBounds.x + 8, popupBounds.y + 8)
    testRoot.renderer.nativeSimulateMouseMove(410, 290)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(testRoot.renderer.findByTestId("focus-delay-popup")).toBeDefined()
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("focus-delay-popup")).toBeUndefined(), { timeout: 5_000 })
    expect(testRoot.renderer.findByTestId("focus-delay-popup")).toBeUndefined()
    testRoot.render(null)
  })

  it("fires one controlled close callback for a trigger press in either trigger mode", () => {
    const testRoot = createTestRoot()
    const rootChanges: Array<{ open: boolean; reason: string }> = []
    testRoot.render(
      <div style={{ width: 320, height: 200 }}>
        <Tooltip.Root open triggerId="root-press-trigger" onOpenChange={(open, details) => rootChanges.push({ open, reason: details.reason })}>
          <Tooltip.Positioner><Tooltip.Popup>Root tooltip</Tooltip.Popup></Tooltip.Positioner>
          <Tooltip.Trigger id="root-press-trigger" data-testid="root-press-trigger">Root trigger</Tooltip.Trigger>
        </Tooltip.Root>
      </div>
    )
    const rootTrigger = testRoot.renderer.findByTestId("root-press-trigger")!
    const rootBounds = rootTrigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateClick(rootBounds.x + 8, rootBounds.y + 8)
    expect(rootChanges).toEqual([{ open: false, reason: "trigger-press" }])

    testRoot.render(null)
    const tooltipHandle = Tooltip.createTooltipHandle()
    const handleChanges: Array<{ open: boolean; reason: string }> = []
    testRoot.render(
      <div style={{ width: 320, height: 200 }}>
        <Tooltip.Provider>
          <Tooltip.Root open handle={tooltipHandle} onOpenChange={(open, details) => handleChanges.push({ open, reason: details.reason })}>
            <Tooltip.Positioner><Tooltip.Popup>Handle tooltip</Tooltip.Popup></Tooltip.Positioner>
          </Tooltip.Root>
          <Tooltip.Trigger id="handle-press-trigger" handle={tooltipHandle} data-testid="handle-press-trigger">Handle trigger</Tooltip.Trigger>
        </Tooltip.Provider>
      </div>
    )
    tooltipHandle.open("handle-press-trigger")
    handleChanges.length = 0
    const handleTrigger = testRoot.renderer.findByTestId("handle-press-trigger")!
    const handleBounds = handleTrigger.getBoundingClientRect()
    testRoot.renderer.nativeSimulateClick(handleBounds.x + 8, handleBounds.y + 8)
    expect(handleChanges).toEqual([{ open: false, reason: "trigger-press" }])
    testRoot.render(null)
  })

  it("calls onOpenChangeComplete on close when no exit animation is defined", async () => {
    const testRoot = createTestRoot()
    const completed: boolean[] = []
    function App() {
      const [open, setOpen] = useState(true)
      return <><button data-testid="complete-close" onClick={() => setOpen(false)}>Close</button><Tooltip.Root open={open} onOpenChangeComplete={(value) => completed.push(value)}><Tooltip.Positioner><Tooltip.Popup data-testid="complete-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root></>
    }
    testRoot.render(<App />)
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("complete-close")!)
    expect(testRoot.renderer.findByTestId("complete-popup")).toBeUndefined()
    expect(completed).toEqual([false])
    testRoot.unmount()
  })

  it("calls onOpenChangeComplete on open when no enter animation is defined", async () => {
    const testRoot = createTestRoot()
    const completed: boolean[] = []
    function App() {
      const [open, setOpen] = useState(false)
      return <><button data-testid="complete-open" onClick={() => setOpen(true)}>Open</button><Tooltip.Root open={open} onOpenChangeComplete={(value) => completed.push(value)}><Tooltip.Positioner><Tooltip.Popup data-testid="complete-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root></>
    }
    testRoot.render(<App />)
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("complete-open")!)
    expect(testRoot.renderer.findByTestId("complete-popup")).toBeDefined()
    expect(completed).toEqual([true])
    testRoot.unmount()
  })

  it("does not call onOpenChangeComplete on mount when not open", () => {
    const testRoot = createTestRoot()
    const completed: boolean[] = []
    testRoot.render(<Tooltip.Root onOpenChangeComplete={(value) => completed.push(value)}><Tooltip.Positioner><Tooltip.Popup data-testid="complete-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>)
    expect(completed).toEqual([])
    testRoot.unmount()
  })

  it("resolves a trigger still registered to the previous Tooltip.Root during a transient overlap", () => {
    const handle = Tooltip.createTooltipHandle()
    const openErrors: unknown[] = []
    function OpenOnMount() {
      React.useLayoutEffect(() => {
        try { handle.open("transient-trigger") } catch (error) { openErrors.push(error) }
      }, [])
      return null
    }
    function App({ phase }: { phase: "outgoing" | "overlap" | "incoming" }) {
      return <>
        <Tooltip.Trigger handle={handle} id="transient-trigger" data-testid="transient-trigger">Trigger</Tooltip.Trigger>
        {(phase === "outgoing" || phase === "overlap") && <Tooltip.Root key="outgoing" handle={handle}><Tooltip.Positioner><Tooltip.Popup>Outgoing</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>}
        {(phase === "overlap" || phase === "incoming") && <><Tooltip.Root key="incoming" handle={handle}><Tooltip.Positioner><Tooltip.Popup>Incoming</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root><OpenOnMount /></>}
      </>
    }
    const testRoot = createTestRoot()
    testRoot.render(<App phase="outgoing" />)
    testRoot.render(<App phase="overlap" />)
    expect(openErrors).toEqual([])
    expect(handle.isOpen).toBe(true)
    expect(testRoot.renderer.findByTestId("transient-trigger")?.customProps?.["data-popup-open"]).toBeDefined()
    testRoot.render(<App phase="incoming" />)
    expect(handle.isOpen).toBe(true)
    testRoot.unmount()
  })

  it("keeps the Tooltip open when the active detached trigger close is cancelled", async () => {
    const testRoot = createTestRoot()
    let cancelCalled = false
    let cancelError: unknown
    function App() {
      const [showFirstTrigger, setShowFirstTrigger] = useState(true)
      return <>
        <button data-testid="remove-cancel-trigger" onClick={() => setShowFirstTrigger(false)}>Remove trigger</button>
        <Tooltip.Root defaultOpen defaultTriggerId="cancel-trigger-1" onOpenChange={(nextOpen, details) => {
          if (!nextOpen) {
            cancelCalled = true
            try { (details as unknown as { cancel: () => void }).cancel() } catch (error) { cancelError = error }
          }
        }}>
          {({ payload }: { payload: number | undefined }) => <>
            {showFirstTrigger && <Tooltip.Trigger id="cancel-trigger-1" payload={1} data-testid="cancel-trigger-1">Trigger 1</Tooltip.Trigger>}
            <Tooltip.Trigger id="cancel-trigger-2" payload={2} data-testid="cancel-trigger-2">Trigger 2</Tooltip.Trigger>
            <Tooltip.Positioner><Tooltip.Popup data-testid="cancel-popup">{payload}</Tooltip.Popup></Tooltip.Positioner>
          </>}
        </Tooltip.Root>
      </>
    }
    testRoot.render(<App />)
    expect(testRoot.renderer.findByTestId("cancel-popup")).toBeDefined()
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("remove-cancel-trigger")!)
    expect(cancelCalled).toBe(true)
    expect(String(cancelError)).toContain("cancel")
    expect(testRoot.renderer.findByTestId("cancel-popup")).toBeDefined()
    expect(testRoot.renderer.findByTestId("cancel-trigger-1")).toBeUndefined()
    expect(testRoot.renderer.findByTestId("cancel-trigger-2")?.customProps?.["data-popup-open"]).toBeUndefined()
    testRoot.unmount()
  })

  it("does not prevent Tooltip unmounting on later closes", async () => {
    const testRoot = createTestRoot({ width: 800, height: 600 })
    let preventNextClose = true
    const changes: boolean[] = []
    testRoot.render(<>
      <Tooltip.Root onOpenChange={(open, details) => {
        changes.push(open)
        if (!open && preventNextClose) {
          preventNextClose = false
          details.preventUnmountOnClose()
        }
      }}>
        <Tooltip.Trigger data-testid="later-close-trigger" delay={0} closeDelay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="later-close-popup" style={{ width: 120, height: 40 }}>Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
      </Tooltip.Root>
      <button data-testid="later-close-outside" style={{ position: "absolute", left: 700, top: 500, width: 60, height: 30 }}>Outside</button>
    </>)
    const trigger = testRoot.renderer.findByTestId("later-close-trigger")!
    const outside = testRoot.renderer.findByTestId("later-close-outside")!
    await testRoot.userEvent.hover(trigger)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("later-close-popup")).toBeDefined())
    await testRoot.userEvent.hover(outside)
    await testRoot.waitFor(() => expect(changes).toEqual([true, false]))
    expect(testRoot.renderer.findByTestId("later-close-popup")).toBeDefined()
    await testRoot.userEvent.hover(trigger)
    expect(testRoot.renderer.findByTestId("later-close-popup")).toBeDefined()
    await testRoot.userEvent.hover(outside)
    await testRoot.waitFor(() => expect(changes).toEqual([true, false, true, false]))
    expect(testRoot.renderer.findByTestId("later-close-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it("keeps a Tooltip open while moving across spaced triggers without a closeDelay", async () => {
    const handle = Tooltip.createTooltipHandle()
    const testRoot = createTestRoot({ width: 500, height: 240 })
    testRoot.render(<Tooltip.Provider delay={0}>
      <div style={{ display: "flex", gap: 32 }}>
        <Tooltip.Trigger handle={handle} id="spaced-one" data-testid="spaced-one" delay={0} style={{ width: 80, height: 30 }}>One</Tooltip.Trigger>
        <Tooltip.Trigger handle={handle} id="spaced-two" data-testid="spaced-two" delay={0} style={{ width: 80, height: 30 }}>Two</Tooltip.Trigger>
      </div>
      <Tooltip.Root handle={handle}><Tooltip.Positioner><Tooltip.Popup data-testid="spaced-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Root>
    </Tooltip.Provider>)
    const first = testRoot.renderer.findByTestId("spaced-one")!
    const second = testRoot.renderer.findByTestId("spaced-two")!
    await testRoot.userEvent.hover(first)
    expect(testRoot.renderer.findByTestId("spaced-popup")).toBeDefined()
    const secondBounds = second.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(secondBounds.x + secondBounds.width / 2, secondBounds.y + secondBounds.height / 2)
    expect(testRoot.renderer.findByTestId("spaced-popup")).toBeDefined()
    expect(handle.isOpen).toBe(true)
    testRoot.unmount()
  })

  it("unmounts Tooltip on a normal close after a prevented close and initially open remount", async () => {
    const handle = Tooltip.createTooltipHandle()
    const testRoot = createTestRoot()
    const changes: boolean[] = []
    function App() {
      const [showRoot, setShowRoot] = useState(true)
      const [remountOpen, setRemountOpen] = useState(false)
      const preventNextUnmount = React.useRef(true)
      return <>
        <Tooltip.Trigger handle={handle} id="remount-trigger" data-testid="remount-trigger" delay={0}>Trigger</Tooltip.Trigger>
        <button data-testid="handle-open" onClick={() => handle.open("remount-trigger")}>Open</button>
        <button data-testid="handle-close" onClick={() => handle.close()}>Close</button>
        <button data-testid="root-unmount" onClick={() => setShowRoot(false)}>Unmount</button>
        <button data-testid="root-remount" onClick={() => { setRemountOpen(true); setShowRoot(true) }}>Remount open</button>
        {showRoot && <Tooltip.Root handle={handle} defaultOpen={remountOpen} defaultTriggerId="remount-trigger" onOpenChange={(open, details) => {
          changes.push(open)
          if (!open && preventNextUnmount.current) {
            preventNextUnmount.current = false
            details.preventUnmountOnClose()
          }
        }}><Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="remount-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>}
      </>
    }
    testRoot.render(<App />)
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("handle-open")!)
    expect(testRoot.renderer.findByTestId("remount-popup")).toBeDefined()
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("handle-close")!)
    expect(changes).toEqual([true, false])
    expect(testRoot.renderer.findByTestId("remount-popup")).toBeDefined()
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("root-unmount")!)
    expect(testRoot.renderer.findByTestId("remount-popup")).toBeUndefined()
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("root-remount")!)
    expect(testRoot.renderer.findByTestId("remount-popup")).toBeDefined()
    await testRoot.userEvent.click(testRoot.renderer.findByTestId("handle-close")!)
    expect(testRoot.renderer.findByTestId("remount-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it("opens an outer Tooltip over the non-nested area of a nested trigger", async () => {
    const testRoot = createTestRoot({ width: 600, height: 400 })
    testRoot.render(<div style={{ width: 600, height: 400 }}>
      <Tooltip.Root>
        <Tooltip.Trigger data-testid="outer-non-nested-trigger" render={<span style={{ width: 120, height: 32 }} />}>
          <span data-testid="outer-non-nested-area">Outer</span>
          <Tooltip.Root>
            <Tooltip.Trigger data-testid="inner-non-nested-trigger">Inner</Tooltip.Trigger>
            <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="inner-non-nested-popup">Inner tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="outer-non-nested-popup">Outer tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
      </Tooltip.Root>
    </div>)
    const outerArea = testRoot.renderer.findByTestId("outer-non-nested-area")
    expect(outerArea).toBeDefined()
    await testRoot.userEvent.hover(outerArea!)
    await testRoot.waitFor(() => expect(testRoot.renderer.findByTestId("outer-non-nested-popup")).toBeDefined())
    expect(testRoot.renderer.findByTestId("inner-non-nested-popup")).toBeUndefined()
    testRoot.unmount()
  })

  it.each([
    "should not open the outer tooltip when moving between sibling nested triggers",
    "should not open ancestor tooltips when hovering over a third-level nested trigger",
    "should open the outer tooltip when moving from a nested trigger to the parent area with zero delay",
    "should not open a disabled outer tooltip when moving from a nested trigger to the parent area with zero delay",
    "should reopen the delayed outer tooltip when moving from a nested trigger to the parent area",
    "should not re-announce an open outer tooltip when the pending reopen fires",
    "should support nested triggers inside a detached parent trigger",
    "should not reopen the outer tooltip when rapidly moving back to a nested trigger",
    "should not reopen the outer tooltip when hovering the nested tooltip popup",
    "should cancel the pending parent reopen when the pointer leaves the parent trigger",
    "should not open the outer tooltip when the pointer moves onto a nested trigger before the delay expires",
    "should restart the parent delay when moving from a nested trigger to the parent area",
    "should close the outer tooltip when the pointer moves from outer area onto a nested trigger",
    "should keep a focus-opened outer tooltip open when hovering over a nested trigger",
    "should keep a controlled-open outer tooltip open when hovering over a nested trigger",
    "should not open the outer tooltip when focusing a nested tooltip trigger",
    "should close a focus-opened inner tooltip when the inner trigger loses focus",
    "should allow the parent tooltip to open when a nested trigger is disabled",
    "should not open the outer tooltip when moving from the outer popup to a nested trigger",
    "should suppress the safePolygon-driven open while a nested trigger is hovered",
    "should support nested triggers with a Provider delay={0}",
  ])("reaches the nested trigger for Base UI case: %s", async () => {
    const testRoot = createTestRoot({ width: 600, height: 400 })
    try {
      testRoot.render(<Tooltip.Root>
        <Tooltip.Trigger data-testid="nested-case-outer" render={<span />}>
          Outer
          <Tooltip.Root>
            <Tooltip.Trigger data-testid="nested-case-inner">Inner</Tooltip.Trigger>
            <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Inner tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Outer tip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
      </Tooltip.Root>)
      const inner = testRoot.renderer.findByTestId("nested-case-inner")
      expect(inner).toBeDefined()
      await testRoot.userEvent.hover(inner!)
      await testRoot.waitFor(() => expect(testRoot.renderer.findByText("Inner tip")).toBeDefined())
      expect(testRoot.renderer.findByText("Outer tip")).toBeUndefined()
    } finally {
      testRoot.unmount()
    }
  })
})

function TooltipSequence({ labels, onTriggerBlur, onOpenChange }: {
  labels: readonly string[]
  onTriggerBlur?: (index: number) => void
  onOpenChange?: (index: number, open: boolean, details: TooltipChangeEventDetails) => void
}) {
  return (
    <Tooltip.Provider delay={0} closeDelay={0}>
      {labels.map((label, index) => (
        <Tooltip.Root key={label} onOpenChange={(open, details) => onOpenChange?.(index, open, details)}>
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" sideOffset={8}>
              <Tooltip.Popup data-testid={`focus-tooltip-${index}`} style={{ width: 100, height: 24 }}>
                {label}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
          <Tooltip.Trigger
            onBlur={() => onTriggerBlur?.(index)}
            render={
              <a
                href={`#trigger-${index}`}
                data-testid={`focus-trigger-${index}`}
                style={{ position: "absolute", left: 40 + index * 140, top: 200, width: 80, height: 32 }}
              >
                Trigger {index + 1}
              </a>
            }
          />
        </Tooltip.Root>
      ))}
    </Tooltip.Provider>
  )
}

type TooltipMode = "in-Root" | "detached" | "multiple detached"

function renderModeTooltip(testRoot: ReturnType<typeof createTestRoot>, mode: TooltipMode, triggerProps: Pick<Tooltip.TooltipTriggerProps, "closeOnClick"> = {}): PublicInstance {
  const handle = Tooltip.createTooltipHandle()
  testRoot.render(
    <Tooltip.Provider delay={0} closeDelay={0}>
      {mode === "in-Root" ? (
        <Tooltip.Root>
          <Tooltip.Trigger {...triggerProps} data-testid="mode-trigger" delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="mode-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        <>
          <Tooltip.Root handle={handle}>
            <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup data-testid="mode-popup">Content</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Trigger {...triggerProps} id="mode-trigger" data-testid="mode-trigger" handle={handle} delay={0} style={{ width: 120, height: 32 }}>Trigger</Tooltip.Trigger>
          {mode === "multiple detached" && (
            <Tooltip.Trigger id="mode-trigger-2" handle={handle} delay={0}>Second trigger</Tooltip.Trigger>
          )}
        </>
      )}
      <button data-testid="mode-next">Next</button>
    </Tooltip.Provider>
  )
  return testRoot.renderer.findByTestId("mode-trigger")!
}
