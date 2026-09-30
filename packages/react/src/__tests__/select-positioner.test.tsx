import React from "react"
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
    screen.render(
      <Select.Root open>
        <Select.Trigger
          data-testid="trigger"
          aria-label="Fruit"
          style={{ position: "absolute", left: 250, top: 190, width: 60, height: 24 }}
        >
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            data-testid="positioner"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionBoundary={{ x: 0, y: 0, width: 320, height: 240 }}
            collisionPadding={8}
            collisionAvoidance={{ side: "flip", align: "flip", fallbackAxisSide: "none" }}
          >
            <Select.Popup data-testid="popup" style={{ width: 160, height: 100 }}>
              <Select.List>
                <Select.Item value="apple">Apple</Select.Item>
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>,
    )

    const trigger = screen.getByTestId("trigger").getBoundingClientRect()
    const popup = screen.getByTestId("popup")
    const popupRect = popup.getBoundingClientRect()
    const positioner = screen.getByTestId("positioner")

    // The native anchored element switches the requested bottom placement to
    // the available side. Its physical result must remain inside the window.
    expect(popupRect.bottom).toBeLessThanOrEqual(trigger.top)
    expect(popupRect.right).toBeLessThanOrEqual(320)
    expect(positioner).toHaveAttribute("data-side", "top")
    expect(positioner).toHaveAttribute("data-align", "end")
  })
})
