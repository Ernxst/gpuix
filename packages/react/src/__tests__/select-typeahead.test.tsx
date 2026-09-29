import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Select from "../components/select"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends GpuixMatchers<R> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function Fruit({ popup }: { popup?: Partial<Select.SelectPopupProps> }) {
  return (
    <div data-testid="row" style={{ width: 400, height: 400, padding: 12 }}>
      <Select.Root>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup data-testid="popup" style={{ width: 180 }} {...popup}>
          <Select.List>
            {["Apple", "Banana", "Cherry"].map((item) => (
              <Select.Item key={item} value={item} style={{ height: 32 }}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Root>
    </div>
  )
}

describeNative("Select typeahead", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("highlights the first item starting with a typed letter", () => {
    screen.render(<Fruit />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("c")
    screen.renderer.simulateKeystrokes("enter")

    expect(screen.getByTestId("trigger")).toHaveTextContent("Cherry")
  })
})
