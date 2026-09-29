import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Select from "../components/select"
import * as Combobox from "../components/combobox"
import * as Tooltip from "../components/tooltip"
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

describeNative("SelectPopup background", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("paints the background its className sets", () => {
    screen.render(<Fruit popup={{ className: compiled({ backgroundColor: "#123456" }) }} />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#123456",
    })
  })

  it("keeps an opaque fallback when the popup has no background", () => {
    screen.render(<Fruit />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#1A1A1A",
    })
  })

  it("lets a Combobox popup class set its background", () => {
    screen.render(
      <div style={{ width: 400, height: 400 }}>
        <Combobox.Root defaultOpen items={["Apple"]}>
          <Combobox.Input />
          <Combobox.Popup data-testid="popup" className={compiled({ backgroundColor: "#123456" })}>
            <Combobox.List>{(item) => <Combobox.Item value={item}>{item}</Combobox.Item>}</Combobox.List>
          </Combobox.Popup>
        </Combobox.Root>
      </div>
    )
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#123456",
    })
  })

  it("lets a Tooltip popup class set its background", () => {
    screen.render(
      <div style={{ width: 400, height: 400 }}>
        <Tooltip.Root defaultOpen>
          <Tooltip.Popup data-testid="popup" className={compiled({ backgroundColor: "#123456" })}>
            Tip
          </Tooltip.Popup>
        </Tooltip.Root>
      </div>
    )
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#123456",
    })
  })
})
