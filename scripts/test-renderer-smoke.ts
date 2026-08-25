import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const nativeEntry = fileURLToPath(
  new URL("../packages/native/index.js", import.meta.url)
)
const env = {
  ...process.env,
  GPUI_TEST_DISABLE_DISPLAY_DISCOVERY: "1",
}
const faultInjection = process.argv.includes("--fault-injection")

function runChild(name: string, source: string) {
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  })

  if (result.status !== 0) {
    throw new Error(
      `${name} failed with status ${result.status} and signal ${result.signal}\n${
        result.error?.stack ?? ""
      }\n${result.stdout}${result.stderr}`
    )
  }

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
}

runChild(
  "packaged test renderer",
  `
const { TestGpuixRenderer } = require(${JSON.stringify(nativeEntry)})
if (typeof TestGpuixRenderer !== "function") {
  throw new Error("packaged binding does not export TestGpuixRenderer")
}
new TestGpuixRenderer()
console.log("packaged test renderer uses the virtual display")
`
)

if (!faultInjection) {
  runChild(
    "published binding fault-injection surface",
    `
const native = require(${JSON.stringify(nativeEntry)})
if (typeof native.testMacosAutoreleasePoolDrainCount !== "undefined") {
  throw new Error("published binding includes display fault-injection counters")
}
if (typeof native.testMacosNativeWindowAllocationCount !== "undefined") {
  throw new Error("published binding includes native window allocation counters")
}
console.log("published binding excludes display fault injection")
`
  )
} else {
  for (let attempt = 1; attempt <= 5; attempt++) {
    runChild(
      `production initialization panic surface attempt ${attempt}`,
      `
const {
  GpuixRenderer,
  testMacosAutoreleasePoolDrainCount,
  testMacosNativeWindowAllocationCount,
} = require(${JSON.stringify(nativeEntry)})
if (typeof testMacosAutoreleasePoolDrainCount !== "function") {
  throw new Error("fault-injection binding does not export the autorelease-pool counter")
}
if (typeof testMacosNativeWindowAllocationCount !== "function") {
  throw new Error("fault-injection binding does not export the native-window counter")
}

const drainsBefore = testMacosAutoreleasePoolDrainCount()
const allocationsBefore = testMacosNativeWindowAllocationCount()
const renderer = new GpuixRenderer()
try {
  renderer.init()
  throw new Error("production renderer unexpectedly initialized")
} catch (error) {
  const message = String(error)
  if (!message.includes("GPUI macOS renderer initialization")) throw error
  if (!message.includes("display discovery disabled by GPUI_TEST_DISABLE_DISPLAY_DISCOVERY")) throw error
}

const drainsAfter = testMacosAutoreleasePoolDrainCount()
const allocationsAfter = testMacosNativeWindowAllocationCount()
if (drainsAfter !== drainsBefore + 1) {
  throw new Error(
    "autorelease pool was not drained on unwind: before=" + drainsBefore + ", after=" + drainsAfter
  )
}
if (allocationsAfter !== allocationsBefore) {
  throw new Error(
    "native window was allocated before display resolution: before=" + allocationsBefore + ", after=" + allocationsAfter
  )
}
console.log("failed initialization drained its pool before allocating a native window")
`
    )
  }
}
