import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Combobox from "../components/combobox"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends GpuixMatchers<R> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip
const items = Array.from({ length: 14 }, (_, index) => `Resource ${index + 1}`)

describeNative("Combobox scrolled list", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 600 })
  })

  function renderCombobox() {
    screen.render(
      <Combobox.Root defaultOpen items={items}>
        <Combobox.Input data-testid="input" ariaLabel="Resources" />
        <Combobox.Portal>
          <Combobox.Positioner position={{ x: 20, y: 20 }}>
            <Combobox.Popup data-testid="popup" style={{ width: 180, maxHeight: 128, overflowY: "auto" }}>
              <Combobox.List>
                {(item) => <Combobox.Item key={item} value={item} data-testid={item} style={{ height: 32 }}>{item}</Combobox.Item>}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>,
    )
  }

  it("reveals the keyboard-highlighted item in the popup", async () => {
    renderCombobox()

    const input = screen.getByTestId("input").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(input.left + 4, input.top + 4)
    for (let index = 0; index < 10; index += 1) screen.renderer.simulateKeystrokes("down")

    const popup = screen.getByTestId("popup")
    const activeItem = screen.getByTestId("Resource 10")
    await screen.waitFor(() => expect(activeItem).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(activeItem.getBoundingClientRect().bottom).toBeLessThanOrEqual(popup.getBoundingClientRect().bottom))
  })

})
