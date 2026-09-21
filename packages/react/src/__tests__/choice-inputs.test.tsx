/** Native checkbox, radio, and hidden inputs, with their form behaviour. */

import React, { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type TestElement,
  type TestRoot,
} from "../testing.js"
import type { GpuixChangeEvent, GpuixSubmitEvent } from "../reconciler/synthetic-event.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type { FormPublicInstance, InputPublicInstance } from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const BOX = { width: 24, height: 24 }

function isRequired(screen: TestRoot, element: TestElement): boolean {
  screen.renderer.drawPendingFrame()
  return Object.values(screen.renderer.getAccessibilityTree().nodes).some(
    (node) => node.host_id === element.id && node.aria.required === true
  )
}

function entries(data: FormData): Array<[string, string]> {
  return [...data.entries()].map(([name, value]) => [name, String(value)])
}

describeNative("native checkbox inputs", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 320 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  it("toggles an uncontrolled checkbox and reports each change", async () => {
    const changes: Array<boolean | undefined> = []
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <div style={{ padding: 20 }}>
        <input
          ref={ref}
          type="checkbox"
          ariaLabel="Subscribe"
          defaultChecked
          onChange={(event) => changes.push(event.checked)}
          style={BOX}
        />
      </div>
    )

    const checkbox = screen.getByRole("checkbox", { name: "Subscribe" })
    expect(checkbox).toBeChecked()
    expect(ref.current!.checked).toBe(true)

    await screen.userEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(ref.current!.checked).toBe(false)

    await screen.userEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(changes).toEqual([false, true])
  })

  it("keeps a controlled checkbox on its prop unless the change is accepted", async () => {
    const rejected = vi.fn()
    function Controlled({ accept }: { accept: boolean }) {
      const [checked, setChecked] = useState(false)
      return (
        <input
          type="checkbox"
          ariaLabel="Controlled"
          checked={checked}
          onChange={(event) => {
            if (accept) setChecked(event.checked === true)
            else rejected()
          }}
          style={BOX}
        />
      )
    }

    screen.render(<Controlled accept={false} />)
    const checkbox = screen.getByRole("checkbox", { name: "Controlled" })
    await screen.userEvent.click(checkbox)
    expect(rejected).toHaveBeenCalledOnce()
    expect(checkbox).not.toBeChecked()

    screen.render(<Controlled accept />)
    await screen.userEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it("follows a controlled prop changed by the application", () => {
    const render = (checked: boolean) =>
      screen.render(
        <input type="checkbox" ariaLabel="Remote" checked={checked} onChange={() => {}} />
      )
    render(false)
    const checkbox = screen.getByRole("checkbox", { name: "Remote" })
    expect(checkbox).not.toBeChecked()
    render(true)
    expect(checkbox).toBeChecked()
    render(false)
    expect(checkbox).not.toBeChecked()
  })

  it("puts the state back when the click is prevented, after onChange as in ReactDOM", async () => {
    const changes: Array<{ checked?: boolean; prevented?: boolean }> = []
    const change = (event: GpuixChangeEvent) =>
      changes.push({
        checked: event.checked,
        prevented: (event.nativeEvent as { defaultPrevented?: boolean }).defaultPrevented,
      })
    let seen: boolean | undefined
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <input
        ref={ref}
        type="checkbox"
        ariaLabel="Prevented"
        onClick={(event) => {
          seen = ref.current!.checked
          event.preventDefault()
        }}
        onChange={change}
        style={BOX}
      />
    )

    const checkbox = screen.getByRole("checkbox", { name: "Prevented" })
    await screen.userEvent.click(checkbox)
    // The click handler already sees the new state, as in HTML.
    expect(seen).toBe(true)
    expect(checkbox).not.toBeChecked()
    // ReactDOM still delivers onChange with the flipped state; the change
    // event's native event says the click was prevented.
    expect(changes).toEqual([{ checked: true, prevented: true }])
  })

  it("lets a controlled checkbox accept a change from a prevented click", async () => {
    function Controlled() {
      const [checked, setChecked] = useState(false)
      return (
        <input
          type="checkbox"
          ariaLabel="Accepts anyway"
          checked={checked}
          onClick={(event) => event.preventDefault()}
          onChange={(event) => setChecked(event.checked === true)}
          style={BOX}
        />
      )
    }
    screen.render(<Controlled />)
    const checkbox = screen.getByRole("checkbox", { name: "Accepts anyway" })
    await screen.userEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it("shows a mixed state until activation clears it", async () => {
    const ref = React.createRef<InputPublicInstance>()
    screen.render(<input ref={ref} type="checkbox" ariaLabel="All" style={BOX} />)
    const checkbox = screen.getByRole("checkbox", { name: "All" })
    ref.current!.indeterminate = true
    // An imperative write reaches the accessibility tree with the next frame.
    screen.renderer.drawPendingFrame()
    expect(checkbox).toBePartiallyChecked()
    expect(ref.current!.indeterminate).toBe(true)

    await screen.userEvent.click(checkbox)
    expect(ref.current!.indeterminate).toBe(false)
    expect(checkbox).toBeChecked()

    ref.current!.indeterminate = true
    screen.renderer.drawPendingFrame()
    expect(checkbox).toBePartiallyChecked()
  })

  it("restores a controlled indeterminate prop after a change", async () => {
    screen.render(
      <input type="checkbox" ariaLabel="Parent" indeterminate onChange={() => {}} style={BOX} />
    )
    const checkbox = screen.getByRole("checkbox", { name: "Parent" })
    await screen.userEvent.click(checkbox)
    expect(checkbox).toBePartiallyChecked()
  })

  it("applies and removes props on update", () => {
    const ref = React.createRef<InputPublicInstance>()
    const render = (props: Record<string, unknown>) =>
      screen.render(<input ref={ref} type="checkbox" ariaLabel="Updated" {...props} />)

    render({ indeterminate: true, required: true })
    const checkbox = screen.getByRole("checkbox", { name: "Updated" })
    expect(checkbox).toBePartiallyChecked()
    expect(isRequired(screen, checkbox)).toBe(true)

    render({})
    expect(checkbox).not.toBePartiallyChecked()
    expect(isRequired(screen, checkbox)).toBe(false)

    // Removing `checked` leaves the control uncontrolled at its last state.
    render({ checked: true, onChange: () => {} })
    expect(checkbox).toBeChecked()
    render({})
    expect(checkbox).toBeChecked()
    expect(ref.current!.defaultChecked).toBe(false)

    render({ defaultChecked: true })
    expect(ref.current!.defaultChecked).toBe(true)
    render({})
    expect(ref.current!.defaultChecked).toBe(false)
  })

  it("ignores clicks, focus, and click() while disabled", async () => {
    const change = vi.fn()
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <input
        ref={ref}
        type="checkbox"
        ariaLabel="Locked"
        disabled
        onChange={change}
        style={BOX}
      />
    )
    const checkbox = screen.getByRole("checkbox", { name: "Locked" })
    expect(checkbox).toBeDisabled()
    await screen.userEvent.click(checkbox)
    ref.current!.click()
    ref.current!.focus()
    expect(change).not.toHaveBeenCalled()
    expect(checkbox).not.toBeChecked()
    expect(screen.renderer.getActiveElement()).toBeNull()
  })

  it("reports a missing required value", async () => {
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <input ref={ref} type="checkbox" ariaLabel="Terms" required style={BOX} />
    )
    const checkbox = screen.getByRole("checkbox", { name: "Terms" })
    expect(isRequired(screen, checkbox)).toBe(true)
    expect(ref.current!.checkValidity()).toBe(false)
    expect(ref.current!.validity.valueMissing).toBe(true)
    expect(ref.current!.validity.valid).toBe(false)
    expect(ref.current!.willValidate).toBe(true)
    expect(ref.current!.validationMessage).not.toBe("")
    await screen.userEvent.click(checkbox)
    expect(ref.current!.checkValidity()).toBe(true)
    expect(ref.current!.validity.valueMissing).toBe(false)
    expect(ref.current!.validationMessage).toBe("")

    ref.current!.setCustomValidity("Pick a plan first")
    expect(ref.current!.validity.customError).toBe(true)
    expect(ref.current!.validationMessage).toBe("Pick a plan first")
    expect(ref.current!.checkValidity()).toBe(false)
    ref.current!.setCustomValidity("")
    expect(ref.current!.checkValidity()).toBe(true)
  })

  it("toggles on Space but not Enter, and honours a prevented Space", async () => {
    let preventSpace = false
    screen.render(
      <input
        type="checkbox"
        ariaLabel="Keyboard"
        onKeyDown={(event) => {
          if (preventSpace && event.key === " ") event.preventDefault()
        }}
        style={BOX}
      />
    )
    const checkbox = screen.getByRole("checkbox", { name: "Keyboard" })
    await screen.userEvent.keyboard(checkbox, "space")
    expect(checkbox).toBeChecked()
    await screen.userEvent.keyboard(checkbox, "enter")
    expect(checkbox).toBeChecked()

    preventSpace = true
    await screen.userEvent.keyboard(checkbox, "space")
    expect(checkbox).toBeChecked()
  })

  it("activates from an explicit label and from a wrapping label, once each", async () => {
    const change = vi.fn()
    screen.render(
      <div style={{ padding: 20, gap: 8 }}>
        <label htmlFor="news" data-testid="explicit" style={{ width: 160, height: 28 }}>
          Newsletter
        </label>
        <input id="news" type="checkbox" onChange={change} style={BOX} />
        <label data-testid="implicit" style={{ flexDirection: "row", gap: 8, height: 28 }}>
          <input type="checkbox" data-testid="wrapped" onChange={change} style={BOX} />
          <span data-testid="implicit-text">Updates</span>
        </label>
      </div>
    )

    const explicit = screen.getByRole("checkbox", { name: "Newsletter" })
    await screen.userEvent.click(screen.getByTestId("explicit"))
    expect(explicit).toBeChecked()

    const wrapped = screen.getByRole("checkbox", { name: "Updates" })
    await screen.userEvent.click(screen.getByTestId("implicit-text"))
    expect(wrapped).toBeChecked()
    // A click on the control inside its label activates it once, not twice.
    await screen.userEvent.click(screen.getByTestId("wrapped"))
    expect(wrapped).not.toBeChecked()
    expect(change).toHaveBeenCalledTimes(3)
  })

  it("rebuilds the native adapter when type changes", () => {
    const ref = React.createRef<InputPublicInstance>()
    const render = (type: string) =>
      screen.render(<input ref={ref} type={type} ariaLabel="Morph" defaultValue="typed" />)
    render("text")
    expect(screen.getByRole("textbox", { name: "Morph" })).toBeTruthy()
    render("checkbox")
    expect(screen.getByRole("checkbox", { name: "Morph" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Morph" })).toBeNull()
    render("text")
    expect(screen.getByRole("textbox", { name: "Morph" })).toBeTruthy()
  })
})

describeNative("native radio inputs", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 360 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  function Group({
    name,
    values,
    checked,
    disabled = [],
    form,
  }: {
    name: string
    values: string[]
    checked?: string
    disabled?: string[]
    form?: string
  }) {
    return (
      <div style={{ flexDirection: "row", gap: 8 }}>
        {values.map((value) => (
          <input
            key={value}
            type="radio"
            name={name}
            value={value}
            form={form}
            ariaLabel={`${name} ${value}`}
            defaultChecked={value === checked}
            disabled={disabled.includes(value)}
            style={BOX}
          />
        ))}
      </div>
    )
  }

  const radio = (name: string) => screen.getByRole("radio", { name })

  it("keeps one member of a group checked and groups by form and name", async () => {
    screen.render(
      <div style={{ padding: 20, gap: 12 }}>
        <form>
          <Group name="size" values={["s", "m", "l"]} checked="m" />
        </form>
        <form>
          <Group name="size" values={["xs", "xl"]} checked="xs" />
        </form>
      </div>
    )

    expect(radio("size m")).toBeChecked()
    await screen.userEvent.click(radio("size l"))
    expect(radio("size l")).toBeChecked()
    expect(radio("size m")).not.toBeChecked()
    // The same name in another form is another group.
    expect(radio("size xs")).toBeChecked()

    await screen.userEvent.click(radio("size l"))
    expect(radio("size l")).toBeChecked()
  })

  it("joins a form named by the form prop rather than its ancestor", async () => {
    screen.render(
      <div style={{ padding: 20, gap: 12 }}>
        <form id="outer">
          <Group name="tone" values={["warm"]} checked="warm" />
        </form>
        <Group name="tone" values={["cool"]} form="outer" />
        <Group name="tone" values={["free"]} checked="free" />
      </div>
    )

    await screen.userEvent.click(radio("tone cool"))
    expect(radio("tone cool")).toBeChecked()
    expect(radio("tone warm")).not.toBeChecked()
    expect(radio("tone free")).toBeChecked()
  })

  it("moves the selection with arrow keys, wrapping and skipping disabled members", async () => {
    const changes: string[] = []
    screen.render(
      <div
        style={{ padding: 20 }}
        onChange={(event) => changes.push((event.target.props as { value?: string }).value!)}
      >
        <Group name="plan" values={["a", "b", "c", "d"]} checked="a" disabled={["c"]} />
      </div>
    )

    await screen.userEvent.keyboard(radio("plan a"), "down")
    expect(radio("plan b")).toBeChecked()
    expect(screen.renderer.getActiveElement()).toBe(radio("plan b").id)

    await screen.userEvent.keyboard(radio("plan b"), "right")
    expect(radio("plan d")).toBeChecked()

    await screen.userEvent.keyboard(radio("plan d"), "down")
    expect(radio("plan a")).toBeChecked()

    await screen.userEvent.keyboard(radio("plan a"), "up")
    expect(radio("plan d")).toBeChecked()

    await screen.userEvent.keyboard(radio("plan d"), "left")
    expect(radio("plan b")).toBeChecked()
    expect(changes).toEqual(["b", "d", "a", "d", "b"])
  })

  it("skips hidden radios with the arrow keys and Tab", async () => {
    screen.render(
      <div style={{ padding: 20, gap: 8 }}>
        <div tabIndex={0} ariaLabel="start" style={{ width: 120, height: 24 }} />
        <div style={{ flexDirection: "row", gap: 8 }}>
          <input type="radio" name="vis" ariaLabel="gone" style={{ ...BOX, display: "none" }} />
          <div hidden>
            <input type="radio" name="vis" ariaLabel="collapsed" style={BOX} />
          </div>
          <div ariaHidden>
            <input type="radio" name="vis" ariaLabel="silent" tabIndex={-1} style={BOX} />
          </div>
          <input type="radio" name="vis" ariaLabel="one" style={BOX} />
          <input type="radio" name="vis" ariaLabel="two" style={BOX} />
        </div>
        <div tabIndex={0} ariaLabel="end" style={{ width: 120, height: 24 }} />
      </div>
    )
    const active = () => screen.renderer.getActiveElement()
    const byName = (name: string) => screen.getByLabelText(name)

    // The first member in tree order is hidden, so the visible one is the stop.
    screen.renderer.focusElement(byName("start").id)
    await screen.userEvent.tab()
    expect(active()).toBe(radio("one").id)
    await screen.userEvent.tab()
    expect(active()).toBe(byName("end").id)

    await screen.userEvent.keyboard(radio("one"), "down")
    expect(radio("two")).toBeChecked()
    // Wrapping from the last visible member skips every hidden one.
    await screen.userEvent.keyboard(radio("two"), "down")
    expect(radio("one")).toBeChecked()
    expect(active()).toBe(radio("one").id)
    await screen.userEvent.keyboard(radio("one"), "up")
    expect(radio("two")).toBeChecked()
  })

  it("checks a focused radio with Space", async () => {
    screen.render(
      <div style={{ padding: 20 }}>
        <Group name="speed" values={["slow", "fast"]} />
      </div>
    )
    await screen.userEvent.keyboard(radio("speed fast"), "space")
    expect(radio("speed fast")).toBeChecked()
  })

  it("makes a group one tab stop", async () => {
    screen.render(
      <div style={{ padding: 20, gap: 8 }}>
        <input ariaLabel="before" style={{ width: 120, height: 24 }} />
        <Group name="checked" values={["1", "2", "3"]} checked="2" />
        <Group name="empty" values={["x", "y", "z"]} />
        <div tabIndex={0} ariaLabel="after" style={{ width: 120, height: 24 }} />
      </div>
    )
    const active = () => screen.renderer.getActiveElement()
    const before = screen.getByRole("textbox", { name: "before" })
    const after = screen.getByLabelText("after")

    screen.renderer.focusElement(before.id)
    await screen.userEvent.tab()
    expect(active()).toBe(radio("checked 2").id)
    await screen.userEvent.tab()
    expect(active()).toBe(radio("empty x").id)
    await screen.userEvent.tab()
    expect(active()).toBe(after.id)

    // Backwards into a group with nothing checked lands on its last member.
    await screen.userEvent.tab({ shift: true })
    expect(active()).toBe(radio("empty z").id)
    await screen.userEvent.tab({ shift: true })
    expect(active()).toBe(radio("checked 2").id)

    // Tab leaves a group from any member.
    screen.renderer.focusElement(radio("checked 1").id)
    await screen.userEvent.tab()
    expect(active()).toBe(radio("empty x").id)
  })

  it("restores a controlled group the application did not change", async () => {
    function Controlled({ accept }: { accept: boolean }) {
      const [value, setValue] = useState("one")
      return (
        <div style={{ padding: 20, flexDirection: "row", gap: 8 }}>
          {["one", "two"].map((option) => (
            <input
              key={option}
              type="radio"
              name="controlled"
              ariaLabel={option}
              checked={value === option}
              onChange={() => {
                if (accept) setValue(option)
              }}
              style={BOX}
            />
          ))}
        </div>
      )
    }

    screen.render(<Controlled accept={false} />)
    await screen.userEvent.click(radio("two"))
    expect(radio("one")).toBeChecked()
    expect(radio("two")).not.toBeChecked()

    screen.render(<Controlled accept />)
    await screen.userEvent.click(radio("two"))
    expect(radio("two")).toBeChecked()
    expect(radio("one")).not.toBeChecked()
  })
})

describeNative("form submission and reset", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 360 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  it("submits checked choices and omits unchecked ones", async () => {
    const submitted: Array<Array<[string, string]>> = []
    const submitters: Array<string | undefined> = []
    screen.render(
      <form
        style={{ padding: 20, gap: 8 }}
        onSubmit={(event: GpuixSubmitEvent) => {
          submitted.push(entries(event.formData))
          submitters.push(event.submitter?.props.id)
        }}
      >
        <input type="checkbox" name="agree" ariaLabel="agree" defaultChecked style={BOX} />
        <input type="checkbox" name="extra" value="yes" ariaLabel="extra" style={BOX} />
        <input type="checkbox" name="off" value="x" disabled defaultChecked style={BOX} />
        <input type="radio" name="size" value="s" ariaLabel="small" style={BOX} />
        <input type="radio" name="size" value="l" ariaLabel="large" defaultChecked style={BOX} />
        <input type="hidden" name="token" value="abc" />
        <input name="note" defaultValue="hello" style={{ width: 120, height: 24 }} />
        <button id="go" name="action" value="save" style={{ width: 80, height: 24 }}>
          Save
        </button>
      </form>
    )

    await screen.userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(submitted).toEqual([
      [
        ["agree", "on"],
        ["size", "l"],
        ["token", "abc"],
        ["note", "hello"],
        ["action", "save"],
      ],
    ])
    expect(submitters).toEqual(["go"])

    await screen.userEvent.click(screen.getByRole("checkbox", { name: "agree" }))
    await screen.userEvent.click(screen.getByRole("checkbox", { name: "extra" }))
    await screen.userEvent.click(screen.getByRole("radio", { name: "small" }))
    await screen.userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(submitted[1]).toEqual([
      ["extra", "yes"],
      ["size", "s"],
      ["token", "abc"],
      ["note", "hello"],
      ["action", "save"],
    ])
  })

  it("blocks submission while a required choice is missing", async () => {
    const submit = vi.fn()
    const form = React.createRef<FormPublicInstance>()
    screen.render(
        <form ref={form} onSubmit={submit} style={{ padding: 20 }}>
          <input type="checkbox" name="terms" ariaLabel="terms" required style={BOX} />
          <input type="radio" name="pick" value="a" ariaLabel="pick a" required style={BOX} />
          <input type="radio" name="pick" value="b" ariaLabel="pick b" style={BOX} />
        </form>
      )
    expect(form.current!.checkValidity()).toBe(false)
    form.current!.requestSubmit()
    expect(submit).not.toHaveBeenCalled()

    await screen.userEvent.click(screen.getByRole("checkbox", { name: "terms" }))
    form.current!.requestSubmit()
    expect(submit).not.toHaveBeenCalled()

    await screen.userEvent.click(screen.getByRole("radio", { name: "pick b" }))
    expect(form.current!.checkValidity()).toBe(true)
    form.current!.requestSubmit()
    expect(submit).toHaveBeenCalledOnce()

    screen.render(
      <form key="fresh" ref={form} noValidate onSubmit={submit}>
        <input type="checkbox" name="unchecked" required />
      </form>
    )
    expect(form.current!.checkValidity()).toBe(false)
    form.current!.requestSubmit()
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it("resets choices to their defaults unless the reset is prevented", async () => {
    let prevent = false
    const form = React.createRef<FormPublicInstance>()
    screen.render(
      <form
        ref={form}
        style={{ padding: 20, gap: 8 }}
        onReset={(event) => {
          if (prevent) event.preventDefault()
        }}
      >
        <input type="checkbox" ariaLabel="on by default" defaultChecked style={BOX} />
        <input type="checkbox" ariaLabel="off by default" style={BOX} />
        <input type="radio" name="r" ariaLabel="first" defaultChecked style={BOX} />
        <input type="radio" name="r" ariaLabel="second" style={BOX} />
        <input ariaLabel="note" defaultValue="draft" style={{ width: 120, height: 24 }} />
        <button type="reset" style={{ width: 80, height: 24 }}>
          Reset
        </button>
      </form>
    )
    const onByDefault = screen.getByRole("checkbox", { name: "on by default" })
    const offByDefault = screen.getByRole("checkbox", { name: "off by default" })
    const second = screen.getByRole("radio", { name: "second" })
    const note = screen.getByRole("textbox", { name: "note" })

    await screen.userEvent.click(onByDefault)
    await screen.userEvent.click(offByDefault)
    await screen.userEvent.click(second)
    await screen.userEvent.clear(note)
    await screen.userEvent.type(note, "edited")

    prevent = true
    form.current!.reset()
    expect(offByDefault).toBeChecked()

    prevent = false
    await screen.userEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(onByDefault).toBeChecked()
    expect(offByDefault).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "first" })).toBeChecked()
    expect(second).not.toBeChecked()
    expect(note).toHaveValue("draft")
  })

  it("leaves a type=button button and a formless submit button inert", async () => {
    const submit = vi.fn()
    screen.render(
      <div style={{ padding: 20, gap: 8 }}>
        <form onSubmit={submit}>
          <button type="button" style={{ width: 80, height: 24 }}>
            Plain
          </button>
        </form>
        <button style={{ width: 80, height: 24 }}>Orphan</button>
      </div>
    )
    await screen.userEvent.click(screen.getByRole("button", { name: "Plain" }))
    await screen.userEvent.click(screen.getByRole("button", { name: "Orphan" }))
    expect(submit).not.toHaveBeenCalled()
  })

  it("renders a hidden input as nothing and never as a text editor", () => {
    const ref = React.createRef<InputPublicInstance>()
    screen.render(
      <div style={{ padding: 20 }}>
        <input ref={ref} type="hidden" name="token" value="abc" />
      </div>
    )
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.renderer.getInputValue(ref.current!.id)).toBeNull()
    expect(ref.current!.value).toBe("abc")
    ref.current!.focus()
    expect(screen.renderer.getActiveElement()).toBeNull()
  })
})

