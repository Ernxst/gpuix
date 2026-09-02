/** Controlled `<input>` state, restored after a handler declines an edit.
 *
 *  The browser's rule: a controlled field shows `props.value` and nothing else.
 *  React DOM enforces it with `restoreControlledState` after every change
 *  dispatch, because a handler that stores nothing — or stores something other
 *  than what was typed — produces no re-render and therefore no new prop to
 *  overwrite the field with. */

import React, { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { EventPayload } from "@gpuix/native"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("controlled editor state", () => {
  it("puts the prop back when the handler stores nothing", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    try {
      screen.render(
        <div style={{ width: 400, height: 160 }}>
          <input
            data-testid="field"
            value="locked"
            style={{ width: 300, height: 40 }}
            onChange={() => {}}
          />
        </div>
      )
      const field = screen.getByTestId("field")

      await screen.userEvent.type(field, "XY")

      // The keystrokes reached the editor and the editor told React about
      // them; React kept its value, so the field goes back to it.
      expect(field).toHaveValue("locked")
      expect(field).toHaveDisplayValue("locked")
      expect(screen.renderer.getInputValue(field.id)).toBe("locked")
    } finally {
      screen.unmount()
    }
  })

  it("keeps what a filtering handler accepts and rewinds what it strips", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    function DigitsStripped() {
      const [value, setValue] = useState("abc")
      return (
        <div style={{ width: 400, height: 160 }}>
          <input
            data-testid="field"
            value={value}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) =>
              setValue((event.value ?? "").replace(/[0-9]/g, ""))
            }
          />
          <text>{`stored:${value}`}</text>
        </div>
      )
    }

    try {
      screen.render(<DigitsStripped />)
      const field = screen.getByTestId("field")

      await screen.userEvent.type(field, "d")
      expect(field).toHaveValue("abcd")

      // The handler strips the digit, so its state does not change and React
      // never re-renders. Nothing but the restore can rewind the editor.
      await screen.userEvent.type(field, "1")
      expect(field).toHaveValue("abcd")
      expect(screen.getByText("stored:abcd")).toBeDefined()

      // Typing continues from the rewound text, not from "abcd1".
      await screen.userEvent.type(field, "e")
      expect(field).toHaveValue("abcde")
      expect(screen.getByText("stored:abcde")).toBeDefined()
    } finally {
      screen.unmount()
    }
  })

  it("leaves an uncontrolled editor alone", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    try {
      screen.render(
        <div style={{ width: 400, height: 160 }}>
          <input data-testid="field" style={{ width: 300, height: 40 }} onChange={() => {}} />
        </div>
      )
      const field = screen.getByTestId("field")
      const write = vi.spyOn(screen.renderer, "setInputValue")

      await screen.userEvent.type(field, "hi")

      // No `value` prop means no prop owns the text — React's own test for an
      // uncontrolled field — so the restore must not run at all, let alone
      // clear what the user typed.
      expect(write).not.toHaveBeenCalled()
      expect(field).toHaveValue("hi")
      write.mockRestore()
    } finally {
      screen.unmount()
    }
  })
})
