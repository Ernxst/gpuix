import React from "react"
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

function Fruit({ popup, readOnly = false }: { popup?: Partial<Select.SelectPopupProps>; readOnly?: boolean }) {
  return (
    <div data-testid="row" style={{ width: 400, height: 400, padding: 12 }}>
      <Select.Root readOnly={readOnly}>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup data-testid="popup" style={{ width: 180 }} {...popup}>
          <Select.List>
            {["Apple", "Banana", "Cherry"].map((item) => (
              <Select.Item key={item} value={item} data-testid={item} style={({ highlighted }) => ({ color: highlighted ? "red" : "blue", height: 32 })}>
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
    expect(screen.getByTestId("Cherry").style.color).toBe("red")
    expect(screen.getByTestId("trigger")).toHaveTextContent("Choose")
    screen.renderer.simulateKeystrokes("enter")

    expect(screen.getByTestId("trigger")).toHaveTextContent("Cherry")
  })

  it("commits a matching item when typeahead runs while closed", () => {
    screen.render(<Fruit />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("escape")
    screen.renderer.simulateKeystrokes("c")

    expect(screen.getByTestId("trigger")).toHaveTextContent("Cherry")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("skips a disabled first match during typeahead", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <Select.List>
            <Select.Item value="Cherry" disabled data-testid="disabled" style={({ highlighted }) => ({ color: highlighted ? "red" : "blue" })}>
              <Select.ItemText>Cherry</Select.ItemText>
            </Select.Item>
            <Select.Item value="Clementine" data-testid="enabled" style={({ highlighted }) => ({ color: highlighted ? "red" : "blue" })}>
              <Select.ItemText>Clementine</Select.ItemText>
            </Select.Item>
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("c")

    expect(screen.getByTestId("disabled").style.color).toBe("blue")
    expect(screen.getByTestId("enabled").style.color).toBe("red")
  })

  it("cycles repeated initials while the popup is open", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger ariaLabel="Fruit">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <Select.List>
            {["Cherry", "Clementine", "Cucumber"].map((item) => (
              <Select.Item key={item} value={item} data-testid={item} style={({ highlighted }) => ({ color: highlighted ? "red" : "blue" })}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("c")
    expect(screen.getByTestId("Cherry").style.color).toBe("red")
    screen.renderer.simulateKeystrokes("c")
    expect(screen.getByTestId("Clementine").style.color).toBe("red")
    screen.renderer.simulateKeystrokes("c")
    expect(screen.getByTestId("Cucumber").style.color).toBe("red")
  })

  it("supports typeahead while open in read-only mode without changing the value", () => {
    screen.render(<Fruit readOnly />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("c")

    expect(screen.getByTestId("Cherry").style.color).toBe("red")
    expect(screen.getByTestId("trigger")).toHaveTextContent("Choose")
  })

  it("allows browsing a read-only Select but blocks click and keyboard commits", () => {
    const onValueChange = vi.fn()
    screen.render(
      <Select.Root readOnly onValueChange={onValueChange}>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit" style={{ width: 180, height: 36 }}>
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup style={{ width: 180 }}>
          <Select.List>
            <Select.Item value="Apple" data-testid="Apple" style={{ height: 32 }}>Apple</Select.Item>
            <Select.Item value="Banana" data-testid="Banana" style={{ height: 32 }}>Banana</Select.Item>
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("down")
    expect(screen.getByTestId("Apple")).toHaveAttribute("data-highlighted", "")
    screen.renderer.simulateKeystrokes("enter")
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("trigger")).toHaveTextContent("Choose")

    const banana = screen.getByTestId("Banana").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(banana.left + 4, banana.top + 4)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("trigger")).toHaveTextContent("Choose")
  })

  it("updates hover highlighting when the Root prop changes after mount", () => {
    function Demo() {
      const [highlightItemOnHover, setHighlightItemOnHover] = React.useState(true)
      return (
        <>
          <Select.Root defaultOpen highlightItemOnHover={highlightItemOnHover}>
            <Select.Trigger ariaLabel="Fruit"><Select.Value placeholder="Choose" /></Select.Trigger>
            <Select.Popup>
              <Select.List>
                <Select.Item value="Apple" data-testid="Apple" style={{ height: 32 }}>Apple</Select.Item>
                <Select.Item value="Banana" data-testid="Banana" style={{ height: 32 }}>Banana</Select.Item>
              </Select.List>
              <button data-testid="toggle" onClick={() => setHighlightItemOnHover((enabled) => !enabled)}>Toggle hover</button>
            </Select.Popup>
          </Select.Root>
        </>
      )
    }

    screen.render(<Demo />)
    const apple = screen.getByTestId("Apple").getBoundingClientRect()
    screen.renderer.nativeSimulateMouseMove(apple.left + 4, apple.top + 4)
    expect(screen.getByTestId("Apple")).toHaveAttribute("data-highlighted", "")

    const toggle = screen.getByTestId("toggle").getBoundingClientRect()
    screen.renderer.nativeSimulateClick(toggle.left + 4, toggle.top + 4)
    const banana = screen.getByTestId("Banana").getBoundingClientRect()
    screen.renderer.nativeSimulateMouseMove(2, 2)
    screen.renderer.nativeSimulateMouseMove(banana.left + 4, banana.top + 4)
    expect(screen.getByTestId("Banana")).not.toHaveAttribute("data-highlighted")

    screen.renderer.nativeSimulateClick(toggle.left + 4, toggle.top + 4)
    screen.renderer.nativeSimulateMouseMove(2, 2)
    screen.renderer.nativeSimulateMouseMove(banana.left + 4, banana.top + 4)
    expect(screen.getByTestId("Banana")).toHaveAttribute("data-highlighted", "")
  })

  it("does not select by typeahead while closed in read-only mode", () => {
    screen.render(<Fruit readOnly />)
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("escape")
    screen.renderer.simulateKeystrokes("c")

    expect(screen.getByTestId("trigger")).toHaveTextContent("Choose")
  })

  it("resets an unmatched multi-character prefix before the next initial", () => {
    screen.render(
      <Select.Root>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <Select.List>
            {["Alpha", "Lemon", "Elderberry"].map((item) => (
              <Select.Item key={item} value={item} data-testid={item} style={({ highlighted }) => ({ color: highlighted ? "red" : "blue" })}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("a")
    screen.renderer.simulateKeystrokes("x")
    screen.renderer.simulateKeystrokes("l")
    screen.renderer.simulateKeystrokes("e")

    expect(screen.getByTestId("Lemon").style.color).toBe("red")
    expect(screen.getByTestId("Elderberry").style.color).toBe("blue")
  })

  it("uses Base UI's 750 ms typeahead buffer timeout", () => {
    let now = 10_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    screen.render(
      <Select.Root>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <Select.List>
            {["Cranberry", "Clementine", "Lemon"].map((item) => (
              <Select.Item key={item} value={item} data-testid={item} style={({ highlighted }) => ({ color: highlighted ? "red" : "blue" })}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("c")
    now += 749
    screen.renderer.simulateKeystrokes("l")
    expect(screen.getByTestId("Clementine").style.color).toBe("red")

    now += 751
    screen.renderer.simulateKeystrokes("l")
    expect(screen.getByTestId("Lemon").style.color).toBe("red")
  })

  it("cycles closed typeahead from the selected item for repeated initials", () => {
    screen.render(
      <Select.Root defaultValue="Banana">
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit">
          <Select.Value placeholder="Choose" />
        </Select.Trigger>
        <Select.Popup>
          <Select.List>
            {["Banana", "Blueberry", "Blackcurrant"].map((item) => (
              <Select.Item key={item} value={item}>
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Root>
    )
    screen.renderer.nativeSimulateClick(30, 25)
    screen.renderer.simulateKeystrokes("escape")
    screen.renderer.simulateKeystrokes("b")
    screen.renderer.simulateKeystrokes("b")

    expect(screen.getByTestId("trigger")).toHaveTextContent("Blackcurrant")
  })
})
