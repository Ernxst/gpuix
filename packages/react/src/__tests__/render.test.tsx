/// Persist-and-remount tests for render(). bun --hot re-evaluates the entry
/// and calls render() again; the native host must stay the same instance.

import { spawn } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import {
  cleanup as cleanupShared,
  configuredTestWindow,
  configureTestWindow,
  createTestRoot,
  isNativeTestRendererAvailable,
  nativeTestRendererLoadError,
  render as renderShared,
  TestRenderer,
} from "../testing.js"
import { useWindowSize } from "../hooks/use-window-size.js"
import {
  installBrowserAutomation,
  render,
  resetRender,
} from "../reconciler/renderer.js"

const srcDir = fileURLToPath(new URL("..", import.meta.url))
const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

function hotAppSource(label: string): string {
  return `
import React from "react"
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { render } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}
import { requestAnimationFrame } from ${JSON.stringify(join(srcDir, "frame-clock.ts"))}

const slot = globalThis
slot.__hotEvals = (slot.__hotEvals ?? 0) + 1
if (!slot.__hotRenderer) {
  slot.__hotRenderer = new TestRenderer()
}
const renderer = slot.__hotRenderer
render(
  React.createElement(
    "div",
    {
      style: { width: 100, height: 100 },
      onClick: () => {
        slot.__hotClicks = (slot.__hotClicks ?? 0) + 1
        console.log("HOT_CLICK", ${JSON.stringify(label)}, slot.__hotClicks)
      },
    },
    ${JSON.stringify(label)}
  ),
  { renderer }
)
renderer.flush()
if (slot.__hotEvals === 1) {
  requestAnimationFrame(() => console.log("HOT_FRAME", ${JSON.stringify(label)}))
  renderer.nativeSimulateClick(10, 10)
  renderer.native.simulateClick(10, 10)
  console.log("HOT_STALE_EVENT_QUEUED")
} else {
  requestAnimationFrame(() => console.log("HOT_FRAME", ${JSON.stringify(label)}))
  await Promise.resolve()
  renderer.advanceAsyncClock(1000 / 60)
  renderer.dispatchNativeEvents()
  console.log("HOT_STALE_EVENT_DROPPED", slot.__hotClicks)
  renderer.nativeSimulateClick(10, 10)
}
console.log("HOT_EVAL", slot.__hotEvals)
console.log("HOT_LABEL", ${JSON.stringify(label)})
console.log("HOT_TEXT", JSON.stringify(renderer.getAllText()))
console.log("HOT_SAME_RENDERER", renderer === slot.__hotRenderer)
setInterval(() => {}, 1 << 30)
`
}

function hotResizeObserverAppSource(label: string): string {
  return `
import React from "react"
import ${JSON.stringify(join(srcDir, "globals.ts"))}
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { render } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}

const slot = globalThis
slot.__hotResizeEvals = (slot.__hotResizeEvals ?? 0) + 1
if (!slot.__hotResizeRenderer) {
  slot.__hotResizeRenderer = new TestRenderer()
}
const renderer = slot.__hotResizeRenderer
const target = React.createRef()
render(
  React.createElement("div", { ref: target, style: { width: 100, height: 100 } }, ${JSON.stringify(label)}),
  { renderer }
)
if (slot.__hotResizePrevious) {
  slot.__hotResizePrevious.compareDocumentPosition(target.current)
  console.log("HOT_RESIZE_POSITION", ${JSON.stringify(label)})
}
slot.__hotResizePrevious = target.current
const observer = new ResizeObserver(() => {
  slot.__hotResizeCallbacks = (slot.__hotResizeCallbacks ?? 0) + 1
  console.log("HOT_RESIZE", ${JSON.stringify(label)}, slot.__hotResizeCallbacks)
})
observer.observe(target.current)
renderer.flush()
renderer.dispatchNativeEvents()
console.log("HOT_RESIZE_EVAL", slot.__hotResizeEvals)
setInterval(() => {}, 1 << 30)
`
}

function collectOutput(child: ReturnType<typeof spawn>) {
  let buf = ""
  child.stdout?.on("data", (chunk) => {
    buf += String(chunk)
  })
  child.stderr?.on("data", (chunk) => {
    buf += String(chunk)
  })
  return {
    wait: async (match: string, timeoutMs: number) => {
      const start = Date.now()
      while (!buf.includes(match)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out waiting for ${JSON.stringify(match)}\n${buf}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return buf
    },
  }
}

describe("TestGpuixRenderer availability", () => {
  // The flag reports a compile-time fact and availability reports a runtime
  // probe, so they are not equal in general: a build with the renderer can
  // still fail to initialize on a machine without a usable GPU. Only the
  // one-way implications below are contractual.
  it("exports a constructor that explains itself when it cannot construct", () => {
    const native = createRequire(import.meta.url)("@gpuix/native") as {
      TestGpuixRenderer?: new (width?: number, height?: number) => unknown
      hasTestGpuixRenderer?: () => boolean
    }
    expect(typeof native.TestGpuixRenderer).toBe("function")
    if (native.hasTestGpuixRenderer?.() === false) {
      expect(isNativeTestRendererAvailable()).toBe(false)
      // Must be the stub's own reason, never "is not a constructor".
      expect(() => new native.TestGpuixRenderer!()).toThrow(/TestGpuixRenderer/)
    } else if (isNativeTestRendererAvailable()) {
      const renderer = new native.TestGpuixRenderer!(1, 1)
      expect(renderer).toBeTruthy()
    } else {
      // Compiled in, but this environment could not initialize it. That is an
      // environment failure, not a broken flag; require only a recorded reason.
      expect(nativeTestRendererLoadError).toBeInstanceOf(Error)
    }
  })
})

function runChild(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(output)
      } else {
        reject(
          new Error(
            `${command} exited with ${code ?? signal ?? "an unknown status"}\n${output}`
          )
        )
      }
    })
  })
}

