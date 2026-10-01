/// The built native binding, loaded in a fresh process with macOS display
/// discovery disabled.
///
/// The default build must construct its test renderer on the virtual display
/// and carry no fault-injection counters. A binding built with
/// `display-discovery-fault-injection` exports those counters; point
/// `NAPI_RS_NATIVE_LIBRARY_PATH` at one to run the failed-initialization case.

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { isNativeTestRendererAvailable } from "../testing.js"

const nativeEntry = createRequire(import.meta.url).resolve("@gpuix/native")
const faultBinding = Boolean(process.env.NAPI_RS_NATIVE_LIBRARY_PATH)

const describeMac =
  process.platform === "darwin" && isNativeTestRendererAvailable() ? describe : describe.skip

function runChild(source: string): { status: number | null; output: string } {
  const result = spawnSync("bun", ["-e", source], {
    encoding: "utf8",
    env: { ...process.env, GPUI_TEST_DISABLE_DISPLAY_DISCOVERY: "1" },
    timeout: 15_000,
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describeMac("native binding without display discovery", () => {
  it("constructs the test renderer on the virtual display", () => {
    const child = runChild(`
      const { TestGpuixRenderer } = require(${JSON.stringify(nativeEntry)})
      if (typeof TestGpuixRenderer !== "function") {
        throw new Error("binding does not export TestGpuixRenderer")
      }
      new TestGpuixRenderer()
    `)

    expect(child.status, child.output).toBe(0)
  })

  it.skipIf(faultBinding)("leaves the fault-injection counters out of the default build", () => {
    const child = runChild(`
      const native = require(${JSON.stringify(nativeEntry)})
      console.log(JSON.stringify([
        typeof native.testMacosAutoreleasePoolDrainCount,
        typeof native.testMacosNativeWindowAllocationCount,
      ]))
    `)

    expect(child.status, child.output).toBe(0)
    expect(JSON.parse(child.output)).toEqual(["undefined", "undefined"])
  })

  it.skipIf(!faultBinding)(
    "drains the autorelease pool and allocates no window when initialization fails",
    { timeout: 90_000 },
    () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const child = runChild(`
          const {
            GpuixRenderer,
            testMacosAutoreleasePoolDrainCount,
            testMacosNativeWindowAllocationCount,
          } = require(${JSON.stringify(nativeEntry)})

          const drainsBefore = testMacosAutoreleasePoolDrainCount()
          const allocationsBefore = testMacosNativeWindowAllocationCount()
          let message = "initialized"
          try {
            new GpuixRenderer().init()
          } catch (error) {
            message = String(error)
          }

          console.log(JSON.stringify({
            message,
            drains: testMacosAutoreleasePoolDrainCount() - drainsBefore,
            allocations: testMacosNativeWindowAllocationCount() - allocationsBefore,
          }))
        `)

        expect(child.status, `attempt ${attempt}\n${child.output}`).toBe(0)
        const result = JSON.parse(child.output)
        expect(result.message).toContain("GPUI macOS renderer initialization")
        expect(result.message).toContain(
          "display discovery disabled by GPUI_TEST_DISABLE_DISPLAY_DISCOVERY",
        )
        expect(result).toMatchObject({ drains: 1, allocations: 0 })
      }
    },
  )
})
