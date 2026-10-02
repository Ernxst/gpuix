import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Combobox from "../components/combobox"
import * as Dialog from "../components/dialog"
import * as Select from "../components/select"
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

  it("lets a state className background replace the fallback", () => {
    screen.render(
      <Fruit
        popup={{
          className: (state) => (state.open ? compiled({ backgroundColor: "#123456" }) : undefined),
        }}
      />
    )
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

  it("leaves the page visible outside a rounded popup background", () => {
    const pageColor = [17, 23, 27, 255]

    screen.render(
      <div style={{ width: 304, height: 184, backgroundColor: "#11171b" }}>
        <Select.Root>
          <Select.Trigger data-testid="trigger" ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
            <Select.Value placeholder="Choose" />
          </Select.Trigger>
          <Select.Popup
            data-testid="popup"
            className={compiled({
              borderRadius: 8,
              backgroundColor: "#1c2226",
            })}
          >
            <Select.List>
              <Select.Item value="apple">Apple</Select.Item>
            </Select.List>
          </Select.Popup>
        </Select.Root>
      </div>
    )

    const trigger = screen.getByTestId("trigger")
    const triggerBounds = screen.renderer.getElementBounds(trigger.id)!
    screen.renderer.nativeSimulateClick(
      triggerBounds.x + triggerBounds.width / 2,
      triggerBounds.y + triggerBounds.height / 2
    )
    screen.renderer.dispatchNativeEvents()
    screen.renderer.drawPendingFrame()

    const popup = screen.getByTestId("popup")
    const bounds = screen.renderer.getElementBounds(popup.id)!
    const capture = screen.renderer.captureScreenshotRaw()
    const scaleFactor = screen.renderer.getWindowSize().scaleFactor
    const pixelAt = (x: number, y: number) => {
      const deviceX = Math.round(x * scaleFactor)
      const deviceY = Math.round(y * scaleFactor)
      const offset = (deviceY * capture.width + deviceX) * 4
      return [...capture.pixels.subarray(offset, offset + 4)]
    }
    const corners = [
      pixelAt(bounds.x + 1, bounds.y + 1),
      pixelAt(bounds.x + bounds.width - 2, bounds.y + 1),
      pixelAt(bounds.x + 1, bounds.y + bounds.height - 2),
      pixelAt(bounds.x + bounds.width - 2, bounds.y + bounds.height - 2),
    ]

    expect(corners, "rounded popup corner pixels should match page #11171b").toEqual(
      Array.from({ length: 4 }, () => pageColor)
    )
  })

  it("keeps rounded popup corners clear across floating components", () => {
    const popupClass = compiled({
      width: 180,
      height: 96,
      borderRadius: 8,
      backgroundColor: "#1c2226",
      overflow: "auto",
    })
    const readCorners = (id: number) => {
      screen.renderer.drawPendingFrame()
      const bounds = screen.renderer.getElementBounds(id)!
      const capture = screen.renderer.captureScreenshotRaw()
      const scale = screen.renderer.getWindowSize().scaleFactor
      const pixelAt = (x: number, y: number) => {
        const deviceX = Math.round(x * scale)
        const deviceY = Math.round(y * scale)
        const offset = (deviceY * capture.width + deviceX) * 4
        return [...capture.pixels.subarray(offset, offset + 4)]
      }
      return {
        corners: [
          pixelAt(bounds.x + 1, bounds.y + 1),
          pixelAt(bounds.x + bounds.width - 2, bounds.y + 1),
          pixelAt(bounds.x + 1, bounds.y + bounds.height - 2),
          pixelAt(bounds.x + bounds.width - 2, bounds.y + bounds.height - 2),
        ],
        center: pixelAt(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        page: pixelAt(300, 220),
      }
    }
    const page = (children: React.ReactNode) => (
      <div style={{ width: 320, height: 240, padding: 40, backgroundColor: "#11171b" }}>{children}</div>
    )

    screen.render(
      page(
        <Select.Root defaultOpen>
          <Select.Trigger />
          <Select.Popup data-testid="select-probe" className={popupClass}>
            <Select.List><Select.Item value="apple">Apple</Select.Item></Select.List>
          </Select.Popup>
        </Select.Root>
      )
    )
    const selectCorners = readCorners(screen.getByTestId("select-probe").id)

    screen.render(
      page(
        <Combobox.Root defaultOpen items={["Apple"]}>
          <Combobox.Input style={{ width: 180, height: 36, backgroundColor: "#11171b" }} />
          <Combobox.Positioner position={{ x: 100, y: 100 }}>
            <Combobox.Popup data-testid="combobox-probe" className={popupClass}>
              <Combobox.List>{(item) => <Combobox.Item value={item}>{item}</Combobox.Item>}</Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Root>
      )
    )
    const comboboxCorners = readCorners(screen.getByTestId("combobox-probe").id)

    screen.render(
      page(
        <Tooltip.Root defaultOpen>
          <Tooltip.Trigger>Anchor</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner position={{ x: 100, y: 100 }} side="bottom">
              <Tooltip.Popup data-testid="tooltip-probe" className={popupClass}>Tip</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )
    )
    const tooltipCorners = readCorners(screen.getByTestId("tooltip-probe").id)

    screen.render(
      page(
        <Tooltip.Root defaultOpen>
          <Tooltip.Trigger>Anchor</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner position={{ x: 100, y: 100 }} side="bottom">
              <Tooltip.Popup
                data-testid="tooltip-default-probe"
                className={compiled({ width: 180, height: 96, borderRadius: 8, overflow: "auto" })}
              >
                Tip
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )
    )
    const tooltipDefault = readCorners(screen.getByTestId("tooltip-default-probe").id)

    screen.render(
      page(
        <Dialog.Root defaultOpen>
          <Dialog.Portal>
            <Dialog.Backdrop style={{ backgroundColor: "#11171b" }} />
            <Dialog.Viewport>
              <Dialog.Popup data-testid="dialog-probe" className={popupClass}>Dialog</Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )
    )
    const dialogCorners = readCorners(screen.getByTestId("dialog-probe").id)

    screen.render(page(<div data-testid="div-probe" className={popupClass} />))
    const divCorners = readCorners(screen.getByTestId("div-probe").id)
    for (const [component, result] of Object.entries({
      Select: selectCorners,
      Combobox: comboboxCorners,
      Tooltip: tooltipCorners,
      Dialog: dialogCorners,
      div: divCorners,
    })) {
      expect(result.corners, `${component} corner pixels should match page #11171b`).toEqual(
        Array.from({ length: 4 }, () => [17, 23, 27, 255])
      )
    }
    expect(tooltipDefault.corners, "Tooltip corners without a background should match the page").toEqual(
      Array.from({ length: 4 }, () => [17, 23, 27, 255])
    )
    expect(tooltipDefault.center, "Tooltip should keep its #1a1a1a default fill").toEqual([
      26, 26, 26, 255,
    ])
  })

  it.each(["hidden", "visible"] as const)(
    "clips the default surface fill to rounded popup corners with overflow %s",
    (overflow) => {
      screen.render(
        <div style={{ width: 304, height: 184, backgroundColor: "#11171b" }}>
          <Select.Root defaultOpen>
            <Select.Trigger style={{ width: 180, height: 36 }} />
            <Select.Popup
              data-testid="popup"
              className={compiled({ width: 180, height: 96, borderRadius: 8 })}
              style={{ overflow }}
            >
              <Select.List><Select.Item value="apple">Apple</Select.Item></Select.List>
            </Select.Popup>
          </Select.Root>
        </div>
      )

      screen.renderer.drawPendingFrame()
      const popup = screen.getByTestId("popup")
      const bounds = screen.renderer.getElementBounds(popup.id)!
      const capture = screen.renderer.captureScreenshotRaw()
      const scale = screen.renderer.getWindowSize().scaleFactor
      const offset = (x: number, y: number) =>
        (Math.round(y * scale) * capture.width + Math.round(x * scale)) * 4
      const corners = [
        offset(bounds.x + 1, bounds.y + 1),
        offset(bounds.x + bounds.width - 2, bounds.y + 1),
        offset(bounds.x + 1, bounds.y + bounds.height - 2),
        offset(bounds.x + bounds.width - 2, bounds.y + bounds.height - 2),
      ].map((index) => [...capture.pixels.subarray(index, index + 4)])
      const centerIndex = offset(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      const center = [...capture.pixels.subarray(centerIndex, centerIndex + 4)]

      expect(corners, "default #1a1a1a surface corners should reveal page #11171b").toEqual(
        Array.from({ length: 4 }, () => [17, 23, 27, 255])
      )
      expect(center, "popup without its own background should keep the #1a1a1a fallback").toEqual([
        26, 26, 26, 255,
      ])
    }
  )

  it("honours an explicitly transparent background instead of the fallback", () => {
    screen.render(<Fruit popup={{ style: { width: 180, backgroundColor: "#00000000" } }} />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#00000000",
    })
  })

  it("lets a background shorthand from style replace the fallback", () => {
    screen.render(<Fruit popup={{ style: { width: 180, background: "#123456" } }} />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      background: "#123456",
    })
  })

  it("lets a compiled class background shorthand replace the fallback", () => {
    screen.render(<Fruit popup={{ className: compiled({ background: "#123456" }) }} />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      background: "#123456",
    })
  })

  it("lets a compiled class state background show on hover", () => {
    screen.render(
      <div style={{ width: 400, height: 400, backgroundColor: "#11171b" }}>
        <Select.Root>
          <Select.Trigger data-testid="trigger" style={{ width: 180, height: 36 }} />
          <Select.Popup
            data-testid="popup"
            className={compiled({
              width: 180,
              height: 96,
              borderRadius: 8,
              hover: { backgroundColor: "#123456" },
            })}
          >
            <Select.List><Select.Item value="apple">Apple</Select.Item></Select.List>
          </Select.Popup>
        </Select.Root>
      </div>
    )
    const trigger = screen.getByTestId("trigger")
    const triggerBounds = screen.renderer.getElementBounds(trigger.id)!
    screen.renderer.nativeSimulateClick(
      triggerBounds.x + triggerBounds.width / 2,
      triggerBounds.y + triggerBounds.height / 2
    )
    screen.renderer.dispatchNativeEvents()
    screen.renderer.drawPendingFrame()

    const popup = screen.getByTestId("popup")
    const bounds = screen.renderer.getElementBounds(popup.id)!
    const readPixel = (x: number, y: number) => {
      const capture = screen.renderer.captureScreenshotRaw()
      const scale = screen.renderer.getWindowSize().scaleFactor
      const offset = (Math.round(y * scale) * capture.width + Math.round(x * scale)) * 4
      return [...capture.pixels.subarray(offset, offset + 4)]
    }
    expect(readPixel(bounds.x + bounds.width / 2, bounds.y + bounds.height - 8)).toEqual([
      17, 23, 27, 255,
    ])

    screen.renderer.nativeSimulateMouseMove(bounds.x + 2, bounds.y + 2)
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(popup.id)).toMatchObject({
      backgroundColor: "#123456",
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
          <Tooltip.Trigger>Trigger</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup data-testid="popup" className={compiled({ backgroundColor: "#123456" })}>
                Tip
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    )
    screen.renderer.drawPendingFrame()

    expect(screen.renderer.getResolvedStyle(screen.getByTestId("popup").id)).toMatchObject({
      backgroundColor: "#123456",
    })
  })
})
