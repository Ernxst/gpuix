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

describeNative("Select scroll arrows", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("render only while the list overflows", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup style={{ width: 180 }}>
          <Select.ScrollUpArrow data-testid="up" />
          <Select.List>
            <Select.Item value="Apple">
              <Select.ItemText>Apple</Select.ItemText>
            </Select.Item>
          </Select.List>
          <Select.ScrollDownArrow data-testid="down" />
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 15)

    expect(screen.getByRole("listbox")).toBeVisible()
    expect(screen.queryByTestId("up")).toBeNull()
    expect(screen.queryByTestId("down")).toBeNull()
  })

  it("shows only the arrow for the direction that can still scroll", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup style={{ width: 180 }}>
          <Select.ScrollUpArrow data-testid="up" />
          <Select.List data-testid="list" style={{ maxHeight: 48, overflowY: "scroll" }}>
            {["Apple", "Banana", "Cherry", "Date", "Elderberry"].map((item) => (
              <Select.Item key={item} value={item} style={{ height: 32 }}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
          <Select.ScrollDownArrow data-testid="down" />
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 15)
    screen.renderer.drawPendingFrame()

    expect(screen.queryByTestId("up")).toBeNull()
    expect(screen.getByTestId("down")).toBeVisible()

    screen.renderer.nativeSimulateScrollWheel(30, 70, 0, -100)
    screen.renderer.drawPendingFrame()

    expect(screen.getByTestId("up")).toBeVisible()
    expect(screen.queryByTestId("down")).toBeNull()
  })

  it("updates arrow visibility when the list resizes", () => {
    let downArrowState: Select.SelectArrowState | undefined
    const renderList = (maxHeight: number) => (
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup side="top" style={{ width: 180 }}>
          <Select.ScrollUpArrow data-testid="up" />
          <Select.List data-testid="list" style={{ maxHeight, overflowY: "scroll" }}>
            {["Apple", "Banana", "Cherry", "Date", "Elderberry"].map((item) => (
              <Select.Item key={item} value={item} style={{ height: 32 }}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
          <Select.ScrollDownArrow
            data-testid="down"
            className={(state) => {
              downArrowState = state
              return undefined
            }}
          />
        </Select.Popup>
      </Select.Root>
    )

    screen.render(renderList(48))
    screen.renderer.nativeSimulateClick(30, 15)
    screen.renderer.drawPendingFrame()

    expect(screen.getByTestId("down")).toBeVisible()
    expect(downArrowState).toEqual({
      direction: "down",
      visible: true,
      side: "top",
      transitionStatus: "idle",
    })

    screen.render(renderList(256))
    screen.renderer.drawPendingFrame()
    screen.renderer.drawPendingFrame()
    expect(screen.queryByTestId("up")).toBeNull()
    expect(screen.queryByTestId("down")).toBeNull()

    screen.render(renderList(48))
    screen.renderer.drawPendingFrame()
    expect(screen.getByTestId("down")).toBeVisible()
  })
})
