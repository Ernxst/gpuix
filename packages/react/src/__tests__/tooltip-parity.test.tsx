import React, { useState } from "react"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as Tooltip from "../components/tooltip.js"
import type { TooltipChangeEventDetails } from "../components/tooltip.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"
import { expectScreenshotsEqual, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Tooltip Base UI parity tree", () => {
  it("closes a focus-opened tooltip when Tab moves to a non-tooltip button", async () => {
    const testRoot = createTestRoot()
    const blurredTriggers: string[] = []

    testRoot.render(
      <>
        <Tooltip.Root>
          <Tooltip.Trigger onBlur={() => blurredTriggers.push("Map")}>Map</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>Map tooltip</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
        <button type="button" data-testid="next-button">Next</button>
      </>
    )

    await testRoot.userEvent.tab()
    expect(testRoot.renderer.findByText("Map tooltip")).toBeDefined()

    await testRoot.userEvent.tab()
    const tree = testRoot.renderer.getAccessibilityTree()
    const nextButton = Object.entries(tree.nodes).find(([, node]) => node.aria.label === "Next")
    expect(tree.gpui_focus).toBe(nextButton?.[0])
    expect(blurredTriggers).toEqual(["Map"])
    expect(testRoot.renderer.findByText("Map tooltip")).toBeUndefined()

    const closedScreenshot = path.join(SHOTS_DIR, "tooltip-focus-leave-closed.png")
    testRoot.renderer.captureScreenshot(closedScreenshot)
    const reference = createTestRoot()
    reference.render(
      <>
        <Tooltip.Root>
          <Tooltip.Trigger>Map</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>Map tooltip</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
        <button type="button" data-testid="next-button">Next</button>
      </>
    )
    const referenceNextButton = reference.renderer.findByTestId("next-button")!
    reference.renderer.focusElement(referenceNextButton.id)
    const referenceScreenshot = path.join(SHOTS_DIR, "tooltip-focus-leave-reference.png")
    reference.renderer.captureScreenshot(referenceScreenshot)
    expectScreenshotsEqual(closedScreenshot, referenceScreenshot)
    reference.unmount()
    testRoot.render(null)
  })

  it("closes a focus-opened tooltip before focus reaches another provider tooltip", async () => {
    const testRoot = createTestRoot()

    testRoot.render(
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger>First</Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>First tooltip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
        </Tooltip.Root>
        <button type="button">Outside</button>
        <Tooltip.Root>
          <Tooltip.Trigger>Last</Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Last tooltip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    await testRoot.userEvent.tab()
    expect(testRoot.renderer.findByText("First tooltip")).toBeDefined()
    await testRoot.userEvent.tab()
    const tree = testRoot.renderer.getAccessibilityTree()
    const outsideButton = Object.entries(tree.nodes).find(([, node]) => node.aria.label === "Outside")
    expect(tree.gpui_focus).toBe(outsideButton?.[0])
    expect(testRoot.renderer.findByText("First tooltip")).toBeUndefined()
    testRoot.unmount()
  })

  it("closes a rendered trigger's focus-opened tooltip on Shift+Tab despite closeDelay", async () => {
    const testRoot = createTestRoot()

    testRoot.render(
      <Tooltip.Provider closeDelay={500}>
        <button type="button">Before</button>
        <Tooltip.Root>
          <Tooltip.Trigger render={<button type="button">Map</button>} />
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>Map tooltip</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    )

    await testRoot.userEvent.tab()
    await testRoot.userEvent.tab()
    expect(testRoot.renderer.findByText("Map tooltip")).toBeDefined()

    await testRoot.userEvent.tab({ shift: true })
    const tree = testRoot.renderer.getAccessibilityTree()
    const beforeButton = Object.entries(tree.nodes).find(([, node]) => node.aria.label === "Before")
    expect(tree.gpui_focus).toBe(beforeButton?.[0])
    expect(testRoot.renderer.findByText("Map tooltip")).toBeUndefined()
    testRoot.unmount()
  })

  it("closes a detached Handle's focus-opened tooltip immediately on blur", () => {
    const testRoot = createTestRoot()
    const handle = Tooltip.createTooltipHandle()
    let trigger: PublicInstance | null = null
    let next: PublicInstance | null = null

    testRoot.render(
      <Tooltip.Provider closeDelay={500}>
        <Tooltip.Root handle={handle}>
          <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Handle tooltip</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
        </Tooltip.Root>
        <Tooltip.Trigger handle={handle} ref={(instance) => { trigger = instance }}>Map</Tooltip.Trigger>
        <button ref={(instance) => { next = instance }} type="button">Next</button>
      </Tooltip.Provider>
    )

    testRoot.renderer.focusElement(trigger!.id)
    expect(testRoot.renderer.findByText("Handle tooltip")).toBeDefined()
    testRoot.renderer.focusElement(next!.id)
    expect(testRoot.renderer.findByText("Handle tooltip")).toBeUndefined()
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
        [0, "trigger-focus", expect.anything()],
        [1, "trigger-focus", expect.anything()],
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
