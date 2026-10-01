import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Select from "../components/select.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  interface Matchers<R = void> extends GpuixMatchers<R> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Select.Positioner", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 320, height: 240 })
  })

  it("fits at the lower-right window edge and retains its requested alignment", () => {
    let enterEvent: object | undefined
    let itemClickEvent: object | undefined
    let changeEvent: object | undefined
    let cancelNextChange = true
    function Demo() {
      const [open, setOpen] = useState(true)
      const [value, setValue] = useState<string | null>(null)
      return (
        <>
      <Select.Root
        open={open}
        onOpenChange={setOpen}
        value={value}
        onValueChange={(nextValue, details) => {
          changeEvent = details.event
          if (cancelNextChange) {
            details.cancel()
            cancelNextChange = false
          } else {
            setValue(nextValue)
          }
        }}
      >
        <Select.Label data-testid="label">Fruit</Select.Label>
        <Select.Trigger
          data-testid="trigger"
          aria-label="Fruit"
          style={{ position: "absolute", left: 250, top: 190, width: 60, height: 24 }}
        >
          <Select.Value data-testid="value" placeholder="Choose" />
          <Select.Icon data-testid="icon">⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Backdrop data-testid="backdrop" />
          <Select.Positioner
            data-testid="positioner"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionBoundary={{ x: 20, y: 20, width: 280, height: 200 }}
            collisionPadding={8}
            collisionAvoidance={{ side: "flip", align: "flip", fallbackAxisSide: "none" }}
          >
            <Select.Popup
              data-testid="popup"
              style={{ width: 160, height: 100 }}
              render={(props, state) => <div {...props} data-render-side={state.side}>{props.children}</div>}
              onKeyDown={(event) => { if (event.key === "Enter") enterEvent = event }}
            >
              <Select.ScrollUpArrow keepMounted data-testid="scroll-up">↑</Select.ScrollUpArrow>
              <Select.Arrow data-testid="arrow" />
              <Select.List data-testid="list">
                <Select.Group data-testid="group">
                  <Select.GroupLabel data-testid="group-label">Fruit</Select.GroupLabel>
                  <Select.Item data-testid="item" value="apple" label="Apple" onClick={(event) => { itemClickEvent = event }}>
                    <Select.ItemText data-testid="item-text">Apple</Select.ItemText>
                    <Select.ItemIndicator keepMounted data-testid="indicator">✓</Select.ItemIndicator>
                  </Select.Item>
                </Select.Group>
                <Select.Separator data-testid="separator" />
              </Select.List>
              <Select.ScrollDownArrow keepMounted data-testid="scroll-down">↓</Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
          <text data-testid="selected-value">Selected: {value ?? "none"}</text>
          <button
            data-testid="clear"
            style={{ position: "absolute", left: 0, top: 0 }}
            onClick={() => setValue(null)}
          >
            Clear
          </button>
        </>
      )
    }

    screen.render(<Demo />)

    const trigger = screen.getByTestId("trigger").getBoundingClientRect()
    const popup = screen.getByTestId("popup")
    const popupRect = popup.getBoundingClientRect()
    const positioner = screen.getByTestId("positioner")

    for (const part of [
      "label", "trigger", "value", "icon", "backdrop", "positioner", "popup",
      "scroll-up", "arrow", "list", "group", "group-label", "item", "item-text",
      "indicator", "separator", "scroll-down",
    ]) {
      expect(screen.getByTestId(part)).toBeInTheDocument()
    }

    // The native anchored element switches the requested bottom placement to
    // the available side. Its physical result must remain inside the window.
    expect(popupRect.bottom).toBeLessThanOrEqual(trigger.top)
    expect(popupRect.right).toBeLessThanOrEqual(292)
    expect(positioner).toHaveAttribute("data-side", "top")
    expect(positioner).toHaveAttribute("data-align", "end")
    expect(screen.getByTestId("trigger")).toHaveAttribute("data-open", "")
    expect(screen.getByTestId("value")).toHaveAttribute("data-placeholder", "")
    expect(screen.getByTestId("icon")).toHaveAttribute("data-open", "")
    expect(screen.getByTestId("backdrop")).toHaveAttribute("data-open", "")
    expect(popup).toHaveAttribute("data-open", "")
    expect(popup).toHaveAttribute("data-side", "top")
    expect(popup).toHaveAttribute("data-align", "end")
    expect(popup).toHaveAttribute("data-render-side", "top")

    screen.renderer.simulateKeystrokes("down")
    expect(screen.getByTestId("item")).toHaveAttribute("data-highlighted", "")
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.getByTestId("selected-value")).toHaveTextContent("Selected: none")
    expect(changeEvent).toBe(enterEvent)
    expect((changeEvent as { type?: string } | undefined)?.type).toBe("keyDown")

    const itemRect = screen.getByTestId("item").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(itemRect.left + 4, itemRect.top + 4)
    expect(screen.getByTestId("selected-value")).toHaveTextContent("Selected: apple")
    expect(changeEvent).toBe(itemClickEvent)
    expect((changeEvent as { type?: string } | undefined)?.type).toBe("click")

    screen.renderer.nativeSimulateClick(trigger.left + trigger.width / 2, trigger.top + trigger.height / 2)
    expect(screen.getByTestId("item")).toHaveAttribute("data-selected", "")
    expect(screen.getByTestId("indicator")).toHaveAttribute("data-selected", "")

    screen.renderer.nativeSimulateClick(5, 5)
    expect(screen.getByTestId("selected-value")).toHaveTextContent("Selected: none")
  })

  it("flips from the upper-left window edge and reports the resulting placement", () => {
    screen.render(
      <Select.Root defaultOpen>
        <Select.Label>Fruit</Select.Label>
        <Select.Trigger
          data-testid="trigger"
          aria-label="Fruit"
          style={{ position: "absolute", left: 0, top: 0, width: 60, height: 24 }}
        >
          <Select.Value placeholder="Choose" />
          <Select.Icon>⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Backdrop />
          <Select.Positioner data-testid="positioner" side="top" align="start" collisionPadding={8}>
            <Select.Popup data-testid="popup" style={{ width: 140, height: 80 }}>
              <Select.ScrollUpArrow keepMounted>↑</Select.ScrollUpArrow>
              <Select.Arrow />
              <Select.List>
                <Select.Group>
                  <Select.GroupLabel>Fruit</Select.GroupLabel>
                  <Select.Item data-testid="item" value="apple">Apple
                    <Select.ItemText>Apple</Select.ItemText>
                    <Select.ItemIndicator keepMounted>✓</Select.ItemIndicator>
                  </Select.Item>
                </Select.Group>
                <Select.Separator />
              </Select.List>
              <Select.ScrollDownArrow keepMounted>↓</Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    )

    const trigger = screen.getByTestId("trigger").getBoundingClientRect()
    const popup = screen.getByTestId("popup").getBoundingClientRect()
    expect(popup.top).toBeGreaterThanOrEqual(trigger.bottom)
    expect(screen.getByTestId("positioner")).toHaveAttribute("data-side", "bottom")
    expect(screen.getByTestId("positioner")).toHaveAttribute("data-align", "start")
    expect(screen.getByTestId("popup")).toHaveAttribute("data-side", "bottom")
    expect(screen.getByTestId("popup")).toHaveAttribute("data-align", "start")
  })
})
