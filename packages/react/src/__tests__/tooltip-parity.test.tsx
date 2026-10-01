import React, { useState } from "react"
import { describe, expect, it } from "vitest"
import * as Tooltip from "../components/tooltip.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Tooltip Base UI parity tree", () => {
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

    await new Promise((resolve) => setTimeout(resolve, 55))
    expect(testRoot.renderer.getAllText()).toContain("Copy message")
    expect(changes.at(-1)).toEqual({ open: true, reason: "trigger-hover" })

    const popup = testRoot.renderer.findByTestId("tooltip-popup")!
    expect(popup.customProps?.["data-side"]).toBe("bottom")
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(triggerBounds.bottom)
    expect(testRoot.renderer.findByTestId("arrow")).toBeDefined()

    testRoot.renderer.nativeSimulateMouseMove(380, 260)
    expect(testRoot.renderer.getAllText()).toContain("Copy message")
    await new Promise((resolve) => setTimeout(resolve, 90))
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
    await new Promise((resolve) => setTimeout(resolve, 10))

    const popup = testRoot.renderer.findByTestId("multiple-trigger-popup")!
    expect(lastChangeTrigger).toBe(first)
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(firstBounds.top)
    testRoot.render(null)
  })
})
