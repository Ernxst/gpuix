/** End-to-end tests for the native GPUI text editor host elements. */
// @ts-nocheck

import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuix/native"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("native text editors", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  it("edits text natively and emits the complete value", () => {
    function TextInput() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            placeholder="Type here..."
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "h i")

    expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
      [
        "Value: hi",
      ]
    `)
    expect(testRoot.renderer.getPaintedText()).toContain("hi")
  })

  it("delivers bound navigation and deletion keys through the editor target", () => {
    const editorEvents: EventPayload[] = []
    const ancestorEvents: EventPayload[] = []

    testRoot.render(
      <div
        style={{ width: 400, height: 160 }}
        onKeyDown={(event: EventPayload) => ancestorEvents.push(event)}
      >
        <textarea
          style={{ width: 300 }}
          onKeyDown={(event: EventPayload) => editorEvents.push(event)}
        />
      </div>,
    )
    const textarea = testRoot.renderer.findByType("textarea")[0]

    for (const key of ["down", "home", "end", "backspace"]) {
      testRoot.renderer.nativeSimulateKeyDown(textarea.id, key)
    }

    expect(editorEvents.map((event) => event.key)).toEqual([
      "ArrowDown",
      "Home",
      "End",
      "Backspace",
    ])
    expect(ancestorEvents.map((event) => event.key)).toEqual([
      "ArrowDown",
      "Home",
      "End",
      "Backspace",
    ])
    expect(editorEvents).toHaveLength(4)
    expect(ancestorEvents).toHaveLength(4)
    expect(editorEvents.every((event) => event.target.id === textarea.id)).toBe(true)
    expect(ancestorEvents.every((event) => event.target.id === textarea.id)).toBe(true)
  })

  it("lets the editor keydown cancel a navigation default", () => {
    function Textarea({ prevent }: { prevent: boolean }) {
      const [text, setText] = useState("")
      return (
        <textarea
          value={text}
          style={{ width: 300 }}
          onChange={(event: EventPayload) => setText(event.value ?? "")}
          onKeyDown={(event: EventPayload) => {
            if (prevent && event.key === "ArrowLeft") event.preventDefault()
          }}
        />
      )
    }

    testRoot.render(<Textarea prevent />)
    let textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "a b left c")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("abc")

    testRoot.render(null)
    testRoot.render(<Textarea prevent={false} />)
    textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "a b left c")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("acb")
  })

  it("lets an ancestor keydown cancel an editor navigation default", () => {
    function Textarea({ prevent }: { prevent: boolean }) {
      const [text, setText] = useState("")
      return (
        <div
          style={{ width: 400, height: 160 }}
          onKeyDown={(event: EventPayload) => {
            if (prevent && event.key === "ArrowLeft") event.preventDefault()
          }}
        >
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
        </div>
      )
    }

    testRoot.render(<Textarea prevent />)
    let textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "a b left c")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("abc")

    testRoot.render(null)
    testRoot.render(<Textarea prevent={false} />)
    textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "a b left c")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("acb")
  })

  it("keeps deferred editor actions in batch order", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <textarea
          value={text}
          style={{ width: 300 }}
          onChange={(event: EventPayload) => setText(event.value ?? "")}
        />
      )
    }

    testRoot.render(<Textarea />)
    let textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "h i shift-enter left x")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("hix\n")

    testRoot.render(null)
    testRoot.render(<Textarea />)
    textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a b left left c")
    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("cab")
  })

  it("moves to the document start with cmd-left before the next insertion", () => {
    function TextInput() {
      const [text, setText] = useState("ab")
      return (
        <input
          value={text}
          style={{ width: 300 }}
          onChange={(event: EventPayload) => setText(event.value ?? "")}
        />
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "cmd-left c")

    expect(testRoot.renderer.getInputValue(input.id)).toBe("cab")
  })

  it("inserts a newline on Enter and Shift+Enter in a textarea", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            placeholder="Write a message..."
            minRows={1}
            maxRows={4}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]

    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "h i shift-enter t h e r e")
    expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
      [
        "Value: \"hi\\nthere\"",
      ]
    `)

    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "enter")
    expect(testRoot.renderer.getAllText()).toContain('Value: "hi\\nthere\\n"')
  })

  it("lets a composer submit on Enter and insert a newline on Shift+Enter", () => {
    function Composer() {
      const [text, setText] = useState("")
      const [submits, setSubmits] = useState(0)
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            minRows={1}
            maxRows={4}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDown={(event: EventPayload) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                setSubmits((count) => count + 1)
              }
            }}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
          <text>{`Submits: ${submits}`}</text>
        </div>
      )
    }

    testRoot.render(<Composer />)
    const textarea = testRoot.renderer.findByType("textarea")[0]

    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "h i enter")
    expect(testRoot.renderer.getAllText()).toContain('Value: "hi"')
    expect(testRoot.renderer.getAllText()).toContain("Submits: 1")

    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "shift-enter x")
    expect(testRoot.renderer.getAllText()).toContain('Value: "hi\\nx"')
    expect(testRoot.renderer.getAllText()).toContain("Submits: 1")
  })

  it("delivers Enter on an input through onKeyDown and inserts nothing", () => {
    const keys: string[] = []
    function TextInput() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDown={(event: EventPayload) => keys.push(event.key)}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "a enter b")

    expect(testRoot.renderer.getAllText()).toContain("Value: ab")
    expect(keys).toContain("Enter")
  })

  it("cancels the newline from a capture handler", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDownCapture={(event: EventPayload) => {
              if (event.key === "Enter") event.preventDefault()
            }}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "enter")

    expect(testRoot.renderer.getAllText()).toContain('Value: ""')
  })

  it("serializes a batch of native keys behind a deferred Enter, in dispatch order", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "h i shift-enter x")

    expect(testRoot.renderer.getAllText()).toContain('Value: "hi\\nx"')
  })

  it("applies a batched key that moves the caret only after the Enter ahead of it resolves", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "h i shift-enter left")

    expect(testRoot.renderer.getInputValue(textarea.id)).toBe("hi\n")
    expect(testRoot.renderer.getInputSelection(textarea.id)).toEqual([2, 2, 0])
  })

  it("resolves two consecutive Enters from the same native batch one at a time", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "a\\n\\nb"')
  })

  it("still applies a batched key that followed a cancelled Enter, without the newline", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDown={(event: EventPayload) => {
              if (event.key === "Enter") event.preventDefault()
            }}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "ab"')
  })

  it("lets an ancestor-only onKeyDown cancel a batched Enter's newline", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div
          style={{ width: 400, height: 160 }}
          onKeyDown={(event: EventPayload) => {
            if (event.key === "Enter") event.preventDefault()
          }}
        >
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "ab"')
  })

  it("still inserts the newline when an ancestor onKeyDown sees Enter but does not cancel it", () => {
    const seen: string[] = []
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }} onKeyDown={(event: EventPayload) => seen.push(event.key)}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "a\\nb"')
    expect(seen).toContain("Enter")
  })

  it("resolves a plain Enter with its own answer, not an outstanding non-deferrable ctrl-Enter's", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDown={(event: EventPayload) => {
              if (event.key === "Enter" && event.ctrlKey) event.preventDefault()
            }}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a ctrl-enter enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "a\\nb"')
  })

  it("never delivers a keyup before the keydown it pairs with, even when the keydown was deferred", () => {
    const seen: string[] = []
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <textarea
          value={text}
          style={{ width: 300 }}
          onChange={(event: EventPayload) => setText(event.value ?? "")}
          onKeyDown={(event: EventPayload) => seen.push(`keydown:${event.key}`)}
          onKeyUp={(event: EventPayload) => seen.push(`keyup:${event.key}`)}
        />
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter b")

    expect(seen).toEqual([
      "keydown:a",
      "keyup:a",
      "keydown:Enter",
      "keyup:Enter",
      "keydown:b",
      "keyup:b",
    ])
  })

  it("reaches JS and inserts the newline for a batched Enter with no onKeyDown anywhere", () => {
    function Textarea() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokeBatch(textarea.id, "a enter b")

    expect(testRoot.renderer.getAllText()).toContain('Value: "a\\nb"')
  })

  it("deletes to the start of the line with cmd-backspace", () => {
    function Textarea() {
      const [text, setText] = useState("keep\nhello world")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "cmd-backspace")

    expect(testRoot.renderer.getAllText()).toContain('Value: "keep\\n"')
  })

  it("deletes to the end of the line with cmd-delete", () => {
    function Textarea() {
      const [text, setText] = useState("keep\nhello world")
      return (
        <div style={{ width: 400, height: 160 }}>
          <textarea
            value={text}
            style={{ width: 300 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${JSON.stringify(text)}`}</text>
        </div>
      )
    }

    testRoot.render(<Textarea />)
    const textarea = testRoot.renderer.findByType("textarea")[0]
    testRoot.renderer.nativeSimulateKeystrokes(textarea.id, "cmd-left cmd-delete")

    expect(testRoot.renderer.getAllText()).toContain('Value: "keep\\n"')
  })

  it("deletes one complete grapheme", () => {
    function TextInput() {
      const [text, setText] = useState("A🙂")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "backspace")

    expect(testRoot.renderer.getAllText()).toContain("Value: A")
  })

  it("moves the caret, replaces a selection, and undoes the edit", () => {
    function TextInput() {
      const [text, setText] = useState("ac")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "left b shift-left X")
    expect(testRoot.renderer.getAllText()).toContain("Value: aXc")

    testRoot.renderer.nativeSimulateKeystrokes(input.id, "cmd-z")
    expect(testRoot.renderer.getAllText()).toContain("Value: abc")
  })

  it("undoes a contiguous typing run as one edit", () => {
    function TextInput() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "a b c cmd-z")

    expect(testRoot.renderer.getAllText()).toContain("Value: ")
    expect(testRoot.renderer.getAllText()).not.toContain("Value: ab")
  })

  it("does not coalesce typing after 700ms", () => {
    function TextInput() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "a")
    testRoot.renderer.advanceTime(800)
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "b cmd-z")

    expect(testRoot.renderer.getAllText()).toContain("Value: a")
  })

  it("undoes contiguous backward deletion as one edit", () => {
    function TextInput() {
      const [text, setText] = useState("abcd")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "backspace backspace cmd-z")

    expect(testRoot.renderer.getAllText()).toContain("Value: abcd")
  })

  it("undoes contiguous forward deletion as one edit", () => {
    function TextInput() {
      const [text, setText] = useState("abcd")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "cmd-left delete delete cmd-z")

    expect(testRoot.renderer.getAllText()).toContain("Value: abcd")
  })

  // Native binds word motion to alt on macOS and to ctrl everywhere else, the
  // same split every platform's own text fields use, so the test has to ask
  // for the chord this host actually binds.
  it("moves by words with the platform's word chord", () => {
    const word = process.platform === "darwin" ? "alt" : "ctrl"
    function TextInput() {
      const [text, setText] = useState("hello world")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(
      input.id,
      `${word}-left X ${word}-right Y`,
    )

    expect(testRoot.renderer.getAllText()).toContain("Value: hello XworldY")
  })

  it("blocks editing when readOnly", () => {
    function TextInput() {
      const [text, setText] = useState("locked")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            readOnly
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "backspace a")

    expect(testRoot.renderer.getAllText()).toContain("Value: locked")
  })

  it("forwards the caret theme to the native editor", () => {
    testRoot.render(
      <input
        autoFocus
        value=""
        theme={{ caret: "#22c55e" }}
        style={{ width: 300, height: 40 }}
      />
    )

    const input = testRoot.renderer.findByType("input")[0]
    expect(input.customProps?.theme).toMatchInlineSnapshot(`
      {
        "caret": "#22c55e",
      }
    `)
  })

  it("applies external value changes", () => {
    function TextInput() {
      const [text, setText] = useState("draft")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            placeholder="Empty"
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
            onKeyDown={(event: EventPayload) => {
              if (event.key === "Enter") setText("")
            }}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateKeystrokes(input.id, "enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: ")
    expect(testRoot.renderer.getPaintedText()).toContain("Empty")
  })

  it("focuses from a real mouse click", () => {
    function TextInput() {
      const [text, setText] = useState("")
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value={text}
            style={{ width: 300, height: 40 }}
            onChange={(event: EventPayload) => setText(event.value ?? "")}
          />
          <text>{`Value: ${text}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    testRoot.renderer.nativeSimulateClick(250, 20)
    testRoot.renderer.simulateKeystrokes("a")

    expect(testRoot.renderer.getAllText()).toContain("Value: a")
  })

  it("keeps primary click and keyboard events available", () => {
    let click: EventPayload | undefined

    function TextInput() {
      const [clicks, setClicks] = useState(0)
      const [keys, setKeys] = useState(0)
      return (
        <div style={{ width: 400, height: 100 }}>
          <input
            value=""
            style={{ width: 300, height: 40 }}
            onClick={(event) => {
              click = event
              setClicks((count) => count + 1)
            }}
            onKeyDown={() => setKeys((count) => count + 1)}
          />
          <text>{`Events: ${clicks}/${keys}`}</text>
        </div>
      )
    }

    testRoot.render(<TextInput />)
    const input = testRoot.renderer.findByType("input")[0]
    testRoot.renderer.nativeSimulateMouseDown(150, 20, 0)
    testRoot.renderer.nativeSimulateMouseUp(150, 20, 0)
    testRoot.renderer.nativeSimulateKeyDown(input.id, "a")

    expect(testRoot.renderer.getAllText()).toContain("Events: 1/1")
    expect(click).toMatchObject({ button: 0, isRightClick: false })

    testRoot.renderer.nativeSimulateMouseDown(150, 20, 2)
    testRoot.renderer.nativeSimulateMouseUp(150, 20, 2)
    expect(testRoot.renderer.getAllText()).toContain("Events: 1/1")
  })

  it("sizes a row from the element's fontSize and lineHeight", () => {
    const { render, renderer } = createTestRoot({ scaleFactor: 1 })
    render(
      <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <textarea data-testid="scaled" minRows={1} maxRows={1} style={{ width: 300, fontSize: 28 }} />
        <textarea data-testid="exact" minRows={1} maxRows={1} style={{ width: 300, lineHeight: "40px" }} />
        <textarea data-testid="rows" minRows={3} maxRows={3} style={{ width: 300, lineHeight: "20px" }} />
        <input data-testid="input" style={{ width: 300, fontSize: 28 }} />
      </div>,
    )
    const heightOf = (id: string) => renderer.getElementBounds(renderer.findByTestId(id)!.id)!.height
    // gpui's default leading is 1.618: round(28 * 1.618) = 45. Before the fix every row was 26.
    expect(heightOf("scaled")).toBe(45)
    expect(heightOf("exact")).toBe(40)
    expect(heightOf("rows")).toBe(60)
    expect(heightOf("input")).toBe(45)
  })

  function editorBounds(type: "input" | "textarea") {
    const node = testRoot.renderer.findByType(type)[0]
    expect(node).toBeDefined()
    const bounds = testRoot.renderer.getElementBounds(node.id)
    expect(bounds).not.toBeNull()
    return bounds!
  }

  it("sizes a row from style.lineHeight", () => {
    testRoot.render(
      <textarea value="one" minRows={1} maxRows={8} style={{ width: 300, lineHeight: "30px" }} />,
    )
    expect(editorBounds("textarea").height).toBe(30)
  })

  it("multiplies lineHeight by minRows", () => {
    testRoot.render(
      <textarea value="one" minRows={3} maxRows={8} style={{ width: 300, lineHeight: "30px" }} />,
    )
    expect(editorBounds("textarea").height).toBe(90)
  })

  it("scales a row from fontSize when lineHeight is unset", () => {
    testRoot.render(<input value="one" style={{ width: 300, fontSize: 28 }} />)
    // GPUI default leading is phi, so 28px * 1.618 rounds to 45.
    expect(editorBounds("input").height).toBe(45)
  })

  it("uses lineHeight on a single-line input", () => {
    testRoot.render(<input value="one" style={{ width: 300, lineHeight: "22px" }} />)
    expect(editorBounds("input").height).toBe(22)
  })
})
