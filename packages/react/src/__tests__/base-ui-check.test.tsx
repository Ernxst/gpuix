import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Combobox from "../components/combobox"
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

describeNative("Select Base UI wrapper behavior", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("selects an item and closes when clicked while opened by default", () => {
    const changes: string[] = []
    const openChanges: boolean[] = []
    screen.render(
      <Select.Root
        defaultOpen
        onValueChange={(value) => changes.push(value)}
        onOpenChange={(open) => openChanges.push(open)}
      >
        <Select.Trigger data-testid="trigger">
          <Select.Value placeholder="Choose a fruit" />
        </Select.Trigger>
        <Select.Popup>
          <Select.Item value="apple" data-testid="apple">Apple</Select.Item>
          <Select.Item value="banana">Banana</Select.Item>
        </Select.Popup>
      </Select.Root>,
    )

    const item = screen.getByTestId("apple")
    const bounds = item.getBoundingClientRect()
    screen.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)

    expect(changes).toEqual(["apple"])
    expect(openChanges).toEqual([false])
    expect(screen.renderer.getAllText()).toContain("Apple")
  })
})

describeNative("Combobox documented render functions", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("renders list items from the documented List render function and selects one", () => {
    const selected: string[] = []
    screen.render(
      <Combobox.Root items={["Apple", "Banana"]} onValueChange={(value) => selected.push(String(value))}>
        <Combobox.Input data-testid="input" style={{ width: 180, height: 36 }} />
        <Combobox.Popup>
          <Combobox.List>
            {(item, index) => (
              <Combobox.Item key={item} value={item} data-testid={`item-${index}`}>
                {item}
              </Combobox.Item>
            )}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Root>,
    )

    const input = screen.renderer.findByType("input")[0]!
    screen.renderer.nativeSimulateKeystrokes(input.id, "down")

    expect(screen.getByTestId("item-0")).toHaveTextContent("Apple")
    screen.renderer.nativeSimulateKeystrokes(input.id, "enter")
    expect(selected).toEqual(["Apple"])
  })

  it("renders the selected value supplied to the documented Value function child", () => {
    screen.render(
      <Combobox.Root items={["Apple", "Banana"]} defaultValue="Banana">
        <Combobox.Value>{(value) => `Selected: ${String(value ?? "none")}`}</Combobox.Value>
      </Combobox.Root>,
    )

    expect(screen.renderer.getAllText()).toContain("Selected: Banana")
  })
})