function runChildWithStatus(
  command: string,
  args: string[],
  timeoutMs = 15_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.once("error", reject)
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`timed out waiting for child process\n${output}`))
    }, timeoutMs)
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, output })
    })
  })
}

const FATAL_HOT_PROGRAM = `
import React, { useEffect } from "react"
import { render } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}

function App() {
  useEffect(() => () => console.log("FATAL_REACT_UNMOUNTED"), [])
  return React.createElement("text", null, "fatal lifecycle smoke")
}

render(React.createElement(App), {
  title: "GPUIX fatal lifecycle smoke",
  menus: [],
  focus: false,
  errorOverlay: false,
  onTerminated: () => console.log("FATAL_TERMINATED"),
})

setTimeout(() => {
  throw new Error("INJECTED_FATAL_HOT_ERROR")
}, 50)
`

const INJECTED_ROOT_FAILURE_PROGRAM = `
import React from "react"
import { render } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}

const renderer = {
  applyBatch() { return [] },
  createElement() {},
  destroyElement() { return [] },
  appendChild() {},
  removeChild() {},
  insertBefore() {},
  setStyle() {},
  setText() {},
  setEventListener() {},
  setRoot() {},
  setCustomProp() {},
  commitMutations() {},
  setStrictStyles() {},
  requestFrame() {},
}

const root = render(React.createElement("div", { accessibilityRole: "button" }), {
  renderer,
  strictStyles: true,
  onTerminated: () => console.log("INJECTED_ROOT_TERMINATED"),
})

await new Promise((resolve) => setTimeout(resolve, 0))

const status = root.getStatus()
if (status.status !== "failed") {
  throw new Error("expected failed root status, got " + JSON.stringify(status))
}
const diagnostics = renderer.drainStyleDiagnostics?.() ?? []
if (!diagnostics.some((diagnostic) =>
  diagnostic.elementId === 0 &&
  diagnostic.elementType === "root" &&
  diagnostic.property === "status" &&
  diagnostic.value === '"failed"' &&
  diagnostic.message.includes("React root is dead after an uncaught render error")
)) {
  throw new Error("missing dead-root diagnostic: " + JSON.stringify(diagnostics))
}
console.log("INJECTED_ROOT_SURVIVED_WITH_FAILED_STATE")
`

const OWNED_ROOT_FAILURE_PROGRAM = `
import React from "react"
import { render } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}

render(React.createElement("div", { accessibilityRole: "button" }), {
  title: "GPUIX owned root failure smoke",
  menus: [],
  focus: false,
  strictStyles: true,
  errorOverlay: false,
  onTerminated: () => console.log("OWNED_ROOT_TERMINATED"),
})
`

function waitForOverlaySnippet(): string {
  return `
async function waitForOverlay(app) {
  const deadline = Date.now() + 5_000
  for (;;) {
    const count = await app.getByTestId("runtime-error-overlay").count()
    if (count === 1) return
    if (Date.now() > deadline) throw new Error("OVERLAY_TIMEOUT")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
`
}

const OVERLAY_APP_ROOT_FAILURE_PROGRAM = `
import React, { useEffect } from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}
import { App, InProcessBackend, liveRendererAsTest } from ${JSON.stringify(join(srcDir, "automation/client.ts"))}
${waitForOverlaySnippet()}
let renderer

function Boom() {
  renderer = useGpuixRequired()
  useEffect(() => {
    throw new Error("INJECTED_OVERLAY_ROOT_ERROR")
  }, [])
  return React.createElement("text", null, "overlay app root failure smoke")
}

render(React.createElement(Boom), {
  title: "GPUIX overlay app root failure smoke",
  menus: [],
  focus: false,
  errorOverlay: true,
  onTerminated: () => console.log("OVERLAY_ROOT_TERMINATED"),
})

setTimeout(async () => {
  if (!renderer) throw new Error("renderer ref was not attached")
  const app = new App(new InProcessBackend(liveRendererAsTest(renderer)))
  await waitForOverlay(app)
  console.log("OVERLAY_SHOWN")
  renderer.quit()
}, 200)
`

