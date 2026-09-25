/// Shared by the `window-reuse` fixtures, which `testing-window-reuse.test.tsx`
/// runs in one worker under `isolate: false`. Each fixture first reads the
/// window-level state a test can observe, then leaves all of it dirty for
/// whichever fixture runs next.
///
/// The first fixture a worker runs opens the window, so what it reads is a
/// fresh window's state; it records that reading, and the window, on
/// `globalThis`, which `isolate: false` keeps for the whole worker. Every later
/// fixture must get the same window back and read the same state from it.

import React, { useEffect } from "react"
import { expect } from "vitest"
import { requestAnimationFrame } from "@gpuix/react"
import { render, type RenderResult, type TestRenderer } from "@gpuix/react/testing"

interface WorkerRecord {
  renderer: TestRenderer
  state: WindowState
}

const WORKER_RECORD = Symbol.for("gpuix.window-reuse-fixture")

/** Frame callbacks that ran, for whichever file queued them to be caught
 *  running in the next one. */
const FRAMES_RUN = Symbol.for("gpuix.window-reuse-fixture.frames")

type WorkerGlobal = typeof globalThis & {
  [WORKER_RECORD]?: WorkerRecord
  [FRAMES_RUN]?: string[]
}

function framesRun(): string[] {
  const worker = globalThis as WorkerGlobal
  return (worker[FRAMES_RUN] ??= [])
}

/** Queues an animation frame on mount and never cancels it. */
function PendingFrame() {
  useEffect(() => {
    requestAnimationFrame(() => framesRun().push("requestAnimationFrame"))
  }, [])
  return null
}

function Probe({ trace }: { trace: string[] }) {
  return (
    <div
      style={{ width: 400, height: 200 }}
      onPointerMove={(event) => trace.push(`move:${event.buttons}`)}
      onDragEnter={() => trace.push("drag-enter")}
      onDragLeave={() => trace.push("drag-leave")}
    >
      <div
        style={{ width: 120, height: 60, backgroundColor: "#3366ff" }}
        onPointerDown={(event) => {
          trace.push(`down:${event.buttons}`)
          event.setPointerCapture()
        }}
        onPointerUp={() => trace.push("up")}
        onClick={() => trace.push("click")}
      />
      <div
        style={{ width: 120, height: 60, backgroundColor: "#ff6633" }}
        onPointerDown={() => trace.push("other-down")}
      />
    </div>
  )
}

type WindowState = ReturnType<typeof readWindowState>

function scriptedPicker(renderer: TestRenderer): string {
  try {
    void renderer.promptForPaths({}).catch(() => {})
    return "scripted"
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function menuAction(renderer: TestRenderer, id: string): string {
  try {
    renderer.simulateMenuAction(id)
    return "ran"
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Everything here is either a window-level setting or something a leftover
 *  one would change. Timings are left out; only their presence counts. */
function readWindowState(screen: RenderResult, trace: string[]) {
  const { renderer } = screen
  const frameRequests = renderer.getAnimationFrameRequestCount()
  renderer.advanceAsyncClock(16)
  const frames = [...framesRun()]
  framesRun().length = 0
  const webGpuDevice = renderer.createWebGpuDevice()
  renderer.destroyWebGpuDevice(webGpuDevice)
  const stats = renderer.getDebugFrameOverlayStats()
  const idle = {
    hasMainMenu: renderer.hasMainMenu(),
    customMenuAction: menuAction(renderer, "leftover"),
    overlay: renderer.getDebugFrameOverlay(),
    overlayFrames: stats.frames,
    overlaySamples: stats.samples,
    overlayHasTimings: stats.currentMs !== null && stats.currentMs !== undefined,
    clipboard: renderer.getClipboardText(),
    pickerRequests: renderer.pickerRequests.length,
    scriptedPicker: scriptedPicker(renderer),
    active: renderer.isActive(),
    activeElement: renderer.getActiveElement(),
    selectedText: renderer.getSelectedText(),
    windowSize: renderer.getWindowSize(),
    pendingEvents: renderer.drainEvents().length,
    frameRequests,
    frames,
    webGpuDevice,
  }

  // Held buttons and a leftover capture both show up in what a fresh
  // press-move-release sequence reports: the buttons a move carries, and
  // whether the release and click reach the element that was pressed.
  renderer.nativeSimulateMouseMove(300, 30)
  renderer.nativeSimulateMouseDown(20, 20)
  renderer.nativeSimulateMouseMove(40, 30, 0)
  renderer.nativeSimulateMouseUp(40, 30, 0)
  renderer.nativeSimulateMouseDown(20, 80)
  renderer.nativeSimulateMouseUp(20, 80, 0)
  renderer.nativeSimulateFileDragMove(200, 100, ["/probe.txt"])
  renderer.nativeSimulateFileDragExit()
  const pointer = [...trace]
  trace.length = 0

  return { ...idle, pointer }
}

export function expectFreshWindow(): void {
  const trace: string[] = []
  const screen = render(<Probe trace={trace} />)
  const state = readWindowState(screen, trace)

  const worker = globalThis as WorkerGlobal
  const record = worker[WORKER_RECORD]
  if (record === undefined) {
    worker[WORKER_RECORD] = { renderer: screen.renderer, state }
    return
  }
  expect(screen.renderer, "the window is reused across files").toBe(record.renderer)
  expect(state).toEqual(record.state)
}

export function dirtyWindow(): void {
  const trace: string[] = []
  const screen = render(
    <>
      <Probe trace={trace} />
      <PendingFrame />
    </>
  )
  const { renderer } = screen

  renderer.requestFrame(() => framesRun().push("renderer.requestFrame"))
  renderer.createWebGpuDevice()
  renderer.setMenus([
    { name: "Leftover", items: [{ kind: "action", id: "leftover", label: "Leftover" }] },
  ])
  renderer.setDebugFrameOverlay("full")
  renderer.flush()
  renderer.setClipboardText("leftover")
  renderer.setNextPickerResult("/leftover")
  // A press that is never released, on an element that captures the pointer.
  renderer.nativeSimulateMouseDown(20, 20)
  renderer.nativeSimulateMouseMove(300, 30, 0)
  renderer.nativeSimulateFileDragMove(200, 100, ["/leftover.txt"])
}