// ── Base UI-shaped fixture ───────────────────────────────────────────
//
// Base UI's `Checkbox.Root` and `Switch.Root` render a semantic `<span>` with
// the role and `aria-checked`, plus a visually hidden native checkbox. The root
// forwards its click to the hidden input, whose `onChange` owns the state. This
// mirrors that structure without Base UI's DOM-only dispatch helpers.

const visuallyHiddenInput = {
  clipPath: "inset(50%)",
  overflow: "hidden",
  border: 0,
  padding: 0,
  width: 1,
  height: 1,
  margin: -1,
  position: "absolute",
} as const

function BaseChoiceRoot({
  role,
  name,
  value,
  label,
  uncheckedValue,
  indeterminate = false,
  onCheckedChange,
}: {
  role: "checkbox" | "switch"
  name?: string
  value?: string
  label: string
  uncheckedValue?: string
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  const [checked, setChecked] = useState(false)
  const inputRef = React.useRef<InputPublicInstance>(null)
  const rootRef = React.useRef<InputPublicInstance>(null)

  React.useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [checked, indeterminate])

  return (
    <>
      <span
        ref={rootRef}
        role={role}
        ariaLabel={label}
        ariaChecked={indeterminate ? "mixed" : checked}
        tabIndex={0}
        data-testid={`${label}-root`}
        style={{ width: 36, height: 20, backgroundColor: checked ? "#2563eb" : "#334155" }}
        onClick={(event) => {
          event.preventDefault()
          inputRef.current?.click()
        }}
      />
      {!checked && name && uncheckedValue !== undefined && (
        <input type="hidden" name={name} value={uncheckedValue} />
      )}
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        name={name}
        value={value}
        tabIndex={-1}
        aria-hidden
        style={visuallyHiddenInput}
        onChange={(event) => {
          if ((event.nativeEvent as { defaultPrevented?: boolean }).defaultPrevented) return
          const next = (event.currentTarget as InputPublicInstance).checked
          onCheckedChange?.(next)
          setChecked(next)
        }}
        onClick={(event) => event.stopPropagation()}
        onFocus={() => rootRef.current?.focus()}
      />
    </>
  )
}