const OVERLAY_UNCAUGHT_EXCEPTION_PROGRAM = `
import React from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}
import { App, InProcessBackend, liveRendererAsTest } from ${JSON.stringify(join(srcDir, "automation/client.ts"))}
${waitForOverlaySnippet()}
let renderer

function App_() {
  renderer = useGpuixRequired()
  return React.createElement("text", null, "overlay uncaught exception smoke")
}

render(React.createElement(App_), {
  title: "GPUIX overlay uncaught exception smoke",
  menus: [],
  focus: false,
  errorOverlay: true,
  onTerminated: () => console.log("OVERLAY_EXCEPTION_TERMINATED"),
})

setTimeout(() => {
  throw new Error("INJECTED_OVERLAY_UNCAUGHT_EXCEPTION")
}, 50)

setTimeout(async () => {
  if (!renderer) throw new Error("renderer ref was not attached")
  const app = new App(new InProcessBackend(liveRendererAsTest(renderer)))
  await waitForOverlay(app)
  console.log("OVERLAY_SHOWN")
  renderer.quit()
}, 300)
`

const OVERLAY_FIRST_RENDER_FAILURE_PROGRAM = `
import React from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}
import { App, InProcessBackend, liveRendererAsTest } from ${JSON.stringify(join(srcDir, "automation/client.ts"))}
${waitForOverlaySnippet()}
let renderer

// A sibling that renders (and captures the renderer through the hook) before
// its invalid neighbor completes and takes the whole first commit down: React
// runs every component function in document order during the render pass,
// well before the div's completeWork() step throws.
function CaptureRenderer() {
  renderer = useGpuixRequired()
  return null
}

render(
  React.createElement(
    React.Fragment,
    null,
    React.createElement(CaptureRenderer),
    React.createElement("div", { accessibilityRole: "button" })
  ),
  {
    title: "GPUIX overlay first-render failure smoke",
    menus: [],
    focus: false,
    strictStyles: true,
    errorOverlay: true,
    onTerminated: () => console.log("OVERLAY_FIRST_RENDER_TERMINATED"),
  }
)

setTimeout(async () => {
  if (!renderer) throw new Error("renderer ref was not attached")
  const app = new App(new InProcessBackend(liveRendererAsTest(renderer)))
  await waitForOverlay(app)
  console.log("OVERLAY_SHOWN")
  renderer.quit()
}, 200)
`

const OVERLAY_RELOAD_PROGRAM = `
import React, { useEffect } from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}
import { App, InProcessBackend, liveRendererAsTest } from ${JSON.stringify(join(srcDir, "automation/client.ts"))}
${waitForOverlaySnippet()}
let renderer
let failed = false

function ReloadApp() {
  renderer = useGpuixRequired()
  useEffect(() => {
    if (!failed) {
      failed = true
      throw new Error("INJECTED_RELOAD_ERROR")
    }
  }, [])
  return React.createElement("text", { "data-testid": "reload-app-content" }, "reload app content")
}

render(React.createElement(ReloadApp), {
  title: "GPUIX overlay reload smoke",
  menus: [],
  focus: false,
  errorOverlay: true,
  onTerminated: () => console.log("OVERLAY_RELOAD_TERMINATED"),
})

setTimeout(async () => {
  if (!renderer) throw new Error("renderer ref was not attached")
  const app = new App(new InProcessBackend(liveRendererAsTest(renderer)))
  await waitForOverlay(app)
  console.log("OVERLAY_SHOWN")
  await app.getByTestId("runtime-error-reload").click()
  const deadline = Date.now() + 5_000
  for (;;) {
    const overlayCount = await app.getByTestId("runtime-error-overlay").count()
    const contentCount = await app.getByTestId("reload-app-content").count()
    if (overlayCount === 0 && contentCount === 1) break
    if (Date.now() > deadline) throw new Error("RELOAD_TIMEOUT")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  console.log("RELOAD_RESTORED_CONTENT")
  renderer.quit()
}, 200)
`

const OVERLAY_EVENT_HANDLER_THROW_PROGRAM = `
import React from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}
import { App, InProcessBackend, liveRendererAsTest } from ${JSON.stringify(join(srcDir, "automation/client.ts"))}
${waitForOverlaySnippet()}
let renderer

function App_() {
  renderer = useGpuixRequired()
  return React.createElement(
    "div",
    {
      "data-testid": "click-boom",
      role: "button",
      style: { width: 100, height: 40 },
      onClick: () => {
        throw new Error("INJECTED_EVENT_HANDLER_ERROR")
      },
    },
    React.createElement("text", null, "click me")
  )
}

render(React.createElement(App_), {
  title: "GPUIX overlay event handler throw smoke",
  menus: [],
  focus: false,
  errorOverlay: true,
  onTerminated: () => console.log("OVERLAY_EVENT_TERMINATED"),
})

setTimeout(async () => {
  if (!renderer) throw new Error("renderer ref was not attached")
  const app = new App(new InProcessBackend(liveRendererAsTest(renderer)))
  await app.getByTestId("click-boom").click()
  await waitForOverlay(app)
  console.log("OVERLAY_SHOWN")
  renderer.quit()
}, 200)
`

const PROGRAMMATIC_QUIT_PROGRAM = `
import React, { useEffect } from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}

let renderer

function App() {
  renderer = useGpuixRequired()
  useEffect(() => () => console.log("QUIT_REACT_UNMOUNTED"), [])
  return React.createElement("text", null, "programmatic quit smoke")
}

render(React.createElement(App), {
  title: "GPUIX programmatic quit smoke",
  menus: [],
  focus: false,
  onTerminated: () => console.log("QUIT_TERMINATED"),
})

setTimeout(() => renderer.quit(), 50)
`

