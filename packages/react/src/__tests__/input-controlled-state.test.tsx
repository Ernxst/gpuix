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
import { handleGpuixEvent } from "../reconciler/event-registry.js"

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

  it("rewinds inside a burst, so the next keystroke lands on the rewound text", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })
    const emitted: string[] = []

    function DigitsStripped() {
      const [value, setValue] = useState("abc")
      return (
        <div style={{ width: 400, height: 160 }}>
          <input
            data-testid="field"
            value={value}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => {
              emitted.push(event.value ?? "")
              setValue((event.value ?? "").replace(/[0-9]/g, ""))
            }}
          />
          <text>{`stored:${value}`}</text>
        </div>
      )
    }

    try {
      screen.render(<DigitsStripped />)
      const field = screen.getByTestId("field")

      // One call, three keys: `simulateKeystrokes` sends them back to back with
      // no checkpoint between, the way a fast typist's keys arrive.
      await screen.userEvent.type(field, "d1e")

      // The third keystroke was typed into "abcd", not into "abcd1" — the
      // rejected digit was gone before it arrived, as it would be in a browser.
      // Restoring later would leave "abcd1e" as the third emitted value.
      expect(emitted).toEqual(["abcd", "abcd1", "abcde"])
      expect(field).toHaveValue("abcde")
      expect(screen.getByText("stored:abcde")).toBeDefined()
    } finally {
      screen.unmount()
    }
  })

  it("commits before it decides, on the bare production dispatch path", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    function Accepting() {
      const [value, setValue] = useState("abc")
      return (
        <div style={{ width: 400, height: 160 }}>
          <input
            data-testid="field"
            value={value}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setValue(event.value ?? "")}
          />
          <text>{`stored:${value}`}</text>
        </div>
      )
    }

    try {
      screen.render(<Accepting />)
      const field = screen.getByTestId("field")

      // Collect the native events instead of letting the harness dispatch them.
      // `dispatchNativeEvents` wraps every dispatch in `flushSync`, which is a
      // luxury the production event callback does not have: it calls
      // `handleGpuixEvent` bare, so a handler's `setState` would only *schedule*
      // a commit unless the dispatch makes itself discrete.
      const captured: EventPayload[] = []
      const harness = vi
        .spyOn(screen.renderer, "dispatchNativeEvents")
        .mockImplementation(() => {
          captured.push(...screen.renderer.drainEvents())
        })
      screen.renderer.nativeSimulateKeystrokes(field.id, "d")
      harness.mockRestore()
      expect(captured.some((event) => event.eventType === "change")).toBe(true)

      const write = vi.spyOn(screen.renderer, "setInputValue")
      for (const event of captured) handleGpuixEvent(event, screen.renderer)
      // Everything React could have scheduled — microtasks and a macrotask —
      // has now run, so a late commit cannot rescue a premature rewind.
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      // The edit was accepted, so nothing was restored and the letter stands.
      expect(write).not.toHaveBeenCalled()
      expect(screen.renderer.getInputValue(field.id)).toBe("abcd")
      expect(screen.getByText("stored:abcd")).toBeDefined()
      write.mockRestore()
    } finally {
      screen.unmount()
    }
  })

  it("takes a later prop equal to text it just rewound", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    function DigitsStrippedUntilAllowed() {
      const [value, setValue] = useState("abc")
      return (
        <div style={{ width: 400, height: 160 }}>
          <div
            data-testid="allow"
            role="button"
            ariaLabel="allow"
            style={{ width: 120, height: 40 }}
            onClick={() => setValue("abc1")}
          >
            <text>allow</text>
          </div>
          <input
            data-testid="field"
            value={value}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) =>
              setValue((event.value ?? "").replace(/[0-9]/g, ""))
            }
          />
        </div>
      )
    }

    try {
      screen.render(<DigitsStrippedUntilAllowed />)
      const field = screen.getByTestId("field")

      await screen.userEvent.type(field, "1")
      expect(field).toHaveValue("abc")

      // The application now asks for exactly the text it refused a moment ago.
      // The rewind has to have cancelled the outstanding echo, or the editor
      // reads this prop as its own edit coming back and ignores it.
      await screen.userEvent.click(screen.getByTestId("allow"))
      expect(field).toHaveValue("abc1")
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
