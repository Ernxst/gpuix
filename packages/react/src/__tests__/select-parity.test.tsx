import React, { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
const items = ["Almond", "Birch", "Cedar", "Dogwood"]

function Menu({
  root = {},
  value = {},
  item = {},
}: {
  root?: Partial<Select.SelectProps<unknown, boolean>>
  value?: Partial<Select.SelectValueProps>
  item?: Partial<Select.SelectItemProps>
}) {
  return (
    <Select.Root {...root}>
      <Select.Trigger data-testid="trigger" ariaLabel="Tree">
        <Select.Value data-testid="value" placeholder="Choose a tree" {...value} />
      </Select.Trigger>
      <Select.Popup data-testid="popup" style={{ width: 180, maxHeight: 160, overflowY: "auto" }}>
        <Select.List>
          {items.map((name) => (
            <Select.Item key={name} value={name} data-testid={name} {...item}>
              <Select.ItemText>{name}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.List>
      </Select.Popup>
    </Select.Root>
  )
}

describeNative("Select Base UI 1.8.0 parity", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 420 })
  })

  function clickTrigger() {
    const rect = screen.getByTestId("trigger").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function clickItem(name: string) {
    const rect = screen.getByTestId(name).getBoundingClientRect()
    screen.renderer.nativeSimulateClick(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  it("selects the item specified by defaultValue", async () => {
    screen.render(<Menu root={{ defaultValue: "Birch" }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByTestId("Birch")).toHaveAttribute("data-selected", ""))
    expect(screen.getByTestId("value")).toHaveTextContent("Birch")
  })

  it("selects the item specified by a controlled value", async () => {
    screen.render(<Menu root={{ value: "Cedar" }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByTestId("Cedar")).toHaveAttribute("data-selected", ""))
    expect(screen.getByTestId("value")).toHaveTextContent("Cedar")
  })

  it("updates the controlled selection when value changes", async () => {
    function App() {
      const [value, setValue] = useState<string | null>("Almond")
      return <><button onClick={() => setValue("Dogwood")}>Change value</button><Menu root={{ value }} /></>
    }
    screen.render(<App />)
    screen.renderer.nativeSimulateClick(12, 12)
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Dogwood"))
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByTestId("Dogwood")).toHaveAttribute("data-selected", ""))
  })

  it("calls onValueChange once with item-press details when an item is clicked", async () => {
    const onValueChange = vi.fn()
    screen.render(<Menu root={{ onValueChange }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("option", { name: "Almond" })).toBeInTheDocument())
    clickItem("Cedar")
    await screen.waitFor(() => expect(onValueChange).toHaveBeenCalledTimes(1))
    expect(onValueChange.mock.calls[0]?.[0]).toBe("Cedar")
    expect(onValueChange.mock.calls[0]?.[1].reason).toBe("item-press")
    expect(screen.getByTestId("value")).toHaveTextContent("Cedar")
  })

  it("commits an uncontrolled selection and closes the popup", async () => {
    screen.render(<Menu />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    clickItem("Birch")
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Birch"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("reports open and Escape close changes", async () => {
    const onOpenChange = vi.fn()
    screen.render(<Menu root={{ onOpenChange }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    screen.renderer.simulateKeystrokes("escape")
    await screen.waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false])
    expect(onOpenChange.mock.calls.map(([, details]) => details.reason)).toEqual(["trigger-press", "escape-key"])
  })

  it("opens by default and closes when an item is selected", async () => {
    screen.render(<Menu root={{ defaultOpen: true }} />)
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    clickItem("Dogwood")
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Dogwood"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("opens with ArrowDown, moves the highlight, and commits with Enter", async () => {
    screen.render(<Menu />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    screen.renderer.simulateKeystrokes("down")
    await screen.waitFor(() => expect(screen.getByTestId("Almond")).toHaveAttribute("data-highlighted", ""))
    screen.renderer.simulateKeystrokes("down")
    await screen.waitFor(() => expect(screen.getByTestId("Birch")).toHaveAttribute("data-highlighted", ""))
    screen.renderer.simulateKeystrokes("enter")
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Birch"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("moves to the first and last items with Home and End", async () => {
    screen.render(<Menu root={{ open: true }} />)
    screen.renderer.simulateKeystrokes("end")
    await screen.waitFor(() => expect(screen.getByTestId("Dogwood")).toHaveAttribute("data-highlighted", ""))
    screen.renderer.simulateKeystrokes("home")
    await screen.waitFor(() => expect(screen.getByTestId("Almond")).toHaveAttribute("data-highlighted", ""))
  })

  it("uses typeahead to highlight and commit a matching item", async () => {
    screen.render(<Menu root={{ open: true }} />)
    screen.renderer.simulateKeystrokes("d")
    await screen.waitFor(() => expect(screen.getByTestId("Dogwood")).toHaveAttribute("data-highlighted", ""))
    screen.renderer.simulateKeystrokes("enter")
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Dogwood"))
  })

  it("closes on Escape without changing the value", async () => {
    screen.render(<Menu root={{ defaultValue: "Almond" }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    screen.renderer.simulateKeystrokes("escape")
    await screen.waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    expect(screen.getByTestId("value")).toHaveTextContent("Almond")
  })

  it("does not open or change value when disabled", async () => {
    const onValueChange = vi.fn()
    screen.render(<Menu root={{ disabled: true, onValueChange }} />)
    clickTrigger()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByTestId("trigger")).toHaveAttribute("data-disabled", "")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("exposes Base UI popup-open and pressed state on the trigger", async () => {
    screen.render(<Menu />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByTestId("trigger")).toHaveAttribute("data-popup-open", ""))
    expect(screen.getByTestId("trigger")).toHaveAttribute("data-pressed", "")
  })

  it("allows browsing in read-only mode but does not commit a selection", async () => {
    const onValueChange = vi.fn()
    screen.render(<Menu root={{ readOnly: true, onValueChange }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    screen.renderer.simulateKeystrokes("d")
    await screen.waitFor(() => expect(screen.getByTestId("Dogwood")).toHaveAttribute("data-highlighted", ""))
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.getByTestId("value")).toHaveTextContent("Choose a tree")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("keeps the popup open while multiple items are selected and toggled", async () => {
    function App() {
      const [value, setValue] = useState<string[]>([])
      return <Menu root={{ multiple: true, value, onValueChange: (next) => setValue(next as string[]) }} />
    }
    screen.render(<App />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    clickItem("Almond")
    await screen.waitFor(() => expect(screen.getByTestId("Almond")).toHaveAttribute("data-selected", ""))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    clickItem("Birch")
    await screen.waitFor(() => expect(screen.getByTestId("Birch")).toHaveAttribute("data-selected", ""))
    expect(screen.getByTestId("value")).toHaveTextContent("Almond, Birch")
    clickItem("Almond")
    await screen.waitFor(() => expect(screen.getByTestId("Almond")).not.toHaveAttribute("data-selected"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByTestId("value")).toHaveTextContent("Birch")
  })

  it("uses items as a label lookup while the popup is closed", async () => {
    screen.render(
      <Select.Root value="cedar" items={{ cedar: "Cedar tree" }}>
        <Select.Trigger data-testid="trigger"><Select.Value data-testid="value" placeholder="Choose" /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="cedar">Cedar tree</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Cedar tree"))
  })

  it("uses the rendered item label when no items lookup is supplied", async () => {
    screen.render(
      <Select.Root value="cedar">
        <Select.Trigger><Select.Value data-testid="value" placeholder="Choose" /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="cedar">Cedar tree</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Cedar tree"))
  })

  it("uses the children callback to render a value-dependent label", async () => {
    screen.render(
      <Select.Root value="cedar">
        <Select.Trigger><Select.Value data-testid="value">{(value) => `Selected ${value}`}</Select.Value></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="cedar">Cedar tree</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Selected cedar"))
  })

  it("updates data-selected and data-highlighted state for the matching items", async () => {
    screen.render(<Menu root={{ defaultValue: "Birch", open: true }} />)
    await screen.waitFor(() => expect(screen.getByTestId("Birch")).toHaveAttribute("data-selected", ""))
    screen.renderer.simulateKeystrokes("down")
    await screen.waitFor(() => expect(screen.getByTestId("Cedar")).toHaveAttribute("data-highlighted", ""))
    expect(screen.getByTestId("Birch")).not.toHaveAttribute("data-highlighted")
  })

  it("renders selected and highlighted state to a function child", async () => {
    screen.render(
      <Select.Root defaultValue="a" open>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List>
          <Select.Item value="a">{({ selected, highlighted }) => `${selected ? "selected" : "not selected"}/${highlighted ? "highlighted" : "not highlighted"}`}</Select.Item>
        </Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByText("selected/highlighted")).toBeInTheDocument())
  })

  it("looks up labels from an items array", async () => {
    screen.render(
      <Select.Root value="cedar" items={[{ value: "cedar", label: "Cedar tree" }]}>
        <Select.Trigger><Select.Value data-testid="value" placeholder="Choose" /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="cedar">Cedar tree</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Cedar tree"))
  })

  it("falls back to the raw value when no item label is known", async () => {
    screen.render(
      <Select.Root value="unknown">
        <Select.Trigger><Select.Value data-testid="value" placeholder="Choose" /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="known">Known</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("unknown"))
  })

  it("gives rendered SelectValue children precedence over the items lookup", async () => {
    screen.render(
      <Select.Root value="cedar" items={{ cedar: "Lookup label" }}>
        <Select.Trigger><Select.Value data-testid="value">Custom label</Select.Value></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="cedar">Cedar tree</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Custom label"))
  })

  it("renders the placeholder for an empty single selection", async () => {
    screen.render(<Menu value={{ placeholder: "Pick one" }} />)
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Pick one"))
    expect(screen.getByTestId("trigger")).toHaveAttribute("data-placeholder", "")
  })

  it("renders comma-separated labels for multiple selected values", async () => {
    screen.render(
      <Select.Root multiple value={["a", "b"]} items={{ a: "Almond", b: "Birch" }}>
        <Select.Trigger><Select.Value data-testid="value" placeholder="Choose" /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="a">A</Select.Item><Select.Item value="b">B</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("Almond, Birch"))
  })

  it("passes the array of selected values to a SelectValue child callback", async () => {
    const seen: unknown[] = []
    screen.render(
      <Select.Root multiple value={["a", "b"]}>
        <Select.Trigger><Select.Value data-testid="value">{(value) => { seen.push(value); return Array.isArray(value) ? `${value.length} selected` : "invalid" }}</Select.Value></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="a">A</Select.Item><Select.Item value="b">B</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("2 selected"))
    expect(seen.at(-1)).toEqual(["a", "b"])
  })

  it("selects object values with the provided equality comparator", async () => {
    const item = { id: 1 }
    const value = { id: 1 }
    screen.render(
      <Select.Root value={value} itemToStringLabel={(candidate) => String(candidate.id)} itemToStringValue={(candidate) => String(candidate.id)} isItemEqualToValue={(candidate, selected) => candidate.id === selected.id}>
        <Select.Trigger data-testid="trigger"><Select.Value>Object value</Select.Value></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value={item} label="One">One</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("option", { name: "One" })).toHaveAttribute("data-selected", ""))
  })

  it("exposes group labels and keeps group items selectable", async () => {
    screen.render(
      <Select.Root open>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List>
          <Select.Group ariaLabel="Conifers" data-testid="group">
            <Select.GroupLabel data-testid="group-label">Conifers</Select.GroupLabel>
            <Select.Item value="cedar" data-testid="cedar">Cedar</Select.Item>
          </Select.Group>
        </Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("group-label")).toHaveTextContent("Conifers"))
    expect(screen.getByTestId("group")).toHaveAttribute("role", "group")
    expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", String(screen.getByTestId("group-label").authorId))
    expect(screen.getByTestId("group-label")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByTestId("cedar")).toHaveAttribute("role", "option")
  })

  it("allows the group label to opt back into the accessibility tree", async () => {
    screen.render(
      <Select.Root open>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List>
          <Select.Group data-testid="group">
          <Select.GroupLabel data-testid="group-label" aria-hidden={undefined}>Conifers</Select.GroupLabel>
          </Select.Group>
        </Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("group-label")).toHaveTextContent("Conifers"))
    expect(screen.getByTestId("group-label")).not.toHaveAttribute("aria-hidden")
  })

  it("requires group labels to be rendered inside Select.Group", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      screen.render(<Select.Root><Select.GroupLabel>Group</Select.GroupLabel></Select.Root>)
      expect(error.mock.calls.flat().join(" ")).toContain("Base UI: SelectGroupContext is missing. SelectGroup parts must be placed within <Select.Group>.")
    } finally {
      error.mockRestore()
    }
  })

  it("clears the group label association when its label unmounts", async () => {
    function App({ label }: { label: boolean }) {
      return <Select.Root open><Select.Trigger><Select.Value /></Select.Trigger><Select.Popup><Select.List><Select.Group data-testid="group">{label && <Select.GroupLabel id="group-label">Conifers</Select.GroupLabel>}</Select.Group></Select.List></Select.Popup></Select.Root>
    }
    screen.render(<App label />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "group-label"))
    screen.render(<App label={false} />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).not.toHaveAttribute("aria-labelledby"))
  })

  it("does not let an older group label cleanup clear a newer label", async () => {
    function App({ labels }: { labels: "old" | "both" | "new" }) {
      return <Select.Root open><Select.Trigger><Select.Value /></Select.Trigger><Select.Popup><Select.List><Select.Group data-testid="group">
        {labels !== "new" && <Select.GroupLabel key="old" id="old-label">Old</Select.GroupLabel>}
        {labels !== "old" && <Select.GroupLabel key="new" id="new-label">New</Select.GroupLabel>}
      </Select.Group></Select.List></Select.Popup></Select.Root>
    }
    screen.render(<App labels="old" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "old-label"))
    screen.render(<App labels="both" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "new-label"))
    screen.render(<App labels="new" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "new-label"))
  })

  it("updates explicit and generated group label ids", async () => {
    function App({ id }: { id?: string }) {
      return <Select.Root open><Select.Trigger><Select.Value /></Select.Trigger><Select.Popup><Select.List><Select.Group data-testid="group"><Select.GroupLabel data-testid="group-label" id={id}>Conifers</Select.GroupLabel></Select.Group></Select.List></Select.Popup></Select.Root>
    }
    screen.render(<App />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby"))
    const generatedId = screen.getByTestId("group-label").authorId
    expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", String(generatedId))
    screen.render(<App id="custom-label" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "custom-label"))
    screen.render(<App />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", String(generatedId)))
  })

  it("registers and unregisters group labels in StrictMode", async () => {
    function App({ id }: { id?: string }) {
      return <React.StrictMode><Select.Root open><Select.Trigger><Select.Value /></Select.Trigger><Select.Popup><Select.List><Select.Group data-testid="group">{id && <Select.GroupLabel key={id} id={id}>{id}</Select.GroupLabel>}</Select.Group></Select.List></Select.Popup></Select.Root></React.StrictMode>
    }
    screen.render(<App id="first-label" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "first-label"))
    screen.render(<App id="second-label" />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", "second-label"))
    screen.render(<App />)
    await screen.waitFor(() => expect(screen.getByTestId("group")).not.toHaveAttribute("aria-labelledby"))
  })

  it("provides selected state to ItemText children", async () => {
    screen.render(
      <Select.Root defaultValue="a" open>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="a"><Select.ItemText data-testid="item-text">{({ selected }) => selected ? "Chosen" : "Unchosen"}</Select.ItemText></Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    await screen.waitFor(() => expect(screen.getByTestId("item-text")).toHaveTextContent("Chosen"))
  })

  it("keeps a disabled item out of the keyboard highlight and selection", async () => {
    const onValueChange = vi.fn()
    screen.render(
      <Select.Root open onValueChange={onValueChange}>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List>
          <Select.Item value="a" disabled data-testid="disabled">Disabled</Select.Item>
          <Select.Item value="b" data-testid="enabled">Enabled</Select.Item>
        </Select.List></Select.Popup>
      </Select.Root>,
    )
    screen.renderer.simulateKeystrokes("down")
    await screen.waitFor(() => expect(screen.getByTestId("enabled")).toHaveAttribute("data-highlighted", ""))
    expect(screen.getByTestId("disabled")).toHaveAttribute("aria-disabled", "true")
    clickItem("disabled")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("treats a null value as an empty selection in multiple mode", async () => {
    const onValueChange = vi.fn()
    screen.render(
      <Select.Root multiple value={null} onValueChange={onValueChange} open>
        <Select.Trigger><Select.Value /></Select.Trigger>
        <Select.Popup><Select.List><Select.Item value="a" data-testid="a">A</Select.Item><Select.Item value="b" data-testid="b">B</Select.Item></Select.List></Select.Popup>
      </Select.Root>,
    )
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-selected")
    clickItem("a")
    await screen.waitFor(() => expect(onValueChange).toHaveBeenCalledWith(["a"], expect.anything()))
  })

  it("keeps selected values when grouped items are reordered and inserted", async () => {
    function App({ names }: { names: string[] }) {
      return <Select.Root defaultValue="cedar" open><Select.Trigger><Select.Value /></Select.Trigger><Select.Popup><Select.List><Select.Group>
        {names.map((name) => <Select.Item key={name} value={name} data-testid={name}>{name}</Select.Item>)}
      </Select.Group></Select.List></Select.Popup></Select.Root>
    }
    screen.render(<App names={["oak", "cedar"]} />)
    await screen.waitFor(() => expect(screen.getByTestId("cedar")).toHaveAttribute("data-selected", ""))
    screen.render(<App names={["fir", "cedar", "oak"]} />)
    await screen.waitFor(() => expect(screen.getByTestId("cedar")).toHaveAttribute("data-selected", ""))
    expect(screen.getByTestId("fir")).not.toHaveAttribute("data-selected")
  })

  it("calls an item click handler exactly once", async () => {
    const onClick = vi.fn()
    screen.render(<Menu item={{ onClick }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("option", { name: "Cedar" })).toBeInTheDocument())
    clickItem("Cedar")
    await screen.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
  })

  it("cancels an uncontrolled open request through event details", async () => {
    screen.render(<Menu root={{ onOpenChange: (open, details) => { if (open) details.cancel() } }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    expect(screen.getByTestId("trigger")).toHaveAttribute("aria-expanded", "false")
  })

  it("calls onOpenChangeComplete after the requested open state is rendered", async () => {
    const completed = vi.fn()
    screen.render(<Menu root={{ onOpenChangeComplete: completed }} />)
    clickTrigger()
    await screen.waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    expect(completed).toHaveBeenCalledWith(true)
  })
})