const READABLE_FOCUS_PROGRAM = `
import React from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}

let renderer
let target

function App() {
  renderer = useGpuixRequired()
  return React.createElement(
    "div",
    { style: { width: 320, height: 160 } },
    React.createElement(
      "div",
      {
        ref: (element) => { target = element },
        tabIndex: -1,
        style: { width: 120, height: 40 },
      },
      React.createElement("text", null, "Role-less focus target")
    )
  )
}

const timeout = setTimeout(() => {
  throw new Error("READABLE_FOCUS_TIMEOUT")
}, 2_000)

render(React.createElement(App), {
  title: "GPUIX readable focus smoke",
  width: 320,
  height: 160,
  menus: [],
  focus: false,
  show: true,
})

setTimeout(() => {
  if (!target) throw new Error("focus target ref was not attached")
  if (renderer.getElementBounds(target.id) === null) {
    throw new Error("focus target did not paint")
  }

  if (renderer.getActiveElement?.() !== null) {
    throw new Error("expected no active element before focus")
  }

  renderer.focusElement(target.id)
  const focused = renderer.getActiveElement?.()
  if (focused !== target.id) {
    throw new Error("expected active element " + target.id + ", received " + focused)
  }

  renderer.blur()
  if (renderer.getActiveElement?.() !== null) {
    throw new Error("expected no active element after blur")
  }

  clearTimeout(timeout)
  console.log("READABLE_FOCUS_OK", target.id)
  renderer.quit()
}, 50)
`

const FAILING_UNMOUNT_QUIT_PROGRAM = `
import React from "react"
import { render, useGpuixRequired } from ${JSON.stringify(join(srcDir, "index.ts"))}

let renderer

function App() {
  renderer = useGpuixRequired()
  return React.createElement("text", null, "failing unmount quit smoke")
}

render(React.createElement(App), {
  title: "GPUIX failing unmount quit smoke",
  menus: [],
  focus: false,
  onTerminated: () => console.log("QUIT_FAILURE_CLEANUP_FINISHED"),
})

const applyBatch = renderer.applyBatch
renderer.applyBatch = (json) => {
  if (!renderer.isInitialized()) throw new Error("INJECTED_UNMOUNT_FAILURE")
  return applyBatch(json)
}

setTimeout(() => renderer.quit(), 50)
`

const INJECTED_NATIVE_MENU_PROGRAM = `
import React from "react"
import { GpuixRenderer } from "@gpuix/native"
import { render, resetRender } from ${JSON.stringify(join(srcDir, "reconciler/renderer.ts"))}

const renderer = new GpuixRenderer(() => {})
renderer.init({ title: "GPUIX injected menu smoke", menus: [], focus: false })

const timeout = setTimeout(() => {
  renderer.quit()
  throw new Error("INJECTED_NATIVE_MENU_TIMEOUT")
}, 1_000)

render(React.createElement("text", null, "injected native menu smoke"), {
  renderer,
  menus: [{
    name: "Smoke",
    items: [{ kind: "action", label: "Mark", id: "mark" }],
  }],
  onMenuAction: ({ id }) => {
    clearTimeout(timeout)
    console.log("INJECTED_NATIVE_MENU_ACTION", id)
    renderer.quit()
    resetRender()
  },
})

setTimeout(() => renderer.simulateMenuAction("mark"), 50)
`

const ESM_TESTING_PROGRAM = `
import {
  TestRenderer,
  isNativeTestRendererAvailable,
  nativeTestRendererLoadError,
} from "@gpuix/react/testing"

if (!isNativeTestRendererAvailable()) {
  throw nativeTestRendererLoadError ?? new Error("TestGpuixRenderer is unavailable")
}

const renderer = new TestRenderer()
renderer.applyBatch(
  JSON.stringify([
    ["createElement", 1, "text"],
    ["setText", 1, "esm test binding"],
    ["setRoot", 1],
  ])
)
renderer.flush()

if (!renderer.getPaintedText().includes("esm test binding")) {
  throw new Error("TestGpuixRenderer did not paint the ESM test binding probe")
}

console.log("ESM_TEST_BINDING_OK")
`

const NATIVE_TEST_RENDERER_SPY_PRELOAD = `
const Module = require("node:module")
const originalLoad = Module._load

globalThis.__gpuixNativeModuleLoads = 0
globalThis.__gpuixNativeTestRendererConstructions = 0

Module._load = function (request, parent, isMain) {
  if (request === "@gpuix/native") {
    globalThis.__gpuixNativeModuleLoads += 1
    return {
      TestGpuixRenderer: class TestGpuixRenderer {
        constructor() {
          globalThis.__gpuixNativeTestRendererConstructions += 1
        }
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
`

const BARE_TESTING_IMPORT_PROGRAM = `
import * as testing from "@gpuix/react/testing"

if (typeof testing.textContent !== "function") {
  throw new Error("textContent was not exported")
}
if ("getChildren" in testing || "getParent" in testing) {
  throw new Error("legacy relationship helpers are still exported")
}

if (globalThis.__gpuixNativeModuleLoads !== 0) {
  throw new Error("bare testing import loaded @gpuix/native")
}
if (globalThis.__gpuixNativeTestRendererConstructions !== 0) {
  throw new Error("bare testing import constructed TestGpuixRenderer")
}

console.log("BARE_TESTING_IMPORT_OK")
`

