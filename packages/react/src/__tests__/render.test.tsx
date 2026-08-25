/// Persist-and-remount tests for render(). bun --hot re-evaluates the entry
/// and calls render() again; the native host must stay the same instance.

import { spawn } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import {
  hasNativeTestRenderer,
  nativeTestRendererError,
  TestRenderer,
} from "../testing.js"
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

const slot = globalThis
slot.__hotEvals = (slot.__hotEvals ?? 0) + 1
if (!slot.__hotRenderer) {
  slot.__hotRenderer = new TestRenderer()
}
const renderer = slot.__hotRenderer
render(React.createElement("text", null, ${JSON.stringify(label)}), { renderer })
renderer.flush()
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

const ESM_TESTING_PROGRAM = `
import {
  TestRenderer,
  hasNativeTestRenderer,
  nativeTestRendererLoadError,
} from "@gpuix/react/testing"

if (!hasNativeTestRenderer()) {
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
import "@gpuix/react/testing"

if (globalThis.__gpuixNativeModuleLoads !== 0) {
  throw new Error("bare testing import loaded @gpuix/native")
}
if (globalThis.__gpuixNativeTestRendererConstructions !== 0) {
  throw new Error("bare testing import constructed TestGpuixRenderer")
}

console.log("BARE_TESTING_IMPORT_OK")
`

const LAZY_NATIVE_TEST_RENDERER_PROGRAM = `
import { hasNativeTestRenderer } from "@gpuix/react/testing"

if (!hasNativeTestRenderer()) {
  throw new Error("expected the native test renderer to initialize")
}
if (globalThis.__gpuixNativeModuleLoads !== 1) {
  throw new Error("first availability check did not load @gpuix/native exactly once")
}
if (globalThis.__gpuixNativeTestRendererConstructions !== 1) {
  throw new Error("first availability check did not construct TestGpuixRenderer exactly once")
}
if (!hasNativeTestRenderer()) {
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

const describeNative = hasNativeTestRenderer() ? describe : describe.skip

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
    if (!hasNativeTestRenderer()) {
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
      await new Promise((resolve) => setTimeout(resolve, 300))

      writeFileSync(file, hotAppSource("world"))

      await output.wait("HOT_LABEL world", 15_000)
      await output.wait('HOT_TEXT ["world"]', 1000)
      await output.wait("HOT_SAME_RENDERER true", 1000)
    } finally {
      child.kill("SIGTERM")
      try {
        unlinkSync(file)
      } catch {}
    }
  }, 40_000)
})
