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

function compiled(style: Record<string, unknown>) {
  return Object.defineProperty({ ...style }, Symbol.for("gpuix.compiledStyle"), {
    value: true,
  }) as unknown as string
}

describeNative("SelectItem className", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("resolves a className function against the item's state", () => {
    const plain = compiled({ height: 32, backgroundColor: "#111111" })
    const highlighted = compiled({ height: 32, backgroundColor: "#222222" })

    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup style={{ width: 180 }}>
          <Select.List>
            <Select.Item
              data-testid="apple"
              value="Apple"
              className={(state: Select.SelectItemState) => (state.highlighted ? highlighted : plain)}
            >
              <Select.ItemText>Apple</Select.ItemText>
            </Select.Item>
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 15)
    screen.renderer.simulateKeystrokes("down")
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("apple").id)).toMatchObject({
      backgroundColor: "#222222",
    })
  })

  it("resolves a trigger className function against its open state", () => {
    const plain = compiled({ backgroundColor: "#111111" })
    const open = compiled({ backgroundColor: "#222222" })

    screen.render(
      <Select.Root>
        <Select.Trigger
          data-testid="trigger"
          ariaLabel="Fruit"
          style={{ width: 180, height: 36 }}
          className={(state: Select.SelectTriggerState) => (state.open ? open : plain)}
        >
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="Apple">Apple</Select.Item></Select.List></Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 15)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("trigger").id)).toMatchObject({
      backgroundColor: "#222222",
    })
  })
})