const LAZY_NATIVE_TEST_RENDERER_PROGRAM = `
import { isNativeTestRendererAvailable } from "@gpuix/react/testing"

if (!isNativeTestRendererAvailable()) {
  throw new Error("expected the native test renderer to initialize")
}
if (globalThis.__gpuixNativeModuleLoads !== 1) {
  throw new Error("first availability check did not load @gpuix/native exactly once")
}
if (globalThis.__gpuixNativeTestRendererConstructions !== 1) {
  throw new Error("first availability check did not construct TestGpuixRenderer exactly once")
}
if (!isNativeTestRendererAvailable()) {
  throw new Error("expected the memoised native test renderer to remain available")
}
if (globalThis.__gpuixNativeModuleLoads !== 1) {
  throw new Error("memoised availability check loaded @gpuix/native again")
}
if (globalThis.__gpuixNativeTestRendererConstructions !== 1) {
  throw new Error("memoised availability check constructed TestGpuixRenderer again")
}

console.log("LAZY_NATIVE_TEST_RENDERER_OK")
`

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describe("native test renderer diagnostics", () => {
  it("loads and constructs the native renderer only on first use", async () => {
    const preload = join(srcDir, "__tests__", "native-test-renderer-spy.tmp.cjs")
    writeFileSync(preload, NATIVE_TEST_RENDERER_SPY_PRELOAD)

    try {
      await expect(
        runChild("node", [
          "--require",
          preload,
          "--input-type=module",
          "--eval",
          BARE_TESTING_IMPORT_PROGRAM,
        ])
      ).resolves.toContain("BARE_TESTING_IMPORT_OK")
      await expect(
        runChild("node", [
          "--require",
          preload,
          "--input-type=module",
          "--eval",
          LAZY_NATIVE_TEST_RENDERER_PROGRAM,
        ])
      ).resolves.toContain("LAZY_NATIVE_TEST_RENDERER_OK")
    } finally {
      unlinkSync(preload)
    }
  })

  it("surfaces loader failures or constructs the GPU-backed renderer", () => {
    if (!isNativeTestRendererAvailable()) {
      expect(nativeTestRendererLoadError).toBeInstanceOf(Error)
      expect(() => new TestRenderer()).toThrow(nativeTestRendererLoadError!.message)
      return
    }

    expect(nativeTestRendererLoadError).toBeNull()
    resetRender()
    const renderer = new TestRenderer()
    const ignored = new TestRenderer()
    render(<text>one</text>, { renderer })
    render(<text>two</text>, { renderer: ignored })

    renderer.flush()
    expect(renderer.getAllText()).toEqual(["two"])
    expect(ignored.getAllText()).toEqual([])
  })
})

