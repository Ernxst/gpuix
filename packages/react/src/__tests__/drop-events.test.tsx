import { afterEach, beforeEach, describe, expect, it } from "vitest"
import React from "react"
import type { EventPayload } from "@gpuix/native"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
} from "../testing"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("DOM file drop events", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  afterEach(() => {
    testRoot.unmount()
  })

  it("delivers file names and paths to an accepted drop", () => {
    const received: Array<{
      names: string[]
      paths: string[]
      length: number
      firstName: string | null
    }> = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const files = event.dataTransfer.files
          received.push({
            names: files.map((file) => file.name),
            paths: files.map((file) => file.path),
            length: files.length,
            firstName: files.item(0)?.name ?? null,
          })
        }}
      />,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop-a.txt",
      "/tmp/gpuix-drop-b.png",
    ])

    expect(received).toEqual([
      {
        names: ["gpuix-drop-a.txt", "gpuix-drop-b.png"],
        paths: ["/tmp/gpuix-drop-a.txt", "/tmp/gpuix-drop-b.png"],
        length: 2,
        firstName: "gpuix-drop-a.txt",
      },
    ])
  })

  it("does not deliver a drop without a prevented dragOver", () => {
    const received: string[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDrop={() => received.push("drop")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop.txt",
    ])

    expect(received).toEqual([])
  })

  it("emits drag enter, over, and leave in order", () => {
    const received: string[] = []
    const dragOverFileLengths: number[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragEnter={() => received.push("dragEnter")}
        onDragOver={(event) => {
          received.push("dragOver")
          dragOverFileLengths.push(event.dataTransfer.files.length)
        }}
        onDragLeave={() => received.push("dragLeave")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-drag.txt",
    ])
    expect(received).toEqual(["dragEnter", "dragOver"])

    testRoot.renderer.nativeSimulateFileDragMove(50, 50, [
      "/tmp/gpuix-drag.txt",
    ])
    expect(received).toEqual(["dragEnter", "dragOver", "dragOver"])

    testRoot.renderer.nativeSimulateFileDragExit()
    expect(received).toEqual([
      "dragEnter",
      "dragOver",
      "dragOver",
      "dragLeave",
    ])
    expect(dragOverFileLengths).toEqual([0, 0])
  })

  it("bubbles an accepted drop and allows an ancestor to accept it", () => {
    const received: string[] = []

    testRoot.render(
      <div
        style={{
          width: 400,
          height: 400,
          display: "flex",
          flexDirection: "column",
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => received.push("outer")}
      >
        <div
          style={{ width: 100, height: 100 }}
          onDrop={() => received.push("inner")}
        />
      </div>,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop-child.txt",
    ])

    expect(received).toEqual(["inner", "outer"])
  })

  it("fans one native file drop out to onFileDrop and onDrop", () => {
    const legacy: EventPayload[] = []
    const drops: string[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => event.preventDefault()}
        onFileDrop={(event: EventPayload) => legacy.push(event)}
        onDrop={() => drops.push("drop")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop-legacy.txt",
    ])

    expect(legacy).toHaveLength(1)
    expect(legacy[0]!.paths).toEqual(["/tmp/gpuix-drop-legacy.txt"])
    expect(drops).toEqual(["drop"])
  })
})