describeNative("Base UI-shaped checkbox and switch", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 240 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  it("toggles through the hidden input without a text editor", async () => {
    const changes: boolean[] = []
    const ancestorClicks = vi.fn()
    screen.render(
      <div style={{ padding: 20, gap: 12 }} onClick={ancestorClicks}>
        <BaseChoiceRoot role="checkbox" label="Accept" onCheckedChange={(c) => changes.push(c)} />
        <BaseChoiceRoot role="switch" label="Wi-Fi" onCheckedChange={(c) => changes.push(c)} />
      </div>
    )

    const checkbox = screen.getByRole("checkbox", { name: "Accept" })
    const toggle = screen.getByRole("switch", { name: "Wi-Fi" })
    // The hidden inputs are aria-hidden: only the roots are in the tree.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(1)
    expect(screen.queryByRole("textbox")).toBeNull()

    await screen.userEvent.click(checkbox)
    await screen.userEvent.click(toggle)
    expect(checkbox).toBeChecked()
    expect(toggle).toBeChecked()
    // The forwarded click stops at the input; ancestors see the user's click only.
    expect(ancestorClicks).toHaveBeenCalledTimes(2)

    await screen.userEvent.keyboard(toggle, "space")
    expect(toggle).not.toBeChecked()
    expect(changes).toEqual([true, true, false])
  })

  it("activates from a wrapping label through the hidden input", async () => {
    screen.render(
      <label style={{ padding: 20, flexDirection: "row", gap: 8 }}>
        <BaseChoiceRoot role="checkbox" label="Remember" />
        <span data-testid="remember-text">Remember me</span>
      </label>
    )
    await screen.userEvent.click(screen.getByTestId("remember-text"))
    expect(screen.getByRole("checkbox", { name: "Remember" })).toBeChecked()
  })

  it("mirrors indeterminate onto the hidden input", () => {
    screen.render(
      <div>
        <BaseChoiceRoot role="checkbox" label="Mixed" indeterminate />
      </div>
    )
    expect(screen.getByRole("checkbox", { name: "Mixed" })).toBePartiallyChecked()
  })

  it("submits the hidden input's value, or the unchecked value", async () => {
    const submitted: Array<Array<[string, string]>> = []
    const form = React.createRef<FormPublicInstance>()
    screen.render(
      <form
        ref={form}
        style={{ padding: 20 }}
        onSubmit={(event: GpuixSubmitEvent) => submitted.push(entries(event.formData))}
      >
        <BaseChoiceRoot role="switch" label="Alerts" name="alerts" value="on" uncheckedValue="off" />
      </form>
    )

    form.current!.requestSubmit()
    await screen.userEvent.click(screen.getByRole("switch", { name: "Alerts" }))
    form.current!.requestSubmit()
    expect(submitted).toEqual([[["alerts", "off"]], [["alerts", "on"]]])
  })
})
