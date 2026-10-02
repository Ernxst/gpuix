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
const items = Array.from({ length: 14 }, (_, index) => `Resource ${index + 1}`)

function ScrolledSelect({
  multiple = false,
  onValueChange,
}: {
  multiple?: boolean
  onValueChange?: (value: unknown) => void
}) {
  return (
    <Select.Root multiple={multiple} onValueChange={onValueChange}>
      <Select.Trigger data-testid="trigger" ariaLabel="Resources" style={{ position: "absolute", left: 140, top: 540, width: 180, height: 36 }}>
        <Select.Value placeholder="All resources" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" align="center" alignItemWithTrigger={false}>
          <Select.Popup data-testid="popup" style={{ width: 180, maxHeight: 320, overflowY: "auto", padding: 8 }}>
            <Select.List>
              {items.map((item) => (
                <Select.Item key={item} value={item} data-testid={item} style={{ height: 32 }}>
                  <Select.ItemText>{item}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

function ScrolledNativeList() {
  const [hovered, setHovered] = React.useState<string | null>(null)
  return (
    <div data-testid="plain-popup" style={{ position: "absolute", left: 140, top: 40, width: 180, height: 320, overflowY: "auto" }}>
      {items.map((item) => (
        <div key={item} data-testid={`plain-${item}`} data-highlighted={hovered === item ? "" : undefined} onMouseEnter={() => setHovered(item)} style={{ height: 32 }}>
          {item}
        </div>
      ))}
    </div>
  )
}

describeNative("Select scrolled list", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 600 })
  })

  function openSelect() {
    const trigger = screen.getByTestId("trigger").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(trigger.left + 20, trigger.top + 18)
  }

  it("highlights the row under the pointer after scrolling by two rows", async () => {
    screen.render(<ScrolledSelect multiple />)
    openSelect()

    const popup = screen.getByTestId("popup")
    screen.renderer.scrollTo(popup.id, 0, -64)
    screen.renderer.drawPendingFrame()

    const target = screen.getByTestId("Resource 8").getBoundingClientRect()
    screen.renderer.nativeSimulateMouseMove(-1, -1)
    screen.renderer.nativeSimulateMouseMove(target.left + 4, target.top + 4)
    await screen.waitFor(() => expect(screen.getByTestId("Resource 8")).toHaveAttribute("data-highlighted", ""))
  })

  it("hit-tests a plain popup list at its scrolled position", () => {
    screen.render(<ScrolledNativeList />)
    const popup = screen.getByTestId("plain-popup")
    screen.renderer.scrollTo(popup.id, 0, -64)
    screen.renderer.drawPendingFrame()
    const target = screen.getByTestId("plain-Resource 8").getBoundingClientRect()
    screen.renderer.nativeSimulateMouseMove(target.left + 4, target.top + 4)
    expect(screen.getByTestId("plain-Resource 8")).toHaveAttribute("data-highlighted", "")
  })

  it("keeps the scroll position fixed while the pointer rests on a visible row", async () => {
    screen.render(<ScrolledSelect multiple />)
    openSelect()

    const popup = screen.getByTestId("popup")
    screen.renderer.scrollTo(popup.id, 0, -64)
    screen.renderer.drawPendingFrame()
    const before = screen.renderer.getScrollMetrics(popup.id)?.[1]
    const target = screen.getByTestId("Resource 10").getBoundingClientRect()
    screen.renderer.nativeSimulateMouseMove(-1, -1)
    screen.renderer.nativeSimulateMouseMove(target.left + 4, target.top + 4)
    await screen.waitFor(() => expect(screen.getByTestId("Resource 10")).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(screen.renderer.getScrollMetrics(popup.id)?.[1]).toBe(before), { timeout: 250 })
  })

  it("reveals Arrow Down, Home, End and typeahead highlights in the list", async () => {
    screen.render(<ScrolledSelect />)
    openSelect()
    const popup = screen.getByTestId("popup")

    for (let index = 0; index < 12; index += 1) screen.renderer.simulateKeystrokes("down")
    await screen.waitFor(() => expect(screen.getByTestId("Resource 12")).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(screen.getByTestId("Resource 12").getBoundingClientRect().bottom).toBeLessThanOrEqual(popup.getBoundingClientRect().bottom))

    // Home, End and typeahead should reveal the item they highlight as well.
    screen.renderer.simulateKeystrokes("home")
    await screen.waitFor(() => expect(screen.getByTestId("Resource 1")).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(screen.getByTestId("Resource 1").getBoundingClientRect().top).toBeGreaterThanOrEqual(popup.getBoundingClientRect().top))

    screen.renderer.simulateKeystrokes("end")
    await screen.waitFor(() => expect(screen.getByTestId("Resource 14")).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(screen.getByTestId("Resource 14").getBoundingClientRect().bottom).toBeLessThanOrEqual(popup.getBoundingClientRect().bottom))

    screen.renderer.simulateKeystrokes("r")
    await screen.waitFor(() => expect(screen.getByTestId("Resource 1")).toHaveAttribute("data-highlighted", ""))
    await screen.waitFor(() => expect(screen.getByTestId("Resource 1").getBoundingClientRect().top).toBeGreaterThanOrEqual(popup.getBoundingClientRect().top))
  })

  it("records a partially clipped row when scrolling rests between row boundaries", () => {
    screen.render(<ScrolledSelect multiple />)
    openSelect()
    const popup = screen.getByTestId("popup")
    screen.renderer.scrollTo(popup.id, 0, -63)

    const bottomRow = screen.getByTestId("Resource 12").getBoundingClientRect()
    const popupBounds = popup.getBoundingClientRect()
    expect((screen.renderer.getScrollMetrics(popup.id)?.[1] ?? 0) % 32).not.toBe(0)
    expect(bottomRow.top).toBeLessThan(popupBounds.bottom)
    expect(bottomRow.bottom).toBeGreaterThan(popupBounds.bottom)
  })

  it("updates a trigger width while the open popup has one measured position per frame", async () => {
    function ResizingSelect() {
      const [selected, setSelected] = React.useState<string[]>([])
      return (
        <Select.Root multiple value={selected} onValueChange={(value) => setSelected(value as string[])}>
          <Select.Trigger data-testid="trigger" ariaLabel="Resources" style={{ position: "absolute", left: 140, top: 540, width: selected.length ? 260 : 140, height: 36 }}>
            <Select.Value placeholder="All resources" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="top" align="center" alignItemWithTrigger={false}>
              <Select.Popup data-testid="popup" style={{ width: 180, maxHeight: 320, overflowY: "auto", padding: 8 }}>
                <Select.List>{items.map((item) => <Select.Item key={item} value={item} data-testid={item} style={{ height: 32 }}>{item}</Select.Item>)}</Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      )
    }

    screen.render(<ResizingSelect />)
    const trigger = screen.getByTestId("trigger").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(trigger.left + 20, trigger.top + 18)
    const popup = screen.getByTestId("popup")
    const firstPosition = popup.getBoundingClientRect().left
    const item = screen.getByTestId("Resource 1").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(item.left + 4, item.top + 4)
    await screen.waitFor(() => expect(screen.getByTestId("trigger").getBoundingClientRect().width).toBe(260))
    const framePositions: number[] = []
    for (let frame = 0; frame < 3; frame += 1) {
      screen.renderer.drawPendingFrame()
      framePositions.push(popup.getBoundingClientRect().left)
    }

    expect(framePositions[0]).toBeGreaterThan(firstPosition)
    expect(framePositions).toEqual([framePositions[0], framePositions[0], framePositions[0]])
  })
})
