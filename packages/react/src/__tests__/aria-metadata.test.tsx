/// `aria-haspopup`, `aria-roledescription`, `aria-relevant`, and
/// `<input type="range">`: the ARIA metadata Base UI's triggers, NumberField
/// and Toast emit, and the native range input its Slider thumb renders.

import React, { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { GpuixChangeEvent, GpuixSubmitEvent } from "../reconciler/synthetic-event.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type {
  AriaHasPopup,
  FormPublicInstance,
  InputPublicInstance,
  PublicInstance,
} from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function ariaFor(screen: TestRoot, hostId: number) {
  screen.renderer.drawPendingFrame()
  return Object.values(screen.renderer.getAccessibilityTree().nodes).find(
    (node) => node.host_id === hostId
  )
}

function nodeFor(screen: TestRoot, hostId: number) {
  const node = ariaFor(screen, hostId)
  expect(node, `accessibility node for element ${hostId}`).toBeDefined()
  return node!
}

describeNative("aria-haspopup, aria-roledescription and aria-relevant", () => {
  let screen: TestRoot
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 320 })
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    screen.renderer.dispose()
  })

  it("retains both spellings through set, update and removal without a diagnostic", () => {
    const hyphen = React.createRef<PublicInstance>()
    const camel = React.createRef<PublicInstance>()
    function Fixture({ step }: { step: 0 | 1 | 2 }) {
      const popup = (["menu", "dialog", undefined] as const)[step]
      const description = (["Number field", "Stepper", undefined] as const)[step]
      const relevant = (["additions text", "all", undefined] as const)[step]
      return (
        <div>
          <button
            ref={hyphen}
            aria-haspopup={popup}
            aria-roledescription={description}
            aria-relevant={relevant}
          >
            Hyphen
          </button>
          <button
            ref={camel}
            ariaHasPopup={popup}
            ariaRoleDescription={description}
            ariaRelevant={relevant}
          >
            Camel
          </button>
        </div>
      )
    }

    screen.render(<Fixture step={0} />)
    for (const ref of [hyphen, camel]) {
      expect(ref.current!.getAttribute("aria-haspopup")).toBe("menu")
      expect(ref.current!.getAttribute("aria-roledescription")).toBe("Number field")
      expect(ref.current!.getAttribute("aria-relevant")).toBe("additions text")
    }
    for (const name of ["Hyphen", "Camel"]) {
      const button = screen.getByRole("button", { name })
      expect(button).toHaveAttribute("aria-haspopup", "menu")
      expect(button).toHaveAttribute("aria-roledescription", "Number field")
      expect(button).toHaveAttribute("aria-relevant", "additions text")
    }

    screen.render(<Fixture step={1} />)
    for (const ref of [hyphen, camel]) {
      expect(ref.current!.getAttribute("aria-haspopup")).toBe("dialog")
      expect(ref.current!.getAttribute("aria-roledescription")).toBe("Stepper")
      expect(ref.current!.getAttribute("aria-relevant")).toBe("all")
    }

    screen.render(<Fixture step={2} />)
    for (const ref of [hyphen, camel]) {
      expect(ref.current!.getAttribute("aria-haspopup")).toBeNull()
      expect(ref.current!.getAttribute("aria-roledescription")).toBeNull()
      expect(ref.current!.getAttribute("aria-relevant")).toBeNull()
    }
    for (const name of ["Hyphen", "Camel"]) {
      const button = screen.getByRole("button", { name })
      expect(button).not.toHaveAttribute("aria-haspopup")
      expect(button).not.toHaveAttribute("aria-roledescription")
      expect(button).not.toHaveAttribute("aria-relevant")
    }

    expect(warn).not.toHaveBeenCalled()
    expect(screen.renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("projects aria-haspopup and aria-roledescription and follows updates and removal", () => {
    function Trigger({ popup, description }: { popup?: AriaHasPopup; description?: string }) {
      return (
        <button aria-haspopup={popup} aria-roledescription={description}>
          Open
        </button>
      )
    }

    screen.render(<Trigger popup="menu" description="Menu button" />)
    const button = screen.getByRole("button", { name: "Open" })
    expect(nodeFor(screen, button.id).aria).toMatchObject({
      role: "Button",
      has_popup: "Menu",
      role_description: "Menu button",
    })

    screen.render(<Trigger popup="true" description="Launcher" />)
    expect(nodeFor(screen, button.id).aria).toMatchObject({
      has_popup: "Menu",
      role_description: "Launcher",
    })

    screen.render(<Trigger popup="listbox" />)
    expect(nodeFor(screen, button.id).aria).toMatchObject({ has_popup: "Listbox" })
    expect(nodeFor(screen, button.id).aria).not.toHaveProperty("role_description")

    // `false` declares no popup: valid, retained, and not projected.
    screen.render(<Trigger popup={false} />)
    expect(button).toHaveAttribute("aria-haspopup", "false")
    expect(nodeFor(screen, button.id).aria).not.toHaveProperty("has_popup")

    screen.render(<Trigger />)
    expect(nodeFor(screen, button.id).aria).not.toHaveProperty("has_popup")
    expect(screen.renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("maps every popup token onto AccessKit's", () => {
    const tokens = [
      [true, "Menu"],
      ["menu", "Menu"],
      ["listbox", "Listbox"],
      ["tree", "Tree"],
      ["grid", "Grid"],
      ["dialog", "Dialog"],
    ] as const
    screen.render(
      <div>
        {tokens.map(([token], index) => (
          <div key={index} role="combobox" ariaLabel={`Picker ${index}`} ariaHasPopup={token} />
        ))}
      </div>
    )
    tokens.forEach(([, expected], index) => {
      const combobox = screen.getByRole("combobox", { name: `Picker ${index}` })
      expect(nodeFor(screen, combobox.id).aria.has_popup).toBe(expected)
    })
  })

  it("keeps aria-relevant off the native snapshot of a live region", () => {
    // Base UI's Toast viewport.
    screen.render(
      <div
        role="region"
        aria-live="polite"
        aria-atomic={false}
        aria-relevant="additions text"
        aria-label="Notifications"
        tabIndex={-1}
      />
    )
    const region = screen.getByRole("region", { name: "Notifications" })
    expect(region).toHaveAttribute("aria-relevant", "additions text")
    const aria = nodeFor(screen, region.id).aria
    expect(aria).toMatchObject({ role: "Region", live: "Polite" })
    expect(Object.keys(aria).filter((key) => key.includes("relevant"))).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    expect(screen.renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("reports a popup on a role without one, a malformed token and an empty role description", () => {
    screen.render(
      <div>
        <div data-testid="heading" role="heading" ariaLabel="Title" ariaHasPopup="menu" />
        <div
          data-testid="malformed"
          role="button"
          ariaLabel="Malformed"
          ariaHasPopup={"popover" as unknown as AriaHasPopup}
        />
        <div data-testid="blank" role="button" ariaLabel="Blank" ariaRoleDescription=" " />
        <div data-testid="generic" ariaLabel="Card" ariaRoleDescription="Card" />
      </div>
    )
    const diagnostics = screen.renderer.drainStyleDiagnostics()
    const byTestId = (testId: string) => diagnostics.filter((d) => d.dataTestId === testId)

    expect(byTestId("heading")).toEqual([
      expect.objectContaining({
        property: "ariaHasPopup",
        message: expect.stringContaining(
          "role=Heading does not support ariaHasPopup, so it is omitted from the accessibility tree"
        ),
      }),
    ])
    expect(byTestId("malformed")).toEqual([
      expect.objectContaining({
        property: "ariaHasPopup",
        message: expect.stringContaining('rejected value "popover"'),
      }),
    ])
    expect(byTestId("blank")).toEqual([
      expect.objectContaining({
        property: "ariaRoleDescription",
        message: expect.stringContaining("an empty role description is not exposed"),
      }),
    ])
    expect(byTestId("generic")).toEqual([
      expect.objectContaining({
        property: "ariaRoleDescription",
        message: expect.stringContaining("role=GenericContainer does not support ariaRoleDescription"),
      }),
    ])
    for (const testId of ["heading", "malformed", "blank"]) {
      const element = screen.renderer.findByTestId(testId)!
      const aria = ariaFor(screen, element.id)?.aria
      expect(aria).not.toHaveProperty("has_popup")
      expect(aria).not.toHaveProperty("role_description")
    }
  })

  it("names a Base UI NumberField input's role without a diagnostic", () => {
    // `NumberField.Input` in @base-ui/react 1.8.0.
    screen.render(
      <input
        type="text"
        inputMode="decimal"
        aria-roledescription="Number field"
        aria-label="Amount"
        autoComplete="off"
        defaultValue="3"
      />
    )
    const field = screen.getByRole("textbox", { name: "Amount" })
    expect(field).toHaveAttribute("aria-roledescription", "Number field")
    expect(nodeFor(screen, field.id).aria).toMatchObject({
      role: "TextInput",
      role_description: "Number field",
    })
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("aria-roledescription"))
    expect(screen.renderer.drainStyleDiagnostics()).toEqual([])
  })
})

describeNative("native range inputs", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 320 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  it("is a slider with HTML's default bounds, step and midpoint", () => {
    const ref = React.createRef<InputPublicInstance>()
    screen.render(<input ref={ref} type="range" aria-label="Volume" />)

    const slider = screen.getByRole("slider", { name: "Volume" })
    expect(nodeFor(screen, slider.id).aria).toMatchObject({
      role: "Slider",
      min_numeric_value: 0,
      max_numeric_value: 100,
      numeric_value: 50,
      numeric_value_step: 1,
    })
    expect(ref.current!.value).toBe("50")
    expect(ref.current!.valueAsNumber).toBe(50)
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("sanitizes its value to the bounds and step, as HTML does", () => {
    const ref = React.createRef<InputPublicInstance>()
    function Fixture(props: { min?: string; max?: string; step?: string; value: string }) {
      return <input ref={ref} type="range" aria-label="Level" {...props} onChange={() => {}} />
    }

    screen.render(<Fixture min="10" max="20" step="4" value="17" />)
    // Steps count from min: 10, 14, 18. 17 rounds to 18.
    expect(ref.current!.valueAsNumber).toBe(18)

    screen.render(<Fixture min="10" max="20" step="4" value="99" />)
    // Clamped to 20, which is off-step, so it steps back down to 18.
    expect(ref.current!.valueAsNumber).toBe(18)

    screen.render(<Fixture min="10" max="5" value="7" />)
    // max below min collapses to min.
    expect(ref.current!.valueAsNumber).toBe(10)

    screen.render(<Fixture min="0" max="1" step="any" value="0.37" />)
    expect(ref.current!.valueAsNumber).toBe(0.37)

    screen.render(<Fixture value="not a number" />)
    expect(ref.current!.valueAsNumber).toBe(50)

    const slider = screen.getByRole("slider", { name: "Level" })
    expect(nodeFor(screen, slider.id).aria).toMatchObject({ numeric_value: 50 })
  })

  it("steps on arrow, page, Home and End keys and reports each change", async () => {
    const changes: number[] = []
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <input
        ref={ref}
        type="range"
        aria-label="Speed"
        min="0"
        max="50"
        step="5"
        defaultValue="20"
        onChange={(event: GpuixChangeEvent) => {
          expect(event.value).toBe(String(ref.current!.valueAsNumber))
          changes.push((event.currentTarget as InputPublicInstance).valueAsNumber!)
        }}
      />
    )
    const slider = screen.getByRole("slider", { name: "Speed" })

    await screen.userEvent.keyboard(slider, "right")
    await screen.userEvent.keyboard(slider, "up")
    await screen.userEvent.keyboard(slider, "down")
    await screen.userEvent.keyboard(slider, "left")
    await screen.userEvent.keyboard(slider, "pageup")
    await screen.userEvent.keyboard(slider, "end")
    await screen.userEvent.keyboard(slider, "end")
    await screen.userEvent.keyboard(slider, "home")
    await screen.userEvent.keyboard(slider, "pagedown")

    // Page moves a tenth of the range, at least one step; End at max changes nothing.
    expect(changes).toEqual([25, 30, 25, 20, 25, 50, 0])
    expect(ref.current!.valueAsNumber).toBe(0)
    expect(nodeFor(screen, slider.id).aria.numeric_value).toBe(0)
  })

  it("steps a hundredth of the range under step=any", async () => {
    const values: string[] = []
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <input
        ref={ref}
        type="range"
        aria-label="Opacity"
        min="0"
        max="1"
        step="any"
        defaultValue="0.37"
        onChange={(event: GpuixChangeEvent) => values.push(event.value!)}
      />
    )
    const slider = screen.getByRole("slider", { name: "Opacity" })

    await screen.userEvent.keyboard(slider, "right")
    expect(ref.current!.valueAsNumber).toBe(0.38)
    await screen.userEvent.keyboard(slider, "pageup")
    expect(ref.current!.valueAsNumber).toBe(0.48)

    screen.renderer.nativeSimulateAccessibilityAction(
      nodeFor(screen, slider.id).accesskit_id,
      "decrement"
    )
    screen.renderer.flush()
    expect(ref.current!.valueAsNumber).toBe(0.47)
    expect(values).toEqual(["0.38", "0.48", "0.47"])
    expect(nodeFor(screen, slider.id).aria).toMatchObject({ numeric_value: 0.47 })
    expect(nodeFor(screen, slider.id).aria).not.toHaveProperty("numeric_value_step")
  })

  it("leaves a prevented key and a disabled range alone", async () => {
    const onChange = vi.fn()
    screen.render(
      <div>
        <input
          type="range"
          aria-label="Prevented"
          defaultValue="40"
          onKeyDown={(event) => event.preventDefault()}
          onChange={onChange}
        />
        <input type="range" aria-label="Disabled" defaultValue="40" disabled onChange={onChange} />
      </div>
    )
    const prevented = screen.getByRole("slider", { name: "Prevented" })
    await screen.userEvent.keyboard(prevented, "right")
    expect(nodeFor(screen, prevented.id).aria.numeric_value).toBe(40)

    const disabled = screen.getByRole("slider", { name: "Disabled" })
    expect(nodeFor(screen, disabled.id).aria.on_action ?? []).not.toContain("Increment")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps a controlled range on its value prop unless React accepts the change", async () => {
    const seen: number[] = []
    function Fixture({ accept }: { accept: boolean }) {
      const [value, setValue] = useState(30)
      return (
        <input
          type="range"
          aria-label={accept ? "Accepting" : "Refusing"}
          value={String(value)}
          onChange={(event: GpuixChangeEvent) => {
            const next = (event.currentTarget as InputPublicInstance).valueAsNumber!
            seen.push(next)
            if (accept) setValue(next)
          }}
        />
      )
    }
    screen.render(
      <div>
        <Fixture accept />
        <Fixture accept={false} />
      </div>
    )
    const accepting = screen.getByRole("slider", { name: "Accepting" })
    const refusing = screen.getByRole("slider", { name: "Refusing" })

    await screen.userEvent.keyboard(accepting, "right")
    await screen.userEvent.keyboard(refusing, "right")

    expect(seen).toEqual([31, 31])
    expect(nodeFor(screen, accepting.id).aria.numeric_value).toBe(31)
    expect(nodeFor(screen, refusing.id).aria.numeric_value).toBe(30)
  })

  it("submits and resets with its form", () => {
    const form = React.createRef<FormPublicInstance>()
    const input = React.createRef<InputPublicInstance>()
    const submitted: Array<Array<[string, string]>> = []
    screen.render(
      <form
        ref={form}
        onSubmit={(event: GpuixSubmitEvent) =>
          submitted.push([...event.formData.entries()].map(([k, v]) => [k, String(v)]))
        }
      >
        <input ref={input} type="range" name="volume" aria-label="Volume" defaultValue="20" />
      </form>
    )

    input.current!.value = "70"
    expect(input.current!.valueAsNumber).toBe(70)
    form.current!.requestSubmit()
    form.current!.reset()
    expect(input.current!.valueAsNumber).toBe(20)
    input.current!.valueAsNumber = 1000
    expect(input.current!.value).toBe("100")
    form.current!.requestSubmit()

    expect(submitted).toEqual([[["volume", "70"]], [["volume", "100"]]])
  })

  it("becomes a text editor again when its type changes", () => {
    function Fixture({ range }: { range: boolean }) {
      return <input type={range ? "range" : "text"} aria-label="Field" defaultValue="12" />
    }
    screen.render(<Fixture range />)
    expect(screen.getByRole("slider", { name: "Field" })).toBeDefined()

    screen.render(<Fixture range={false} />)
    expect(screen.queryByRole("slider")).toBeNull()
    const textbox = screen.getByRole("textbox", { name: "Field" })
    expect(nodeFor(screen, textbox.id).aria).not.toHaveProperty("numeric_value")
  })
})

describeNative("Base UI Slider", () => {
  let screen: TestRoot
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 320 })
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    screen.renderer.dispose()
  })

  /**
   * The host tree `Slider.Root > Slider.Control > Slider.Track > Slider.Thumb`
   * renders in @base-ui/react 1.8.0. The thumb's visually hidden
   * `<input type="range">` carries the semantics, and its `onKeyDown` handles
   * and prevents every stepping key itself.
   */
  function BaseUiSlider({ onValue }: { onValue?: (value: number) => void }) {
    const [value, setValue] = useState(40)
    const commit = (next: number) => {
      onValue?.(next)
      setValue(next)
    }
    return (
      <div role="group" aria-labelledby="slider-label">
        <text id="slider-label">Volume</text>
        <div data-orientation="horizontal">
          <div>
            <div style={{ width: `${value}%` }} />
            <div data-index={0}>
              <input
                type="range"
                aria-labelledby="slider-label"
                aria-orientation="horizontal"
                aria-valuenow={value}
                aria-valuetext={`${value}%`}
                aria-roledescription="volume slider"
                min={0}
                max={100}
                step={1}
                value={String(value)}
                onChange={(event: GpuixChangeEvent) =>
                  commit((event.currentTarget as InputPublicInstance).valueAsNumber!)
                }
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                  event.preventDefault()
                  commit(value + (event.key === "ArrowRight" ? 10 : -10))
                }}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  function thumbNode() {
    const slider = screen.getByRole("slider", { name: "Volume" })
    return nodeFor(screen, slider.id)
  }

  it("exposes a slider with its range, value, orientation, value text and actions", () => {
    screen.render(<BaseUiSlider />)

    const node = thumbNode()
    expect(node.aria).toMatchObject({
      role: "Slider",
      label: "Volume",
      value: "40%",
      min_numeric_value: 0,
      max_numeric_value: 100,
      numeric_value: 40,
      numeric_value_step: 1,
      orientation: "Horizontal",
      role_description: "volume slider",
    })
    expect(node.aria.on_action).toEqual(expect.arrayContaining(["Increment", "Decrement"]))
    expect(screen.queryByRole("textbox")).toBeNull()

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("aria-roledescription"))
    expect(
      screen.renderer
        .drainStyleDiagnostics()
        .filter((diagnostic) => diagnostic.property.startsWith("aria"))
    ).toEqual([])
  })

  it("steps on increment and decrement through Base UI's onChange", () => {
    const values: number[] = []
    screen.render(<BaseUiSlider onValue={(value) => values.push(value)} />)

    screen.renderer.nativeSimulateAccessibilityAction(thumbNode().accesskit_id, "increment")
    screen.renderer.flush()
    expect(thumbNode().aria).toMatchObject({ numeric_value: 41, value: "41%" })

    screen.renderer.nativeSimulateAccessibilityAction(thumbNode().accesskit_id, "decrement")
    screen.renderer.nativeSimulateAccessibilityAction(thumbNode().accesskit_id, "decrement")
    screen.renderer.flush()
    expect(thumbNode().aria).toMatchObject({ numeric_value: 39, value: "39%" })
    expect(values).toEqual([41, 40, 39])
  })

  it("lets Base UI's own key handling replace the native step", async () => {
    const values: number[] = []
    screen.render(<BaseUiSlider onValue={(value) => values.push(value)} />)
    const slider = screen.getByRole("slider", { name: "Volume" })

    await screen.userEvent.keyboard(slider, "right")
    expect(values).toEqual([50])
    expect(thumbNode().aria.numeric_value).toBe(50)
  })
})
