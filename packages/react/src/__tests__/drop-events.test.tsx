import { afterEach, beforeEach, describe, expect, it } from "vitest"
import React from "react"
import type { EventPayload } from "@gpuix/native"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
} from "../testing"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

type DragHandlers = {
  onDragEnter: () => void
  onDragOver: (event: { preventDefault(): void }) => void
  onDragLeave: () => void
  onDrop: () => void
}

const imageSource =
  `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#5ca9ff"/></svg>',
  ).toString("base64")}`

const customDragHosts: Array<[
  string,
  (handlers: DragHandlers) => React.ReactElement,
]> = [
  ["input", (handlers) => <input {...handlers} value="" style={{ width: 200, height: 40 }} />],
  [
    "textarea",
    (handlers) => <textarea {...handlers} value="" style={{ width: 200, height: 80 }} />,
  ],
  ["img", (handlers) => <img {...handlers} src={imageSource} style={{ width: 200, height: 120 }} />],
  [
    "svg",
    (handlers) => (
      <svg
        {...handlers}
        source='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#5ca9ff"/></svg>'
      />
    ),
  ],
  ["code", (handlers) => <code {...handlers} code="drop" language="txt" style={{ width: 200 }} />],
  [
    "markdown",
    (handlers) => <markdown {...handlers} source="drop" style={{ width: 200, height: 40 }} />,
  ],
  [
    "diff",
    (handlers) => (
      <diff
        {...handlers}
        patch={'diff --git a/drop.txt b/drop.txt\n--- a/drop.txt\n+++ b/drop.txt\n@@ -1 +1 @@\n-old\n+new'}
        style={{ width: 200, height: 60 }}
      />
    ),
  ],
  [
    "anchored",
    (handlers) => (
      <anchored
        {...handlers}
        position={{ x: 40, y: 40 }}
        deferred={false}
        style={{ width: 200, height: 80 }}
      >
        <text>drop</text>
      </anchored>
    ),
  ],
]

function dragHandlers(received: string[]): DragHandlers {
  return {
    onDragEnter: () => received.push("enter"),
    onDragOver: (event) => {
      received.push("over")
      event.preventDefault()
    },
    onDragLeave: () => received.push("leave"),
    onDrop: () => received.push("drop"),
  }
}

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

  it("delivers an accepted drop to onDropCapture", () => {
    const received: string[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => event.preventDefault()}
        onDropCapture={() => received.push("dropCapture")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop-capture.txt",
    ])

    expect(received).toEqual(["dropCapture"])
  })

  it("runs an ancestor drop capture handler before the target bubble handler", () => {
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
        onDropCapture={() => received.push("outer capture")}
      >
        <div
          style={{ width: 100, height: 100 }}
          onDrop={() => received.push("inner bubble")}
        />
      </div>,
    )

    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-drop-capture-order.txt",
    ])

    expect(received).toEqual(["outer capture", "inner bubble"])
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

  for (const [host, renderHost] of customDragHosts) {
    it(`delivers the complete external drag lifecycle on <${host}>`, () => {
      const received: string[] = []

      testRoot.render(renderHost(dragHandlers(received)))
      testRoot.renderer.nativeSimulateFileDrop(50, 50, [
        `/tmp/gpuix-${host}-drop.txt`,
      ])

      expect(received).toContain("enter")
      expect(received).toContain("over")
      expect(received).toContain("drop")
      expect(received).not.toContain("leave")
    })

    it(`leaves <${host}> after an external drag exits`, () => {
      const received: string[] = []

      testRoot.render(renderHost(dragHandlers(received)))
      testRoot.renderer.nativeSimulateFileDragMove(50, 50, [
        `/tmp/gpuix-${host}-drag.txt`,
      ])
      testRoot.renderer.nativeSimulateFileDragExit()

      expect(received).toEqual(["enter", "over", "leave"])
    })
  }

  it("clears the ancestor acceptance path when its active child is removed", () => {
    const received: string[] = []
    const renderTree = (withDragOver: boolean, withChild: boolean) => (
      <div
        style={{ width: 300, height: 200 }}
        onDragOver={withDragOver ? (event) => event.preventDefault() : undefined}
        onDrop={() => received.push("drop")}
      >
        {withChild ? (
          <div
            style={{ width: 100, height: 100 }}
            onDragOver={(event) => event.preventDefault()}
          />
        ) : null}
      </div>
    )

    testRoot.render(renderTree(true, true))
    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-remove-child.txt",
    ])

    // The old child is gone while GPUI still has an active drag. Submit on the
    // parent without a new Entered/dragOver phase; the stale child acceptance
    // must not authorize it.
    testRoot.render(renderTree(false, false))
    testRoot.renderer.nativeSimulateFileDropSubmit(40, 40)

    expect(received).toEqual([])
  })

  it("submits an accepted drag without synthesizing dragLeave", () => {
    const received: string[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragEnter={() => received.push("enter")}
        onDragOver={(event) => {
          received.push("over")
          event.preventDefault()
        }}
        onDragLeave={() => received.push("leave")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-submit-without-leave.txt",
    ])
    testRoot.renderer.nativeSimulateFileDropSubmit(40, 40)

    expect(received).toEqual(["enter", "over"])
  })

  it("clears native drag state when the active target is detached", () => {
    const received: string[] = []

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => received.push("leave")}
        onDrop={() => received.push("drop")}
      />,
    )
    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-detached-target.txt",
    ])

    testRoot.render(null)
    testRoot.renderer.nativeSimulateFileDropSubmit(40, 40)

    expect(received).toEqual([])
  })

  it("clears acceptance when dragLeave throws", () => {
    const received: string[] = []
    let preventNextOver = true

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => {
          if (preventNextOver) {
            preventNextOver = false
            event.preventDefault()
          }
        }}
        onDragLeave={() => {
          received.push("leave")
          throw new Error("dragLeave failed")
        }}
        onDrop={() => received.push("drop")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-throwing-leave.txt",
    ])
    try {
      testRoot.renderer.nativeSimulateFileDragExit()
    } catch {
      // The test seam may surface the handler error directly on some React builds.
    }
    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-after-throwing-leave.txt",
    ])

    expect(received).toEqual(["leave"])
  })

  it("clears acceptance when legacy fileDrop throws", () => {
    const legacy: string[] = []
    const drops: string[] = []
    let preventNextOver = true
    let throwNextFileDrop = true

    testRoot.render(
      <div
        style={{ width: 200, height: 200 }}
        onDragOver={(event) => {
          if (preventNextOver) {
            preventNextOver = false
            event.preventDefault()
          }
        }}
        onFileDrop={() => {
          legacy.push("legacy")
          if (throwNextFileDrop) {
            throwNextFileDrop = false
            throw new Error("fileDrop failed")
          }
        }}
        onDrop={() => drops.push("drop")}
      />,
    )

    testRoot.renderer.nativeSimulateFileDragMove(40, 40, [
      "/tmp/gpuix-throwing-file-drop.txt",
    ])
    try {
      testRoot.renderer.nativeSimulateFileDropSubmit(40, 40)
    } catch {
      // The test seam may surface the handler error directly on some React builds.
    }
    testRoot.renderer.nativeSimulateFileDrop(40, 40, [
      "/tmp/gpuix-after-throwing-file-drop.txt",
    ])

    expect(legacy).toEqual(["legacy", "legacy"])
    expect(drops).toEqual([])
  })
})
