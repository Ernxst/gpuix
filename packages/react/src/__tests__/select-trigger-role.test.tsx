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

describeNative("SelectTrigger", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("is a combobox that controls its listbox", () => {
    screen.render(<Fruit />)
    const closedTrigger = screen.getByRole("combobox", { name: "Fruit" })
    expect(closedTrigger).not.toHaveAttribute("aria-controls")

    screen.renderer.nativeSimulateClick(30, 25)

    const trigger = screen.getByRole("combobox", { name: "Fruit" })
    const listbox = screen.getByRole("listbox")

    expect(trigger).toHaveAttribute("aria-controls", listbox.authorId)

    const tree = screen.renderer.getAccessibilityTree()
    const triggerNode = Object.values(tree.nodes).find((node) => node.host_id === trigger.id)
    const [listboxTreeId] = Object.entries(tree.nodes).find(
      ([, node]) => node.host_id === listbox.id
    ) ?? []

    expect(triggerNode?.aria.expanded).toBe(true)
    expect(triggerNode?.aria.controls).toEqual([listboxTreeId])
  })

  it("does not expose aria-controls when the open popup has no list", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit" data-testid="trigger">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <div>Popup content</div>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 15)

    expect(screen.getByRole("combobox", { name: "Fruit" })).not.toHaveAttribute("aria-controls")
  })
})