describeNative("render()", () => {
  let renderer: TestRenderer

  beforeEach(() => {
    resetRender()
    renderer = new TestRenderer()
  })

  it("renders the same logical geometry at requested 1x and 2x scales", () => {
    const renderAtScale = (scaleFactor: number) => {
      const root = createTestRoot({ width: 320, height: 200, scaleFactor })
      try {
        root.render(
          <div style={{ width: 320, height: 200 }}>
            <div
              data-testid="target"
              style={{ width: 120, height: 48, marginLeft: 24, marginTop: 16 }}
            />
          </div>
        )
        const target = root.renderer.findByTestId("target")!
        return {
          bounds: root.renderer.getElementBounds(target.id),
          window: root.renderer.getWindowSize(),
          frame: root.renderer.getAccessibilityTree().frame,
        }
      } finally {
        root.unmount()
      }
    }

    const oneX = renderAtScale(1)
    const twoX = renderAtScale(2)

    expect(oneX.window).toEqual({ width: 320, height: 200, scaleFactor: 1 })
    expect(twoX.window).toEqual({ width: 320, height: 200, scaleFactor: 2 })
    expect(oneX.bounds).toEqual({ x: 24, y: 16, width: 120, height: 48 })
    expect(twoX.bounds).toEqual(oneX.bounds)
    expect(oneX.frame).toMatchObject({
      viewport_size: { width: 320, height: 200 },
      scale_factor: 1,
    })
    expect(twoX.frame).toMatchObject({
      viewport_size: { width: 320, height: 200 },
      scale_factor: 2,
    })
  })

  it("rejects scale factors that cannot produce a window", () => {
    expect(() => new TestRenderer({ scaleFactor: 0 })).toThrow(
      "TestGpuixRenderer scale factor must be a positive, finite number"
    )
    expect(() => new TestRenderer({ scaleFactor: Number.MAX_VALUE })).toThrow(
      "TestGpuixRenderer scale factor must be a positive, finite number"
    )
  })

  // The window used to take its size and scale from whatever display the host
  // had attached, so the same test measured differently between machines — and
  // between runs on one machine, when the display changed under it.
  it("opens every default window at the same fixed geometry", () => {
    const geometry = () => {
      const root = createTestRoot()
      try {
        return root.renderer.getWindowSize()
      } finally {
        root.unmount()
      }
    }

    const first = geometry()
    const second = geometry()

    expect(first).toEqual({ width: 1280, height: 800, scaleFactor: 2 })
    expect(second).toEqual(first)
  })

  it("takes window geometry from configureTestWindow, and lets a call override it", () => {
    const geometry = (options?: Parameters<typeof createTestRoot>[0]) => {
      const root = createTestRoot(options)
      try {
        return root.renderer.getWindowSize()
      } finally {
        root.unmount()
      }
    }

    const configured = configuredTestWindow()
    try {
      configureTestWindow({ width: 640, height: 480, scaleFactor: 1 })
      expect(geometry()).toEqual({ width: 640, height: 480, scaleFactor: 1 })
      // Per field: the call moves the width and inherits the rest.
      expect(geometry({ width: 320 })).toEqual({ width: 320, height: 480, scaleFactor: 1 })
    } finally {
      configureTestWindow(configured)
    }

    expect(geometry()).toEqual({ width: 1280, height: 800, scaleFactor: 2 })
  })

  // `render()` records the geometry its shared window was built with, so a
  // `configureTestWindow` after the first render has to drop that window or it
  // would go unnoticed for the rest of the file.
  it("applies configureTestWindow to the next render() after one already ran", () => {
    const configured = configuredTestWindow()
    try {
      const before = renderShared(<text>before</text>)
      expect(before.renderer.getWindowSize()).toEqual({
        width: 1280,
        height: 800,
        scaleFactor: 2,
      })

      configureTestWindow({ width: 640, height: 480, scaleFactor: 1 })
      const after = renderShared(<text>after</text>)
      expect(after.renderer.getWindowSize()).toEqual({
        width: 640,
        height: 480,
        scaleFactor: 1,
      })
    } finally {
      configureTestWindow(configured)
      cleanupShared()
    }
  })

  it("updates every useWindowSize consumer from a native resize and releases the handler", () => {
    const windowHandlers: Array<((event: import("@gpuix/native").EventPayload) => void) | null> = []
    const renderedSizes = new Map<string, ReturnType<typeof useWindowSize>>()
    const setWindowEventHandler = renderer.setWindowEventHandler.bind(renderer)
    renderer.setWindowEventHandler = (handler) => {
      windowHandlers.push(handler)
      setWindowEventHandler(handler)
    }

    function Size({ id }: { id: string }) {
      const size = useWindowSize()
      renderedSizes.set(id, size)
      return <text data-testid={id} />
    }

    render(
      <div>
        <Size id="first" />
        <Size id="second" />
      </div>,
      { renderer }
    )
    renderer.flush()

    const initial = renderer.getWindowSize()
    expect(renderedSizes.get("first")).toEqual(initial)
    expect(renderedSizes.get("second")).toEqual(initial)
    expect(windowHandlers).toHaveLength(1)

    renderer.simulateResize(960, 540)
    renderer.dispatchNativeEvents()
    renderer.flush()

    expect(renderer.getWindowSize()).toMatchObject({ width: 960, height: 540 })
    expect(renderedSizes.get("first")).toMatchObject({ width: 960, height: 540 })
    expect(renderedSizes.get("second")).toMatchObject({ width: 960, height: 540 })

    resetRender()
    expect(windowHandlers.at(-1)).toBeNull()
  })

  it("forwards native activation changes through the window event handler", () => {
    const activations: Array<{ eventType: string; isActive?: boolean }> = []
    renderer.setWindowEventHandler((event) => activations.push(event))

    // Install the production observer before changing the offscreen window state.
    render(<div />, { renderer })
    renderer.flush()

    renderer.nativeSimulateWindowActivation(false)
    expect(renderer.isActive()).toBe(false)
    renderer.nativeSimulateWindowActivation(true)
    expect(renderer.isActive()).toBe(true)

    expect(
      activations
        .filter((event) => event.eventType === "windowActivation")
        .map(({ eventType, isActive }) => ({ eventType, isActive }))
    ).toEqual([
      { eventType: "windowActivation", isActive: false },
      { eventType: "windowActivation", isActive: true },
    ])
  })

  it("normalizes an incomplete browser window-size response", () => {
    const incompleteBrowserRenderer = Object.assign(new TestRenderer(), {
      getWindowSize: () => ({ width: 1280, height: 720 }) as unknown as ReturnType<TestRenderer["getWindowSize"]>,
    })
    let renderedSize: ReturnType<typeof useWindowSize> | undefined

    function Size() {
      renderedSize = useWindowSize()
      return <text />
    }

    render(<Size />, { renderer: incompleteBrowserRenderer })
    incompleteBrowserRenderer.flush()

    expect(renderedSize).toEqual({ width: 1280, height: 720, scaleFactor: 1 })
  })

  it("runs graceful termination exactly once", () => {
    let terminated = 0
    render(<text>Termination test</text>, {
      renderer,
      onTerminated: () => {
        terminated += 1
      },
    })

    renderer.simulateTermination()
    renderer.simulateTermination()
    expect(terminated).toBe(1)
  })

  it("replaces painted text when the entry is evaluated again", () => {
    render(<text>hello</text>, { renderer })
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["hello"])

    render(<text>world</text>, { renderer })
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["world"])
  })

  it("remounts when the app component identity changes", () => {

    function makeApp(label: string) {
      return function App() {
        const [value] = useState(label)
        return <text>{value}</text>
      }
    }

    render(React.createElement(makeApp("first")), { renderer })
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["first"])

    render(React.createElement(makeApp("second")), { renderer })
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["second"])
  })

  it("keeps the remounted tree after deferred React work", async () => {
    render(
      <div>
        <text>before</text>
      </div>,
      { renderer }
    )
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["before"])
    expect(renderer.getRoot()).toBeDefined()

    render(
      <div>
        <text>after</text>
      </div>,
      { renderer }
    )
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["after"])

    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()
    expect(renderer.getRoot()).toBeDefined()
    expect(renderer.getAllText()).toEqual(["after"])
  })

  it("always exposes browser automation on globalThis", async () => {
    Reflect.set(globalThis, "window", {})
    try {
      installBrowserAutomation(renderer)
      render(<text>automated</text>, { renderer })
      renderer.flush()

      const automation = Reflect.get(globalThis, "gpuix")
      expect(automation).toBeDefined()
      expect(await automation.getByText("automated").textContent()).toBe("automated")
    } finally {
      resetRender()
      Reflect.deleteProperty(globalThis, "window")
    }

    expect(Reflect.get(globalThis, "gpuix")).toBeUndefined()
  })

  it("loads the built testing entry point through ESM and remounts under bun --hot", async () => {
    await expect(
      runChild("node", ["--input-type=module", "--eval", ESM_TESTING_PROGRAM])
    ).resolves.toContain("ESM_TEST_BINDING_OK")
    await expect(runChild("bun", ["--eval", ESM_TESTING_PROGRAM])).resolves.toContain(
      "ESM_TEST_BINDING_OK"
    )

    const file = join(srcDir, "__tests__", "hot-app.tmp.tsx")
    writeFileSync(file, hotAppSource("hello"))

    const child = spawn("bun", ["--hot", file], {
      cwd: srcDir,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const output = collectOutput(child)

    try {
      await output.wait("HOT_LABEL hello", 15_000)
      await output.wait('HOT_TEXT ["hello"]', 1000)
      await output.wait("HOT_SAME_RENDERER true", 1000)
      await output.wait("HOT_CLICK hello 1", 1000)
      await output.wait("HOT_STALE_EVENT_QUEUED", 1000)
      await new Promise((resolve) => setTimeout(resolve, 300))

      writeFileSync(file, hotAppSource("world"))

      await output.wait("HOT_LABEL world", 15_000)
      await output.wait('HOT_TEXT ["world"]', 1000)
      await output.wait("HOT_SAME_RENDERER true", 1000)
      await output.wait("HOT_STALE_EVENT_DROPPED 1", 1000)
      await output.wait("HOT_CLICK world 2", 1000)
      const hotOutput = await output.wait("HOT_FRAME world", 1000)
      expect(hotOutput).not.toContain("HOT_FRAME hello")
    } finally {
      child.kill("SIGTERM")
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 40_000)

  it("keeps the global ResizeObserver attached to refs from a hot-reloaded tree", async () => {
    const file = join(srcDir, "__tests__", "hot-resize-observer.tmp.tsx")
    writeFileSync(file, hotResizeObserverAppSource("before"))

    const child = spawn("bun", ["--hot", file], {
      cwd: srcDir,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const output = collectOutput(child)

    try {
      await output.wait("HOT_RESIZE before 1", 15_000)
      await new Promise((resolve) => setTimeout(resolve, 300))

      writeFileSync(file, hotResizeObserverAppSource("after"))

      // The observer from the first evaluation receives its terminal entry
      // first and releases the stale native target; the new observer then
      // delivers the live ref from the remounted tree.
      await output.wait("HOT_RESIZE before 2", 15_000)
      await output.wait("HOT_RESIZE after 3", 1_000)
      await output.wait("HOT_RESIZE_POSITION after", 1_000)
      await output.wait("HOT_RESIZE_EVAL 2", 1_000)
    } finally {
      child.kill("SIGTERM")
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 40_000)

  it("quits and unmounts React when bun --hot receives an uncaught exception", async () => {
    const file = join(srcDir, "__tests__", "fatal-hot.tmp.tsx")
    writeFileSync(file, FATAL_HOT_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", ["--hot", file])
      expect(result.code, result.output).toBe(1)
      expect(result.signal).toBeNull()
      expect(result.output).toContain("INJECTED_FATAL_HOT_ERROR")
      expect(result.output.match(/^FATAL_REACT_UNMOUNTED$/gm), result.output).toHaveLength(1)
      expect(result.output.match(/^FATAL_TERMINATED$/gm), result.output).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("keeps an injected embedder alive with observable failed-root state", async () => {
    const file = join(srcDir, "__tests__", "injected-root-failure.tmp.tsx")
    writeFileSync(file, INJECTED_ROOT_FAILURE_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(
        result.output.match(/^INJECTED_ROOT_SURVIVED_WITH_FAILED_STATE$/gm),
        result.output
      ).toHaveLength(1)
      expect(result.output).not.toContain("INJECTED_ROOT_TERMINATED")
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("exits with failure when an owned renderer's root becomes dead", async () => {
    const file = join(srcDir, "__tests__", "owned-root-failure.tmp.tsx")
    writeFileSync(file, OWNED_ROOT_FAILURE_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(1)
      expect(result.signal).toBeNull()
      expect(result.output).toContain(
        "React root is dead after an uncaught render error"
      )
      expect(
        result.output.match(/^OWNED_ROOT_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("keeps an owned renderer alive behind a runtime error overlay when the app root dies", async () => {
    const file = join(srcDir, "__tests__", "overlay-app-root-failure.tmp.tsx")
    writeFileSync(file, OVERLAY_APP_ROOT_FAILURE_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).toContain(
        "React root is dead after an uncaught render error"
      )
      expect(result.output).toContain("OVERLAY_SHOWN")
      // Not the fatal path: quit came from the test explicitly clicking
      // through the loop after observing the overlay, not from us tearing
      // the window down when the app root died.
      expect(result.output).not.toContain(
        "fatal JavaScript error (uncaught React root error); quitting native application"
      )
      expect(
        result.output.match(/^OVERLAY_ROOT_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("keeps an owned renderer alive behind a runtime error overlay on an uncaught exception", async () => {
    const file = join(srcDir, "__tests__", "overlay-uncaught-exception.tmp.tsx")
    writeFileSync(file, OVERLAY_UNCAUGHT_EXCEPTION_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).toContain("INJECTED_OVERLAY_UNCAUGHT_EXCEPTION")
      expect(result.output).toContain("OVERLAY_SHOWN")
      expect(result.output).not.toContain(
        "fatal JavaScript error (uncaughtException); quitting native application"
      )
      expect(
        result.output.match(/^OVERLAY_EXCEPTION_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("keeps the frame loop alive for a first-render failure so the overlay can paint and quit", async () => {
    const file = join(srcDir, "__tests__", "overlay-first-render-failure.tmp.tsx")
    writeFileSync(file, OVERLAY_FIRST_RENDER_FAILURE_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).toContain(
        "React root is dead after an uncaught render error"
      )
      expect(result.output).toContain("OVERLAY_SHOWN")
      // The quit assertion is what proves the frame loop was actually
      // running: without it, quit() cannot deliver `terminated` at all.
      expect(
        result.output.match(/^OVERLAY_FIRST_RENDER_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("clears the overlay and restores the app when Reload is clicked", async () => {
    const file = join(srcDir, "__tests__", "overlay-reload.tmp.tsx")
    writeFileSync(file, OVERLAY_RELOAD_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).toContain("OVERLAY_SHOWN")
      expect(result.output).toContain("RELOAD_RESTORED_CONTENT")
      expect(
        result.output.match(/^OVERLAY_RELOAD_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("shows the runtime error overlay when a clicked event handler throws", async () => {
    const file = join(srcDir, "__tests__", "overlay-event-handler-throw.tmp.tsx")
    writeFileSync(file, OVERLAY_EVENT_HANDLER_THROW_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file])
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).toContain("OVERLAY_SHOWN")
      expect(
        result.output.match(/^OVERLAY_EVENT_TERMINATED$/gm),
        result.output
      ).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 20_000)

  it("unmounts after the native window is destroyed and exits after programmatic quit", async () => {
    const file = join(srcDir, "__tests__", "programmatic-quit.tmp.tsx")
    writeFileSync(file, PROGRAMMATIC_QUIT_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", ["--hot", file], 3_000)
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).not.toContain("window not found")
      expect(result.output).not.toContain("React unmount failed")
      expect(result.output.match(/^QUIT_REACT_UNMOUNTED$/gm), result.output).toHaveLength(1)
      expect(result.output.match(/^QUIT_TERMINATED$/gm), result.output).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 10_000)

  it("reports the active role-less element from a running renderer", async () => {
    const file = join(srcDir, "__tests__", "readable-focus.tmp.tsx")
    writeFileSync(file, READABLE_FOCUS_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file], 3_000)
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).not.toContain("READABLE_FOCUS_TIMEOUT")
      expect(result.output.match(/^READABLE_FOCUS_OK \d+$/gm), result.output).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 10_000)

  it("exits with failure after programmatic quit even when React unmount throws", async () => {
    const file = join(srcDir, "__tests__", "failing-unmount-quit.tmp.tsx")
    writeFileSync(file, FAILING_UNMOUNT_QUIT_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", ["--hot", file], 3_000)
      expect(result.code, result.output).toBe(1)
      expect(result.signal).toBeNull()
      expect(result.output).toContain("INJECTED_UNMOUNT_FAILURE")
      expect(result.output).toContain("React unmount failed during termination")
      expect(result.output).not.toContain("repeated native tick failure")
      expect(result.output.match(/^QUIT_FAILURE_CLEANUP_FINISHED$/gm), result.output).toHaveLength(1)
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 10_000)

  it("delivers menu actions from an injected production renderer", async () => {
    const file = join(srcDir, "__tests__", "injected-native-menu.tmp.tsx")
    writeFileSync(file, INJECTED_NATIVE_MENU_PROGRAM)

    try {
      const result = await runChildWithStatus("bun", [file], 3_000)
      expect(result.code, result.output).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.output).not.toContain("INJECTED_NATIVE_MENU_TIMEOUT")
      expect(result.output.match(/^INJECTED_NATIVE_MENU_ACTION mark$/gm), result.output).toHaveLength(
        1
      )
    } finally {
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 10_000)
})
