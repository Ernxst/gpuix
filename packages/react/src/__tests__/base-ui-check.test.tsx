import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Combobox from "../components/combobox"
import * as Dialog from "../components/dialog"
import * as AlertDialog from "../components/alert-dialog"
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

describeNative("Tooltip Base UI wrapper behavior", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("opens when its trigger receives focus", async () => {
    screen.render(
      <Tooltip.Provider delay={0}>
        <Tooltip.Root>
          <Tooltip.Trigger>Copy</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>Copy message</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>,
    )

    await screen.userEvent.tab()
    await screen.waitFor(() => expect(screen.renderer.getAllText()).toContain("Copy message"))
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

describeNative("Dialog Base UI wrapper behavior", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("exposes dialog ARIA attributes", () => {
    screen.render(
      <Dialog.Root defaultOpen>
        <Dialog.Portal>
          <Dialog.Viewport>
            <Dialog.Popup data-testid="dialog-popup">
              <Dialog.Title>Settings</Dialog.Title>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>,
    )

    expect(screen.getByTestId("dialog-popup").customProps?.role).toBe("dialog")
    expect(screen.renderer.getAllText()).toContain("Settings")
  })
})

describeNative("AlertDialog Base UI wrapper behavior", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
  })

  it("exposes alertdialog ARIA attributes", () => {
    screen.render(
      <AlertDialog.Root defaultOpen>
        <AlertDialog.Portal>
          <AlertDialog.Viewport>
            <AlertDialog.Popup data-testid="alert-popup">
              <AlertDialog.Title>Delete this item?</AlertDialog.Title>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>,
    )

    expect(screen.getByTestId("alert-popup").customProps?.role).toBe("alertdialog")
    expect(screen.renderer.getAllText()).toContain("Delete this item?")
  })
})
