/** The Input Events `inputType` on a text editor's change event (#579).
 *
 *  React DOM's `onChange` for a text field is the DOM `input` event, whose
 *  `nativeEvent.inputType` names the edit. Base UI's Autocomplete opens its
 *  list only for an edit with an `inputType` other than
 *  `insertReplacementText`; without one it treats the edit as autofill and
 *  leaves the list closed. */

import React, { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type { GpuixChangeEvent } from "../reconciler/synthetic-event.js"
import type { InputPublicInstance } from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends GpuixMatchers<R> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const FIELD = { width: 300, height: 60 }
const PRIMARY = process.platform === "darwin" ? "cmd" : "ctrl"
const WORD = process.platform === "darwin" ? "alt" : "ctrl"

describeNative("text editor change inputType", () => {
  let screen: TestRoot

  afterEach(() => {
    screen.unmount()
  })

  function recordChanges(type: "input" | "textarea", defaultValue = "") {
    const changes: Array<[string, string | undefined, string | undefined]> = []
    screen = createTestRoot({ width: 400, height: 120 })
    screen.render(
      React.createElement(type, {
        "data-testid": "field",
        defaultValue,
        style: FIELD,
        onChange: (event: GpuixChangeEvent) =>
          changes.push([
            (event.currentTarget as InputPublicInstance).value,
            event.inputType,
            event.nativeEvent.inputType ?? undefined,
          ]),
      })
    )
    const field = screen.renderer.findByTestId("field")!
    const press = (keys: string) => screen.renderer.nativeSimulateKeystrokes(field.id, keys)
    return { changes, press }
  }

  it("names typing, deletion, undo and redo", () => {
    const { changes, press } = recordChanges("input", "one two")

    press("x")
    press("backspace")
    press("left delete")
    press(`${WORD}-backspace`)
    press(`${PRIMARY}-z`)
    press(`shift-${PRIMARY}-z`)

    expect(changes.map(([, inputType]) => inputType)).toEqual([
      "insertText",
      "deleteContentBackward",
      "deleteContentForward",
      "deleteWordBackward",
      "historyUndo",
      "historyRedo",
    ])
    for (const [, inputType, native] of changes) expect(native).toBe(inputType)
  })

  it("names a line break in a textarea", () => {
    const { changes, press } = recordChanges("textarea", "a")

    press("enter")

    expect(changes).toEqual([["a\n", "insertLineBreak", "insertLineBreak"]])
  })

  it("reports no change, and so no inputType, for a programmatic value write", () => {
    const { changes } = recordChanges("input")
    const ref = screen.getByTestId("field")

    screen.renderer.setInputValue(ref.id, "set")

    expect(changes).toEqual([])
  })

  /** Base UI Autocomplete's input path, reduced to what it reads from the
   *  change event: the value, and whether the edit was typed. */
  function Autocomplete() {
    const [value, setValue] = useState("")
    const [open, setOpen] = useState(false)
    const matches = ["apple", "apricot", "banana"].filter(
      (item) => value !== "" && item.includes(value.trim())
    )
    return (
      <div style={{ width: 400, height: 200 }}>
        <input
          data-testid="query"
          value={value}
          style={{ width: 300, height: 30 }}
          onChange={(event: GpuixChangeEvent) => {
            const next = (event.currentTarget as InputPublicInstance).value
            const inputType = event.nativeEvent.inputType
            const autofillLike = !inputType || inputType === "insertReplacementText"
            setValue(next)
            if (next === "") setOpen(false)
            else if (!autofillLike) setOpen(true)
          }}
        />
        {open &&
          matches.map((item) => (
            <div key={item} role="option" ariaLabel={item} style={{ height: 20 }}>
              <text>{item}</text>
            </div>
          ))}
      </div>
    )
  }

  it("opens and filters an autocomplete list as the user types, and closes it on clear", async () => {
    screen = createTestRoot({ width: 400, height: 200 })
    screen.render(<Autocomplete />)
    const query = screen.getByTestId("query")
    const options = () =>
      ["apple", "apricot", "banana"].filter((name) => screen.queryByRole("option", { name }))

    await screen.userEvent.type(query, "a")
    expect(query).toHaveValue("a")
    expect(options()).toEqual(["apple", "apricot", "banana"])

    await screen.userEvent.type(query, "pr")
    expect(query).toHaveValue("apr")
    expect(options()).toEqual(["apricot"])

    await screen.userEvent.clear(query)
    expect(query).toHaveValue("")
    expect(options()).toEqual([])
  })
})
