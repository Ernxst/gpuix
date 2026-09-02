/** The text-editing members of `HTMLInputElement`, on `<input>`/`<textarea>` refs. */

import React, { useEffect, useRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuix/native"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { InputPublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("input selection API", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot({ strictStyles: false })
  })

  afterEach(() => {
    testRoot.renderer.dispose()
  })

  /** An uncontrolled editor holding `value`, so nothing re-renders underneath
   *  the assertions unless a test asks for it. */
  const renderInput = (value: string): InputPublicInstance => {
    const ref = React.createRef<InputPublicInstance>()
    testRoot.render(
      <div style={{ width: 400, height: 100 }}>
        <input ref={ref} value={value} style={{ width: 300, height: 40 }} />
      </div>
    )
    return ref.current!
  }

  it("reports the value with the caret at its end", () => {
    const input = renderInput("hello")

    expect(input.value).toBe("hello")
    expect(input.selectionStart).toBe(5)
    expect(input.selectionEnd).toBe(5)
    expect(input.selectionDirection).toBe("forward")
  })

  it("selects a range with setSelectionRange", () => {
    const input = renderInput("hello world")

    input.setSelectionRange(6, 11)

    expect(input.selectionStart).toBe(6)
    expect(input.selectionEnd).toBe(11)
    expect(input.selectionDirection).toBe("forward")
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe("world")
  })

  it("remembers which end of the selection moves", () => {
    const input = renderInput("hello world")

    input.setSelectionRange(0, 5, "backward")
    expect(input.selectionDirection).toBe("backward")

    input.setSelectionRange(0, 5, "forward")
    expect(input.selectionDirection).toBe("forward")
  })

  it("reports forward for the directions this editor cannot represent", () => {
    // HTML lets a platform with no "none" mode substitute "forward".
    const input = renderInput("hello")

    input.setSelectionRange(0, 5, "none")
    expect(input.selectionDirection).toBe("forward")

    input.setSelectionRange(0, 5)
    expect(input.selectionDirection).toBe("forward")
  })

  it("collapses an inverted range at its end rather than swapping it", () => {
    const input = renderInput("hello world")

    input.setSelectionRange(8, 3)

    expect(input.selectionStart).toBe(3)
    expect(input.selectionEnd).toBe(3)
  })

  it("treats offsets past the end of the value as the end", () => {
    const input = renderInput("hello")

    input.setSelectionRange(2, 99)
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(5)

    // WebIDL folds a negative unsigned long to 2**32-1, which then clamps.
    input.setSelectionRange(-1, -1)
    expect(input.selectionStart).toBe(5)
    expect(input.selectionEnd).toBe(5)
  })

  it("selects everything with select()", () => {
    const input = renderInput("hello world")

    input.setSelectionRange(2, 3)
    input.select()

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(11)
  })

  it("pushes selectionEnd ahead when selectionStart overtakes it", () => {
    const input = renderInput("hello world")
    input.setSelectionRange(0, 3)

    input.selectionStart = 7

    expect(input.selectionStart).toBe(7)
    expect(input.selectionEnd).toBe(7)
  })

  it("collapses the selection when selectionEnd drops below selectionStart", () => {
    const input = renderInput("hello world")
    input.setSelectionRange(4, 9)

    input.selectionEnd = 2

    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
  })

  it("counts offsets in UTF-16 code units, as the DOM does", () => {
    const input = renderInput("a😀b")

    // "😀" is one code point and two code units, so the caret lands on 4.
    expect(input.value.length).toBe(4)
    expect(input.selectionStart).toBe(4)

    input.setSelectionRange(1, 3)
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe("😀")
  })

  it("writes the value without reporting a change", () => {
    const changes: string[] = []
    const ref = React.createRef<InputPublicInstance>()
    testRoot.render(
      <div style={{ width: 400, height: 100 }}>
        <input
          ref={ref}
          value="hello"
          style={{ width: 300, height: 40 }}
          onChange={(event: EventPayload) => changes.push(event.value ?? "")}
        />
      </div>
    )
    const input = ref.current!

    input.value = "goodbye"

    expect(input.value).toBe("goodbye")
    // Assigning `value` moves the caret to the end and fires no change event,
    // exactly as `HTMLInputElement.value =` does.
    expect(input.selectionStart).toBe(7)
    expect(changes).toEqual([])
  })

  it("tracks the caret the native editor moves for itself", () => {
    const input = renderInput("")
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "h i")

    expect(input.value).toBe("hi")
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
  })

  it("restores the caret after a controlled reformat", () => {
    const ref = React.createRef<InputPublicInstance>()

    function MaskedInput() {
      const [value, setValue] = useState("")
      const caret = useRef<number | null>(null)

      useEffect(() => {
        if (caret.current === null) return
        ref.current?.setSelectionRange(caret.current, caret.current)
        caret.current = null
      })

      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            ref={ref}
            value={value}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => {
              const next = (event.value ?? "").toUpperCase()
              caret.current = 1
              setValue(next)
            }}
          />
        </div>
      )
    }

    testRoot.render(<MaskedInput />)
    const input = testRoot.renderer.findByType("input")[0]!
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "a b")

    // A new `value` prop parks the caret at the end; the effect pulls it back.
    expect(ref.current!.value).toBe("AB")
    expect(ref.current!.selectionStart).toBe(1)
    expect(ref.current!.selectionEnd).toBe(1)
  })

  it("gives a textarea the same members", () => {
    const ref = React.createRef<InputPublicInstance>()
    testRoot.render(
      <div style={{ width: 400, height: 160 }}>
        <textarea ref={ref} value={"one\ntwo"} minRows={2} style={{ width: 300 }} />
      </div>
    )
    const textarea = ref.current!

    expect(textarea.value).toBe("one\ntwo")

    textarea.setSelectionRange(4, 7)
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("two")

    textarea.select()
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(7)
  })
})
