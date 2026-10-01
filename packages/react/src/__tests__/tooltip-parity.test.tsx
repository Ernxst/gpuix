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
})
