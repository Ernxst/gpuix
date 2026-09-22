/** Non-string `value` and `defaultValue` on text editors (#580).
 *
 *  React DOM stringifies both props before they reach the element, so
 *  `<input value={5}>` shows "5" and `ref.value` reads "5". Base UI's
 *  NumberField renders its numeric state this way, then steps from the value
 *  it reads back on ArrowUp and ArrowDown. */

import React, { createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type { GpuixChangeEvent, GpuixKeyboardEvent } from "../reconciler/synthetic-event.js"
import type { FormPublicInstance, InputPublicInstance, NativeRenderer } from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const FIELD = { width: 200, height: 30 }

describe("numeric text editor props before the first frame", () => {
  it("stringify into the ref's value and the props sent to the renderer", () => {
    const renderer: NativeRenderer = { applyBatch: vi.fn(() => []), setStrictStyles: vi.fn() }
    const root = createRoot(renderer, { strictStyles: false })
    const controlled = createRef<InputPublicInstance>()
    const uncontrolled = createRef<InputPublicInstance>()
    const area = createRef<InputPublicInstance>()
    flushSync(() =>
      root.render(
        <div>
          <input ref={controlled} value={5} onChange={() => {}} />
          <input ref={uncontrolled} defaultValue={0} />
          <textarea ref={area} defaultValue={1.5} />
        </div>
      )
    )

    try {
      expect(controlled.current!.value).toBe("5")
      expect(uncontrolled.current!.value).toBe("0")
      expect(area.current!.value).toBe("1.5")
      const ops = vi
        .mocked(renderer.applyBatch)
        .mock.calls.flatMap(([batch]) => JSON.parse(batch as unknown as string) as unknown[][])
      expect(ops.filter(([op]) => op === "setCustomPropValue").map((op) => op.slice(2))).toEqual([
        ["value", "5"],
        ["defaultValue", "0"],
        ["defaultValue", "1.5"],
      ])
    } finally {
      flushSync(() => root.unmount())
    }
  })
})

describeNative("numeric text editor props", () => {
  let screen: TestRoot

  afterEach(() => {
    screen.unmount()
  })

  for (const type of ["input", "textarea"] as const) {
    it(`shows a numeric ${type} value and default value`, () => {
      screen = createTestRoot({ width: 400, height: 120 })
      screen.render(
        <div style={{ gap: 8 }}>
          {React.createElement(type, { "data-testid": "value", value: 5, onChange: () => {}, style: FIELD })}
          {React.createElement(type, { "data-testid": "default", defaultValue: 0, style: FIELD })}
        </div>
      )

      expect(screen.getByTestId("value")).toHaveValue("5")
      expect(screen.getByTestId("value")).toHaveDisplayValue("5")
      expect(screen.getByTestId("default")).toHaveValue("0")
      expect(screen.getByTestId("default")).toHaveDisplayValue("0")
    })
  }

  it("follows numeric value updates and keeps the text once the value is removed", () => {
    screen = createTestRoot({ width: 400, height: 80 })
    const ref = createRef<InputPublicInstance>()
    const field = (value: number | string | undefined) => (
      <input ref={ref} data-testid="field" value={value} onChange={() => {}} style={FIELD} />
    )

    screen.render(field(5))
    expect(ref.current!.value).toBe("5")

    screen.render(field(12))
    expect(ref.current!.value).toBe("12")
    expect(screen.renderer.getInputValue(ref.current!.id)).toBe("12")

    // The same text as a string is no change at all.
    screen.render(field("12"))
    expect(ref.current!.value).toBe("12")

    screen.render(field(undefined))
    expect(ref.current!.value).toBe("12")
  })

  it("puts a declined edit back to the numeric value", async () => {
    screen = createTestRoot({ width: 400, height: 80 })
    screen.render(<input data-testid="field" value={42} onChange={() => {}} style={FIELD} />)
    const field = screen.getByTestId("field")

    await screen.userEvent.type(field, "9")

    expect(field).toHaveValue("42")
  })

  it("resets to a numeric default value", async () => {
    screen = createTestRoot({ width: 400, height: 80 })
    const form = createRef<FormPublicInstance>()
    screen.render(
      <form ref={form}>
        <input data-testid="field" name="count" defaultValue={3} style={FIELD} />
      </form>
    )
    const field = screen.getByTestId("field")

    await screen.userEvent.type(field, "1")
    expect(field).toHaveValue("31")

    form.current!.reset()
    expect(field).toHaveValue("3")
  })

  /** The NumberField shape: numeric state rendered straight into `value`,
   *  arrow keys stepping from what the input reads back, clamped to bounds,
   *  and typed text parsed only when it is a finite number. */
  function Stepper(props: {
    initial: number | null
    step: number
    min: number
    max: number
    onValue: (value: number | null) => void
  }) {
    const [value, setValue] = useState<number | null>(props.initial)
    const [text, setText] = useState<string | null>(null)
    const commit = (next: number | null) => {
      setValue(next)
      setText(null)
      props.onValue(next)
    }
    return (
      <input
        data-testid="stepper"
        value={text ?? value ?? ""}
        style={FIELD}
        onKeyDown={(event: GpuixKeyboardEvent) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          const current = (event.currentTarget as InputPublicInstance).value
          const base = current.trim() === "" ? null : Number(current)
          const direction = event.key === "ArrowUp" ? 1 : -1
          const stepped = base === null ? props.min : base + direction * props.step
          commit(Math.min(props.max, Math.max(props.min, stepped)))
        }}
        onChange={(event: GpuixChangeEvent) => {
          const next = (event.currentTarget as InputPublicInstance).value
          setText(next)
          if (next.trim() === "") commit(null)
          else if (Number.isFinite(Number(next))) props.onValue(Number(next))
        }}
      />
    )
  }

  it("steps a numeric value with ArrowUp and ArrowDown inside its bounds", async () => {
    screen = createTestRoot({ width: 400, height: 80 })
    const onValue = vi.fn()
    screen.render(<Stepper initial={5} step={2} min={0} max={8} onValue={onValue} />)
    const field = screen.getByTestId("stepper")
    expect(field).toHaveValue("5")

    await screen.userEvent.keyboard(field, "up")
    expect(field).toHaveValue("7")
    await screen.userEvent.keyboard(field, "up")
    expect(field).toHaveValue("8")
    await screen.userEvent.keyboard(field, "down down")
    expect(field).toHaveValue("4")

    expect(onValue.mock.calls.map(([value]) => value)).toEqual([7, 8, 6, 4])
  })

  it("clears to empty and steps from the minimum without producing NaN", async () => {
    screen = createTestRoot({ width: 400, height: 80 })
    const onValue = vi.fn()
    screen.render(<Stepper initial={5} step={1} min={0} max={10} onValue={onValue} />)
    const field = screen.getByTestId("stepper")

    await screen.userEvent.clear(field)
    expect(field).toHaveValue("")
    await screen.userEvent.type(field, "-")
    expect(field).toHaveValue("-")
    await screen.userEvent.clear(field)
    await screen.userEvent.keyboard(field, "up")
    expect(field).toHaveValue("0")

    const values = onValue.mock.calls.map(([value]) => value)
    expect(values).toEqual([null, null, 0])
    expect(values.some((value) => Number.isNaN(value))).toBe(false)
  })
})
