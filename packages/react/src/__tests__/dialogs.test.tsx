import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  showDirectoryPicker,
  showOpenFilePicker,
  showSaveFilePicker,
} from "../dialogs.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("dialogs", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot()
    screen.render(<div />)
  })

  afterEach(() => {
    screen.unmount()
  })

  it("returns scripted paths from an open picker", async () => {
    screen.renderer.setNextPickerResult(["/a", "/b"])

    await expect(showOpenFilePicker({ multiple: true })).resolves.toEqual(["/a", "/b"])
    expect(screen.renderer.pickerRequests[0]).toMatchObject({
      kind: "open",
      options: { multiple: true },
    })
  })

  it("rejects cancellation with AbortError", async () => {
    screen.renderer.setNextPickerResult(null)

    await expect(showDirectoryPicker()).rejects.toMatchObject({
      name: "AbortError",
      message: "The user aborted a request.",
    })
  })

  it("returns a scripted save path and records its suggested name", async () => {
    screen.renderer.setNextPickerResult("/saved.txt")

    await expect(showSaveFilePicker({ suggestedName: "x.txt" })).resolves.toBe("/saved.txt")
    expect(screen.renderer.pickerRequests[0]).toMatchObject({
      kind: "save",
      options: { suggestedName: "x.txt" },
    })
  })

  it("requires a scripted result", () => {
    expect(() => showOpenFilePicker()).toThrow(
      "No picker result scripted; call setNextPickerResult() first"
    )
  })
})
