/// Persist-and-remount tests for render(). bun --hot re-evaluates the entry
/// and calls render() again; the native host must stay the same instance.

import { spawn } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import {
  isNativeTestRendererAvailable,
  nativeTestRendererError,
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
  onTerminated: () => console.log("FATAL_TERMINATED"),
})

setTimeout(() => {
  throw new Error("INJECTED_FATAL_HOT_ERROR")
}, 50)
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
  onTerminated: () => console.log("QUIT_TERMINATED"),
})

setTimeout(() => renderer.quit(), 50)
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
renderer.init({ title: "GPUIX injected menu smoke", menus: [] })

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
renderer.createElement(1, "text")
renderer.setText(1, "esm test binding")
renderer.setRoot(1)
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
import {
  getAllByText,
  getByText,
  getChildren,
  getParent,
  queryByText,
  textContent,
  within,
} from "@gpuix/react/testing"

if ([getAllByText, getByText, getChildren, getParent, queryByText, textContent, within].some(
  (query) => typeof query !== "function"
)) {
  throw new Error("testing queries were not exported")
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
      expect(nativeTestRendererError).toBeInstanceOf(Error)
      expect(() => new TestRenderer()).toThrow(nativeTestRendererError!.message)
      return
    }

    expect(nativeTestRendererError).toBeNull()
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
      return <text testId={id} />
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
